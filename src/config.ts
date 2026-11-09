export const ARENA = { width: 1280, height: 720 } as const
export const ARENA_ASPECT = ARENA.width / ARENA.height

export const ROUND = {
  durationMs: 45_000,
  countdownMs: 3_000,
  fruitPoints: 10,
  bombPenalty: 20,
  handFlightSpeed: 0.8,
} as const

export const BLADE_TRAIL_MS = 145
export const TARGET_HISTORY_MS = 750

export const TRACKING = {
  inputWidth: 960,
  inputHeight: 540,
  captureIntervalMs: 27,
  freshFrameMs: 10,
  stableSingleFrames: 3,
  bladeGlideMs: 24,
  holdMs: 240,
  foldedFrames: 3,
  strokeGapMs: 420,
  handLockMs: 380,
  confirmMs: 150,
  reliableSideScore: 0.82,
  controlMargin: 0.12,
  predictionMs: 55,
  filterLeadMs: 16,
  minCutoffHz: 3.2,
  velocityCutoffHz: 2,
  speedGain: 6.5,
  maxCutoffHz: 20,
  jumpFloor: 0.029,
  jumpPalmFraction: 0.48,
  jumpTimeAllowance: 0.24,
  jumpMaxAllowance: 0.032,
  jumpPalmCoherence: 0.74,
  confirmationFloor: 0.045,
  confirmationPalmFraction: 0.65,
  detectionConfidence: 0.42,
  presenceConfidence: 0.42,
  trackingConfidence: 0.45,
} as const

export function formatTime(remainingMs: number) {
  const seconds = Math.ceil(Math.max(0, remainingMs) / 1000)
  const minutes = String(Math.floor(seconds / 60)).padStart(2, '0')
  const rest = String(seconds % 60).padStart(2, '0')
  return minutes + ':' + rest
}
