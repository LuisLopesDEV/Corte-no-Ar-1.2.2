import { TRACKING } from './config.js'
import type { TraceSample } from './hand-camera.js'
import type { Point } from './types.js'

const MAX_SAMPLES = 1000
const RECORD_MS = 30_000
const TRACE_VERSION = 1

function isPoint(value: unknown): value is Point | null {
  if (value === null) return true
  if (typeof value !== 'object' || !value || !('x' in value) || !('y' in value)) return false
  return typeof value.x === 'number' && value.x >= 0 && value.x <= 1 &&
    typeof value.y === 'number' && value.y >= 0 && value.y <= 1
}

function isTraceSample(value: unknown): value is TraceSample {
  if (typeof value !== 'object' || !value) return false
  const sample = value as Partial<TraceSample>
  return typeof sample.time === 'number' && Number.isFinite(sample.time) && sample.time >= 0 &&
    isPoint(sample.raw) && isPoint(sample.filtered) &&
    typeof sample.hands === 'number' && Number.isFinite(sample.hands) &&
    typeof sample.inferenceMs === 'number' && Number.isFinite(sample.inferenceMs) &&
    typeof sample.roundTripMs === 'number' && Number.isFinite(sample.roundTripMs) &&
    typeof sample.state === 'string' && sample.state.length <= 40 &&
    typeof sample.backend === 'string' && sample.backend.length <= 40 &&
    (sample.palm === undefined || isPoint(sample.palm)) &&
    (sample.indexExtended == null || typeof sample.indexExtended === 'boolean') &&
    (sample.videoFps == null || (typeof sample.videoFps === 'number' && Number.isFinite(sample.videoFps))) &&
    (sample.inputSide === undefined || (typeof sample.inputSide === 'number' && Number.isFinite(sample.inputSide))) &&
    (sample.mode === undefined || sample.mode === 'search' || sample.mode === 'track')
}

export function addTrackingDiagnostics() {
  const panel = document.createElement('details')
  panel.className = 'tracking-debug'
  panel.open = true
  panel.innerHTML = [
    '<summary>Diagnóstico da câmera</summary>',
    '<p>Grava coordenadas por até 30 segundos. Indicador bruto em azul, filtrado em amarelo e palma em verde.</p>',
    '<div class="actions">',
    '<button class="button primary" type="button" data-record>Gravar trilha</button>',
    '<button class="button secondary" type="button" data-play disabled>Reproduzir</button>',
    '<button class="button secondary" type="button" data-export disabled>Exportar JSON</button>',
    '<label>Importar trilha <input type="file" accept=".json,application/json" data-import></label>',
    '</div>',
    '<p data-report role="status">Abra a câmera para medir o rastreamento.</p>',
    '<canvas width="640" height="360" aria-label="Trajetórias bruta e filtrada da mão"></canvas>',
  ].join('')
  document.querySelector('.shell')?.append(panel)

  const record = panel.querySelector<HTMLButtonElement>('[data-record]')
  const play = panel.querySelector<HTMLButtonElement>('[data-play]')
  const save = panel.querySelector<HTMLButtonElement>('[data-export]')
  const load = panel.querySelector<HTMLInputElement>('[data-import]')
  const report = panel.querySelector<HTMLElement>('[data-report]')
  const canvas = panel.querySelector('canvas')
  const ctx = canvas?.getContext('2d')
  if (!record || !play || !save || !load || !report || !canvas || !ctx) {
    throw new Error('O diagnóstico da câmera não pôde ser aberto.')
  }

  let recording = false
  let started = 0
  let timer: number | null = null
  let replay = 0
  let samples: TraceSample[] = []
  let lastReport = -Infinity
  const recentPositions: number[] = []
  let measurementStart: number | null = null

  function draw(data: readonly TraceSample[]) {
    if (!ctx || !canvas) return
    const { width, height } = canvas
    ctx.fillStyle = '#161a21'
    ctx.fillRect(0, 0, width, height)
    ctx.strokeStyle = '#464d5b'
    ctx.lineWidth = 1
    ctx.strokeRect(1, 1, width - 2, height - 2)

    const tracks = { raw: '#8ba7ff', filtered: '#f7cb5e', palm: '#7fd3a5' } as const
    for (const key of ['raw', 'filtered', 'palm'] as const) {
      ctx.strokeStyle = tracks[key]
      ctx.lineWidth = 2
      ctx.beginPath()
      let penDown = false
      for (const sample of data) {
        const point = sample[key]
        if (!point) {
          penDown = false
          continue
        }
        if (penDown) ctx.lineTo(point.x * width, point.y * height)
        else ctx.moveTo(point.x * width, point.y * height)
        penDown = true
      }
      ctx.stroke()
    }
  }

  function finishRecording() {
    recording = false
    if (timer !== null) window.clearTimeout(timer)
    timer = null
    if (record) record.textContent = 'Gravar trilha'
    if (play) play.disabled = samples.length < 2
    if (save) save.disabled = samples.length === 0
    if (report) report.textContent = samples.length + ' amostras gravadas.'
    draw(samples)
  }

  record.addEventListener('click', () => {
    if (recording) {
      finishRecording()
      return
    }
    cancelAnimationFrame(replay)
    replay = 0
    samples = []
    recording = true
    started = performance.now()
    play.disabled = true
    save.disabled = true
    record.textContent = 'Parar gravação'
    report.textContent = 'Gravando a trilha por até 30 segundos.'
    draw(samples)
    timer = window.setTimeout(finishRecording, RECORD_MS)
  })

  play.addEventListener('click', () => {
    if (recording || samples.length < 2) return
    cancelAnimationFrame(replay)
    const begin = performance.now()
    const end = samples.at(-1)?.time ?? 0
    let index = 0
    const step = (now: number) => {
      const time = now - begin
      while (index < samples.length && (samples[index]?.time ?? Infinity) <= time) index++
      draw(samples.slice(0, index))
      report.textContent = 'Reprodução · ' + Math.min(time, end).toFixed(0) + ' ms'
      replay = index < samples.length ? requestAnimationFrame(step) : 0
    }
    replay = requestAnimationFrame(step)
  })

  save.addEventListener('click', () => {
    if (recording || samples.length === 0) return
    const file = new Blob(
      [JSON.stringify({ version: TRACE_VERSION, settings: TRACKING, samples }, null, 2)],
      { type: 'application/json' },
    )
    const url = URL.createObjectURL(file)
    const link = document.createElement('a')
    link.href = url
    link.download = 'corte-no-ar-trilha.json'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  })

  load.addEventListener('change', async () => {
    const file = load.files?.[0]
    if (!file) return
    try {
      if (file.size > 1_500_000) throw new Error('Trilha muito grande.')
      const data = JSON.parse(await file.text()) as { version?: unknown; samples?: unknown }
      if (data.version !== TRACE_VERSION || !Array.isArray(data.samples) ||
        data.samples.length < 2 || data.samples.length > MAX_SAMPLES ||
        !data.samples.every(isTraceSample)) throw new Error('Formato de trilha inválido.')
      const imported = data.samples.slice().sort((a, b) => a.time - b.time)
      if ((imported.at(-1)?.time ?? 0) > RECORD_MS + 500) throw new Error('Duração da trilha inválida.')
      cancelAnimationFrame(replay)
      replay = 0
      samples = imported
      finishRecording()
    } catch {
      report.textContent = 'Escolha um JSON exportado pelo diagnóstico do Corte no Ar.'
    } finally {
      load.value = ''
    }
  })

  draw([])
  return (sample: TraceSample) => {
    measurementStart ??= sample.time
    if (sample.state === 'tracking') recentPositions.push(sample.time)
    while (recentPositions[0] !== undefined && recentPositions[0] <= sample.time - 1000) recentPositions.shift()
    if (recording) {
      samples.push({ ...sample, time: Math.max(0, sample.time - started) })
      draw(samples.slice(-70))
      if (samples.length >= MAX_SAMPLES) finishRecording()
    }
    if (!replay && sample.time - lastReport >= 500) {
      lastReport = sample.time
      const stats = [sample.backend, sample.hands + ' mão(s)']
      if (sample.videoFps != null) stats.push(sample.videoFps.toFixed(0) + ' fps do vídeo')
      if (sample.time - measurementStart >= 1000) stats.push(recentPositions.length + ' posições/s')
      if (sample.mode) stats.push(sample.mode === 'track' ? 'Rastreio da mão' : 'Busca de mãos')
      if (sample.inputSide) stats.push(sample.inputSide + ' px de entrada')
      stats.push(sample.inferenceMs.toFixed(0) + ' ms de análise', sample.roundTripMs.toFixed(0) + ' ms até chegar')
      if (recording) stats.unshift(samples.length + ' amostras')
      report.textContent = stats.join(' · ')
    }
  }
}
