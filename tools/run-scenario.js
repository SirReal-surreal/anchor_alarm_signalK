'use strict'

// Drives one simulator scenario against the Signal K test server and prints a timeline
// of the anchor notification. Usage: node tools/run-scenario.js <scenario> [seconds]
// Drops the anchor 8 s after the simulator starts and raises it at the end (unless 'keep').

const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const env = { ...process.env }
for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)
  if (m && !(m[1] in env)) env[m[1]] = m[2]
}
const scenario = process.argv[2] || 'still'
const seconds = Number(process.argv[3] || 60)
const keep = process.argv[4] === 'keep' // leave the anchor dropped at the end
const headers = { Authorization: 'Bearer ' + env.SK_TOKEN, 'Content-Type': 'application/json' }
const api = p => env.SK_URL + '/signalk/v1/api/vessels/self/' + p.replace(/\./g, '/')
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function get(p) {
  try {
    const r = await fetch(api(p), { headers })
    return r.ok ? await r.json() : null
  } catch (e) {
    return null
  }
}
async function put(p, value) {
  const r = await fetch(api(p), { method: 'PUT', headers, body: JSON.stringify({ value }) })
  return { status: r.status, body: await r.text() }
}

async function main() {
  const t0 = Date.now()
  const stamp = () => ((Date.now() - t0) / 1000).toFixed(0).padStart(3) + ' s'
  const sim = spawn(process.execPath, [path.join(__dirname, 'simulate.js'), scenario, '--seconds', String(seconds), ...process.argv.slice(5)], {
    stdio: 'inherit'
  })
  await sleep(8000)
  console.log(stamp(), 'PUT drop ->', JSON.stringify(await put('navigation.anchor.drop', true)))

  let last = ''
  while (Date.now() - t0 < (seconds + 3) * 1000) {
    const n = await get('notifications.navigation.anchor')
    const r = await get('navigation.anchor.currentRadius')
    const key = n ? n.value.state + ' | ' + n.value.message : 'n/a'
    if (key !== last) {
      console.log(stamp(), 'notification:', key, '| distance', r && r.value)
      last = key
    }
    await sleep(2000)
  }
  if (keep) {
    console.log(stamp(), 'anchor left dropped')
    sim.kill()
    return
  }
  console.log(stamp(), 'PUT raise ->', JSON.stringify(await put('navigation.anchor.drop', false)))
  await sleep(2000)
  const n = await get('notifications.navigation.anchor')
  console.log(stamp(), 'final notification:', n && n.value.state + ' | ' + n.value.message)
  sim.kill()
}
main().catch(e => {
  console.error(e)
  process.exit(1)
})
