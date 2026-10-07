import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatSeconds } from "@/lib/utils/time";
import ReportChart from "./ReportChart";
import SessionHistory from "./SessionHistory";

interface SessionRow {
  id: string;
  student_id: string;
  started_at: string;
  ended_at: string | null;
  active_seconds: number;
  idle_seconds: number;
  last_page: number;
}

interface StudentReport {
  studentId: string;
  fullName: string;
  totalActiveSeconds: number;
  totalIdleSeconds: number;
  sessionCount: number;
  lastReadDate: string | null;
  sessions: SessionRow[];
}

export default async function DocumentReportPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // 1. Fetch document details
  const { data: document, error: docError } = await supabase
    .from("documents")
    .select("id, title, file_type, created_at, teacher_id")
    .eq("id", params.id)
    .single();

  if (docError || !document) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        Document not found.
      </div>
    );
  }

  // Verify teacher owns this document
  if (document.teacher_id !== user.id) {
    redirect("/teacher");
  }

  // 2. All assignments for this document with student profiles
  const { data: assignments, error: assignError } = await supabase
    .from("assignments")
    .select("id, student_id, profiles(id, full_name)")
    .eq("document_id", params.id);

  // 3. All reading sessions for this document
  const { data: sessions, error: sessionError } = await supabase
    .from("reading_sessions")
    .select(
      "id, student_id, started_at, ended_at, active_seconds, idle_seconds, last_page"
    )
    .eq("document_id", params.id)
    .order("started_at", { ascending: false });

  // Build per-student report
  const studentMap = new Map<string, StudentReport>();

  for (const assignment of assignments ?? []) {
    const profile = assignment.profiles as unknown as {
      id: string;
      full_name: string;
    } | null;
    const studentId = assignment.student_id;
    const fullName = profile?.full_name ?? "Unknown Student";

    if (!studentMap.has(studentId)) {
      studentMap.set(studentId, {
        studentId,
        fullName,
        totalActiveSeconds: 0,
        totalIdleSeconds: 0,
        sessionCount: 0,
        lastReadDate: null,
        sessions: [],
      });
    }
  }

  for (const session of sessions ?? []) {
    let entry = studentMap.get(session.student_id);
    if (!entry) {
      // Session from a student not currently assigned — still include them
      entry = {
        studentId: session.student_id,
        fullName: "Unknown Student",
        totalActiveSeconds: 0,
        totalIdleSeconds: 0,
        sessionCount: 0,
        lastReadDate: null,
        sessions: [],
      };
      studentMap.set(session.student_id, entry);
    }

    entry.totalActiveSeconds += session.active_seconds ?? 0;
    entry.totalIdleSeconds += session.idle_seconds ?? 0;
    entry.sessionCount += 1;
    entry.sessions.push(session as SessionRow);

    if (
      !entry.lastReadDate ||
      session.started_at > entry.lastReadDate
    ) {
      entry.lastReadDate = session.started_at;
    }
  }

  const reports: StudentReport[] = Array.from(studentMap.values()).sort(
    (a, b) => a.fullName.localeCompare(b.fullName)
  );

  const chartData = reports.map((r) => ({
    name: r.fullName,
    activeMinutes: parseFloat((r.totalActiveSeconds / 60).toFixed(1)),
  }));

  return (
    <div className="space-y-8">
      {/* Back + header */}
      <div>
        <Link
          href="/teacher"
          className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          ← Back to Documents
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">{document.title}</h1>
          <FileBadge type={document.file_type} />
          <span className="text-sm text-gray-400">
            Uploaded {new Date(document.created_at).toLocaleDateString()}
          </span>
        </div>
      </div>

      {(assignError || sessionError) && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          Some data could not be loaded. Results may be incomplete.
        </div>
      )}

      {reports.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-gray-400">
          No students assigned to this document yet.
        </div>
      ) : (
        <>
          {/* Summary table */}
          <section>
            <h2 className="mb-3 text-base font-semibold text-gray-700">
              Student Summary
            </h2>
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <th className="px-6 py-3">Student</th>
                    <th className="px-6 py-3">Active Time</th>
                    <th className="px-6 py-3">Idle Time</th>
                    <th className="px-6 py-3">Sessions</th>
                    <th className="px-6 py-3">Last Read</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {reports.map((r) => (
                    <tr key={r.studentId} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 font-medium text-gray-900">
                        {r.fullName}
                      </td>
                      <td className="px-6 py-4 text-gray-600">
                        {formatSeconds(r.totalActiveSeconds)}
                      </td>
                      <td className="px-6 py-4 text-gray-600">
                        {formatSeconds(r.totalIdleSeconds)}
                      </td>
                      <td className="px-6 py-4 text-gray-600">
                        {r.sessionCount}
                      </td>
                      <td className="px-6 py-4 text-gray-400">
                        {r.lastReadDate
                          ? new Date(r.lastReadDate).toLocaleDateString()
                          : "Never"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Chart */}
          <section>
            <h2 className="mb-3 text-base font-semibold text-gray-700">
              Active Reading Time per Student (minutes)
            </h2>
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <ReportChart data={chartData} />
            </div>
          </section>

          {/* Session history */}
          <section>
            <h2 className="mb-3 text-base font-semibold text-gray-700">
              Session History
            </h2>
            <SessionHistory
              students={reports.map((r) => ({
                studentId: r.studentId,
                fullName: r.fullName,
                sessions: r.sessions,
              }))}
            />
          </section>
        </>
      )}
    </div>
  );
}

function FileBadge({ type }: { type: string }) {
  if (type === "pdf") {
    return (
      <span className="inline-flex items-center rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700 ring-1 ring-inset ring-red-200">
        PDF
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-200">
      DOCX
    </span>
  );
}
