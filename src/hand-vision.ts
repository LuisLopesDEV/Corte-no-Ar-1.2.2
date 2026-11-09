import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import { TRACKING } from './config.js'
import { indexIsExtended } from './hand-geometry.js'
import type { Size } from './types.js'
import type { Delegate, Detection, HandObservation, LightRegion, VisionMode } from './vision-protocol.js'

type CameraImage = HTMLVideoElement | ImageBitmap
type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
const METER_WIDTH = 32
const METER_HEIGHT = 24

function makeCanvas(width: number, height: number) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function imageSize(image: CameraImage): Size {
  return 'videoWidth' in image
    ? { width: image.videoWidth, height: image.videoHeight }
    : { width: image.width, height: image.height }
}

class HandVision {
  private readonly detector: HandLandmarker
  private readonly mode: VisionMode
  private readonly input = makeCanvas(1, 1)
  private readonly inputContext = this.input.getContext('2d', { alpha: false }) as Canvas2D | null
  private readonly meter = makeCanvas(METER_WIDTH, METER_HEIGHT)
  private readonly meterContext = this.meter.getContext('2d', { alpha: false, willReadFrequently: true }) as Canvas2D | null
  private lastMeterAt = -Infinity
  private gain = 1

  constructor(detector: HandLandmarker, mode: VisionMode) {
    this.detector = detector
    this.mode = mode
  }

  detect(image: CameraImage, time: number, region: LightRegion | null): Detection {
    const started = performance.now()
    const size = imageSize(image)
    const longest = Math.max(size.width, size.height)
    const scaleX = size.width / longest
    const scaleY = size.height / longest
    const result = this.detector.detectForVideo(this.prepare(image, size, time, region), time)
    const hands: HandObservation[] = []

    for (const [index, landmarks] of result.landmarks.entries()) {
      const tip = landmarks[8]
      const wrist = landmarks[0]
      const middle = landmarks[9]
      const first = landmarks[5]
      const last = landmarks[17]
      if (!tip || !wrist || !middle || !first || !last) continue

      const palm = {
        x: (wrist.x + middle.x + first.x + last.x) * scaleX / 4,
        y: (wrist.y + middle.y + first.y + last.y) * scaleY / 4,
      }
      const palmSpan = Math.hypot((middle.x - wrist.x) * scaleX, (middle.y - wrist.y) * scaleY)
      if (![tip.x, tip.y, palm.x, palm.y, palmSpan].every(Number.isFinite) || palmSpan < 0.012) continue
      if (tip.x < -0.1 || tip.x > 1.1 || tip.y < -0.1 || tip.y > 1.1) continue

      const world = result.worldLandmarks[index]
      const spatial = world?.length === landmarks.length
        ? world
        : landmarks.map(point => ({ x: point.x * scaleX, y: point.y * scaleY, z: point.z * scaleX }))
      const side = result.handedness[index]?.[0]
      const label = side?.categoryName
      hands.push({
        tip: { x: tip.x * scaleX, y: tip.y * scaleY },
        palm,
        palmSpan,
        indexExtended: indexIsExtended(spatial),
        side: label === 'Left' || label === 'Right' ? label : null,
        sideScore: side?.score ?? 0,
      })
    }
    return { hands, size, inferenceMs: performance.now() - started, mode: this.mode }
  }

  close() {
    this.detector.close()
  }

  private measureLight(image: CameraImage, size: Size, region: LightRegion | null) {
    const meter = this.meterContext
    if (!meter) return 108
    const { width, height } = size
    const longest = Math.max(width, height)
    const radius = region ? Math.max(28, region.span * longest * 1.65) : 0
    const x = region ? region.center.x * longest : width / 2
    const y = region ? region.center.y * longest : height / 2
    const left = region ? Math.min(width - 1, Math.max(0, x - radius)) : width * 0.20
    const top = region ? Math.min(height - 1, Math.max(0, y - radius)) : height * 0.18
    const right = region ? Math.max(left + 1, Math.min(width, x + radius)) : width * 0.80
    const bottom = region ? Math.max(top + 1, Math.min(height, y + radius)) : height * 0.82

    meter.drawImage(image, left, top, right - left, bottom - top, 0, 0, METER_WIDTH, METER_HEIGHT)
    const pixels = meter.getImageData(0, 0, METER_WIDTH, METER_HEIGHT).data
    const histogram = new Uint16Array(256)
    for (let i = 0; i < pixels.length; i += 4) {
      const light = Math.round(0.21 * (pixels[i] ?? 0) + 0.72 * (pixels[i + 1] ?? 0) + 0.07 * (pixels[i + 2] ?? 0))
      histogram[light] = (histogram[light] ?? 0) + 1
    }

    let count = 0
    for (const [level, occurrences] of histogram.entries()) {
      count += occurrences
      if (count >= METER_WIDTH * METER_HEIGHT * 0.50) return level
    }
    return 108
  }

  private prepare(image: CameraImage, size: Size, time: number, region: LightRegion | null) {
    const ctx = this.inputContext
    const { width, height } = size
    if (!ctx || !width || !height) return image

    if (time - this.lastMeterAt >= 180) {
      const light = this.measureLight(image, size, region)
      let targetGain = 1
      if (light < 96) targetGain = Math.min(2.65, 106 / Math.max(30, light))
      else if (light > 165) targetGain = Math.max(0.80, 150 / light)
      this.gain = Number.isFinite(this.lastMeterAt) ? 0.5 * this.gain + 0.5 * targetGain : targetGain
      this.lastMeterAt = time
    }

    const scale = Math.min(1, TRACKING.inputWidth / Math.max(width, height))
    const correctLight = this.gain < 0.91 || this.gain > 1.09
    if (scale === 1 && !correctLight) return image

    const inputWidth = Math.round(width * scale)
    const inputHeight = Math.round(height * scale)
    if (this.input.width !== inputWidth) this.input.width = inputWidth
    if (this.input.height !== inputHeight) this.input.height = inputHeight
    ctx.filter = correctLight ? 'brightness(' + this.gain.toFixed(2) + ')' : 'none'
    ctx.drawImage(image, 0, 0, inputWidth, inputHeight)
    return this.input
  }
}

export async function createHandVision(assets: string, inWorker: boolean, delegate: Delegate, mode: VisionMode = 'search') {
  const files = await FilesetResolver.forVisionTasks(assets.replace(/\/$/, ''), inWorker)
  const detector = await HandLandmarker.createFromOptions(files, {
    baseOptions: {
      modelAssetPath: new URL('hand_landmarker.task', assets).href,
      delegate,
    },
    canvas: inWorker ? new OffscreenCanvas(1, 1) : undefined,
    runningMode: 'VIDEO',
    numHands: mode === 'track' ? 1 : 2,
    minHandDetectionConfidence: TRACKING.detectionConfidence,
    minHandPresenceConfidence: TRACKING.presenceConfidence,
    minTrackingConfidence: TRACKING.trackingConfidence,
  })
  return new HandVision(detector, mode)
}
