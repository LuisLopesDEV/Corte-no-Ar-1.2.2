import { ARENA, ROUND, TRACKING } from './config.js'
import { BladeInput } from './blade.js'
import { SliceGame } from './game.js'
import type { GameView } from './game-view.js'
import { cameraErrorMessage, connectHandCamera } from './hand-camera.js'
import type { CameraEvent, HandCamera, TraceSample } from './hand-camera.js'
import { predictHand } from './hand-filter.js'
import type { HandFrame } from './hand-filter.js'
import { arenaPoint, previewGuide, previewPoint } from './hand-geometry.js'
import type { FrameGeometry } from './hand-geometry.js'
import { loadRecord, saveRecord } from './record.js'
import { ArenaRenderer } from './render.js'
import type { Control, Screen, TimedStroke } from './types.js'

const HAND_GUIDE = 'Enquadre a mão inteira e estenda o indicador. O contorno indica a área de movimento.'

export class MatchController {
  private readonly view: GameView
  private readonly renderer: ArenaRenderer
  private readonly game = new SliceGame()
  private readonly mouseBlade = new BladeInput(0, 185)
  private readonly handBlade = new BladeInput(0.065, TRACKING.strokeGapMs, TRACKING.bladeGlideMs)
  private readonly trace?: (sample: TraceSample) => void
  private screen: Screen = 'menu'
  private control: Control = 'mouse'
  private remaining: number = ROUND.durationMs
  private countdown: number = ROUND.countdownMs
  private best = loadRecord()
  private lastFrame = performance.now()
  private feedbackUntil = 0
  private camera: HandCamera | null = null
  private cameraRequest: AbortController | null = null
  private recovering = false
  private hand: { frame: HandFrame; geometry: FrameGeometry } | null = null

  constructor(view: GameView, trace?: (sample: TraceSample) => void) {
    this.view = view
    this.trace = trace
    this.renderer = new ArenaRenderer(view.canvas)
  }

  start() {
    this.bindControls()
    this.refreshHud()
    requestAnimationFrame(this.animate)
  }

  private acceptsHand() {
    return this.screen === 'setup' || this.screen === 'countdown' || this.screen === 'playing'
  }

  private syncCamera() {
    this.view.showCamera(Boolean(this.camera) && this.acceptsHand())
    this.camera?.setActive(this.acceptsHand() && !document.hidden)
  }

  private setScreen(screen: Screen) {
    this.screen = screen
    this.view.showScreen(screen, this.control)
    this.syncCamera()
    this.mouseBlade.clear()
    this.handBlade.clear()
    this.hand = null
    this.game.clearTargetHistory()
  }

  private refreshHud() {
    this.view.updateHud(this.game.score, this.remaining, this.best)
  }

  private stopCamera() {
    this.cameraRequest?.abort()
    this.cameraRequest = null
    const camera = this.camera
    this.camera = null
    camera?.close()
    this.recovering = false
    this.hand = null
    this.handBlade.clear()
    this.view.buttons.startCamera.disabled = true
    this.view.showCamera(false)
    this.view.showCameraRate(null)
  }

  private showMenu() {
    this.stopCamera()
    this.game.reset()
    this.remaining = ROUND.durationMs
    this.view.clearHit()
    this.setScreen('menu')
    this.refreshHud()
    this.view.setControlLabel('Escolha o controle')
    this.view.setStatus('Pronto para jogar')
    this.view.buttons.camera.focus({ preventScroll: true })
  }

  private async prepareCamera() {
    this.stopCamera()
    this.control = 'camera'
    this.setScreen('setup')
    this.view.clearHit()
    this.view.setSetupStatus('Permita o acesso à câmera para começar.')
    this.view.setControlLabel('Controle pela mão')
    this.view.setStatus('Preparando a câmera')

    const request = new AbortController()
    this.cameraRequest = request
    try {
      const camera = await connectHandCamera(this.view.video, request.signal, {
        update: event => {
          if (!request.signal.aborted) this.handleCamera(event)
        },
        trace: this.trace,
        cadence: fps => {
          if (!request.signal.aborted && this.screen === 'setup') this.view.showCameraRate(fps)
        },
      })
      if (request.signal.aborted) {
        camera.close()
        return
      }

      this.camera = camera
      this.syncCamera()
      this.view.setCameraLabel('Mostre uma mão')
      this.view.setSetupStatus(HAND_GUIDE)
      this.view.setStatus('Câmera ligada')
    } catch (error) {
      if (!request.signal.aborted) this.cameraFailed(error)
    }
  }

  private startRound(control: Control) {
    if (control === 'camera' && (!this.camera || this.view.buttons.startCamera.disabled || this.recovering)) return
    if (control === 'mouse') this.stopCamera()

    this.control = control
    this.game.reset()
    this.remaining = ROUND.durationMs
    this.countdown = ROUND.countdownMs
    this.lastFrame = performance.now()
    this.view.clearHit()
    this.setScreen('countdown')
    this.refreshHud()
    this.view.setCountdown(this.countdown)
    this.view.setControlLabel(control === 'camera' ? 'Controle pela mão' : 'Controle pelo mouse')
    this.view.setStatus('Prepare o movimento')
    this.view.canvas.focus({ preventScroll: true })
  }

  private pause(message = '') {
    if (this.screen !== 'playing') return
    this.setScreen('paused')
    this.view.setStatus('Partida pausada')
    this.view.showPause(message)
  }

  private resume() {
    if (this.screen !== 'paused') return
    this.lastFrame = performance.now()
    this.setScreen('playing')
    this.view.setStatus('Corte as frutas')
    this.view.canvas.focus({ preventScroll: true })
  }

  private finishRound() {
    const newBest = this.game.score > this.best
    if (newBest) {
      this.best = this.game.score
      saveRecord(this.best)
    }
    this.stopCamera()
    this.setScreen('result')
    this.view.clearHit()
    this.refreshHud()
    this.view.showResult(this.game.score, this.best, newBest)
    this.view.setStatus('Partida encerrada')
  }

  private cut(stroke: TimedStroke | null, time: number) {
    if (!stroke || this.screen !== 'playing' || this.recovering) return
    const hit = this.control === 'camera' ? this.game.cutCaptured(stroke) : this.game.cut(stroke)
    if (!hit) return
    this.view.showHit(hit)
    this.feedbackUntil = time + 600
    this.refreshHud()
  }

  private handleCamera(event: CameraEvent) {
    if (event.kind === 'error') {
      this.cameraFailed(event.error)
      return
    }
    this.recovering = event.kind === 'recovering'
    if (!this.acceptsHand()) return

    if (event.kind === 'tracking') {
      this.hand = { frame: event.frame, geometry: event.geometry }
      this.view.guide(previewGuide(event.geometry))
      this.view.aim(previewPoint(event.frame.filtered, event.geometry))
      this.view.setCameraLabel('Mão detectada')
      if (this.screen === 'setup') {
        this.view.buttons.startCamera.disabled = false
        this.view.setSetupStatus('Mão detectada. Mova o indicador para testar a lâmina.')
      } else if (this.screen === 'playing') {
        this.view.setStatus('Corte as frutas')
      }
      const stroke = this.handBlade.move({
        point: arenaPoint(event.frame.filtered, event.geometry),
        capturedAt: event.frame.capturedAt,
        shownAt: event.frame.receivedAt,
        startsStroke: event.frame.startsStroke,
      })
      this.cut(stroke, event.frame.receivedAt)
      return
    }

    this.hand = null
    if (event.kind === 'holding') {
      if (!event.keepsStroke) this.handBlade.hold()
      this.view.aim(previewPoint(event.frame.filtered, event.geometry), true)
      return
    }

    this.handBlade.clear()
    this.view.aim(null)
    if (event.kind === 'recovering') {
      this.game.clearTargetHistory()
      this.view.setStatus('Restabelecendo a câmera…')
      this.view.setCameraLabel('Reconectando')
      if (this.screen === 'setup') this.view.setSetupStatus('Restabelecendo a câmera…')
      return
    }

    const guidance = event.kind === 'extend' ? 'Estenda o indicador' : 'Mostre uma mão'
    this.view.setCameraLabel(guidance)
    if (this.screen === 'playing') this.view.setStatus(guidance)
    if (this.screen === 'setup') this.view.setSetupStatus(HAND_GUIDE)
  }

  private cameraFailed(error: unknown) {
    this.stopCamera()
    if (this.screen === 'setup') {
      this.view.setSetupStatus(cameraErrorMessage(error))
      this.view.setStatus('Câmera indisponível')
      return
    }

    this.control = 'mouse'
    this.view.setControl(this.control)
    this.view.setControlLabel('Controle pelo mouse')
    if (this.screen === 'playing') {
      this.pause('A câmera foi interrompida. Continue a partida com o mouse.')
    } else if (this.screen === 'paused') {
      this.view.showPause('A câmera foi interrompida. Continue a partida com o mouse.')
    } else {
      this.view.setStatus('Câmera interrompida. Use o mouse.')
    }
  }

  private readonly animate = (time: number) => {
    const elapsed = Math.max(0, time - this.lastFrame)
    this.lastFrame = time

    if (!this.recovering && !document.hidden) {
      if (this.screen === 'countdown') {
        this.countdown -= elapsed
        if (this.countdown <= 0) {
          this.setScreen('playing')
          this.view.setStatus('Corte as frutas')
        } else {
          this.view.setCountdown(this.countdown)
        }
      } else if (this.screen === 'playing') {
        this.remaining = Math.max(0, this.remaining - elapsed)
        this.refreshHud()
        if (this.remaining === 0) {
          this.finishRound()
        } else {
          const dt = Math.min(elapsed / 1000, 0.045)
          const speed = this.control === 'camera' ? ROUND.handFlightSpeed : 1
          this.game.advance(dt, ROUND.durationMs - this.remaining, speed)
          if (this.control === 'camera') this.game.rememberTargets(time)
        }
      }
    }

    if (time >= this.feedbackUntil) this.view.clearHit()
    // Na partida, o ponto visível da lâmina acompanha os segmentos confirmados.
    const visualPoint = this.screen === 'setup' && this.hand
      ? arenaPoint(predictHand(this.hand.frame, time), this.hand.geometry)
      : undefined
    const blade = this.control === 'camera' ? this.handBlade.drawing(time, visualPoint) : this.mouseBlade.drawing(time)
    this.renderer.draw(this.game, time, this.screen === 'menu' || this.screen === 'setup' || this.screen === 'result', blade)
    requestAnimationFrame(this.animate)
  }

  private bindControls() {
    const { buttons, canvas, arena } = this.view
    buttons.camera.addEventListener('click', () => void this.prepareCamera())
    buttons.mouse.addEventListener('click', () => this.startRound('mouse'))
    buttons.setupMouse.addEventListener('click', () => this.startRound('mouse'))
    buttons.startCamera.addEventListener('click', () => this.startRound('camera'))
    buttons.setupBack.addEventListener('click', () => this.showMenu())
    buttons.pauseBack.addEventListener('click', () => this.showMenu())
    buttons.resultBack.addEventListener('click', () => this.showMenu())
    buttons.pause.addEventListener('click', () => this.pause())
    buttons.resume.addEventListener('click', () => this.resume())
    buttons.replay.addEventListener('click', () => {
      if (this.control === 'camera') void this.prepareCamera()
      else this.startRound('mouse')
    })

    canvas.addEventListener('pointermove', event => {
      if (this.control !== 'mouse' || this.screen !== 'playing') return
      const bounds = canvas.getBoundingClientRect()
      if (!bounds.width || !bounds.height) return
      const time = performance.now()
      this.cut(this.mouseBlade.move({
        point: {
          x: (event.clientX - bounds.left) * ARENA.width / bounds.width,
          y: (event.clientY - bounds.top) * ARENA.height / bounds.height,
        },
        capturedAt: time,
        shownAt: time,
      }), time)
    })
    const clearMouse = () => this.mouseBlade.clear()
    canvas.addEventListener('pointerleave', clearMouse)
    canvas.addEventListener('pointercancel', clearMouse)

    document.addEventListener('keydown', event => {
      if (event.code !== 'Space' || event.repeat || event.target instanceof HTMLButtonElement) return
      if (this.screen !== 'playing' && this.screen !== 'paused') return
      event.preventDefault()
      if (this.screen === 'playing') this.pause()
      else this.resume()
    })
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause()
      this.lastFrame = performance.now()
      this.syncCamera()
    })
    window.addEventListener('blur', () => this.pause())
    window.addEventListener('pagehide', () => this.stopCamera())
    window.addEventListener('pageshow', event => {
      if (event.persisted) this.showMenu()
    })

    buttons.fullscreen.addEventListener('click', async () => {
      try {
        await arena.requestFullscreen()
      } catch {
        this.view.setStatus('Tela cheia indisponível neste navegador')
      }
    })
    buttons.exitFullscreen.addEventListener('click', async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen()
      } catch {
        this.view.setStatus('Use Esc para sair da tela cheia')
      }
    })
  }
}
