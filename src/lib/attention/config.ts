export const ATTENTION_CONFIG = {
  // Detection loop
  FRAME_INTERVAL_MS: 200, // ~5fps

  // Head pose thresholds (degrees)
  YAW_THRESHOLD: 25,
  PITCH_MIN: -25,
  PITCH_MAX: 20,

  // Blink detection
  BLINK_THRESHOLD: 0.6, // blendshape value for eye closed
  BLINK_CLOSED_MAX_SECONDS: 2, // eyes can be closed this long

  // Identity
  IDENTITY_SIMILARITY_THRESHOLD: 0.55,
  EMBEDDING_COMPUTE_INTERVAL_MS: 5000, // recompute every 5s
  EMBEDDING_VALID_FOR_MS: 10000, // keep result for 10s

  // State machine
  GRACE_PERIOD_SECONDS: 8,
  IDLE_AUTO_END_MINUTES: 5,
  INTERACTION_TIMEOUT_SECONDS: 180, // 3 minutes no interaction = idle

  // Liveness
  LIVENESS_CHECK_SECONDS: 60,
  LIVENESS_HEAD_MOVEMENT_DEGREES: 2,

  // Session saving
  SESSION_SAVE_INTERVAL_MS: 15000, // every 15 seconds

  // Tab-focus timer (Phase 3 uses only this)
  TICK_INTERVAL_MS: 1000, // count seconds every 1s
} as const;
