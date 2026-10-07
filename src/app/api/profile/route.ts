import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

function createAdminClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function getOrCreateProfile(
  supabase: Awaited<ReturnType<typeof createClient>>,
  user: { id: string; email?: string; user_metadata: Record<string, unknown> }
) {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, full_name, role, face_embedding")
    .eq("id", user.id)
    .maybeSingle();

  if (error || profile) return { profile, error };

  const role = user.user_metadata.role === "teacher" ? "teacher" : "student";
  const fullName =
    typeof user.user_metadata.full_name === "string" && user.user_metadata.full_name
      ? user.user_metadata.full_name
      : user.email ?? "ReadTrack user";

  const { data: createdProfile, error: createError } = await createAdminClient()
    .from("profiles")
    .insert({ id: user.id, full_name: fullName, role })
    .select("id, full_name, role, face_embedding")
    .single();

  return { profile: createdProfile, error: createError };
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { profile, error } = await getOrCreateProfile(supabase, user);

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

  const { profile, error: profileError } = await getOrCreateProfile(supabase, user);

  if (profileError) {
    return NextResponse.json(
      { error: `Could not initialize profile: ${profileError.message}` },
      { status: 500 }
    );
  }

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

  const { profile, error: profileError } = await getOrCreateProfile(supabase, user);

  if (profileError) {
    return NextResponse.json(
      { error: `Could not initialize profile: ${profileError.message}` },
      { status: 500 }
    );
  }

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
