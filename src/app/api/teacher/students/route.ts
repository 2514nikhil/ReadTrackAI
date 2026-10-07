import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function getTeacher() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { supabase, user: null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  return { supabase, user: profile?.role === "teacher" ? user : null };
}

export async function GET() {
  const { supabase, user } = await getTeacher();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized or forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("teacher_students")
    .select("student_id, created_at, profiles!teacher_students_student_id_fkey(id, full_name)")
    .eq("teacher_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ students: data ?? [] });
}

export async function POST(request: NextRequest) {
  const { supabase, user } = await getTeacher();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized or forbidden" }, { status: 403 });
  }

  let body: { email?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "Student email is required" }, { status: 400 });
  }

  const serviceSupabase = createServiceClient();
  const { data: users, error: usersError } = await serviceSupabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  const studentUser = users?.users.find((candidate) => candidate.email?.toLowerCase() === email);

  if (usersError || !studentUser) {
    return NextResponse.json({ error: "No account found for that email" }, { status: 404 });
  }

  const { data: studentProfile } = await serviceSupabase
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", studentUser.id)
    .maybeSingle();

  if (studentProfile?.role !== "student") {
    return NextResponse.json({ error: "That account is not a student account" }, { status: 400 });
  }

  const { error: insertError } = await supabase.from("teacher_students").insert({
    teacher_id: user.id,
    student_id: studentUser.id,
  });

  if (insertError) {
    if (insertError.code === "23505") {
      return NextResponse.json({ error: "Student is already on your roster" }, { status: 409 });
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ student: studentProfile }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const { supabase, user } = await getTeacher();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized or forbidden" }, { status: 403 });
  }

  const studentId = new URL(request.url).searchParams.get("studentId");
  if (!studentId) {
    return NextResponse.json({ error: "studentId is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("teacher_students")
    .delete()
    .eq("teacher_id", user.id)
    .eq("student_id", studentId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
