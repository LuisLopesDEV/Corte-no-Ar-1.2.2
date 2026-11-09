import { TRACKING } from './config.js'
import { VideoCadence, captureTimestamp, resultWatchdogMs } from './camera-time.js'
import { HandFilter } from './hand-filter.js'
import type { FilterResult, HandFrame } from './hand-filter.js'
import { createFrameGeometry, previewPoint } from './hand-geometry.js'
import type { FrameGeometry } from './hand-geometry.js'
import { HandSelector } from './hand-selector.js'
import type { Point, Size } from './types.js'
import { openInference } from './hand-inference.js'
import type { Inference } from './hand-inference.js'
import type { Detection, LightRegion, VisionMode } from './vision-protocol.js'

type CameraFrame = { videoTime: number; capturedAt: number; availableAt: number }

export type CameraEvent =
  | { kind: 'tracking'; frame: HandFrame; geometry: FrameGeometry }
  | { kind: 'holding'; frame: HandFrame; geometry: FrameGeometry; keepsStroke: boolean }
  | { kind: 'looking' | 'extend' | 'recovering' }
  | { kind: 'error'; error: unknown }

export type TraceSample = {
  time: number
  raw: Point | null
  filtered: Point | null
  hands: number
  inferenceMs: number
  roundTripMs: number
  state: string
  backend: string
  palm?: Point | null
  indexExtended?: boolean | null
  videoFps?: number | null
  inputSide?: number
  mode?: VisionMode
}

type CameraCallbacks = {
  update(event: CameraEvent): void
  trace?: (sample: TraceSample) => void
  cadence?: (fps: number) => void
}

export class HandCamera {
  private readonly video: HTMLVideoElement
  private readonly stream: MediaStream
  private readonly assets: string
  private readonly callbacks: CameraCallbacks
  private readonly filter = new HandFilter()
  private readonly selector = new HandSelector()
  private readonly cadence = new VideoCadence()
  private readonly lifetime = new AbortController()
  private readonly usesVideoFrames: boolean
  private inference: Inference | null
  private active = false
  private generation = 0
  private callbackId: number | null = null
  private watchdogId: number | null = null
  private inFlight = false
  private triedRecovery = false
  private lastVideoTime = -1
  private lastCaptureAt = -Infinity
  private latestFrame: CameraFrame | null = null
  private roundTripMs = 0
  private videoFps: number | null = null
  private foldedFrames = 0
  private stableSingleFrames = 0
  private size: Size | null = null
  private geometry: FrameGeometry | null = null
  private lightRegion: LightRegion | null = null

  constructor(
    video: HTMLVideoElement,
    stream: MediaStream,
    assets: string,
    inference: Inference,
    callbacks: CameraCallbacks,
  ) {
    this.video = video
    this.stream = stream
    this.assets = assets
    this.inference = inference
    this.callbacks = callbacks
    this.usesVideoFrames = typeof video.requestVideoFrameCallback === 'function'
    for (const track of stream.getVideoTracks()) {
      track.addEventListener('ended', this.disconnected, { signal: this.lifetime.signal })
    }
  }

  setActive(active: boolean) {
    if (this.lifetime.signal.aborted || this.active === active) return
    this.active = active
    this.generation++
    this.resetTracking()
    this.cadence.reset()
    this.videoFps = null
    this.lastVideoTime = -1
    this.lastCaptureAt = -Infinity
    this.latestFrame = null
    this.cancelCallback()
    if (active) this.schedule()
  }

  close() {
    if (this.lifetime.signal.aborted) return
    this.setActive(false)
    this.lifetime.abort()
    stopStream(this.video, this.stream)
    this.inference?.close()
    this.inference = null
  }

  private readonly disconnected = () => {
    this.callbacks.update({
      kind: 'error',
      error: new DOMException('A câmera foi desconectada.', 'NotReadableError'),
    })
  }

  private resetTracking() {
    this.filter.reset()
    this.selector.reset()
    this.foldedFrames = 0
    this.stableSingleFrames = 0
    this.lightRegion = null
    if (this.watchdogId !== null) {
      window.clearTimeout(this.watchdogId)
      this.watchdogId = null
    }
  }

  private cancelCallback() {
    if (this.callbackId === null) return
    if (this.usesVideoFrames) {
      this.video.cancelVideoFrameCallback(this.callbackId)
    } else {
      cancelAnimationFrame(this.callbackId)
    }
    this.callbackId = null
  }

  private schedule() {
    if (!this.active || this.lifetime.signal.aborted || this.callbackId !== null) return
    if (this.usesVideoFrames) {
      this.callbackId = this.video.requestVideoFrameCallback((now, metadata) => {
        const fps = this.cadence.observe(metadata.mediaTime, metadata.presentedFrames)
        if (fps !== null) {
          this.videoFps = fps
          this.callbacks.cadence?.(fps)
        }
        this.onFrame(metadata.mediaTime, captureTimestamp(now, metadata.captureTime), now)
      })
    } else {
      this.callbackId = requestAnimationFrame(now => this.onFrame(this.video.currentTime, now, now))
    }
  }

  private onFrame(videoTime: number, capturedAt: number, availableAt: number) {
    this.callbackId = null
    if (!this.active || this.lifetime.signal.aborted) return
    this.schedule()
    this.latestFrame = { videoTime, capturedAt, availableAt }
    this.submitFrame()
  }

  private submitFrame(maxAge = Infinity) {
    const frame = this.latestFrame
    const inference = this.inference
    if (!this.active || !frame || !inference || this.inFlight || frame.videoTime === this.lastVideoTime) return
    const time = performance.now()
    if (time - frame.availableAt > maxAge) return
    if (!this.usesVideoFrames && time - this.lastCaptureAt < TRACKING.captureIntervalMs) return
    if (this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return

    // Um único quadro em trânsito impede que a latência vire uma fila.
    this.inFlight = true
    this.lastVideoTime = frame.videoTime
    this.lastCaptureAt = time
    void this.process(inference, time, frame.capturedAt, this.generation)
  }

  private async process(inference: Inference, startedAt: number, capturedAt: number, generation: number) {
    try {
      const mode = this.stableSingleFrames >= TRACKING.stableSingleFrames ? 'track' : 'search'
      const result = await inference.detect(this.video, startedAt, this.lightRegion, mode)
      if (!this.active || this.lifetime.signal.aborted || generation !== this.generation) return
      const receivedAt = performance.now()
      this.roundTripMs = Math.max(receivedAt - startedAt, this.roundTripMs * 0.85)
      this.handleResult(result, capturedAt, receivedAt, inference.name)
    } catch (error) {
      if (!this.lifetime.signal.aborted) await this.recover(error)
    } finally {
      this.inFlight = false
      // Aproveita um quadro recém-chegado durante a análise, sem enfileirar imagens.
      if (this.usesVideoFrames) this.submitFrame(TRACKING.freshFrameMs)
    }
  }

  private handleResult(detection: Detection, capturedAt: number, receivedAt: number, backend: string) {
    if (!this.size || this.size.width !== detection.size.width || this.size.height !== detection.size.height) {
      this.size = detection.size
      this.geometry = createFrameGeometry(detection.size)
      this.filter.reset()
      this.selector.reset()
      this.foldedFrames = 0
    }
    const geometry = this.geometry
    if (!geometry) return

    const selection = this.selector.select(detection.hands, receivedAt, detection.mode)
    const hand = selection.hand
    let event: CameraEvent

    if (!hand) {
      this.stableSingleFrames = 0
      this.foldedFrames = 0
      event = this.asCameraEvent(this.filter.missing(receivedAt), geometry)
      if (event.kind === 'looking') this.lightRegion = null
    } else {
      if (detection.mode === 'search') {
        this.stableSingleFrames = detection.hands.length === 1 && hand.indexExtended
          ? Math.min(selection.changed ? 1 : this.stableSingleFrames + 1, TRACKING.stableSingleFrames)
          : 0
      }
      this.lightRegion = { center: hand.palm, span: hand.palmSpan }
      if (selection.changed) {
        this.filter.reset()
        this.foldedFrames = 0
      }
      if (hand.indexExtended) {
        this.foldedFrames = 0
        event = this.asCameraEvent(this.filter.update(hand, capturedAt, receivedAt), geometry)
      } else {
        this.foldedFrames = Math.min(this.foldedFrames + 1, TRACKING.foldedFrames)
        const held = this.foldedFrames < TRACKING.foldedFrames ? this.filter.waitForPose() : null
        if (held?.kind === 'holding') event = { ...held, geometry }
        else {
          this.filter.reset()
          event = { kind: 'extend' }
        }
      }
    }

    this.callbacks.trace?.({
      time: receivedAt,
      raw: hand ? previewPoint(hand.tip, geometry) : null,
      filtered: event.kind === 'tracking' || event.kind === 'holding' ? previewPoint(event.frame.filtered, geometry) : null,
      hands: detection.hands.length,
      inferenceMs: detection.inferenceMs,
      roundTripMs: receivedAt - capturedAt,
      state: event.kind,
      backend,
      palm: hand ? previewPoint(hand.palm, geometry) : null,
      indexExtended: hand?.indexExtended ?? null,
      videoFps: this.videoFps,
      inputSide: Math.min(TRACKING.inputWidth, Math.max(detection.size.width, detection.size.height)),
      mode: detection.mode,
    })
    this.callbacks.update(event)
    this.armWatchdog(geometry)
  }

  private asCameraEvent(result: FilterResult, geometry: FrameGeometry): CameraEvent {
    return result.kind === 'lost' ? { kind: 'looking' } : { ...result, geometry }
  }

  private armWatchdog(geometry: FrameGeometry) {
    if (!this.active || this.lifetime.signal.aborted) return
    if (this.watchdogId !== null) window.clearTimeout(this.watchdogId)
    this.watchdogId = window.setTimeout(() => {
      this.watchdogId = null
      if (!this.active) return
      this.stableSingleFrames = 0
      this.callbacks.update(this.asCameraEvent(this.filter.missing(performance.now()), geometry))
    }, resultWatchdogMs(this.roundTripMs))
  }

  private async recover(error: unknown) {
    this.inference?.close()
    this.inference = null
    this.resetTracking()
    if (this.triedRecovery || !this.stream.active) {
      this.callbacks.update({ kind: 'error', error })
      return
    }

    this.triedRecovery = true
    this.callbacks.update({ kind: 'recovering' })
    try {
      const inference = await openInference(this.assets, this.video, this.lifetime.signal, false)
      if (this.lifetime.signal.aborted) {
        inference.close()
        return
      }
      this.inference = inference
      this.roundTripMs = 0
      this.callbacks.update({ kind: 'looking' })
      this.schedule()
    } catch (reason) {
      if (!this.lifetime.signal.aborted) this.callbacks.update({ kind: 'error', error: reason })
    }
  }
}

function stopStream(video: HTMLVideoElement, stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop()
  if (video.srcObject === stream) video.srcObject = null
}

async function enableAutomaticExposure(track: MediaStreamTrack, constraints: MediaTrackConstraints) {
  try {
    const capabilities = track.getCapabilities() as MediaTrackCapabilities & { exposureMode?: string[] }
    if (!capabilities.exposureMode?.includes('continuous')) return
    const settings = track.getSettings() as MediaTrackSettings & { exposureMode?: string }
    if (settings.exposureMode === 'continuous') return
    const autoExposure: MediaTrackConstraintSet & { exposureMode: string } = { exposureMode: 'continuous' }
    await track.applyConstraints({ ...constraints, advanced: [autoExposure] })
  } catch {
    // Câmeras sem esse ajuste usam a compensação digital perto da palma.
  }
}

export async function connectHandCamera(
  video: HTMLVideoElement,
  signal: AbortSignal,
  callbacks: CameraCallbacks,
) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Abra o jogo pelo endereço local indicado no terminal para usar a câmera.')
  }

  const constraints = {
    facingMode: 'user',
    width: { ideal: TRACKING.inputWidth },
    height: { ideal: TRACKING.inputHeight },
    frameRate: { ideal: 30, max: 30 },
    resizeMode: { ideal: 'none' },
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: constraints })
  const stopOnAbort = () => stopStream(video, stream)
  signal.addEventListener('abort', stopOnAbort, { once: true })

  let inference: Inference | undefined
  try {
    signal.throwIfAborted()
    const track = stream.getVideoTracks()[0]
    if (track) await enableAutomaticExposure(track, constraints)
    signal.throwIfAborted()
    video.srcObject = stream
    await video.play()
    const assets = new URL('vision/', document.baseURI).href
    inference = await openInference(assets, video, signal, true)
    signal.throwIfAborted()
    return new HandCamera(video, stream, assets, inference, callbacks)
  } catch (error) {
    stopStream(video, stream)
    inference?.close()
    throw error
  } finally {
    signal.removeEventListener('abort', stopOnAbort)
  }
}

export function cameraErrorMessage(error: unknown) {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    return 'Abra o jogo pelo endereço local indicado no terminal ou jogue com mouse.'
  }

  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return 'A câmera está bloqueada. Libere a permissão no navegador ou use o mouse.'
      case 'NotFoundError':
        return 'Nenhuma câmera foi encontrada. Conecte uma webcam ou use o mouse.'
      case 'NotReadableError':
        return 'A câmera está ocupada ou desconectada. Confira a webcam ou use o mouse.'
    }
  }

  return 'O controle pela mão não iniciou. Volte para tentar de novo ou use o mouse.'
}
