import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatSeconds } from "@/lib/utils/time";

export default async function StudentDashboard() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user!.id)
    .maybeSingle();

  // Fetch assignments joined with documents
  const { data: assignments, error } = await supabase
    .from("assignments")
    .select("document_id, documents(id, title, file_type)")
    .eq("student_id", user!.id)
    .order("document_id");

  // Fetch all reading session totals for this student in one query
  const { data: sessions } = await supabase
    .from("reading_sessions")
    .select("document_id, active_seconds")
    .eq("student_id", user!.id);

  // Build a map of document_id → total active seconds
  const secondsMap: Record<string, number> = {};
  if (sessions) {
    for (const s of sessions) {
      secondsMap[s.document_id] = (secondsMap[s.document_id] ?? 0) + (s.active_seconds ?? 0);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">My Documents</h1>
        <p className="mt-1 text-gray-500">
          Welcome back,{" "}
          <span className="font-medium text-gray-700">
            {profile?.full_name ?? user!.email}
          </span>
          !
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load documents: {error.message}
        </div>
      )}

      {!error && (!assignments || assignments.length === 0) ? (
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center">
          <p className="text-gray-400">No documents assigned to you yet.</p>
          <p className="mt-1 text-xs text-gray-300">
            Check back after your teacher uploads and assigns documents.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {assignments?.map((a) => {
            const doc = a.documents as unknown as {
              id: string;
              title: string;
              file_type: string;
            } | null;
            if (!doc) return null;

            const totalSeconds = secondsMap[doc.id] ?? 0;

            return (
              <div
                key={doc.id}
                className="flex flex-col rounded-xl border border-gray-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <h2 className="text-sm font-semibold text-gray-900 leading-snug">
                    {doc.title}
                  </h2>
                  <FileBadge type={doc.file_type} />
                </div>

                <div className="mt-auto pt-3 border-t border-gray-100 flex items-center justify-between">
                  <span className="text-xs text-gray-400">
                    Read time:{" "}
                    <span className="font-medium text-gray-600">
                      {formatSeconds(totalSeconds)}
                    </span>
                  </span>
                  <Link
                    href={`/student/read/${doc.id}`}
                    className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 transition-colors"
                  >
                    Read
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FileBadge({ type }: { type: string }) {
  if (type === "pdf") {
    return (
      <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700 ring-1 ring-inset ring-red-200 whitespace-nowrap">
        PDF
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-200 whitespace-nowrap">
      DOCX
    </span>
  );
}
