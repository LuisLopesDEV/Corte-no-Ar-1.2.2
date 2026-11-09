export function captureTimestamp(callbackAt: number, captureTime?: number) {
  if (captureTime === undefined || !Number.isFinite(captureTime) || captureTime < 0) return callbackAt
  if (captureTime > callbackAt || callbackAt - captureTime > 5000) return callbackAt
  return captureTime
}

export function resultWatchdogMs(roundTripMs: number) {
  // Um quadro válido lento deve chegar sem que o relógio o confunda com perda.
  return Math.min(2400, Math.max(380, (roundTripMs + 45) * 2.25))
}

export class VideoCadence {
  private start: { time: number; frames: number } | null = null

  reset() {
    this.start = null
  }

  observe(time: number, frames: number) {
    if (!Number.isFinite(time) || !Number.isFinite(frames)) return null
    if (!this.start || time < this.start.time || frames < this.start.frames) {
      this.start = { time, frames }
      return null
    }
    const duration = time - this.start.time
    if (duration < 1) return null
    const fps = (frames - this.start.frames) / duration
    this.start = { time, frames }
    return fps
  }
}
