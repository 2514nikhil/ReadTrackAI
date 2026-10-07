"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { formatSeconds } from "@/lib/utils/time";
import { ATTENTION_CONFIG } from "@/lib/attention/config";
import { attentionEngine, type AttentionUpdate } from "@/lib/attention/engine";
import dynamic from "next/dynamic";
// Lazy-load viewers to avoid SSR issues with pdfjs-dist / docx-preview
const PdfViewer = dynamic(() => import("./PdfViewer"), { ssr: false });
const DocxViewer = dynamic(() => import("./DocxViewer"), { ssr: false });

export interface DocumentReaderProps {
  documentId: string;
  title: string;
  fileType: "pdf" | "docx";
  signedUrl: string;
}

export default function DocumentReader({
  documentId,
  title,
  fileType,
  signedUrl,
}: DocumentReaderProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [activeSeconds, setActiveSeconds] = useState(0);
  const [idleSeconds, setIdleSeconds] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [autoEnded, setAutoEnded] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  // Attention engine state
  const [attentionUpdate, setAttentionUpdate] = useState<AttentionUpdate | null>(null);
  const [webcamError, setWebcamError] = useState<string | null>(null);
  const [engineReady, setEngineReady] = useState(false);
  const [cameraHidden, setCameraHidden] = useState(false);

  // Enrollment banner
  const [enrollBannerDismissed, setEnrollBannerDismissed] = useState(false);
  const [enrollmentChecked, setEnrollmentChecked] = useState(false);
  const [hasEnrolledFace, setHasEnrolledFace] = useState(false);

  // Refs to always have latest values inside intervals/event handlers without
  // re-creating them on every render.
  const activeSecondsRef = useRef(0);
  const idleSecondsRef = useRef(0);
  const currentPageRef = useRef(1);
  const sessionIdRef = useRef<string | null>(null);
  const sessionEndedRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Sync state → refs
  useEffect(() => {
    activeSecondsRef.current = activeSeconds;
  }, [activeSeconds]);
  useEffect(() => {
    idleSecondsRef.current = idleSeconds;
  }, [idleSeconds]);
  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);
  useEffect(() => {
    sessionEndedRef.current = sessionEnded;
  }, [sessionEnded]);

  // ---------------------------------------------------------------------------
  // Save session to the API
  // ---------------------------------------------------------------------------
  const saveSession = useCallback(
    async (ended = false) => {
      const sid = sessionIdRef.current;
      if (!sid && ended) return; // nothing to end if session never started
      try {
        const res = await fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: sid ?? undefined,
            documentId,
            activeSeconds: activeSecondsRef.current,
            idleSeconds: idleSecondsRef.current,
            lastPage: currentPageRef.current,
            ended,
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          console.error("Session save error:", json.error);
        } else if (!sid && json.sessionId) {
          setSessionId(json.sessionId);
          sessionIdRef.current = json.sessionId;
        }
      } catch (err) {
        console.error("Session save failed:", err);
      }
    },
    [documentId]
  );

  // ---------------------------------------------------------------------------
  // On mount: create session, start attention engine, attach periodic save
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // Create initial session
    (async () => {
      try {
        const res = await fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            documentId,
            activeSeconds: 0,
            idleSeconds: 0,
            lastPage: 1,
            ended: false,
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          setSessionError(json.error ?? "Failed to start session");
        } else {
          setSessionId(json.sessionId);
          sessionIdRef.current = json.sessionId;
        }
      } catch (err) {
        setSessionError(String(err));
      }
    })();

    // ---- Webcam + attention engine ----
    let streamRef: MediaStream | null = null;

    (async () => {
      // Check enrollment before starting camera so we can set the embedding early.
      try {
        const profileRes = await fetch("/api/profile");
        if (profileRes.ok) {
          const profileData = await profileRes.json();
          if (profileData.face_embedding && Array.isArray(profileData.face_embedding)) {
            const embedding = new Float32Array(profileData.face_embedding as number[]);
            attentionEngine.setEnrolledEmbedding(embedding);
            setHasEnrolledFace(true);
          }
        }
      } catch {
        // Non-fatal — identity tracking simply won't be active.
      }
      setEnrollmentChecked(true);

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      } catch {
        setWebcamError(
          "Camera permission denied. Allow camera access and reload the page."
        );
        return;
      }

      streamRef = stream;
      const video = videoRef.current;
      if (!video) return;

      video.srcObject = stream;

      // Register callback before start so we don't miss early frames.
      attentionEngine.onUpdate((update) => {
        if (sessionEndedRef.current) return;

        // Handle auto-end from idle timeout
        if (update.autoEnded) {
          activeSecondsRef.current = update.activeSeconds;
          idleSecondsRef.current = update.idleSeconds;
          saveSession(true).then(() => {
            setActiveSeconds(Math.floor(update.activeSeconds));
            setIdleSeconds(Math.floor(update.idleSeconds));
            setSessionEnded(true);
            setAutoEnded(true);
            sessionEndedRef.current = true;
          });
          return;
        }

        setAttentionUpdate(update);
        setActiveSeconds(Math.floor(update.activeSeconds));
        setIdleSeconds(Math.floor(update.idleSeconds));
        activeSecondsRef.current = update.activeSeconds;
        idleSecondsRef.current = update.idleSeconds;
      });

      try {
        await attentionEngine.start(video);
        setEngineReady(true);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Attention engine failed to start.";
        setWebcamError(msg);
      }
    })();

    // ---- Interaction event listeners ----
    const notifyInteraction = () => attentionEngine.notifyInteraction();
    window.addEventListener("scroll", notifyInteraction, { passive: true });
    window.addEventListener("keydown", notifyInteraction);

    // ---- Periodic save every 15 s ----
    const saveInterval = setInterval(() => {
      if (!sessionEndedRef.current) {
        saveSession(false);
      }
    }, ATTENTION_CONFIG.SESSION_SAVE_INTERVAL_MS);

    // ---- Unload: fire-and-forget with keepalive ----
    const handleUnload = () => {
      const sid = sessionIdRef.current;
      if (!sid || sessionEndedRef.current) return;
      fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          sessionId: sid,
          documentId,
          activeSeconds: activeSecondsRef.current,
          idleSeconds: idleSecondsRef.current,
          lastPage: currentPageRef.current,
          ended: false,
        }),
      });
    };

    window.addEventListener("beforeunload", handleUnload);

    return () => {
      clearInterval(saveInterval);
      window.removeEventListener("scroll", notifyInteraction);
      window.removeEventListener("keydown", notifyInteraction);
      window.removeEventListener("beforeunload", handleUnload);
      attentionEngine.stop();
      // Stop all video tracks so the browser camera indicator turns off.
      if (streamRef) {
        streamRef.getTracks().forEach((t) => t.stop());
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [documentId, saveSession]);

  // ---------------------------------------------------------------------------
  // Page change callback (passed to viewers) — also notifies interaction
  // ---------------------------------------------------------------------------
  const handlePageChange = useCallback((page: number, total: number) => {
    setCurrentPage(page);
    setTotalPages(total);
    currentPageRef.current = page;
    attentionEngine.notifyInteraction();
  }, []);

  // ---------------------------------------------------------------------------
  // Stop Reading
  // ---------------------------------------------------------------------------
  const handleStop = async () => {
    await saveSession(true);
    setSessionEnded(true);
    sessionEndedRef.current = true;
  };

  // ---------------------------------------------------------------------------
  // Derived status badge values
  // ---------------------------------------------------------------------------
  const inGrace = attentionUpdate?.inGrace ?? false;
  const isTracking = attentionUpdate?.frameActive ?? false;
  const statusReason = attentionUpdate?.reason ?? (engineReady ? "Initialising…" : "Starting camera…");
  const showEnrollBanner =
    enrollmentChecked && !hasEnrolledFace && !enrollBannerDismissed;
  const identityFailed =
    attentionUpdate !== null &&
    !attentionUpdate.identityOk &&
    attentionUpdate.reason === "Different person";

  // ---------------------------------------------------------------------------
  // Render — auto-ended screen (idle timeout)
  // ---------------------------------------------------------------------------
  if (sessionEnded && autoEnded) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-10 text-center max-w-md">
          <h2 className="text-xl font-bold text-amber-800 mb-2">Session Ended Automatically</h2>
          <p className="text-sm text-amber-700 mb-4">
            The session ended after {ATTENTION_CONFIG.IDLE_AUTO_END_MINUTES} minutes of inactivity.
          </p>
          <p className="text-sm text-amber-700 mb-1">
            Active reading time:{" "}
            <span className="font-semibold">{formatSeconds(activeSeconds)}</span>
          </p>
          <p className="text-sm text-amber-700 mb-6">
            Idle time:{" "}
            <span className="font-semibold">{formatSeconds(idleSeconds)}</span>
          </p>
          <Link
            href="/student"
            className="inline-block rounded-lg bg-amber-600 px-5 py-2 text-sm font-semibold text-white hover:bg-amber-700 transition-colors"
          >
            Back to Documents
          </Link>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render — manual session ended screen
  // ---------------------------------------------------------------------------
  if (sessionEnded) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="rounded-xl border border-green-200 bg-green-50 p-10 text-center max-w-md">
          <h2 className="text-xl font-bold text-green-800 mb-2">Reading Session Complete</h2>
          <p className="text-sm text-green-700 mb-1">
            Active reading time:{" "}
            <span className="font-semibold">{formatSeconds(activeSeconds)}</span>
          </p>
          <p className="text-sm text-green-700 mb-4">
            Idle time:{" "}
            <span className="font-semibold">{formatSeconds(idleSeconds)}</span>
          </p>
          <Link
            href="/student"
            className="inline-block rounded-lg bg-green-600 px-5 py-2 text-sm font-semibold text-white hover:bg-green-700 transition-colors"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Main reading UI
  // ---------------------------------------------------------------------------
  return (
    <div className="flex flex-col h-full min-h-screen bg-gray-50">
      {/* ── Header ── */}
      <header className="flex items-center justify-between gap-4 border-b border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/student"
            className="shrink-0 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
          >
            ← Back
          </Link>
          <span className="text-sm font-semibold text-gray-500 hidden sm:inline">ReadTrack —</span>
          <h1 className="text-sm font-bold text-gray-900 truncate" title={title}>
            {title}
          </h1>
        </div>

        {/* Status badge */}
        <div className="shrink-0 flex flex-col items-end gap-0.5">
          {isTracking ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-800 ring-1 ring-inset ring-green-300">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
              Tracking OK
            </span>
          ) : inGrace ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-300">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              Grace period
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-300">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              {statusReason}
            </span>
          )}
          <span className="text-[10px] text-gray-400 pr-0.5">
            {webcamError ? "camera: error" : engineReady ? "camera: on" : "camera: starting…"}
          </span>
        </div>
      </header>

      {/* ── Webcam / engine error banner ── */}
      {webcamError && (
        <div className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 space-y-1">
          <p className="font-semibold">Camera / attention engine error</p>
          <p>{webcamError}</p>
          <p className="text-red-500">
            The document is still shown but attention tracking is disabled.
          </p>
        </div>
      )}

      {/* ── Face not enrolled banner ── */}
      {showEnrollBanner && (
        <div className="mx-4 mt-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800 flex items-start justify-between gap-3">
          <p>
            <span className="font-semibold">Face not enrolled.</span> Identity tracking is
            disabled.{" "}
            <Link
              href="/student/enroll"
              className="underline font-semibold hover:text-blue-900"
            >
              Enroll your face
            </Link>{" "}
            for full tracking.
          </p>
          <button
            onClick={() => setEnrollBannerDismissed(true)}
            className="shrink-0 text-blue-500 hover:text-blue-700 font-bold leading-none"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Different person banner ── */}
      {identityFailed && (
        <div className="mx-4 mt-3 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-xs text-orange-800">
          <span className="font-semibold">Identity mismatch.</span> The person in the
          camera does not match the enrolled face. Active time is not being recorded.
        </div>
      )}

      {/* ── Session create error ── */}
      {sessionError && (
        <div className="mx-4 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700">
          Warning: could not start session — {sessionError}. Your reading time may not be saved.
        </div>
      )}

      {/* ── Document viewer ── */}
      <main className="flex-1 overflow-auto px-4 py-4">
        {fileType === "pdf" ? (
          <PdfViewer url={signedUrl} onPageChange={handlePageChange} />
        ) : (
          <DocxViewer url={signedUrl} onPageChange={handlePageChange} />
        )}
      </main>

      {/* ── Footer status bar ── */}
      <footer className="border-t border-gray-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
            <span>
              Active:{" "}
              <span className="font-semibold text-gray-800">
                {formatSeconds(activeSeconds)}
              </span>
            </span>
            <span className="hidden sm:inline text-gray-300">|</span>
            <span>
              Idle:{" "}
              <span className="font-semibold text-gray-800">
                {formatSeconds(idleSeconds)}
              </span>
            </span>
            <span className="hidden sm:inline text-gray-300">|</span>
            <span>
              Page{" "}
              <span className="font-semibold text-gray-800">{currentPage}</span>
              {totalPages > 1 && (
                <span className="text-gray-400">
                  {" "}
                  / {totalPages}
                </span>
              )}
            </span>
          </div>

          <button
            onClick={handleStop}
            className="rounded-lg bg-red-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-red-700 transition-colors"
          >
            Stop Reading
          </button>
        </div>
      </footer>

      {/* ── Camera preview (bottom-right corner) ── */}
      <div className="fixed bottom-20 right-4 z-50 flex flex-col items-end gap-1">
        <button
          onClick={() => setCameraHidden((h) => !h)}
          className="rounded-md border border-gray-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-gray-500 hover:bg-gray-50 shadow-sm transition-colors"
        >
          {cameraHidden ? "Show camera" : "Hide camera"}
        </button>
        {/* The <video> element must always be in the DOM so MediaPipe can read
            frames from it, even when visually hidden. */}
        <video
          ref={videoRef}
          muted
          autoPlay
          playsInline
          width={160}
          height={120}
          className={[
            "rounded-lg border border-gray-300 bg-black shadow-md object-cover",
            cameraHidden ? "hidden" : "block",
          ].join(" ")}
        />
      </div>
    </div>
  );
}
