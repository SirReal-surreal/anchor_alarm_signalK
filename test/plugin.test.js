'use strict'
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const createPlugin = require('../plugin/index')

function mockApp(dir) {
  const app = {
    messages: [],
    puts: {},
    onDelta: null,
    status: '',
    getDataDirPath: () => dir,
    handleMessage: (id, msg) => app.messages.push(msg),
    setPluginStatus: s => (app.status = s),
    error: () => {},
    registerPutHandler: (ctx, p, fn) => (app.puts[p] = fn),
    subscriptionmanager: {
      subscribe: (sub, unsubs, err, cb) => {
        app.onDelta = cb
        unsubs.push(() => (app.onDelta = null))
      }
    }
  }
  return app
}

const values = (app, p) =>
  app.messages.flatMap(m => m.updates.flatMap(u => u.values)).filter(v => v.path === p)

const feed = (app, path_, value) =>
  app.onDelta({ updates: [{ $source: 'sim', timestamp: new Date().toISOString(), values: [{ path: path_, value }] }] })

test('plugin: drop refused without data, works with data, persists and restores', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anchor-'))
  const app = mockApp(dir)
  const plugin = createPlugin(app)
  plugin.start({ offsetLength: 0, offsetWidth: 0 })

  assert.strictEqual(values(app, 'navigation.anchor.drop').pop().value, false)
  assert.strictEqual(values(app, 'notifications.navigation.anchor').pop().value.message, 'Anchor is raised')

  const refused = app.puts['navigation.anchor.drop']('vessels.self', 'navigation.anchor.drop', true)
  assert.strictEqual(refused.statusCode, 400)
  assert.strictEqual(refused.message, 'No position information')

  feed(app, 'navigation.position', { latitude: 53.96, longitude: 10.9 })
  feed(app, 'navigation.headingTrue', 1.0)
  const ok = app.puts['navigation.anchor.drop']('vessels.self', 'navigation.anchor.drop', true)
  assert.strictEqual(ok.statusCode, 200)
  assert.strictEqual(values(app, 'navigation.anchor.drop').pop().value, true)
  assert.strictEqual(values(app, 'notifications.navigation.anchor').pop().value.message, 'Anchor is fine')

  // 3 positions 80 m away -> alarm
  for (let i = 0; i < 3; i++) feed(app, 'navigation.position', { latitude: 53.9607, longitude: 10.9 })
  assert.strictEqual(values(app, 'notifications.navigation.anchor').pop().value.state, 'alarm')

  plugin.stop() // flushes the state file
  assert.ok(fs.existsSync(path.join(dir, 'anchor-state.json')))

  // restart: anchor restored and armed
  const app2 = mockApp(dir)
  const plugin2 = createPlugin(app2)
  plugin2.start({ offsetLength: 0, offsetWidth: 0 })
  assert.strictEqual(values(app2, 'navigation.anchor.drop').pop().value, true)
  assert.strictEqual(plugin2.commands.raise().ok, true)
  assert.strictEqual(values(app2, 'notifications.navigation.anchor').pop().value.message, 'Anchor is raised')
  plugin2.stop()
})

test('plugin: $source filter ignores other sources', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anchor-'))
  const app = mockApp(dir)
  const plugin = createPlugin(app)
  plugin.start({ positionSource: 'gps.main' })
  feed(app, 'navigation.position', { latitude: 53.96, longitude: 10.9 }) // source "sim": ignored
  feed(app, 'navigation.headingTrue', 1.0)
  assert.strictEqual(plugin.commands.drop().error, 'No position information')
  plugin.stop()
})

test('plugin: command PUT (radius, nudge) and boat point publishing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anchor-'))
  const app = mockApp(dir)
  const plugin = createPlugin(app)
  plugin.start({ offsetLength: 0, offsetWidth: 0 })
  const cmd = v => app.puts['navigation.anchor.command']('vessels.self', 'navigation.anchor.command', v)

  feed(app, 'navigation.position', { latitude: 53.96, longitude: 10.9 })
  feed(app, 'navigation.headingTrue', 0)
  assert.strictEqual(cmd({ nudge: 'north' }).message, 'Anchor is not dropped')
  plugin.commands.drop()
  assert.strictEqual(cmd({ radius: 'up' }).statusCode, 200)
  assert.strictEqual(values(app, 'navigation.anchor.maxRadius').pop().value, 36)
  assert.strictEqual(cmd({ nudge: 'east' }).statusCode, 200)
  assert.strictEqual(cmd({ bogus: 1 }).statusCode, 400)

  feed(app, 'navigation.position', { latitude: 53.9601, longitude: 10.9 })
  assert.ok(values(app, 'navigation.anchor.boatPosition').pop().value.latitude > 53.96)
  assert.ok(values(app, 'navigation.anchor.currentRadius').pop().value > 5)
  plugin.stop()
})
