import { TRACKING } from './config.js'
import type { HandObservation, VisionMode } from './vision-protocol.js'

export type HandSelection = { hand: HandObservation | null; changed: boolean }

export class HandSelector {
  private last: HandObservation | null = null
  private seenAt = -Infinity

  reset() {
    this.last = null
    this.seenAt = -Infinity
  }

  select(hands: readonly HandObservation[], time: number, mode: VisionMode = 'search'): HandSelection {
    if (hands.length === 0) return { hand: null, changed: false }
    const previous = this.last

    if (!previous || time - this.seenAt > TRACKING.handLockMs) {
      if (mode === 'track') return { hand: null, changed: false }
      const largest = hands.reduce((a, b) => a.palmSpan >= b.palmSpan ? a : b)
      this.last = largest
      this.seenAt = time
      return { hand: largest, changed: true }
    }

    let best: HandObservation | null = null
    let bestCost = Infinity
    for (const hand of hands) {
      const scaleRatio = hand.palmSpan / previous.palmSpan
      if (scaleRatio < 0.55 || scaleRatio > 1.95) continue

      const sideConflict = previous.side && hand.side &&
        previous.sideScore >= TRACKING.reliableSideScore &&
        hand.sideScore >= TRACKING.reliableSideScore &&
        previous.side !== hand.side
      const travel = Math.hypot(hand.palm.x - previous.palm.x, hand.palm.y - previous.palm.y)

      // Lado é um indício de identidade, não uma confiança de detecção da mão.
      const cost = travel + 0.19 * Math.abs(Math.log(scaleRatio)) + (sideConflict ? 0.27 : 0)
      if (sideConflict && travel > 0.10) continue
      if (cost < bestCost) {
        best = hand
        bestCost = cost
      }
    }

    if (best) {
      this.last = best
      this.seenAt = time
    }
    return { hand: best, changed: false }
  }
}
