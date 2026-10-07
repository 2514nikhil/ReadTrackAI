import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { ATTENTION_CONFIG } from "./config";
import { embeddingEngine, cosineSimilarity } from "./embedding";

export type AttentionState = "ACTIVE" | "IDLE";

export interface AttentionUpdate {
  state: AttentionState;
  activeSeconds: number;
  idleSeconds: number;
  frameActive: boolean;
  /** "OK" | "No face" | "Multiple faces" | "Looking away" | "Eyes closed" | "Tab not focused" | "Different person" | "No movement (liveness)" | "No interaction" */
  reason: string;
  tabVisible: boolean;
  faceFound: boolean;
  lookingAtScreen: boolean;
  identityOk: boolean;
  livenessOk: boolean;
  inGrace: boolean;    // true during grace period
  autoEnded: boolean;  // true when session auto-ended by idle timeout
}

class AttentionEngine {
  private faceLandmarker: FaceLandmarker | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private callback: ((update: AttentionUpdate) => void) | null = null;
  private activeSeconds = 0;
  private idleSeconds = 0;
  private eyesClosedSince: number | null = null;
  private initialized = false;
  private lastTickTime = 0;

  // Identity tracking
  private enrolledEmbedding: Float32Array | null = null;
  private lastEmbedding: Float32Array | null = null;
  private lastEmbeddingTime = 0;
  private lastIdentityResult = false;

  // State machine
  private state: AttentionState = "IDLE";
  private graceStartTime: number | null = null;   // when grace period started
  private idleStartTime: number | null = null;    // when IDLE state started
  private lastInteractionTime: number = Date.now();

  // Liveness
  private lastBlinkTime: number = Date.now();
  private lastHeadMovement: number = Date.now();
  private prevYaw: number = 0;
  private prevPitch: number = 0;
  private prevBothClosed: boolean = false;
  private livenessOk: boolean = true;

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Verify that the model file is reachable before handing off to MediaPipe.
    const modelPath = "/models/face_landmarker.task";
    const probe = await fetch(modelPath, { method: "HEAD" }).catch(() => null);
    if (!probe || !probe.ok) {
      throw new Error(
        `Face landmarker model not found at ${modelPath}. Please download it from ` +
          `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task` +
          ` and place it in the public/models/ folder.`
      );
    }

    const filesetResolver = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm"
    );

    this.faceLandmarker = await FaceLandmarker.createFromOptions(
      filesetResolver,
      {
        baseOptions: {
          modelAssetPath: modelPath,
          delegate: "CPU",
        },
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
        runningMode: "VIDEO",
        numFaces: 2,
      }
    );

    // Initialize embedding engine — failure is non-fatal; tracking still works.
    try {
      await embeddingEngine.initialize();
      if (embeddingEngine.getInitError()) {
        console.warn(
          "[AttentionEngine] Embedding engine unavailable:",
          embeddingEngine.getInitError()
        );
      }
    } catch (err) {
      console.warn("[AttentionEngine] Embedding engine init threw:", err);
    }

    this.initialized = true;
  }

  async start(videoElement: HTMLVideoElement): Promise<void> {
    this.videoElement = videoElement;

    if (!this.initialized) {
      await this.initialize();
    }

    const now = Date.now();

    // Reset all counters and state on each new session start.
    this.activeSeconds = 0;
    this.idleSeconds = 0;
    this.eyesClosedSince = null;
    this.lastTickTime = 0;
    this.lastEmbeddingTime = 0;
    this.lastIdentityResult = false;

    this.state = "IDLE";
    this.graceStartTime = null;
    this.idleStartTime = null;
    this.lastInteractionTime = now;

    this.lastBlinkTime = now;
    this.lastHeadMovement = now;
    this.prevYaw = 0;
    this.prevPitch = 0;
    this.prevBothClosed = false;
    this.livenessOk = true;

    this.intervalId = setInterval(
      () => this.runFrame(),
      ATTENTION_CONFIG.FRAME_INTERVAL_MS
    );
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    // Do NOT stop video tracks here — DocumentReader owns the stream.
  }

  onUpdate(cb: (update: AttentionUpdate) => void): void {
    this.callback = cb;
  }

  setEnrolledEmbedding(embedding: Float32Array | null): void {
    this.enrolledEmbedding = embedding;
    // Reset cached result so the new embedding is evaluated on the next frame.
    this.lastEmbeddingTime = 0;
    this.lastIdentityResult = false;
  }

  /** Call whenever the student interacts (scroll, keydown, page change). */
  notifyInteraction(): void {
    this.lastInteractionTime = Date.now();
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private runFrame = async (): Promise<void> => {
    const now = Date.now();
    const tabVisible = this.getTabVisible();

    // ---- Early-out when tab is not visible ----
    if (!tabVisible) {
      this.runStateMachine(false, now);
      this.emit({
        frameActive: false,
        reason: "Tab not focused",
        tabVisible: false,
        faceFound: false,
        lookingAtScreen: false,
        identityOk: true,
        livenessOk: this.livenessOk,
      });
      return;
    }

    const video = this.videoElement;
    if (!video || video.readyState < 2) {
      // Video not ready yet — skip this frame entirely (don't count time).
      return;
    }

    if (!this.faceLandmarker) return;

    const result: FaceLandmarkerResult = this.faceLandmarker.detectForVideo(
      video,
      now
    );

    const faceCount = result.faceLandmarks.length;
    let reason = "OK";
    let faceFound = false;
    let lookingAtScreen = false;
    let yaw = this.prevYaw;
    let pitch = this.prevPitch;

    if (faceCount === 0) {
      reason = "No face";
    } else if (faceCount > 1) {
      reason = "Multiple faces";
    } else {
      // Exactly one face.
      faceFound = true;

      const pose = this.computeHeadPose(result);
      if (!pose) {
        // Matrix unavailable — treat as no face.
        faceFound = false;
        reason = "No face";
      } else {
        yaw = pose.yaw;
        pitch = pose.pitch;
        lookingAtScreen =
          yaw >= -ATTENTION_CONFIG.YAW_THRESHOLD &&
          yaw <= ATTENTION_CONFIG.YAW_THRESHOLD &&
          pitch >= ATTENTION_CONFIG.PITCH_MIN &&
          pitch <= ATTENTION_CONFIG.PITCH_MAX;

        if (!lookingAtScreen) {
          reason = "Looking away";
        }
      }
    }

    // ---- Blink + liveness ----
    const eyesClosedTooLong = faceFound ? this.checkEyesClosed(result) : false;

    if (faceFound) {
      // Detect a new blink (transition from open → closed)
      const blendshapes = result.faceBlendshapes?.[0]?.categories ?? [];
      const leftBlink =
        blendshapes.find((c) => c.categoryName === "eyeBlinkLeft")?.score ?? 0;
      const rightBlink =
        blendshapes.find((c) => c.categoryName === "eyeBlinkRight")?.score ?? 0;
      const bothClosed =
        leftBlink > ATTENTION_CONFIG.BLINK_THRESHOLD &&
        rightBlink > ATTENTION_CONFIG.BLINK_THRESHOLD;

      if (bothClosed && !this.prevBothClosed) {
        // Leading edge of a blink
        this.lastBlinkTime = now;
      }
      this.prevBothClosed = bothClosed;

      // Head movement delta
      const delta = Math.abs(yaw - this.prevYaw) + Math.abs(pitch - this.prevPitch);
      if (delta > ATTENTION_CONFIG.LIVENESS_HEAD_MOVEMENT_DEGREES) {
        this.lastHeadMovement = now;
      }
    }

    // Update head pose history regardless (so grace/idle transitions are smooth)
    this.prevYaw = yaw;
    this.prevPitch = pitch;

    // livenessOk = had a blink OR head movement within the last LIVENESS_CHECK_SECONDS
    const livenessWindow = ATTENTION_CONFIG.LIVENESS_CHECK_SECONDS * 1000;
    this.livenessOk =
      now - this.lastBlinkTime < livenessWindow ||
      now - this.lastHeadMovement < livenessWindow;

    // ---- Interaction check ----
    const interactionOk =
      now - this.lastInteractionTime <
      ATTENTION_CONFIG.INTERACTION_TIMEOUT_SECONDS * 1000;

    // ---- Identity check ----
    let identityOk = true; // default: if no enrolled embedding, don't block
    if (this.enrolledEmbedding && faceFound && embeddingEngine.isReady()) {
      // Recompute embedding every EMBEDDING_COMPUTE_INTERVAL_MS.
      if (now - this.lastEmbeddingTime > ATTENTION_CONFIG.EMBEDDING_COMPUTE_INTERVAL_MS) {
        const landmarks = result.faceLandmarks[0];
        const embedding = await embeddingEngine.computeEmbedding(video, landmarks);
        if (embedding) {
          this.lastEmbedding = embedding;
          this.lastEmbeddingTime = now;
          const similarity = cosineSimilarity(embedding, this.enrolledEmbedding);
          this.lastIdentityResult =
            similarity >= ATTENTION_CONFIG.IDENTITY_SIMILARITY_THRESHOLD;
        }
        // If embedding computation failed, keep the last cached result.
      }

      // If last result is too old, reset to false (consider identity unknown).
      if (Date.now() - this.lastEmbeddingTime > ATTENTION_CONFIG.EMBEDDING_VALID_FOR_MS) {
        this.lastIdentityResult = false;
      }

      identityOk = this.lastIdentityResult;
    }

    // ---- Compose frameActive and reason (priority order) ----
    if (faceFound && lookingAtScreen && eyesClosedTooLong) {
      reason = "Eyes closed";
    } else if (faceFound && lookingAtScreen && !eyesClosedTooLong && !identityOk) {
      reason = "Different person";
    } else if (faceFound && lookingAtScreen && !eyesClosedTooLong && identityOk && !this.livenessOk) {
      reason = "No movement (liveness)";
    } else if (faceFound && lookingAtScreen && !eyesClosedTooLong && identityOk && this.livenessOk && !interactionOk) {
      reason = "No interaction";
    }

    const frameActive =
      tabVisible &&
      faceFound &&
      lookingAtScreen &&
      !eyesClosedTooLong &&
      identityOk &&
      this.livenessOk &&
      interactionOk;

    // ---- State machine ----
    const autoEnded = this.runStateMachine(frameActive, now);
    if (autoEnded) return; // runStateMachine already emitted + stopped

    const inGrace =
      this.graceStartTime !== null && this.state === "ACTIVE" && !frameActive;

    this.emit({
      frameActive,
      reason,
      tabVisible,
      faceFound,
      lookingAtScreen,
      identityOk,
      livenessOk: this.livenessOk,
      inGrace,
    });
  };

  /**
   * Runs the ACTIVE/IDLE state machine, accumulates time, and returns true if
   * the session was auto-ended (in which case the caller must return immediately).
   */
  private runStateMachine(frameActive: boolean, now: number): boolean {
    let countAsActive: boolean;

    if (frameActive) {
      // Any active frame clears grace and idle timers.
      this.graceStartTime = null;
      this.idleStartTime = null;
      this.state = "ACTIVE";
      countAsActive = true;
    } else {
      if (this.state === "ACTIVE") {
        // Start grace period if not already started.
        if (this.graceStartTime === null) {
          this.graceStartTime = now;
        }

        if (
          now - this.graceStartTime <
          ATTENTION_CONFIG.GRACE_PERIOD_SECONDS * 1000
        ) {
          // Still within grace — count as active.
          countAsActive = true;
        } else {
          // Grace expired → transition to IDLE.
          this.state = "IDLE";
          if (this.idleStartTime === null) {
            this.idleStartTime = now;
          }
          countAsActive = false;
        }
      } else {
        // Already IDLE.
        if (this.idleStartTime === null) {
          this.idleStartTime = now;
        }
        countAsActive = false;

        // Auto-end check.
        if (
          now - this.idleStartTime >
          ATTENTION_CONFIG.IDLE_AUTO_END_MINUTES * 60 * 1000
        ) {
          // Accumulate final elapsed time before stopping.
          this.accumulateTime(false, now);

          // Emit the auto-ended update.
          if (this.callback) {
            this.callback({
              state: "IDLE",
              activeSeconds: this.activeSeconds,
              idleSeconds: this.idleSeconds,
              frameActive: false,
              reason: "Idle timeout",
              tabVisible: this.getTabVisible(),
              faceFound: false,
              lookingAtScreen: false,
              identityOk: true,
              livenessOk: this.livenessOk,
              inGrace: false,
              autoEnded: true,
            });
          }

          this.stop();
          return true; // signal auto-ended
        }
      }
    }

    this.accumulateTime(countAsActive, now);
    return false;
  }

  private accumulateTime(countAsActive: boolean, now: number): void {
    if (this.lastTickTime > 0) {
      const elapsed = (now - this.lastTickTime) / 1000;
      if (countAsActive) {
        this.activeSeconds += elapsed;
      } else {
        this.idleSeconds += elapsed;
      }
    }
    this.lastTickTime = now;
  }

  private emit(
    partial: Omit<
      AttentionUpdate,
      "state" | "activeSeconds" | "idleSeconds" | "inGrace" | "autoEnded"
    > & { inGrace?: boolean; autoEnded?: boolean }
  ): void {
    if (!this.callback) return;
    this.callback({
      ...partial,
      state: this.state,
      activeSeconds: this.activeSeconds,
      idleSeconds: this.idleSeconds,
      inGrace: partial.inGrace ?? false,
      autoEnded: partial.autoEnded ?? false,
    });
  }

  private computeHeadPose(
    result: FaceLandmarkerResult
  ): { yaw: number; pitch: number } | null {
    const matrix = result.facialTransformationMatrixes?.[0];
    if (!matrix?.data) return null;
    const m = matrix.data;
    // Column-major 4×4 matrix.
    // pitch = asin(-m[9])   (rotation around X)
    // yaw   = atan2(m[8], m[10])  (rotation around Y)
    const pitch = Math.asin(-m[9]) * (180 / Math.PI);
    const yaw = Math.atan2(m[8], m[10]) * (180 / Math.PI);
    return { yaw, pitch };
  }

  private checkEyesClosed(result: FaceLandmarkerResult): boolean {
    const blendshapes = result.faceBlendshapes?.[0]?.categories ?? [];
    const leftBlink =
      blendshapes.find((c) => c.categoryName === "eyeBlinkLeft")?.score ?? 0;
    const rightBlink =
      blendshapes.find((c) => c.categoryName === "eyeBlinkRight")?.score ?? 0;
    const bothClosed =
      leftBlink > ATTENTION_CONFIG.BLINK_THRESHOLD &&
      rightBlink > ATTENTION_CONFIG.BLINK_THRESHOLD;

    if (bothClosed) {
      if (!this.eyesClosedSince) this.eyesClosedSince = Date.now();
      return (
        Date.now() - this.eyesClosedSince >
        ATTENTION_CONFIG.BLINK_CLOSED_MAX_SECONDS * 1000
      );
    } else {
      this.eyesClosedSince = null;
      return false;
    }
  }

  private getTabVisible(): boolean {
    if (typeof document === "undefined") return false;
    return document.visibilityState === "visible" && document.hasFocus();
  }
}

export const attentionEngine = new AttentionEngine();
