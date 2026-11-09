import { ARENA, ROUND, TARGET_HISTORY_MS } from './config.js'
import type { Point, Stroke, TimedStroke } from './types.js'

export const FRUIT_VARIETIES = ['apple', 'orange', 'lime', 'plum'] as const
export type FruitVariety = typeof FRUIT_VARIETIES[number]

type Motion = Point & { vx: number; vy: number; radius: number; angle: number; spin: number }
export type Fruit = Motion & { kind: 'fruit'; variety: FruitVariety }
export type Bomb = Motion & { kind: 'bomb' }
export type Target = Fruit | Bomb
export type Piece = Fruit & { side: 1 | -1; life: number }
export type Spark = Point & { vx: number; vy: number; life: number; style: FruitVariety | 'bomb' }
export type Hit = { fruitPoints: number; bombPenalty: number }
type TargetPosition = Point & { time: number }

const GRAVITY = 1010
const MIN_LAUNCH_SPEED = 810
const MAX_RISE = 0.8
const HIT_MARGIN = 5
const ORIGIN = { x: 0, y: 0 }

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min)
}

function distanceToStroke(point: Point, stroke: Stroke) {
  const { from, to } = stroke
  const dx = to.x - from.x
  const dy = to.y - from.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return Math.hypot(point.x - from.x, point.y - from.y)

  const projection = ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared
  const t = Math.min(1, Math.max(0, projection))
  return Math.hypot(point.x - from.x - t * dx, point.y - from.y - t * dy)
}

function relativePosition(stroke: TimedStroke, start: TargetPosition, end: TargetPosition, time: number): Point {
  const bladeProgress = (time - stroke.fromAt) / (stroke.toAt - stroke.fromAt)
  const targetProgress = end.time > start.time ? (time - start.time) / (end.time - start.time) : 0
  return {
    x: stroke.from.x + (stroke.to.x - stroke.from.x) * bladeProgress -
      (start.x + (end.x - start.x) * targetProgress),
    y: stroke.from.y + (stroke.to.y - stroke.from.y) * bladeProgress -
      (start.y + (end.y - start.y) * targetProgress),
  }
}

function crossesMovingTarget(stroke: TimedStroke, start: TargetPosition, end: TargetPosition, radius: number) {
  const from = Math.max(stroke.fromAt, start.time)
  const to = Math.min(stroke.toAt, end.time)
  if (from > to) return false

  // Testa o movimento relativo da lâmina e do alvo no mesmo intervalo de tempo.
  return distanceToStroke(ORIGIN, {
    from: relativePosition(stroke, start, end, from),
    to: relativePosition(stroke, start, end, to),
  }) <= radius + HIT_MARGIN
}

export class SliceGame {
  score = 0
  private activeTargets: Target[] = []
  private activePieces: Piece[] = []
  private activeSparks: Spark[] = []
  private readonly targetHistory = new Map<Target, TargetPosition[]>()
  private lastTargetFrame = -Infinity
  private spawnIn = 0.22

  get targets(): readonly Target[] { return this.activeTargets }
  get pieces(): readonly Piece[] { return this.activePieces }
  get sparks(): readonly Spark[] { return this.activeSparks }

  reset() {
    this.score = 0
    this.activeTargets = []
    this.activePieces = []
    this.activeSparks = []
    this.spawnIn = 0.22
    this.clearTargetHistory()
  }

  cut(stroke: Stroke): Hit | null {
    const targets = this.activeTargets.filter(target => distanceToStroke(target, stroke) <= target.radius + HIT_MARGIN)
    return this.applyCut(stroke, targets)
  }

  rememberTargets(time: number) {
    if (time <= this.lastTargetFrame) return
    this.lastTargetFrame = time
    for (const target of this.activeTargets) {
      let path = this.targetHistory.get(target)
      if (!path) {
        path = []
        this.targetHistory.set(target, path)
      }
      path.push({ x: target.x, y: target.y, time })
    }

    const cutoff = time - TARGET_HISTORY_MS
    for (const [target, path] of this.targetHistory) {
      if ((path.at(-1)?.time ?? -Infinity) < cutoff) {
        this.targetHistory.delete(target)
        continue
      }
      while (path[1] && path[1].time < cutoff) path.shift()
    }
  }

  clearTargetHistory() {
    this.targetHistory.clear()
    this.lastTargetFrame = -Infinity
  }

  cutCaptured(stroke: TimedStroke): Hit | null {
    if (stroke.toAt <= stroke.fromAt || stroke.fromAt < this.lastTargetFrame - TARGET_HISTORY_MS) return null
    const targets: Target[] = []
    for (const [target, path] of this.targetHistory) {
      for (const [index, start] of path.entries()) {
        if (start.time > stroke.toAt) break
        // Até o próximo desenho, o alvo ainda está na última posição exibida.
        const end = path[index + 1] ?? (start.time === this.lastTargetFrame ? { ...start, time: stroke.toAt } : start)
        if (crossesMovingTarget(stroke, start, end, target.radius)) {
          targets.push(target)
          break
        }
      }
    }
    return this.applyCut(stroke, targets)
  }

  private applyCut(stroke: Stroke, targets: Target[]): Hit | null {
    if (!targets.length) return null
    const hit: Hit = { fruitPoints: 0, bombPenalty: 0 }
    const angle = Math.atan2(stroke.to.y - stroke.from.y, stroke.to.x - stroke.from.x)
    for (const target of targets) {
      if (target.kind === 'bomb') hit.bombPenalty += ROUND.bombPenalty
      else hit.fruitPoints += ROUND.fruitPoints
      this.targetHistory.delete(target)
      this.burst(target, angle)
    }

    this.activeTargets = this.activeTargets.filter(target => !targets.includes(target))
    this.score = Math.max(0, this.score + hit.fruitPoints - hit.bombPenalty)
    return hit
  }

  advance(dt: number, roundAgeMs: number, flightSpeed = 1) {
    this.spawnIn -= dt
    if (this.spawnIn <= 0) {
      this.spawnWave(roundAgeMs)
      // A frequência sobe levemente ao longo da rodada, sem acelerar o voo.
      const progress = Math.min(1, Math.max(0, roundAgeMs / ROUND.durationMs))
      const waveRate = 0.92 + 0.16 * progress
      this.spawnIn = randomBetween(0.78, 1.23) / waveRate
    }

    const flightDt = dt * flightSpeed
    for (const target of this.activeTargets) {
      target.x += target.vx * flightDt
      target.y += target.vy * flightDt + GRAVITY * flightDt * flightDt / 2
      target.vy += GRAVITY * flightDt
      target.angle += target.spin * flightDt
    }
    this.activeTargets = this.activeTargets.filter(target => target.y < ARENA.height + 155 || target.vy < 0)

    for (const piece of this.activePieces) {
      piece.life -= dt
      piece.vy += GRAVITY * dt
      piece.x += piece.vx * dt
      piece.y += piece.vy * dt
      piece.angle += piece.spin * dt
    }
    this.activePieces = this.activePieces.filter(piece => piece.life > 0)

    for (const spark of this.activeSparks) {
      spark.life -= dt
      spark.vy += 620 * dt
      spark.x += spark.vx * dt
      spark.y += spark.vy * dt
    }
    this.activeSparks = this.activeSparks.filter(spark => spark.life > 0)
  }

  private spawnWave(roundAgeMs: number) {
    const count = Math.floor(randomBetween(2, 5))
    for (let i = 0; i < count; i++) {
      const x = randomBetween(125, ARENA.width - 125)
      const y = ARENA.height + 62 + i * 25
      const lowestPeak = y - MIN_LAUNCH_SPEED ** 2 / (2 * GRAVITY)
      const peakY = randomBetween(ARENA.height * (1 - MAX_RISE), lowestPeak)
      const motion = {
        x,
        y,
        vx: (ARENA.width / 2 - x) * randomBetween(0.12, 0.42),
        vy: -Math.sqrt(2 * GRAVITY * (y - peakY)),
        radius: randomBetween(34, 47),
        angle: randomBetween(-0.7, 0.7),
        spin: randomBetween(-1.6, 1.6),
      }

      const bomb = roundAgeMs > 2500 && i === count - 1 && Math.random() < 0.38
      if (bomb) {
        this.activeTargets.push({ ...motion, kind: 'bomb' })
      } else {
        const variety = FRUIT_VARIETIES[Math.floor(Math.random() * FRUIT_VARIETIES.length)] ?? 'orange'
        this.activeTargets.push({ ...motion, kind: 'fruit', variety })
      }
    }
  }

  private burst(target: Target, sliceAngle: number) {
    if (target.kind === 'fruit') {
      for (const side of [-1, 1] as const) {
        this.activePieces.push({
          ...target,
          side,
          angle: sliceAngle,
          vx: target.vx - Math.sin(sliceAngle) * 155 * side,
          vy: target.vy + Math.cos(sliceAngle) * 155 * side,
          spin: side * 2.6,
          life: 0.75,
        })
      }
    }

    for (let i = 0; i < (target.kind === 'bomb' ? 24 : 15); i++) {
      const angle = randomBetween(0, Math.PI * 2)
      const speed = randomBetween(95, 370)
      this.activeSparks.push({
        x: target.x,
        y: target.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: randomBetween(0.22, 0.63),
        style: target.kind === 'bomb' ? 'bomb' : target.variety,
      })
    }
  }
}
