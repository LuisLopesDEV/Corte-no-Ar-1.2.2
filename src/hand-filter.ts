import { TRACKING } from './config.js'
import type { Point } from './types.js'
import type { HandObservation } from './vision-protocol.js'

export type HandFrame = {
  raw: Point
  filtered: Point
  velocity: Point
  palmSpan: number
  capturedAt: number
  receivedAt: number
  startsStroke: boolean
}

export type FilterResult =
  | { kind: 'tracking'; frame: HandFrame }
  | { kind: 'holding'; frame: HandFrame; keepsStroke: boolean }
  | { kind: 'lost' }

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function smoothingWeight(seconds: number, cutoff: number) {
  return seconds / (seconds + 1 / (2 * Math.PI * cutoff))
}

function mix(previous: Point, next: Point, weight: number): Point {
  return {
    x: previous.x + (next.x - previous.x) * weight,
    y: previous.y + (next.y - previous.y) * weight,
  }
}

export function predictHand(frame: HandFrame, time: number): Point {
  const freshness = Math.max(0, 1 - Math.max(0, time - frame.receivedAt - 50) / 100)
  const lead = Math.min(TRACKING.predictionMs, Math.max(0, time - frame.capturedAt) + TRACKING.filterLeadMs)
  const seconds = lead * freshness / 1000
  const dx = frame.velocity.x * seconds
  const dy = frame.velocity.y * seconds
  const travel = Math.hypot(dx, dy)
  const limit = Math.min(0.065, frame.palmSpan * 0.6)
  const scale = travel > limit ? limit / travel : 1
  return { x: frame.filtered.x + dx * scale, y: frame.filtered.y + dy * scale }
}

export class HandFilter {
  private last: { observation: HandObservation; frame: HandFrame } | null = null
  private candidate: { observation: HandObservation; time: number } | null = null
  private interrupted = true

  reset() {
    this.last = null
    this.candidate = null
    this.interrupted = true
  }

  missing(receivedAt: number): FilterResult {
    this.candidate = null
    return this.hold(receivedAt)
  }

  waitForPose(): FilterResult {
    this.candidate = null
    return this.last ? { kind: 'holding', frame: this.last.frame, keepsStroke: true } : { kind: 'lost' }
  }

  update(observation: HandObservation, capturedAt: number, receivedAt: number): FilterResult {
    const previous = this.last
    if (!previous || capturedAt - previous.frame.capturedAt > TRACKING.strokeGapMs) {
      return this.anchor(observation, capturedAt, receivedAt)
    }

    const dt = Math.max(0.001, (capturedAt - previous.frame.capturedAt) / 1000)
    if (this.isIsolatedJump(previous.observation, observation, dt)) {
      const candidate = this.candidate
      const tolerance = Math.max(TRACKING.confirmationFloor, observation.palmSpan * TRACKING.confirmationPalmFraction)
      if (candidate && capturedAt - candidate.time <= TRACKING.confirmMs &&
        distance(candidate.observation.tip, observation.tip) <= tolerance &&
        distance(candidate.observation.palm, observation.palm) <= tolerance) {
        return this.anchor(observation, capturedAt, receivedAt)
      }
      this.candidate = { observation, time: capturedAt }
      return this.hold(receivedAt)
    }

    const rawVelocity = {
      x: (observation.tip.x - previous.observation.tip.x) / dt,
      y: (observation.tip.y - previous.observation.tip.y) / dt,
    }
    const velocity = mix(previous.frame.velocity, rawVelocity, smoothingWeight(dt, TRACKING.velocityCutoffHz))
    const cutoff = Math.min(TRACKING.maxCutoffHz, TRACKING.minCutoffHz + TRACKING.speedGain * Math.hypot(velocity.x, velocity.y))
    const frame = {
      raw: observation.tip,
      filtered: mix(previous.frame.filtered, observation.tip, smoothingWeight(dt, cutoff)),
      velocity,
      palmSpan: observation.palmSpan,
      capturedAt,
      receivedAt,
      startsStroke: this.interrupted,
    }
    this.last = { observation, frame }
    this.candidate = null
    this.interrupted = false
    return { kind: 'tracking', frame }
  }

  private anchor(observation: HandObservation, capturedAt: number, receivedAt: number): FilterResult {
    const frame = {
      raw: observation.tip,
      filtered: observation.tip,
      velocity: { x: 0, y: 0 },
      palmSpan: observation.palmSpan,
      capturedAt,
      receivedAt,
      startsStroke: true,
    }
    this.last = { observation, frame }
    this.candidate = null
    this.interrupted = false
    return { kind: 'tracking', frame }
  }

  private hold(receivedAt: number): FilterResult {
    this.interrupted = true
    if (this.last && receivedAt - this.last.frame.receivedAt <= TRACKING.holdMs) {
      return { kind: 'holding', frame: this.last.frame, keepsStroke: false }
    }
    this.reset()
    return { kind: 'lost' }
  }

  private isIsolatedJump(previous: HandObservation, current: HandObservation, seconds: number) {
    const tipX = current.tip.x - previous.tip.x
    const tipY = current.tip.y - previous.tip.y
    const palmX = current.palm.x - previous.palm.x
    const palmY = current.palm.y - previous.palm.y
    const tipTravel = Math.hypot(tipX, tipY)
    const relativeShift = Math.hypot(tipX - palmX, tipY - palmY)
    const palmSpan = Math.min(previous.palmSpan, current.palmSpan)
    const tolerance = Math.max(TRACKING.jumpFloor, palmSpan * TRACKING.jumpPalmFraction) +
      Math.min(TRACKING.jumpMaxAllowance, seconds * TRACKING.jumpTimeAllowance)

    // Um movimento largo e coerente da mão inteira continua sendo um corte.
    return tipTravel > tolerance && relativeShift > tolerance &&
      Math.hypot(palmX, palmY) < tipTravel * TRACKING.jumpPalmCoherence
  }
}
