import { ARENA, BLADE_TRAIL_MS } from './config.js'
import { FRUIT_VARIETIES } from './game.js'
import type { FruitVariety, Piece, SliceGame } from './game.js'
import type { BladeDrawing } from './blade.js'
import type { Point } from './types.js'

const SPRITE_RADIUS = 48
const SPRITE_SIZE = 144
const SKINS = {
  apple: { light: '#fa8c81', dark: '#c13943', flesh: '#fff0ce' },
  orange: { light: '#ffc557', dark: '#e4772b', flesh: '#ffdf87' },
  lime: { light: '#cde87a', dark: '#679636', flesh: '#edf5ad' },
  plum: { light: '#c5a4e7', dark: '#715298', flesh: '#f0ca90' },
}

function drawBackground(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#161a21'
  ctx.fillRect(0, 0, ARENA.width, ARENA.height)

  // Uma faixa diagonal separa a área ilustrada do menu.
  ctx.fillStyle = '#202b47'
  ctx.beginPath()
  ctx.moveTo(950, 0)
  ctx.lineTo(ARENA.width, 0)
  ctx.lineTo(ARENA.width, ARENA.height)
  ctx.lineTo(650, ARENA.height)
  ctx.closePath()
  ctx.fill()

  ctx.strokeStyle = '#e9efff12'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = 0; x <= ARENA.width; x += 64) {
    ctx.moveTo(x, 0)
    ctx.lineTo(x, ARENA.height)
  }
  for (let y = 0; y <= ARENA.height; y += 64) {
    ctx.moveTo(0, y)
    ctx.lineTo(ARENA.width, y)
  }
  ctx.stroke()
}

function drawBombShape(ctx: CanvasRenderingContext2D, r: number) {
  ctx.fillStyle = '#323945'
  ctx.strokeStyle = '#b5bac2'
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  ctx.strokeStyle = '#d4a662'
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.moveTo(0, -r + 1)
  ctx.quadraticCurveTo(0, -r - 19, 19, -r - 17)
  ctx.stroke()
  ctx.fillStyle = '#f8c760'
  ctx.beginPath()
  ctx.arc(19, -r - 17, 5, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = '#f1a997'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(-10, -10)
  ctx.lineTo(10, 10)
  ctx.moveTo(-10, 10)
  ctx.lineTo(10, -10)
  ctx.stroke()
}

function drawFruitShape(ctx: CanvasRenderingContext2D, r: number, variety: FruitVariety) {
  const skin = SKINS[variety]
  const fill = ctx.createLinearGradient(-r, -r, r, r)
  fill.addColorStop(0, skin.light)
  fill.addColorStop(1, skin.dark)
  ctx.fillStyle = fill
  ctx.beginPath()

  if (variety === 'apple') {
    ctx.moveTo(0, -r * 0.73)
    ctx.bezierCurveTo(-r, -r * 1.38, -r * 1.35, 0, -r * 0.72, r * 0.7)
    ctx.bezierCurveTo(-r * 0.37, r * 1.12, -r * 0.16, r * 0.84, 0, r * 0.9)
    ctx.bezierCurveTo(r * 0.26, r * 0.88, r * 0.43, r * 1.12, r * 0.74, r * 0.65)
    ctx.bezierCurveTo(r * 1.35, -r * 0.22, r * 0.84, -r * 1.37, 0, -r * 0.73)
  } else {
    const narrow = variety === 'plum' ? 0.84 : 1
    ctx.ellipse(0, 0, r * narrow, r * 0.95, 0, 0, Math.PI * 2)
  }
  ctx.closePath()
  ctx.fill()

  ctx.strokeStyle = '#674936'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(-2, -r * 0.75)
  ctx.quadraticCurveTo(-4, -r, 4, -r * 1.13)
  ctx.stroke()

  ctx.fillStyle = '#a5d379'
  ctx.beginPath()
  ctx.ellipse(r * 0.33, -r * 0.94, r * 0.32, r * 0.12, -0.45, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#fff9dc55'
  ctx.beginPath()
  ctx.ellipse(-r * 0.39, -r * 0.33, r * 0.13, r * 0.29, 0.6, 0, Math.PI * 2)
  ctx.fill()
}

function drawPiece(ctx: CanvasRenderingContext2D, piece: Piece) {
  const r = piece.radius
  const skin = SKINS[piece.variety]
  ctx.save()
  ctx.translate(piece.x, piece.y)
  ctx.rotate(piece.angle + (piece.side === 1 ? Math.PI : 0))
  ctx.globalAlpha = Math.min(1, piece.life * 3)
  ctx.fillStyle = skin.flesh
  ctx.strokeStyle = skin.dark
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.arc(0, 0, r * 0.93, 0, Math.PI)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  ctx.strokeStyle = skin.light
  ctx.lineWidth = 2
  ctx.beginPath()
  for (let i = 1; i < 5; i++) {
    const angle = i * Math.PI / 5
    ctx.moveTo(0, 2)
    ctx.lineTo(Math.cos(angle) * r * 0.72, Math.sin(angle) * r * 0.72)
  }
  ctx.stroke()
  ctx.restore()
}


function makeCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('O navegador não conseguiu abrir o jogo em 2D.')
  return { canvas, context }
}

function createSprite(style: FruitVariety | 'bomb') {
  const { canvas, context } = makeCanvas(SPRITE_SIZE, SPRITE_SIZE)
  context.translate(SPRITE_SIZE / 2, SPRITE_SIZE / 2)
  if (style === 'bomb') drawBombShape(context, SPRITE_RADIUS)
  else drawFruitShape(context, SPRITE_RADIUS, style)
  return canvas
}

export class ArenaRenderer {
  private readonly ctx: CanvasRenderingContext2D
  private readonly background: HTMLCanvasElement
  private readonly sprites = new Map<FruitVariety | 'bomb', HTMLCanvasElement>()

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = ARENA.width
    canvas.height = ARENA.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('O navegador não conseguiu abrir o jogo em 2D.')
    this.ctx = context

    const background = makeCanvas(ARENA.width, ARENA.height)
    drawBackground(background.context)
    this.background = background.canvas
    for (const style of [...FRUIT_VARIETIES, 'bomb'] as const) {
      this.sprites.set(style, createSprite(style))
    }
  }

  draw(game: SliceGame, time: number, idle: boolean, blade: BladeDrawing | null) {
    const ctx = this.ctx
    ctx.drawImage(this.background, 0, 0)

    if (idle) {
      this.drawMenuArt(time)
    } else {
      for (const target of game.targets) this.drawTarget(target, target.kind === 'bomb' ? 'bomb' : target.variety)
      for (const piece of game.pieces) drawPiece(ctx, piece)
      for (const spark of game.sparks) {
        ctx.globalAlpha = Math.min(1, spark.life * 2)
        ctx.fillStyle = spark.style === 'bomb' ? '#ffad70' : SKINS[spark.style].light
        ctx.fillRect(spark.x, spark.y, 5, 5)
      }
      ctx.globalAlpha = 1
    }

    if (blade) this.drawBlade(blade, time)
  }

  private drawTarget(target: Point & { radius: number; angle: number }, style: FruitVariety | 'bomb') {
    const sprite = this.sprites.get(style)
    if (!sprite) return
    const ctx = this.ctx
    const size = SPRITE_SIZE * target.radius / SPRITE_RADIUS
    ctx.save()
    ctx.translate(target.x, target.y)
    ctx.rotate(target.angle)
    ctx.drawImage(sprite, -size / 2, -size / 2, size, size)
    ctx.restore()
  }

  private drawBlade(blade: BladeDrawing, time: number) {
    const ctx = this.ctx
    ctx.save()
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#ffda71'

    for (let i = 1; i < blade.trail.length; i++) {
      const start = blade.trail[i - 1]
      const end = blade.trail[i]
      if (!start || !end) continue
      ctx.globalAlpha = Math.max(0, 1 - (time - end.shownAt) / BLADE_TRAIL_MS)
      ctx.lineWidth = 2 + 7 * ctx.globalAlpha
      ctx.beginPath()
      ctx.moveTo(start.x, start.y)
      ctx.lineTo(end.x, end.y)
      ctx.stroke()
    }

    ctx.globalAlpha = 1
    ctx.fillStyle = '#fff1ba'
    ctx.beginPath()
    ctx.arc(blade.point.x, blade.point.y, 6, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  private drawMenuArt(time: number) {
    const ctx = this.ctx
    const float = Math.sin(time / 770) * 10
    ctx.save()
    ctx.strokeStyle = '#f4ca628c'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(795, 527)
    ctx.quadraticCurveTo(1032, 327, 1180, 150)
    ctx.stroke()
    ctx.restore()

    this.drawTarget({ x: 980, y: 306 + float, radius: 87, angle: -0.34 }, 'orange')
    this.drawTarget({ x: 1115, y: 470 - float, radius: 61, angle: 0.4 }, 'apple')
    this.drawTarget({ x: 859, y: 477 + float, radius: 47, angle: -0.48 }, 'lime')
  }
}
