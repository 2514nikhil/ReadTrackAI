import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import StudentNav from "./_components/StudentNav";

export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  const role =
    profile?.role === "teacher" || profile?.role === "student"
      ? profile.role
      : user.user_metadata?.role === "teacher"
        ? "teacher"
        : "student";

  if (role !== "student") {
    redirect("/teacher");
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-6 py-3">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold text-gray-900">ReadTrack</span>
            <span className="text-sm text-gray-400">— Student</span>
          </div>
          <StudentNav />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
