"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import {
  FaceLandmarker,
  FilesetResolver,
} from "@mediapipe/tasks-vision";
import { embeddingEngine } from "@/lib/attention/embedding";

// Number of frames to capture during enrollment
const CAPTURE_COUNT = 5;

type EnrollStatus = "idle" | "capturing" | "saving" | "done" | "error";

export default function EnrollPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);

  const [consent, setConsent] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);

  const [enrolled, setEnrolled] = useState<boolean | null>(null); // null = loading
  const [enrollStatus, setEnrollStatus] = useState<EnrollStatus>("idle");
  const [captureProgress, setCaptureProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // On mount: check existing enrollment status
  // ---------------------------------------------------------------------------
  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((data) => setEnrolled(data.has_face_embedding ?? false))
      .catch(() => setEnrolled(false));
  }, []);

  // ---------------------------------------------------------------------------
  // Start webcam and initialize models when consent is granted
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!consent) return;

    let cancelled = false;

    (async () => {
      // Start webcam
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480 },
          audio: false,
        });
      } catch {
        if (!cancelled) {
          setCameraError("Camera permission denied. Please allow camera access.");
        }
        return;
      }

      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      // Initialize FaceLandmarker
      try {
        const modelPath = "/models/face_landmarker.task";
        const probe = await fetch(modelPath, { method: "HEAD" }).catch(() => null);
        if (!probe || !probe.ok) {
          if (!cancelled) {
            setCameraError(
              "Face landmarker model not found. Please place face_landmarker.task in public/models/."
            );
          }
          return;
        }

        const filesetResolver = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
        );
        const landmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath: modelPath,
            delegate: "CPU",
          },
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: false,
          runningMode: "VIDEO",
          numFaces: 1,
        });

        if (!cancelled) {
          faceLandmarkerRef.current = landmarker;
        } else {
          landmarker.close();
          return;
        }
      } catch (err) {
        if (!cancelled) {
          setCameraError(
            err instanceof Error
              ? `Failed to load face detector: ${err.message}`
              : "Failed to load face detector."
          );
        }
        return;
      }

      // Initialize embedding engine
      await embeddingEngine.initialize();
      if (!cancelled) {
        const initErr = embeddingEngine.getInitError();
        if (initErr) {
          setModelError(initErr);
        }
        setCameraReady(true);
      }
    })();

    return () => {
      cancelled = true;
      // Stop camera tracks on cleanup
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (faceLandmarkerRef.current) {
        faceLandmarkerRef.current.close();
        faceLandmarkerRef.current = null;
      }
      setCameraReady(false);
      setCameraError(null);
    };
  }, [consent]);

  // ---------------------------------------------------------------------------
  // Capture a single embedding from the current video frame
  // ---------------------------------------------------------------------------
  const captureOneEmbedding = useCallback(async (): Promise<Float32Array | null> => {
    const video = videoRef.current;
    const landmarker = faceLandmarkerRef.current;
    if (!video || !landmarker || video.readyState < 2) return null;

    const result = landmarker.detectForVideo(video, Date.now());
    if (result.faceLandmarks.length !== 1) return null;

    return embeddingEngine.computeEmbedding(video, result.faceLandmarks[0]);
  }, []);

  // ---------------------------------------------------------------------------
  // Start enrollment: capture 5 embeddings, 1 per second, then average
  // ---------------------------------------------------------------------------
  const handleStartEnrollment = useCallback(async () => {
    setEnrollStatus("capturing");
    setCaptureProgress(0);
    setErrorMessage(null);

    const embeddings: Float32Array[] = [];

    for (let i = 0; i < CAPTURE_COUNT; i++) {
      setCaptureProgress(i + 1);
      const emb = await captureOneEmbedding();
      if (!emb) {
        setEnrollStatus("error");
        setErrorMessage(
          `No face detected in frame ${i + 1}. Please look straight at the camera.`
        );
        return;
      }
      embeddings.push(emb);

      if (i < CAPTURE_COUNT - 1) {
        // Wait 1 second before next capture
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    // Average the embeddings
    const embLen = embeddings[0].length;
    const averaged = new Float32Array(embLen);
    for (const emb of embeddings) {
      for (let j = 0; j < embLen; j++) {
        averaged[j] += emb[j];
      }
    }
    for (let j = 0; j < embLen; j++) {
      averaged[j] /= CAPTURE_COUNT;
    }

    // Save to server
    setEnrollStatus("saving");
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ face_embedding: Array.from(averaged) }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Server error");
      }
      setEnrolled(true);
      setEnrollStatus("done");
    } catch (err) {
      setEnrollStatus("error");
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to save face data."
      );
    }
  }, [captureOneEmbedding]);

  // ---------------------------------------------------------------------------
  // Delete enrollment
  // ---------------------------------------------------------------------------
  const handleDelete = useCallback(async () => {
    setErrorMessage(null);
    try {
      const res = await fetch("/api/profile", { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Server error");
      }
      setEnrolled(false);
      setEnrollStatus("idle");
      setCaptureProgress(0);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to delete face data."
      );
    }
  }, []);

  const isCapturing = enrollStatus === "capturing";
  const isSaving = enrollStatus === "saving";
  const isBusy = isCapturing || isSaving;
  const canEnroll = consent && cameraReady && embeddingEngine.isReady() && !isBusy;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Face Enrollment</h1>
      <p className="text-sm text-gray-500 mb-6">
        Enrolling your face allows ReadTrack to verify your identity during reading sessions.
        Your video never leaves your device — only a small numeric fingerprint is stored.
      </p>

      {/* ── Enrollment status badge ── */}
      <div className="mb-6">
        {enrolled === null ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-500">
            Checking enrollment…
          </span>
        ) : enrolled ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-800 ring-1 ring-inset ring-green-300">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
            Face enrolled ✓
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-300">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            Not enrolled
          </span>
        )}
      </div>

      {/* ── Consent checkbox ── */}
      <label className="flex items-start gap-3 cursor-pointer mb-6 select-none">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => {
            setConsent(e.target.checked);
            if (!e.target.checked) {
              setEnrollStatus("idle");
              setCaptureProgress(0);
              setErrorMessage(null);
              setCameraError(null);
            }
          }}
          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <span className="text-sm text-gray-700">
          I agree to let ReadTrack use my webcam while I read.{" "}
          <strong>Video never leaves my device.</strong> Only a numeric embedding is stored.
        </span>
      </label>

      {/* ── Camera / model errors ── */}
      {cameraError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {cameraError}
        </div>
      )}

      {modelError && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 whitespace-pre-wrap font-mono">
          {modelError}
        </div>
      )}

      {/* ── Webcam preview ── */}
      {consent && !cameraError && (
        <div className="mb-6">
          <video
            ref={videoRef}
            muted
            autoPlay
            playsInline
            width={640}
            height={480}
            className="w-full max-w-[640px] rounded-xl border border-gray-300 bg-black object-cover"
          />
          {!cameraReady && (
            <p className="mt-2 text-xs text-gray-400 text-center">Starting camera…</p>
          )}
        </div>
      )}

      {/* ── Enrollment controls ── */}
      {consent && !cameraError && (
        <div className="flex flex-wrap items-center gap-4 mb-4">
          <button
            onClick={handleStartEnrollment}
            disabled={!canEnroll}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isCapturing
              ? `Capturing ${captureProgress}/${CAPTURE_COUNT}…`
              : isSaving
              ? "Saving…"
              : "Start Enrollment"}
          </button>

          {(isCapturing || isSaving) && (
            <span className="text-sm text-gray-500">
              Progress:{" "}
              <span className="font-semibold text-gray-800">
                {captureProgress}/{CAPTURE_COUNT}
              </span>
            </span>
          )}

          {enrollStatus === "done" && (
            <span className="text-sm font-semibold text-green-700">
              ✓ Face enrolled successfully!
            </span>
          )}
        </div>
      )}

      {/* ── Error message ── */}
      {errorMessage && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </div>
      )}

      {/* ── Delete button ── */}
      {enrolled && (
        <div className="mt-2">
          <button
            onClick={handleDelete}
            className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 transition-colors"
          >
            Delete Face Data
          </button>
        </div>
      )}

      {/* ── Back link ── */}
      <div className="mt-8 pt-6 border-t border-gray-200">
        <Link
          href="/student"
          className="text-sm font-semibold text-blue-600 hover:text-blue-700"
        >
          ← Back to dashboard
        </Link>
      </div>
    </div>
  );
}
