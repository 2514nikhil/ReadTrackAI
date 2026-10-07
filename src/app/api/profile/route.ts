import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, full_name, role, face_embedding")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: profile.id,
    full_name: profile.full_name,
    role: profile.role,
    has_face_embedding: profile.face_embedding !== null,
    face_embedding: profile.face_embedding ?? null,
  });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.role !== "student") {
    return NextResponse.json({ error: "Forbidden: students only" }, { status: 403 });
  }

  let body: { face_embedding: number[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { face_embedding } = body;
  if (!Array.isArray(face_embedding) || face_embedding.length === 0) {
    return NextResponse.json(
      { error: "face_embedding must be a non-empty number array" },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("profiles")
    .update({ face_embedding })
    .eq("id", user.id);

  if (error) {
    return NextResponse.json(
      { error: `Failed to save embedding: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}

export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.role !== "student") {
    return NextResponse.json({ error: "Forbidden: students only" }, { status: 403 });
  }

  const { error } = await supabase
    .from("profiles")
    .update({ face_embedding: null })
    .eq("id", user.id);

  if (error) {
    return NextResponse.json(
      { error: `Failed to delete embedding: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
