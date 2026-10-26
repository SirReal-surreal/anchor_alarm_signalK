'use strict'

// Fake GPS + heading for development. Writes deltas to a Signal K server (ws input).
//   node tools/simulate.js <scenario> [--lat 53.96] [--lon 10.9] [--seconds 300] [--noise 1]
// Scenarios: still | glitch | drift | gpsloss | excursion | noheading | swing
// Needs SK_URL and SK_TOKEN (from .env). Requires Node >= 22 (global WebSocket).

const fs = require('fs')
const path = require('path')
const geo = require('../core/geo')

const env = { ...process.env }
try {
  for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)
    if (m && !(m[1] in env)) env[m[1]] = m[2]
  }
} catch (e) {}

const args = process.argv.slice(2)
const scenario = args[0] || 'still'
const opt = (name, def) => {
  const i = args.indexOf('--' + name)
  return i >= 0 ? Number(args[i + 1]) : def
}
const centre = { latitude: opt('lat', 53.96), longitude: opt('lon', 10.9) }
const seconds = opt('seconds', 300)
const ANTENNA_OFFSET_M = 9 // antenna sits this far behind the anchor point
const ANTENNA_STARBOARD_M = 0.5 // ... and this far to starboard of it

if (!env.SK_URL || !env.SK_TOKEN) {
  console.error('SK_URL / SK_TOKEN missing (.env)')
  process.exit(1)
}
if (!['still', 'glitch', 'drift', 'gpsloss', 'excursion', 'noheading', 'swing'].includes(scenario)) {
  console.error('unknown scenario ' + scenario)
  process.exit(1)
}

const url = env.SK_URL.replace(/^http/, 'ws') + '/signalk/v1/stream?subscribe=none&token=' + env.SK_TOKEN
const ws = new WebSocket(url)
const noiseFactor = opt('noise', 1) // --noise 0 for exact comparisons
const noise = m => (Math.random() - 0.5) * 2 * m * noiseFactor

// boat position at second t (anchor point), heading in rad
function boat(t) {
  const heading = (Math.PI / 4) * Math.sin(t / 40) // slowly swinging about north
  let northM = noise(0.7)
  let eastM = noise(0.7)
  if (scenario === 'drift' && t > 30) northM += (t - 30) * 0.5 // 0.5 m/s away after 30 s
  if (scenario === 'excursion' && t >= 30 && t < 70) northM += 50 // leaves the 35 m circle for 40 s
  if (scenario === 'swing') { // slow circle (about 3 min per round, radius 15 m) around the anchor
    northM += 15 * Math.cos(t / 30)
    eastM += 15 * Math.sin(t / 30)
  }
  if (scenario === 'glitch' && t % 20 === 10) northM += 150 // single wild fix every 20 s
  return { heading, anchorPoint: geo.move(centre, northM, eastM) }
}

function delta(path_, value) {
  return {
    context: 'vessels.self',
    updates: [{ source: { label: 'anchor-sim', type: 'simulator' }, timestamp: new Date().toISOString(), values: [{ path: path_, value }] }]
  }
}

ws.addEventListener('open', () => {
  console.log(`connected, scenario "${scenario}", ${seconds} s, centre ${centre.latitude} ${centre.longitude}`)
  let t = 0
  const timer = setInterval(() => {
    const b = boat(t)
    // antenna is ANTENNA_OFFSET_M behind the anchor point
    const antenna = geo.antennaToAnchorPoint(b.anchorPoint, b.heading, -ANTENNA_OFFSET_M, ANTENNA_STARBOARD_M)
    const gpsDown = scenario === 'gpsloss' && t >= 30 && t < 130
    if (!gpsDown) ws.send(JSON.stringify(delta('navigation.position', antenna)))
    const headingDown = scenario === 'noheading' && t >= 20
    if (t % 2 === 0 && !headingDown) ws.send(JSON.stringify(delta('navigation.headingTrue', (b.heading + 2 * Math.PI) % (2 * Math.PI))))
    if (++t > seconds) {
      clearInterval(timer)
      ws.close()
    }
  }, 1000)
})
ws.addEventListener('error', e => console.error('ws error', e.message || e))
ws.addEventListener('close', () => {
  console.log('done')
  process.exit(0)
})
