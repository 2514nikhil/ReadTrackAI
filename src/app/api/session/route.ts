import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface SessionBody {
  sessionId?: string;
  documentId: string;
  activeSeconds: number;
  idleSeconds: number;
  lastPage: number;
  ended: boolean;
}

export async function POST(request: NextRequest) {
  // 1. Authenticate
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Confirm user is a student
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.role !== "student") {
    return NextResponse.json({ error: "Forbidden: students only" }, { status: 403 });
  }

  // 3. Parse JSON body
  let body: SessionBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { sessionId, documentId, activeSeconds, idleSeconds, lastPage, ended } = body;

  if (!documentId) {
    return NextResponse.json({ error: "documentId is required" }, { status: 400 });
  }
  if (typeof activeSeconds !== "number" || typeof idleSeconds !== "number") {
    return NextResponse.json({ error: "activeSeconds and idleSeconds must be numbers" }, { status: 400 });
  }

  // 4. Verify the document is assigned to this student
  const { data: assignment } = await supabase
    .from("assignments")
    .select("document_id")
    .eq("document_id", documentId)
    .eq("student_id", user.id)
    .maybeSingle();

  if (!assignment) {
    return NextResponse.json({ error: "Document not assigned to this student" }, { status: 403 });
  }

  // 5. INSERT or UPDATE
  if (!sessionId) {
    // Create a new session
    const { data: newSession, error: insertError } = await supabase
      .from("reading_sessions")
      .insert({
        student_id: user.id,
        document_id: documentId,
        active_seconds: activeSeconds,
        idle_seconds: idleSeconds,
        last_page: lastPage,
        ended_at: ended ? new Date().toISOString() : null,
      })
      .select("id")
      .single();

    if (insertError || !newSession) {
      return NextResponse.json(
        { error: `Failed to create session: ${insertError?.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ sessionId: newSession.id }, { status: 201 });
  } else {
    // Update existing session — verify ownership first
    const { error: updateError } = await supabase
      .from("reading_sessions")
      .update({
        active_seconds: activeSeconds,
        idle_seconds: idleSeconds,
        last_page: lastPage,
        ...(ended ? { ended_at: new Date().toISOString() } : {}),
      })
      .eq("id", sessionId)
      .eq("student_id", user.id);

    if (updateError) {
      return NextResponse.json(
        { error: `Failed to update session: ${updateError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ sessionId }, { status: 200 });
  }
}
