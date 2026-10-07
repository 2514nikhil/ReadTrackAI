import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function TeacherDashboard() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user!.id)
    .maybeSingle();

  // Fetch this teacher's documents with a count of students assigned
  const { data: documents, error } = await supabase
    .from("documents")
    .select("id, title, file_type, created_at, assignments(count)")
    .eq("teacher_id", user!.id)
    .order("created_at", { ascending: false });

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Teacher Dashboard</h1>
          <p className="mt-1 text-gray-500">
            Welcome back,{" "}
            <span className="font-medium text-gray-700">
              {profile?.full_name ?? user!.email}
            </span>
            !
          </p>
        </div>
        <Link
          href="/teacher/upload"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 transition-colors"
        >
          + Upload Document
        </Link>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load documents: {error.message}
        </div>
      )}

      {!error && (!documents || documents.length === 0) ? (
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center">
          <p className="text-gray-400">No documents uploaded yet.</p>
          <Link
            href="/teacher/upload"
            className="mt-4 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
          >
            Upload your first document
          </Link>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <th className="px-6 py-3">Title</th>
                <th className="px-6 py-3">Type</th>
                <th className="px-6 py-3">Students</th>
                <th className="px-6 py-3">Uploaded</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {documents?.map((doc) => {
                const assignmentCount =
                  // Supabase returns [{count: N}] for aggregated counts
                  (doc.assignments as unknown as { count: number }[])?.[0]?.count ?? 0;

                return (
                  <tr key={doc.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 font-medium text-gray-900">
                      {doc.title}
                    </td>
                    <td className="px-6 py-4">
                      <FileBadge type={doc.file_type} />
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {assignmentCount} student{assignmentCount !== 1 ? "s" : ""}
                    </td>
                    <td className="px-6 py-4 text-gray-400">
                      {new Date(doc.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link
                        href={`/teacher/documents/${doc.id}`}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 transition-colors"
                      >
                        View Report
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
