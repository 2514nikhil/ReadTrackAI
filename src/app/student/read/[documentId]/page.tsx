import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DocumentReader from "./DocumentReader";

interface PageProps {
  params: Promise<{ documentId: string }>;
}

export default async function ReadDocumentPage({ params }: PageProps) {
  const { documentId } = await params;
  const supabase = await createClient();

  // Get the current user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    notFound();
  }

  // Verify the document is assigned to this student and fetch doc info
  const { data: assignment } = await supabase
    .from("assignments")
    .select("document_id, documents(id, title, file_type, file_path)")
    .eq("document_id", documentId)
    .eq("student_id", user.id)
    .single();

  if (!assignment) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center max-w-md">
          <h2 className="text-lg font-semibold text-red-800 mb-2">Document Not Found</h2>
          <p className="text-sm text-red-600">
            This document doesn&apos;t exist or hasn&apos;t been assigned to you.
          </p>
          <a
            href="/student"
            className="mt-4 inline-block rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 transition-colors"
          >
            Back to Dashboard
          </a>
        </div>
      </div>
    );
  }

  const doc = assignment.documents as unknown as {
    id: string;
    title: string;
    file_type: string;
    file_path: string;
  } | null;

  if (!doc) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center max-w-md">
          <h2 className="text-lg font-semibold text-red-800 mb-2">Document Error</h2>
          <p className="text-sm text-red-600">Could not load document information.</p>
          <a
            href="/student"
            className="mt-4 inline-block rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 transition-colors"
          >
            Back to Dashboard
          </a>
        </div>
      </div>
    );
  }

  // Generate a signed URL valid for 1 hour
  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from("documents")
    .createSignedUrl(doc.file_path, 3600);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center max-w-md">
          <h2 className="text-lg font-semibold text-red-800 mb-2">Could Not Load File</h2>
          <p className="text-sm text-red-600">
            Failed to generate a download link for this document.{" "}
            {signedUrlError?.message}
          </p>
          <a
            href="/student"
            className="mt-4 inline-block rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 transition-colors"
          >
            Back to Dashboard
          </a>
        </div>
      </div>
    );
  }

  return (
    <DocumentReader
      documentId={doc.id}
      title={doc.title}
      fileType={doc.file_type as "pdf" | "docx"}
      signedUrl={signedUrlData.signedUrl}
    />
  );
}
