import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

// Service-role client bypasses storage RLS
function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: NextRequest) {
  // 1. Authenticate with the SSR client (reads session cookies)
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Confirm the user is a teacher
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.role !== "teacher") {
    return NextResponse.json({ error: "Forbidden: teachers only" }, { status: 403 });
  }

  // 3. Parse multipart form data
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  const title = (formData.get("title") as string | null)?.trim();
  const studentIdsRaw = (formData.get("studentIds") as string | null) ?? "";

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (!title) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  // 4. Validate file type
  const originalName = file.name;
  const ext = originalName.split(".").pop()?.toLowerCase();
  if (ext !== "pdf" && ext !== "docx") {
    return NextResponse.json(
      { error: "Only PDF and DOCX files are allowed" },
      { status: 400 }
    );
  }
  const fileType = ext as "pdf" | "docx";

  const studentIds = studentIdsRaw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (studentIds.length > 0) {
    const { data: roster, error: rosterError } = await supabase
      .from("teacher_students")
      .select("student_id")
      .eq("teacher_id", user.id)
      .in("student_id", studentIds);

    if (rosterError || (roster?.length ?? 0) !== new Set(studentIds).size) {
      return NextResponse.json(
        { error: "You can only assign documents to students on your roster" },
        { status: 403 }
      );
    }
  }

  // 5. Upload to Supabase Storage using the service-role client
  const serviceSupabase = createServiceClient();
  const storagePath = `${user.id}/${randomUUID()}.${ext}`;
  const fileBuffer = await file.arrayBuffer();

  const { error: storageError } = await serviceSupabase.storage
    .from("documents")
    .upload(storagePath, fileBuffer, {
      contentType: file.type || (ext === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
      upsert: false,
    });

  if (storageError) {
    return NextResponse.json(
      { error: `Storage error: ${storageError.message}` },
      { status: 500 }
    );
  }

  // 6. Insert the document row (uses teacher's SSR client so RLS teacher_id check passes)
  const { data: doc, error: docError } = await supabase
    .from("documents")
    .insert({ title, file_path: storagePath, file_type: fileType, teacher_id: user.id })
    .select("id")
    .single();

  if (docError || !doc) {
    return NextResponse.json(
      { error: `Document insert error: ${docError?.message}` },
      { status: 500 }
    );
  }

  // 7. Insert assignments for each selected student
  if (studentIds.length > 0) {
    const rows = studentIds.map((studentId) => ({
      document_id: doc.id,
      student_id: studentId,
    }));

    const { error: assignError } = await supabase.from("assignments").insert(rows);

    if (assignError) {
      return NextResponse.json(
        { error: `Assignment error: ${assignError.message}` },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ documentId: doc.id }, { status: 200 });
}
