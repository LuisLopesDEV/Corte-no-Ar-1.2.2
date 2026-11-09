/// <reference lib="webworker" />

import { createHandVision } from './hand-vision.js'
import type { VisionRequest, VisionResponse } from './vision-protocol.js'

const scope = self as unknown as DedicatedWorkerGlobalScope
let vision: Awaited<ReturnType<typeof createHandVision>> | null = null

function send(message: VisionResponse) {
  scope.postMessage(message)
}

scope.onmessage = async ({ data }: MessageEvent<VisionRequest>) => {
  try {
    if (data.type === 'init') {
      vision = await createHandVision(data.assets, true, data.delegate, data.mode)
      send({ type: 'ready' })
    } else {
      if (!vision) throw new Error('Rastreador ainda não inicializado.')
      send({ type: 'frame', detection: vision.detect(data.image, data.time, data.region) })
    }
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  } finally {
    if (data.type === 'frame') data.image.close()
  }
}
