import { BLADE_TRAIL_MS } from './config.js'
import type { Point, TimedStroke } from './types.js'

type TimedPoint = Point & { shownAt: number }
export type BladeDrawing = { point: Point; trail: readonly TimedPoint[] }
export type BladeSample = {
  point: Point
  capturedAt: number
  shownAt: number
  startsStroke?: boolean
}

export class BladeInput {
  private previous: BladeSample | null = null
  private point: Point | null = null
  private trail: TimedPoint[] = []
  private glide: { from: Point; time: number } | null = null
  private readonly minimumSpeed: number
  private readonly maximumGap: number
  private readonly glideMs: number

  constructor(minimumSpeed: number, maximumGap: number, glideMs = 0) {
    this.minimumSpeed = minimumSpeed
    this.maximumGap = maximumGap
    this.glideMs = glideMs
  }

  move(sample: BladeSample): TimedStroke | null {
    const previous = sample.startsStroke ? null : this.previous
    this.previous = sample
    this.point = sample.point
    const elapsed = previous ? sample.capturedAt - previous.capturedAt : Infinity
    const trailPoint = { ...sample.point, shownAt: sample.shownAt }
    if (!previous || elapsed <= 0 || elapsed > this.maximumGap) {
      this.glide = null
      this.trail = [trailPoint]
      return null
    }

    const distance = Math.hypot(sample.point.x - previous.point.x, sample.point.y - previous.point.y)
    this.glide = this.glideMs > 0 && distance >= 0.6 ? { from: previous.point, time: sample.shownAt } : null
    if (distance < 0.6) return null
    this.trail.push(trailPoint)
    if (this.trail.length > 24) this.trail.shift()
    if (distance < this.minimumSpeed * elapsed) return null
    return { from: previous.point, to: sample.point, fromAt: previous.capturedAt, toAt: sample.capturedAt }
  }

  hold() {
    this.previous = null
    this.trail = []
    this.glide = null
  }

  clear() {
    this.hold()
    this.point = null
  }

  drawing(now: number, visualPoint?: Point): BladeDrawing | null {
    if (!this.point) return null
    this.trail = this.trail.filter(point => now - point.shownAt < BLADE_TRAIL_MS)
    const glide = this.glide
    let point = this.point
    if (glide && now - glide.time < this.glideMs) {
      // A ponta percorre apenas o segmento confirmado, com a maior parte do avanço no primeiro quadro.
      const progress = 1 - (1 - Math.max(0, now - glide.time) / this.glideMs) ** 2
      point = {
        x: glide.from.x + (point.x - glide.from.x) * progress,
        y: glide.from.y + (point.y - glide.from.y) * progress,
      }
    }
    return { point: visualPoint ?? point, trail: this.trail }
  }
}
