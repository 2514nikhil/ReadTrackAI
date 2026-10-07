import Link from "next/link";

/**
 * Shown for any URL that doesn't match a route — the App Router 404 page.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <p className="mb-1 text-5xl font-black text-gray-200">404</p>
        <h1 className="mb-2 text-lg font-bold text-gray-900">Page not found</h1>
        <p className="mb-6 text-sm text-gray-500">
          The page you&apos;re looking for doesn&apos;t exist or you don&apos;t
          have permission to view it.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link
            href="/student"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
          >
            Student dashboard
          </Link>
          <Link
            href="/teacher"
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Teacher dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
