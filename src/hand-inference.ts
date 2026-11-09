import { TRACKING } from './config.js'
import type { Delegate, Detection, LightRegion, VisionMode, VisionRequest, VisionResponse } from './vision-protocol.js'

const WORKER_LOAD_TIMEOUT_MS = 9000
const WORKER_FRAME_TIMEOUT_MS = 3000
const BENCHMARK_SAMPLES = 7
const TARGET_LATENCY_MS = 25
const SMALL_INPUT_SIDE = 640
const MIN_SPEED_GAIN = 0.10

type WorkerProfile = { delegate: Delegate; inputSide: number }
type CameraProfile = WorkerProfile & { width: number; height: number }
let preferredProfile: CameraProfile | null = null

export type Inference = {
  name: string
  detect(video: HTMLVideoElement, time: number, region: LightRegion | null, mode: VisionMode): Promise<Detection>
  close(): void
}

function requestWorker(
  worker: Worker,
  request: VisionRequest,
  signal: AbortSignal,
  timeout: number,
  transfer: Transferable[] = [],
) {
  signal.throwIfAborted()
  return new Promise<VisionResponse>((resolve, reject) => {
    const timer = window.setTimeout(() => fail(new Error('A análise da câmera demorou demais.')), timeout)

    function cleanup() {
      window.clearTimeout(timer)
      worker.removeEventListener('message', message)
      worker.removeEventListener('error', error)
      worker.removeEventListener('messageerror', messageError)
      signal.removeEventListener('abort', abort)
    }

    function fail(reason: unknown) {
      cleanup()
      reject(reason)
    }

    function message(event: MessageEvent<VisionResponse>) {
      if (event.data.type === 'error') {
        fail(new Error(event.data.message))
      } else {
        cleanup()
        resolve(event.data)
      }
    }

    function error(event: ErrorEvent) {
      event.preventDefault()
      fail(new Error(event.message || 'A análise em segundo plano falhou.'))
    }

    function messageError() {
      fail(new Error('O navegador não conseguiu transferir o quadro da câmera.'))
    }

    function abort() {
      fail(signal.reason)
    }

    worker.addEventListener('message', message)
    worker.addEventListener('error', error)
    worker.addEventListener('messageerror', messageError)
    signal.addEventListener('abort', abort, { once: true })

    try {
      worker.postMessage(request, transfer)
    } catch (reason) {
      fail(reason)
    }
  })
}

class WorkerInference implements Inference {
  private readonly worker = new Worker(new URL('./hand-worker.ts', import.meta.url), { type: 'module' })
  private readonly lifetime = new AbortController()
  readonly name: string
  private readonly delegate: Delegate
  private readonly mode: VisionMode
  private inputSide: number

  constructor(profile: WorkerProfile, mode: VisionMode) {
    this.delegate = profile.delegate
    this.mode = mode
    this.inputSide = profile.inputSide
    this.name = 'Worker ' + this.delegate
  }

  async initialize(assets: string, video: HTMLVideoElement, signal: AbortSignal) {
    const response = await requestWorker(
      this.worker,
      { type: 'init', assets, delegate: this.delegate, mode: this.mode },
      signal,
      WORKER_LOAD_TIMEOUT_MS,
    )
    if (response.type !== 'ready') throw new Error('A câmera não inicializou.')
    await this.detect(video, performance.now(), null)
    signal.throwIfAborted()
  }

  async detect(video: HTMLVideoElement, time: number, region: LightRegion | null) {
    const scale = Math.min(1, this.inputSide / Math.max(video.videoWidth, video.videoHeight))
    const image = scale < 1
      ? await createImageBitmap(video, {
        resizeWidth: Math.round(video.videoWidth * scale),
        resizeHeight: Math.round(video.videoHeight * scale),
        resizeQuality: 'low',
      })
      : await createImageBitmap(video)

    try {
      const response = await requestWorker(
        this.worker,
        { type: 'frame', image, time, region },
        this.lifetime.signal,
        WORKER_FRAME_TIMEOUT_MS,
        [image],
      )
      if (response.type !== 'frame') throw new Error('Resposta inesperada do rastreador.')
      return response.detection
    } finally {
      image.close()
    }
  }

  profile(): WorkerProfile {
    return { delegate: this.delegate, inputSide: this.inputSide }
  }

  async tune(video: HTMLVideoElement, signal: AbortSignal) {
    const normal = await this.measure(video, signal)
    if (normal.medianMs <= TARGET_LATENCY_MS || Math.max(video.videoWidth, video.videoHeight) <= SMALL_INPUT_SIDE) {
      return normal.medianMs
    }

    const normalSide = this.inputSide
    this.inputSide = SMALL_INPUT_SIDE
    try {
      await this.detect(video, performance.now(), null)
      const small = await this.measure(video, signal)
      if (small.medianMs < normal.medianMs * (1 - MIN_SPEED_GAIN) && small.handFrames >= normal.handFrames * 0.75) {
        return small.medianMs
      }
    } catch {
      this.inputSide = normalSide
      signal.throwIfAborted()
      await this.detect(video, performance.now(), null)
    }

    this.inputSide = normalSide
    return normal.medianMs
  }

  private async measure(video: HTMLVideoElement, signal: AbortSignal) {
    const times: number[] = []
    let handFrames = 0
    for (let i = 0; i < BENCHMARK_SAMPLES; i++) {
      signal.throwIfAborted()
      const start = performance.now()
      const result = await this.detect(video, start, null)
      times.push(performance.now() - start)
      if (result.hands.length) handFrames++
    }
    times.sort((a, b) => a - b)
    return { medianMs: times[Math.floor(times.length / 2)] ?? Infinity, handFrames }
  }

  close() {
    if (this.lifetime.signal.aborted) return
    this.lifetime.abort()
    this.worker.terminate()
  }
}

async function prepareWorker(
  assets: string,
  video: HTMLVideoElement,
  signal: AbortSignal,
  profile: WorkerProfile,
  measure: boolean,
  mode: VisionMode = 'search',
) {
  let worker: WorkerInference | null = null
  const closeOnAbort = () => worker?.close()
  signal.addEventListener('abort', closeOnAbort, { once: true })
  try {
    signal.throwIfAborted()
    worker = new WorkerInference(profile, mode)
    await worker.initialize(assets, video, signal)
    const medianMs = measure ? await worker.tune(video, signal) : Infinity
    signal.throwIfAborted()
    return { worker, medianMs }
  } catch {
    worker?.close()
    signal.throwIfAborted()
    return null
  } finally {
    signal.removeEventListener('abort', closeOnAbort)
  }
}

async function withPlayerTracker(search: WorkerInference, assets: string, video: HTMLVideoElement, signal: AbortSignal): Promise<Inference> {
  try {
    const track = await prepareWorker(assets, video, signal, search.profile(), false, 'track')
    if (!track) return search
    return {
      name: search.name,
      detect(source, time, region, mode) {
        return (mode === 'track' ? track.worker : search).detect(source, time, region)
      },
      close() {
        track.worker.close()
        search.close()
      },
    }
  } catch (error) {
    search.close()
    throw error
  }
}

function hasHardwareWebGL() {
  try {
    const gl = new OffscreenCanvas(1, 1).getContext('webgl2')
    if (!gl) return false
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : ''
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return Boolean(renderer) && !/swiftshader|software|llvmpipe|softpipe|basic render/i.test(renderer)
  } catch {
    return false
  }
}

export async function openInference(
  assets: string,
  video: HTMLVideoElement,
  signal: AbortSignal,
  tryGpu: boolean,
): Promise<Inference> {
  if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function') {
    const width = video.videoWidth
    const height = video.videoHeight
    const cached = preferredProfile?.width === width && preferredProfile.height === height ? preferredProfile : null
    if (cached && (tryGpu || cached.delegate === 'CPU')) {
      const preferred = await prepareWorker(assets, video, signal, cached, false)
      if (preferred) return withPlayerTracker(preferred.worker, assets, video, signal)
      preferredProfile = null
    }

    const cpu = await prepareWorker(assets, video, signal, { delegate: 'CPU', inputSide: TRACKING.inputWidth }, tryGpu)
    let gpu: Awaited<ReturnType<typeof prepareWorker>> = null
    try {
      if (tryGpu && hasHardwareWebGL()) {
        gpu = await prepareWorker(assets, video, signal, { delegate: 'GPU', inputSide: TRACKING.inputWidth }, true)
      }
      signal.throwIfAborted()
    } catch (error) {
      cpu?.worker.close()
      gpu?.worker.close()
      throw error
    }
    const selected = gpu && (!cpu || gpu.medianMs < cpu.medianMs * (1 - MIN_SPEED_GAIN)) ? gpu : cpu
    if (cpu !== selected) cpu?.worker.close()
    if (gpu !== selected) gpu?.worker.close()
    if (selected) {
      preferredProfile = { ...selected.worker.profile(), width, height }
      return withPlayerTracker(selected.worker, assets, video, signal)
    }
  }

  const { createHandVision } = await import('./hand-vision.js')
  const vision = await createHandVision(assets, false, 'CPU')
  if (signal.aborted) {
    vision.close()
    signal.throwIfAborted()
  }

  return {
    name: 'CPU na página',
    async detect(source, time, region) {
      return vision.detect(source, time, region)
    },
    close() {
      vision.close()
    },
  }
}

