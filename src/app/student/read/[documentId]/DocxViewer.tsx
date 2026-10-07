"use client";

import { useEffect, useRef, useState } from "react";
import * as docx from "docx-preview";

interface DocxViewerProps {
  url: string;
  onPageChange: (page: number, total: number) => void;
}

export default function DocxViewer({ url, onPageChange }: DocxViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const arrayBuffer = await response.arrayBuffer();

        if (cancelled || !containerRef.current) return;

        await docx.renderAsync(arrayBuffer, containerRef.current, undefined, {
          className: "docx-wrapper",
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          ignoreFonts: false,
          breakPages: true,
          useBase64URL: false,
          renderChanges: false,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
        });

        if (cancelled) return;
        // DOCX has no reliable page count — report page 1 of 1
        onPageChange(1, 1);
      } catch (err: unknown) {
        if (cancelled) return;
        setError(
          `Failed to render document: ${err instanceof Error ? err.message : String(err)}`
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // onPageChange is stable (useCallback in parent); intentionally omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
          <p className="text-sm text-gray-500">Loading document…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center max-w-md">
          <p className="text-sm font-semibold text-red-700">Error</p>
          <p className="mt-1 text-xs text-red-500">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl rounded-lg overflow-hidden shadow-md bg-white">
      {/* docx-preview renders its own styles into this container */}
      <div ref={containerRef} className="docx-container w-full" />
    </div>
  );
}
