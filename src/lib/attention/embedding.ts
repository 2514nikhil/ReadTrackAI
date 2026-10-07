import * as ort from "onnxruntime-web";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

// Must be set before any InferenceSession is created.
ort.env.wasm.wasmPaths = "/";

const MODEL_MISSING_MESSAGE =
  "Face recognition model not found at /models/mobilefacenet.onnx.\n" +
  "Please download a MobileFaceNet ONNX model and place it at public/models/mobilefacenet.onnx.\n" +
  "Sources:\n" +
  "  - https://github.com/onnx/models (search for mobilefacenet)\n" +
  "  - InsightFace buffalo_sc: w600k_mbf.onnx\n" +
  "Input: 1×3×112×112 float32, normalized with mean=[0.5,0.5,0.5] std=[0.5,0.5,0.5]\n" +
  "Output: 1×128 embedding vector";

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8);
}

class EmbeddingEngine {
  private session: ort.InferenceSession | null = null;
  private initialized = false;
  private initError: string | null = null;

  async initialize(): Promise<void> {
    if (this.initialized || this.initError) return;

    // Check model file exists before attempting to load it.
    const probe = await fetch("/models/mobilefacenet.onnx", {
      method: "HEAD",
    }).catch(() => null);

    if (!probe || !probe.ok) {
      this.initError = MODEL_MISSING_MESSAGE;
      return;
    }

    try {
      this.session = await ort.InferenceSession.create(
        "/models/mobilefacenet.onnx",
        { executionProviders: ["wasm"] }
      );
      this.initialized = true;
    } catch (err) {
      this.initError =
        err instanceof Error
          ? `Failed to load ONNX model: ${err.message}`
          : "Failed to load ONNX model.";
    }
  }

  isReady(): boolean {
    return this.initialized && this.session !== null;
  }

  getInitError(): string | null {
    return this.initError;
  }

  async computeEmbedding(
    videoElement: HTMLVideoElement,
    landmarks: NormalizedLandmark[]
  ): Promise<Float32Array | null> {
    if (!this.session) return null;

    const vw = videoElement.videoWidth;
    const vh = videoElement.videoHeight;
    if (!vw || !vh) return null;

    // Compute bounding box from all landmarks, add 20% padding.
    const xs = landmarks.map((l) => l.x * vw);
    const ys = landmarks.map((l) => l.y * vh);
    const rawMinX = Math.min(...xs);
    const rawMinY = Math.min(...ys);
    const rawMaxX = Math.max(...xs);
    const rawMaxY = Math.max(...ys);
    const padX = (rawMaxX - rawMinX) * 0.2;
    const padY = (rawMaxY - rawMinY) * 0.2;
    const minX = Math.max(0, rawMinX - padX);
    const minY = Math.max(0, rawMinY - padY);
    const maxX = Math.min(vw, rawMaxX + padX);
    const maxY = Math.min(vh, rawMaxY + padY);
    const cropW = maxX - minX;
    const cropH = maxY - minY;
    if (cropW <= 0 || cropH <= 0) return null;

    // Crop and resize to 112×112.
    const canvas = document.createElement("canvas");
    canvas.width = 112;
    canvas.height = 112;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(videoElement, minX, minY, cropW, cropH, 0, 0, 112, 112);

    const imageData = ctx.getImageData(0, 0, 112, 112);
    const pixels = imageData.data; // RGBA, length = 112*112*4

    // Build CHW float32 tensor: shape [1, 3, 112, 112]
    // Normalize: (pixel/255 - 0.5) / 0.5
    const tensorData = new Float32Array(1 * 3 * 112 * 112);
    const planeSize = 112 * 112;
    for (let i = 0; i < planeSize; i++) {
      const r = pixels[i * 4] / 255;
      const g = pixels[i * 4 + 1] / 255;
      const b = pixels[i * 4 + 2] / 255;
      tensorData[i] = (r - 0.5) / 0.5; // R channel
      tensorData[planeSize + i] = (g - 0.5) / 0.5; // G channel
      tensorData[2 * planeSize + i] = (b - 0.5) / 0.5; // B channel
    }

    const inputName = this.session.inputNames[0];
    const tensor = new ort.Tensor("float32", tensorData, [1, 3, 112, 112]);

    try {
      const results = await this.session.run({ [inputName]: tensor });
      const outputName = this.session.outputNames[0];
      const output = results[outputName];
      return output.data as Float32Array;
    } catch {
      return null;
    }
  }
}

export const embeddingEngine = new EmbeddingEngine();
