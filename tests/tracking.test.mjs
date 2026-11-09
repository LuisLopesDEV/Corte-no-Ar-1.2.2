import assert from 'node:assert/strict'
import test from 'node:test'
import { ARENA, ROUND, formatTime } from '../.test-build/config.js'
import { BladeInput } from '../.test-build/blade.js'
import { VideoCadence, captureTimestamp, resultWatchdogMs } from '../.test-build/camera-time.js'
import { SliceGame } from '../.test-build/game.js'
import { HandCamera } from '../.test-build/hand-camera.js'
import { HandFilter, predictHand } from '../.test-build/hand-filter.js'
import { arenaPoint, createFrameGeometry, indexIsExtended } from '../.test-build/hand-geometry.js'
import { HandSelector } from '../.test-build/hand-selector.js'

function hand(x, y = 0.28125, overrides = {}) {
  return {
    tip: { x, y },
    palm: { x, y: y + 0.10 },
    palmSpan: 0.11,
    indexExtended: true,
    side: 'Right',
    sideScore: 0.98,
    ...overrides,
  }
}

function cameraProbe(t, deferred = false) {
  let now = 1000
  let index = 0
  let hands = []
  let duration = 0
  t.mock.method(performance, 'now', () => now)
  const nextFrames = []
  const events = []
  const pending = []
  const submitted = []
  const previousWindow = globalThis.window
  const previousMedia = globalThis.HTMLMediaElement
  globalThis.window = { setTimeout, clearTimeout }
  globalThis.HTMLMediaElement = { HAVE_CURRENT_DATA: 2 }
  const video = {
    readyState: 2,
    requestVideoFrameCallback(callback) {
      nextFrames.push(callback)
      return nextFrames.length
    },
    cancelVideoFrameCallback() {},
  }
  const stream = { active: true, getVideoTracks: () => [], getTracks: () => [] }
  const inference = {
    name: 'simulado',
    async detect(_video, time, _region, mode) {
      submitted.push({ time, mode })
      const result = { hands, size: ARENA, inferenceMs: duration, mode }
      if (deferred) await new Promise(resolve => pending.push(resolve))
      else now += duration
      return result
    },
    close() {},
  }
  const camera = new HandCamera(video, stream, '', inference, { update: event => events.push(event) })
  t.after(() => {
    camera.close()
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
    if (previousMedia === undefined) delete globalThis.HTMLMediaElement
    else globalThis.HTMLMediaElement = previousMedia
  })
  camera.setActive(true)
  const frame = async (time, observations, latency = 8) => {
    now = time
    hands = observations
    duration = latency
    const callback = nextFrames.shift()
    assert.ok(callback)
    callback(now, { mediaTime: time / 1000, captureTime: time - 10, presentedFrames: ++index })
    await new Promise(resolve => setImmediate(resolve))
    return events.at(-1)
  }
  frame.submitted = submitted
  frame.finish = async time => {
    now = time
    const resolve = pending.shift()
    assert.ok(resolve)
    resolve()
    await new Promise(done => setImmediate(done))
  }
  return frame
}

test('uma talhada larga em 67 ms atravessa e corta uma fruta', () => {
  const filter = new HandFilter()
  const input = new BladeInput(0.065, 420)
  const geometry = createFrameGeometry(ARENA)
  const start = filter.update(hand(0.17), 1000, 1040)
  const end = filter.update(hand(0.83), 1067, 1110)
  assert.equal(start.kind, 'tracking')
  assert.equal(end.kind, 'tracking')

  function sample(frame) {
    return {
      point: arenaPoint(frame.filtered, geometry),
      capturedAt: frame.capturedAt,
      shownAt: frame.receivedAt,
      startsStroke: frame.startsStroke,
    }
  }

  assert.equal(input.move(sample(start.frame)), null)
  const stroke = input.move(sample(end.frame))
  assert.ok(stroke)
  assert.ok(Math.abs(stroke.to.x - stroke.from.x) > ARENA.width * 0.48)

  const game = new SliceGame()
  game.advance(0.23, 0)
  const fruit = game.targets.find(target => target.kind === 'fruit')
  assert.ok(fruit)
  fruit.x = ARENA.width / 2
  fruit.y = ARENA.height / 2
  assert.equal(game.cut(stroke)?.fruitPoints, ROUND.fruitPoints)
})

test('a talhada atrasada acerta o alvo no meio do seu trajeto e pontua uma vez', () => {
  const game = new SliceGame()
  game.advance(0.23, 0)
  for (const fruit of game.targets) fruit.x = 1100
  const target = game.targets[0]
  target.x = 640
  target.y = 300
  target.radius = 34
  game.rememberTargets(1000)
  target.y = 382
  game.rememberTargets(1100)
  target.y = 500
  game.rememberTargets(1280)
  const stroke = { from: { x: 520, y: 341 }, to: { x: 760, y: 341 }, fromAt: 1000, toAt: 1100 }
  assert.equal(game.cut(stroke), null)
  assert.equal(game.cutCaptured(stroke)?.fruitPoints, ROUND.fruitPoints)
  assert.equal(game.cutCaptured(stroke), null)
  assert.equal(game.score, ROUND.fruitPoints)
})

test('o corte da câmera respeita a hora em que o alvo entrou e o limite do histórico', () => {
  const game = new SliceGame()
  game.rememberTargets(1000)
  game.advance(0.23, 0)
  for (const fruit of game.targets) fruit.x = 1100
  const target = game.targets[0]
  target.x = 640
  target.y = 375
  game.rememberTargets(1150)
  const stroke = { from: { x: 520, y: 375 }, to: { x: 760, y: 375 }, fromAt: 1000, toAt: 1100 }
  assert.equal(game.cutCaptured(stroke), null)
  game.rememberTargets(2000)
  assert.equal(game.cutCaptured({ ...stroke, fromAt: 1170, toAt: 1210 }), null)
  game.clearTargetHistory()
  assert.equal(game.cutCaptured({ ...stroke, fromAt: 2000, toAt: 2100 }), null)
  assert.equal(game.cut(stroke)?.fruitPoints, ROUND.fruitPoints)
})

test('um salto vertical isolado segura a lâmina e a recuperação reinicia o traço', () => {
  const filter = new HandFilter()
  const start = filter.update(hand(0.4), 100, 140)
  const spike = hand(0.4, 0.46, { palm: hand(0.4).palm })
  const held = filter.update(spike, 133, 173)
  assert.equal(held.kind, 'holding')
  assert.deepEqual(held.frame.filtered, start.frame.filtered)

  const next = filter.update(hand(0.41), 166, 206)
  assert.equal(next.kind, 'tracking')
  assert.equal(next.frame.startsStroke, true)
  assert.equal(filter.missing(350).kind, 'holding')
  assert.equal(filter.missing(500).kind, 'lost')
})

test('o rastro começa ao ser exibido e a previsão não cria um corte', () => {
  const filter = new HandFilter()
  const input = new BladeInput(0.065, 420)
  const geometry = createFrameGeometry(ARENA)
  filter.update(hand(0.4), 100, 300)
  const next = filter.update(hand(0.46), 166, 366)
  assert.equal(next.kind, 'tracking')
  const observed = arenaPoint(next.frame.filtered, geometry)
  assert.equal(input.move({
    point: observed,
    capturedAt: 166,
    shownAt: 366,
  }), null)
  const projected = arenaPoint(predictHand(next.frame, 380), geometry)
  const drawing = input.drawing(380, projected)
  assert.notDeepEqual(projected, observed)
  assert.deepEqual(drawing.point, projected)
  assert.equal(drawing.trail[0].shownAt, 366)
  assert.equal(input.drawing(510).trail.length, 1)
  assert.equal(input.drawing(512).trail.length, 0)
})

test('a ponta percorre a reta confirmada sem alterar o segmento usado para pontuar', () => {
  const input = new BladeInput(0.065, 420, 24)
  const from = { x: 200, y: 220 }
  const to = { x: 440, y: 340 }
  assert.equal(input.move({ point: from, capturedAt: 1000, shownAt: 1055 }), null)
  const stroke = input.move({ point: to, capturedAt: 1070, shownAt: 1125 })
  assert.deepEqual(stroke, { from, to, fromAt: 1000, toAt: 1070 })
  assert.deepEqual(input.drawing(1125).point, from)
  assert.deepEqual(input.drawing(1137).point, { x: 380, y: 310 })
  assert.deepEqual(input.drawing(1149).point, to)
  const restart = { x: 100, y: 420 }
  assert.equal(input.move({ point: restart, capturedAt: 1140, shownAt: 1195, startsStroke: true }), null)
  assert.deepEqual(input.drawing(1196).point, restart)
})

test('a escolha mantém o jogador e só troca a mão depois do intervalo de perda', () => {
  const selector = new HandSelector()
  const player = hand(0.45, 0.3, { palmSpan: 0.16 })
  const visitor = hand(0.16, 0.2, { palmSpan: 0.062, side: 'Left' })
  assert.equal(selector.select([visitor, player], 100).hand, player)
  const movingPlayer = hand(0.73, 0.3, { palmSpan: 0.16 })
  assert.equal(selector.select([visitor, movingPlayer], 166).hand, movingPlayer)
  assert.equal(selector.select([visitor], 220).hand, null)
  const newPlayer = selector.select([visitor], 600)
  assert.equal(newPlayer.hand, visitor)
  assert.equal(newPlayer.changed, true)
})

test('a geometria da câmera 4:3 conserva a escala horizontal e vertical', () => {
  const geometry = createFrameGeometry({ width: 640, height: 480 })
  const start = arenaPoint({ x: 0.4, y: 0.35 }, geometry)
  const end = arenaPoint({ x: 0.45, y: 0.4 }, geometry)
  assert.ok(Math.abs(Math.abs(end.x - start.x) - Math.abs(end.y - start.y)) < 0.00001)
})

test('o indicador estendido habilita o gesto e o punho fechado o bloqueia', () => {
  const points = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }))
  points[5] = { x: 0, y: -0.10, z: 0 }
  points[6] = { x: 0, y: -0.15, z: 0 }
  points[7] = { x: 0, y: -0.18, z: 0 }
  points[8] = { x: 0, y: -0.21, z: 0 }
  points[9] = { x: 0.03, y: -0.10, z: 0 }
  assert.equal(indexIsExtended(points), true)
  points[7] = { x: 0, y: -0.14, z: -0.03 }
  points[8] = { x: 0, y: -0.11, z: -0.03 }
  assert.equal(indexIsExtended(points), false)
})

test('um resultado válido com mais de 150 ms de análise é entregue ao jogo', async t => {
  const frame = cameraProbe(t)
  const event = await frame(1000, [hand(0.5)], 190)
  assert.equal(event.kind, 'tracking')
  assert.equal(event.frame.capturedAt, 990)
  assert.equal(event.frame.receivedAt, 1190)
  assert.ok(resultWatchdogMs(190) > 380)
})

test('dois quadros de pose ambígua preservam o traço e o terceiro fecha a lâmina', async t => {
  const frame = cameraProbe(t)
  const ambiguous = hand(0.42, 0.28125, { indexExtended: false })
  const start = await frame(1000, [hand(0.31)])
  assert.equal(start.kind, 'tracking')
  for (const time of [1034, 1068]) {
    const held = await frame(time, [ambiguous])
    assert.equal(held.kind, 'holding')
    assert.equal(held.keepsStroke, true)
    assert.deepEqual(held.frame.filtered, start.frame.filtered)
  }
  const end = await frame(1102, [hand(0.56)])
  assert.equal(end.kind, 'tracking')
  assert.equal(end.frame.startsStroke, false)
  assert.equal((await frame(1136, [ambiguous])).kind, 'holding')
  assert.equal((await frame(1170, [ambiguous])).kind, 'holding')
  assert.equal((await frame(1204, [ambiguous])).kind, 'extend')
  const reopened = await frame(1238, [hand(0.59)])
  assert.equal(reopened.kind, 'tracking')
  assert.equal(reopened.frame.startsStroke, true)
})

test('o rastreador rápido segue a mão estável e devolve a escolha à busca em caso de perda', async t => {
  const frame = cameraProbe(t)
  const player = hand(0.47, 0.28, { palmSpan: 0.16 })
  const spectator = hand(0.16, 0.2, { palmSpan: 0.062, side: 'Left' })
  for (const time of [1000, 1033, 1066, 1099]) {
    assert.equal((await frame(time, [player])).kind, 'tracking')
  }
  const held = await frame(1132, [spectator])
  assert.equal(held.kind, 'holding')
  assert.equal(held.keepsStroke, false)
  const recovered = await frame(1165, [spectator, player])
  assert.equal(recovered.kind, 'tracking')
  assert.deepEqual(recovered.frame.raw, player.tip)
  assert.equal(recovered.frame.startsStroke, true)
  await frame(1198, [spectator, player])
  assert.deepEqual(frame.submitted.map(item => item.mode), ['search', 'search', 'search', 'track', 'track', 'search', 'search'])
})

test('só reaproveita quadros novos quando ainda estão frescos e a análise anterior terminou', async t => {
  const frame = cameraProbe(t, true)
  const player = hand(0.5)
  await frame(1000, [player])
  await frame(1033, [player])
  assert.deepEqual(frame.submitted.map(item => item.time), [1000])
  await frame.finish(1039)
  assert.deepEqual(frame.submitted.map(item => item.time), [1000, 1039])
  await frame(1066, [player])
  await frame.finish(1084)
  assert.deepEqual(frame.submitted.map(item => item.time), [1000, 1039])
  const newest = await frame(1099, [player])
  assert.equal(newest.frame.capturedAt, 1023)
  assert.deepEqual(frame.submitted.map(item => item.time), [1000, 1039, 1099])
  await frame.finish(1102)
})

test('cadência mede quadros apresentados mesmo se o jogo pular callbacks', () => {
  const cadence = new VideoCadence()
  assert.equal(cadence.observe(1, 4), null)
  assert.equal(cadence.observe(1.5, 12), null)
  assert.equal(cadence.observe(2, 19), 15)
  assert.equal(cadence.observe(3, 49), 30)
  cadence.reset()
  assert.equal(cadence.observe(3.1, 52), null)
})

test('tempo de captura ausente ou inválido e rodadas com mais de um minuto', () => {
  assert.equal(captureTimestamp(1000, 980), 980)
  assert.equal(captureTimestamp(1000), 1000)
  assert.equal(captureTimestamp(1000, Infinity), 1000)
  assert.equal(captureTimestamp(1000, 1001), 1000)
  assert.equal(formatTime(75_000), '01:15')
  assert.equal(formatTime(1), '00:01')
  assert.equal(formatTime(0), '00:00')
})
