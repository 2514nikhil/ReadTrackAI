import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

const PUBLIC_PATHS = ["/login", "/signup"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const { supabaseResponse, user, supabase } = await updateSession(request);

  // Allow public auth pages through
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    // If already authenticated, redirect to the correct dashboard
    if (user) {
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
      const dest = role === "teacher" ? "/teacher" : "/student";
      return NextResponse.redirect(new URL(dest, request.url));
    }
    return supabaseResponse;
  }

  // Unauthenticated users get sent to /login
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Role-guard: /student only for students, /teacher only for teachers
  if (pathname.startsWith("/student") || pathname.startsWith("/teacher")) {
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

    if (pathname.startsWith("/student") && role !== "student" && profile?.role) {
      return NextResponse.redirect(new URL("/teacher", request.url));
    }
    if (pathname.startsWith("/teacher") && role !== "teacher" && profile?.role) {
      return NextResponse.redirect(new URL("/student", request.url));
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     * - _next/static  (Next.js static assets)
     * - _next/image   (Next.js image optimisation)
     * - favicon.ico
     * - Public static files with known extensions:
    *     images, fonts, WASM binaries, task/onnx model files, JS workers, and modules
     *
     * This ensures the auth middleware never touches files that are fetched
     * directly by onnxruntime-web, pdfjs-dist, or MediaPipe.
     */
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?|ttf|wasm|task|onnx|js|mjs)$).*)",
  ],
};
