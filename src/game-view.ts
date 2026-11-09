import { ARENA, ARENA_ASPECT, ROUND, formatTime } from './config.js'
import type { Hit } from './game.js'
import type { Control, Point, Rectangle, Screen } from './types.js'

function element<T extends HTMLElement = HTMLElement>(id: string) {
  const node = document.getElementById(id)
  if (!node) throw new Error('Elemento ausente: ' + id)
  return node as T
}

function text(node: HTMLElement, value: string) {
  if (node.textContent !== value) node.textContent = value
}

export class GameView {
  readonly arena = element('arena')
  readonly canvas = element<HTMLCanvasElement>('game')
  readonly video = element<HTMLVideoElement>('camera')
  readonly buttons = {
    camera: element<HTMLButtonElement>('use-camera'),
    mouse: element<HTMLButtonElement>('use-mouse'),
    startCamera: element<HTMLButtonElement>('start-camera'),
    setupMouse: element<HTMLButtonElement>('setup-mouse'),
    setupBack: element<HTMLButtonElement>('setup-back'),
    pauseBack: element<HTMLButtonElement>('pause-back'),
    resultBack: element<HTMLButtonElement>('result-back'),
    pause: element<HTMLButtonElement>('pause'),
    resume: element<HTMLButtonElement>('resume'),
    replay: element<HTMLButtonElement>('replay'),
    fullscreen: element<HTMLButtonElement>('fullscreen'),
    exitFullscreen: element<HTMLButtonElement>('exit-fullscreen'),
  }
  private readonly panels = {
    menu: element('menu-panel'),
    setup: element('setup-panel'),
    paused: element('pause-panel'),
    result: element('result-panel'),
  }
  private readonly viewfinder = element('viewfinder')
  private readonly cameraFrame = element('camera-frame')
  private readonly cameraGuide = element('camera-guide')
  private readonly cameraDot = element('camera-dot')
  private readonly cameraLabel = element('camera-label')
  private readonly setupStatus = element('setup-status')
  private readonly cameraRate = element('camera-rate')
  private readonly controlLabel = element('control-label')
  private readonly gameStatus = element('game-status')
  private readonly countdown = element('countdown')
  private readonly feedback = element('feedback')
  private readonly score = element('score')
  private readonly time = element('time')
  private readonly best = element('best')
  private readonly pauseNote = element('pause-note')
  private readonly resultScore = element('result-score')
  private readonly resultNote = element('result-note')

  constructor() {
    const style = document.documentElement.style
    style.setProperty('--arena-ratio', ARENA.width + ' / ' + ARENA.height)
    style.setProperty('--arena-aspect', String(ARENA_ASPECT))
    this.canvas.tabIndex = -1

    text(element('menu-rules'), 'Corte as frutas, desvie das bombas e faça o máximo de pontos em ' +
      ROUND.durationMs / 1000 + ' segundos.')
    text(element('fruit-rule'), 'Fruta +' + ROUND.fruitPoints)
    text(element('bomb-rule'), 'Bomba −' + ROUND.bombPenalty)
  }

  showScreen(screen: Screen, control: Control) {
    this.arena.dataset.screen = screen
    this.setControl(control)
    for (const [name, panel] of Object.entries(this.panels)) panel.hidden = name !== screen
    this.countdown.hidden = screen !== 'countdown'
    this.buttons.pause.hidden = screen !== 'playing'
  }

  setControl(control: Control) {
    this.arena.dataset.control = control
  }

  setControlLabel(message: string) { text(this.controlLabel, message) }
  setStatus(message: string) { text(this.gameStatus, message) }
  setSetupStatus(message: string) { text(this.setupStatus, message) }
  setCameraLabel(message: string) { text(this.cameraLabel, message) }

  showCameraRate(fps: number | null) {
    this.cameraRate.hidden = fps === null || fps >= 20
    if (fps !== null && !this.cameraRate.hidden) {
      text(this.cameraRate, 'Câmera a ' + Math.round(fps) + ' fps. Se a mão borrar, ilumine-a de frente.')
    }
  }

  showCamera(visible: boolean) {
    this.viewfinder.hidden = !visible
    if (!visible) {
      this.cameraDot.hidden = true
      this.cameraGuide.hidden = true
    } else if (this.video.videoWidth && this.video.videoHeight) {
      this.cameraFrame.style.aspectRatio = this.video.videoWidth + ' / ' + this.video.videoHeight
    }
  }

  guide(region: Rectangle) {
    this.cameraGuide.hidden = false
    this.cameraGuide.style.left = region.x * 100 + '%'
    this.cameraGuide.style.top = region.y * 100 + '%'
    this.cameraGuide.style.width = region.width * 100 + '%'
    this.cameraGuide.style.height = region.height * 100 + '%'
  }

  aim(point: Point | null, held = false) {
    this.cameraDot.hidden = !point
    if (!point) return
    this.cameraDot.style.left = point.x * 100 + '%'
    this.cameraDot.style.top = point.y * 100 + '%'
    this.cameraDot.style.opacity = held ? '0.5' : '1'
  }

  updateHud(score: number, remaining: number, best: number) {
    text(this.score, String(score).padStart(3, '0'))
    text(this.best, String(best).padStart(3, '0'))
    text(this.time, formatTime(remaining))
    this.time.classList.toggle('urgent', remaining <= 10_000)
  }

  setCountdown(milliseconds: number) {
    text(this.countdown, String(Math.ceil(milliseconds / 1000)))
  }

  showHit(hit: Hit) {
    const messages = []
    if (hit.fruitPoints > 0) messages.push('+' + hit.fruitPoints)
    if (hit.bombPenalty > 0) messages.push('Bomba −' + hit.bombPenalty)
    this.feedback.classList.toggle('negative', hit.bombPenalty > 0)
    text(this.feedback, messages.join(' · '))
  }

  clearHit() { text(this.feedback, '') }

  showPause(message: string) {
    this.pauseNote.hidden = !message
    text(this.pauseNote, message)
    this.buttons.resume.focus({ preventScroll: true })
  }

  showResult(score: number, best: number, newBest: boolean) {
    text(this.resultScore, score + (score === 1 ? ' ponto' : ' pontos'))
    text(this.resultNote, newBest ? 'Novo recorde neste navegador!' : 'Recorde nesta estação · ' + best)
    this.buttons.replay.focus({ preventScroll: true })
  }
}
