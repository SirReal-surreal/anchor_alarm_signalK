'use strict'
const test = require('node:test')
const assert = require('node:assert')
const geo = require('../core/geo')
const { AnchorMonitor } = require('../core/monitor')

const BASE = { latitude: 53.96, longitude: 10.9 }
const S = 1000

// Boat heading north, antenna offset 0 so positions equal anchor-point positions
function setup(cfg = {}) {
  const notes = []
  const saved = []
  const m = new AnchorMonitor(
    { offsetLength: 0, offsetWidth: 0, ...cfg },
    { notify: n => notes.push(n), persist: s => saved.push(s) }
  )
  return { m, notes, saved }
}

function dropped(cfg) {
  const ctx = setup(cfg)
  ctx.m.onHeading(0, 0)
  ctx.m.onPosition(BASE, 0)
  assert.deepStrictEqual(ctx.m.drop(0), { ok: true, changed: true })
  ctx.notes.length = 0
  return ctx
}

// feed one position at second t, d metres north of the anchor
const at = (m, t, d) => m.onPosition(geo.move(BASE, d, 0), t * S)
const last = notes => notes[notes.length - 1]

test('drop is refused without position / heading / with stale data', () => {
  const { m } = setup()
  assert.strictEqual(m.drop(0).error, 'No position information')
  m.onPosition(BASE, 0)
  assert.strictEqual(m.drop(0).error, 'No heading information')
  m.onHeading(0, 0)
  assert.strictEqual(m.drop(11 * S).error, 'No position information')
  m.onPosition(BASE, 11 * S)
  assert.strictEqual(m.drop(12 * S).error, 'No heading information')
  m.onHeading(0, 12 * S)
  assert.ok(m.drop(12 * S).ok)
})

test('drop stores the antenna-corrected anchor point and notifies normal', () => {
  const notes = []
  const m = new AnchorMonitor({ offsetLength: 9, offsetWidth: 0 }, { notify: n => notes.push(n) })
  m.onHeading(0, 0)
  m.onPosition(BASE, 0)
  m.drop(0)
  assert.ok(geo.distance(m.anchor, geo.move(BASE, 9, 0)) < 0.001)
  assert.strictEqual(last(notes).state, 'normal')
})

test('a single GPS glitch does not alarm', () => {
  const { m, notes } = dropped()
  for (let t = 1; t <= 10; t++) at(m, t, t === 5 ? 200 : 5)
  assert.strictEqual(notes.length, 0)
})

test('two glitch samples do not alarm either', () => {
  const { m, notes } = dropped()
  for (let t = 1; t <= 10; t++) at(m, t, t === 5 || t === 6 ? 200 : 5)
  assert.strictEqual(notes.length, 0)
})

test('3 of 5 samples outside triggers the alarm', () => {
  const { m, notes } = dropped()
  at(m, 1, 5)
  at(m, 2, 50)
  at(m, 3, 5)
  at(m, 4, 50)
  assert.strictEqual(notes.length, 0)
  at(m, 5, 50)
  assert.strictEqual(last(notes).state, 'alarm')
  assert.strictEqual(last(notes).message, 'Anchor radius exceeded')
  assert.deepStrictEqual(last(notes).method, ['sound', 'visual'])
})

test('clears after 4 of 5 samples inside radius minus hysteresis, with message', () => {
  const { m, notes } = dropped()
  for (let t = 1; t <= 3; t++) at(m, t, 50)
  assert.strictEqual(last(notes).state, 'alarm')
  at(m, 4, 34) // inside the radius but within the hysteresis band (35 - 2 = 33): not counted
  for (let t = 5; t <= 7; t++) at(m, t, 10)
  assert.strictEqual(last(notes).state, 'alarm') // window 50,34,10,10,10: only 3 count as inside
  at(m, 8, 10) // window 34,10,10,10,10: 4 inside
  assert.strictEqual(last(notes).state, 'normal')
  assert.strictEqual(last(notes).message, 'Back inside anchor circle')
})

test('alarm is re-sent every 30 s while outside, but not more often', () => {
  const { m, notes } = dropped()
  for (let t = 1; t <= 3; t++) at(m, t, 50)
  assert.strictEqual(notes.length, 1)
  for (let t = 4; t <= 30; t++) at(m, t, 50)
  assert.strictEqual(notes.length, 1)
  at(m, 33, 50)
  assert.strictEqual(notes.length, 2)
  m.tick(40 * S)
  assert.strictEqual(notes.length, 2)
  m.tick(63 * S)
  assert.strictEqual(notes.length, 3)
})

test('position lost after 60 s, repeated, and clears by itself', () => {
  const { m, notes } = dropped()
  at(m, 1, 5)
  m.tick(60 * S)
  assert.strictEqual(notes.length, 0)
  m.tick(61 * S)
  assert.strictEqual(last(notes).message, 'Position lost')
  m.tick(70 * S)
  assert.strictEqual(notes.length, 1)
  m.tick(91 * S)
  assert.strictEqual(notes.length, 2)
  at(m, 92, 5)
  assert.strictEqual(last(notes).state, 'normal')
})

test('no alarms at all while the anchor is raised', () => {
  const { m, notes } = setup()
  m.onHeading(0, 0)
  m.onPosition(BASE, 0)
  for (let t = 1; t <= 200; t++) m.tick(t * S)
  assert.strictEqual(notes.length, 0)
})

test('raising the anchor clears an active alarm', () => {
  const { m, notes } = dropped()
  for (let t = 1; t <= 3; t++) at(m, t, 50)
  assert.strictEqual(last(notes).state, 'alarm')
  m.raise(4 * S)
  assert.strictEqual(last(notes).state, 'normal')
  assert.strictEqual(last(notes).message, 'Anchor is raised')
  for (let t = 5; t <= 200; t++) m.tick(t * S)
  assert.strictEqual(last(notes).state, 'normal')
})

test('lost heading while armed keeps the last heading and raises nothing', () => {
  const notes = []
  const m = new AnchorMonitor({ offsetLength: 9, offsetWidth: 0 }, { notify: n => notes.push(n) })
  m.onHeading(0, 0)
  m.onPosition(BASE, 0)
  m.drop(0)
  notes.length = 0
  for (let t = 1; t <= 3600; t++) m.onPosition(BASE, t * S)
  assert.strictEqual(notes.length, 0)
  assert.ok(m.getStatus(3600 * S).distance < 0.001)
})

test('radius change, limits and persistence hooks', () => {
  const { m, saved } = setup()
  m.setRadius(40, 0)
  assert.strictEqual(m.maxRadius, 40)
  m.changeRadius(1, 0)
  assert.strictEqual(m.maxRadius, 41)
  m.setRadius(1, 0)
  assert.strictEqual(m.maxRadius, 5)
  m.setRadius(99999, 0)
  assert.strictEqual(m.maxRadius, 500)
  assert.ok(saved.length >= 4)
  assert.ok(!m.setRadius(NaN, 0).ok)
})

test('nudge moves the anchor 1 m and needs a dropped anchor', () => {
  const { m } = setup()
  assert.ok(!m.nudge('north', 0).ok)
  m.onHeading(0, 0)
  m.onPosition(BASE, 0)
  m.drop(0)
  const before = m.anchor
  m.nudge('east', 0)
  assert.ok(Math.abs(geo.distance(before, m.anchor) - 1) < 0.001)
  assert.ok(m.anchor.longitude > before.longitude)
  assert.ok(!m.nudge('up', 0).ok)
})

test('state survives a restart: armed anchor is restored and watchdog starts', () => {
  const a = dropped({ offsetLength: 9 })
  a.m.setRadius(42, 0)
  const state = JSON.parse(JSON.stringify(a.saved[a.saved.length - 1]))
  assert.strictEqual(state.armed, true)

  const notes = []
  const m = new AnchorMonitor({ offsetLength: 9, offsetWidth: 0 }, { notify: n => notes.push(n) })
  m.restore(state, 1000 * S)
  assert.strictEqual(m.armed, true)
  assert.strictEqual(m.maxRadius, 42)
  assert.strictEqual(last(notes).state, 'normal')
  m.tick(1059 * S)
  assert.strictEqual(last(notes).state, 'normal')
  m.tick(1061 * S)
  assert.strictEqual(last(notes).message, 'Position lost')
  // position comes back at the spot where the anchor point sits: inside
  m.onPosition(geo.move(BASE, -9, 0), 1062 * S)
  assert.strictEqual(last(notes).state, 'normal')
})

test('restoring a raised state keeps radius, stays disarmed', () => {
  const m = new AnchorMonitor()
  m.restore({ armed: false, anchor: null, maxRadius: 50 }, 0)
  assert.strictEqual(m.armed, false)
  assert.strictEqual(m.maxRadius, 50)
})

test('invalid positions are ignored and feed the watchdog', () => {
  const { m, notes } = dropped()
  m.onPosition({ latitude: null, longitude: null }, 5 * S)
  m.tick(61 * S)
  assert.strictEqual(last(notes).message, 'Position lost')
})
