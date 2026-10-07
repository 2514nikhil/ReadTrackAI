
"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

// Point to the worker copied into /public
pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.js";

interface PdfViewerProps {
  url: string;
  onPageChange: (page: number, total: number) => void;
}

export default function PdfViewer({ url, onPageChange }: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);

  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);

  // ---------------------------------------------------------------------------
  // Load PDF document
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const loadTask = pdfjsLib.getDocument(url);
    loadTask.promise
      .then((doc) => {
        if (cancelled) return;
        setPdfDoc(doc);
        setTotalPages(doc.numPages);
        setCurrentPage(1);
        onPageChange(1, doc.numPages);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(`Failed to load PDF: ${err instanceof Error ? err.message : String(err)}`);
        setLoading(false);
      });

    return () => {
      cancelled = true;
      loadTask.destroy();
    };
    // onPageChange is stable (useCallback in parent) — intentionally omit to
    // avoid reloading the PDF on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // ---------------------------------------------------------------------------
  // Render current page onto canvas
  // ---------------------------------------------------------------------------
  const renderPage = useCallback(
    async (doc: PDFDocumentProxy, pageNum: number) => {
      if (!canvasRef.current) return;
      setRendering(true);

      try {
        const page = await doc.getPage(pageNum);
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // Scale to fit the container width (max 900px)
        const containerWidth = Math.min(canvas.parentElement?.clientWidth ?? 900, 900);
        const viewport = page.getViewport({ scale: 1 });
        const scale = containerWidth / viewport.width;
        const scaledViewport = page.getViewport({ scale });

        canvas.width = scaledViewport.width;
        canvas.height = scaledViewport.height;

        // Cancel any in-flight render
        if (renderTaskRef.current) {
          renderTaskRef.current.cancel();
        }

        const renderTask = page.render({ canvasContext: ctx, viewport: scaledViewport });
        renderTaskRef.current = renderTask;
        await renderTask.promise;
      } catch (err: unknown) {
        // RenderingCancelledException is normal — ignore it
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("Rendering cancelled")) {
          setError(`Failed to render page: ${msg}`);
        }
      } finally {
        setRendering(false);
      }
    },
    []
  );

  useEffect(() => {
    if (pdfDoc && currentPage > 0) {
      renderPage(pdfDoc, currentPage);
    }
  }, [pdfDoc, currentPage, renderPage]);

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------
  const goToPrev = () => {
    if (currentPage <= 1) return;
    const next = currentPage - 1;
    setCurrentPage(next);
    onPageChange(next, totalPages);
  };

  const goToNext = () => {
    if (currentPage >= totalPages) return;
    const next = currentPage + 1;
    setCurrentPage(next);
    onPageChange(next, totalPages);
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
          <p className="text-sm text-gray-500">Loading PDF…</p>
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
    <div className="flex flex-col items-center gap-4">
      {/* Canvas */}
      <div className="relative w-full max-w-3xl mx-auto rounded-lg overflow-hidden shadow-md bg-white">
        {rendering && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/60 z-10">
            <div className="h-6 w-6 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
          </div>
        )}
        <canvas ref={canvasRef} className="block w-full" />
      </div>

      {/* Navigation */}
      {totalPages > 1 && (
        <div className="flex items-center gap-3">
          <button
            onClick={goToPrev}
            disabled={currentPage <= 1}
            className="rounded-lg border border-gray-300 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
          >
            ← Previous
          </button>
          <span className="text-sm text-gray-500">
            Page <span className="font-semibold text-gray-800">{currentPage}</span>{" "}
            of{" "}
            <span className="font-semibold text-gray-800">{totalPages}</span>
          </span>
          <button
            onClick={goToNext}
            disabled={currentPage >= totalPages}
            className="rounded-lg border border-gray-300 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
