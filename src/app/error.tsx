"use client";

import { useEffect } from "react";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Global error boundary for the Next.js App Router.
 * Shown whenever an unhandled error is thrown in a page or layout.
 */
export default function GlobalError({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    // Log to console; swap for a real error service (e.g. Sentry) if needed.
    console.error("[ReadTrack] Unhandled error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-gray-50">
        <div className="flex min-h-screen items-center justify-center px-4">
          <div className="w-full max-w-md rounded-xl border border-red-200 bg-white p-8 text-center shadow-sm">
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
              <svg
                className="h-6 w-6 text-red-600"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                />
              </svg>
            </div>

            <h1 className="mb-2 text-lg font-bold text-gray-900">
              Something went wrong
            </h1>
            <p className="mb-1 text-sm text-gray-600">
              An unexpected error occurred. Your reading progress has been saved
              if a session was active.
            </p>
            {error.message && (
              <p className="mb-4 rounded-md bg-gray-50 px-3 py-2 text-xs font-mono text-gray-500">
                {error.message}
              </p>
            )}

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
              <button
                onClick={reset}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
              >
                Try again
              </button>
              <a
                href="/"
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Go home
              </a>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
