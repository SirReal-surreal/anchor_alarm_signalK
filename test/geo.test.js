'use strict'
const test = require('node:test')
const assert = require('node:assert')
const geo = require('../core/geo')

const base = { latitude: 53.96, longitude: 10.9 }

test('distance of 1 m north move is 1 m', () => {
  const d = geo.distance(base, geo.move(base, 1, 0))
  assert.ok(Math.abs(d - 1) < 0.001, String(d))
})

test('distance of 10 m east move is 10 m (longitude scaled by latitude)', () => {
  const d = geo.distance(base, geo.move(base, 0, 10))
  assert.ok(Math.abs(d - 10) < 0.001, String(d))
})

test('antenna offset heading north: 9 m forward, 0.5 m to port', () => {
  const p = geo.antennaToAnchorPoint(base, 0, 9, -0.5)
  assert.ok(geo.distance(p, geo.move(base, 9, -0.5)) < 0.001)
})

test('antenna offset heading east: anchor point lies east of antenna', () => {
  const p = geo.antennaToAnchorPoint(base, Math.PI / 2, 9, 0)
  assert.ok(Math.abs(geo.distance(base, p) - 9) < 0.001)
  assert.ok(p.longitude > base.longitude)
  assert.ok(Math.abs(p.latitude - base.latitude) < 1e-9)
})

test('isValidPosition', () => {
  assert.ok(geo.isValidPosition(base))
  assert.ok(!geo.isValidPosition(null))
  assert.ok(!geo.isValidPosition({ latitude: null, longitude: 1 }))
  assert.ok(!geo.isValidPosition({ latitude: 91, longitude: 1 }))
})
