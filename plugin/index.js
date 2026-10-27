'use strict'

const defaults = require('../core/defaults')
const { AnchorMonitor } = require('../core/monitor')
const { createStateFile } = require('./state-file')

const PATH_DROP = 'navigation.anchor.drop'
const PATH_MAX_RADIUS = 'navigation.anchor.maxRadius'
const PATH_CURRENT_RADIUS = 'navigation.anchor.currentRadius'
const PATH_POSITION = 'navigation.anchor.position'
const PATH_BOAT_POINT = 'navigation.anchor.boatPosition'
const PATH_COMMAND = 'navigation.anchor.command'
const PATH_HEARTBEAT = 'navigation.anchor.heartbeat'
const PATH_NOTIFICATION = 'notifications.navigation.anchor'

const prop = (title, def, extra = {}) => ({ type: 'number', title, default: def, ...extra })

module.exports = function (app) {
  const plugin = {
    id: 'signalk-anchor-alarm',
    name: 'Anchor alarm',
    description: 'Anchor alarm with antenna offset, glitch-tolerant radius check and persistent state'
  }

  let monitor = null
  let stateFile = null
  let tickTimer = null
  let heartbeatTimer = null
  let unsubscribes = []

  plugin.schema = () => ({
    type: 'object',
    description: 'The map in the web page needs a chart (.mbtiles) in the Signal K charts folder (~/.signalk/charts) and the Signal K Charts plugin enabled. Without a chart the alarm still works, only the map background is missing.',
    properties: {
      offsetLength: prop('Antenna offset length [m] (positive = anchor point forward of antenna)', defaults.offsetLength),
      offsetWidth: prop('Antenna offset width [m] (negative = anchor point to port of antenna)', defaults.offsetWidth),
      defaultRadius: prop('Default radius [m]', defaults.defaultRadius),
      radiusStep: prop('Radius step [m] (one press of the radius +/- buttons changes the alarm radius)', defaults.radiusStep),
      nudgeStep: prop('Anchor nudge step [m] (one press of an arrow button moves the anchor position)', defaults.nudgeStep),
      windowSize: prop('Radius check: samples in window', defaults.windowSize),
      alarmCount: prop('Radius check: outside samples that raise the alarm', defaults.alarmCount),
      clearCount: prop('Radius check: inside samples that clear the alarm', defaults.clearCount),
      hysteresis: prop('Hysteresis for clearing [m]', defaults.hysteresis),
      reAlarmSeconds: prop('Re-send active alarm every [s]', defaults.reAlarmSeconds),
      positionTimeoutSeconds: prop('Position lost after [s]', defaults.positionTimeoutSeconds),
      maxDataAgeSeconds: prop('Max age of position/heading to drop anchor [s]', defaults.maxDataAgeSeconds),
      positionPath: { type: 'string', title: 'Position path', default: defaults.positionPath },
      headingPath: { type: 'string', title: 'Heading path (true, rad)', default: defaults.headingPath },
      positionSource: { type: 'string', title: 'Position $source (empty = any)', default: '' },
      headingSource: { type: 'string', title: 'Heading $source (empty = any)', default: '' }
    }
  })

  // ---- Signal K output ----------------------------------------------------

  function publish(values, meta) {
    const update = { values }
    if (meta) update.meta = meta
    app.handleMessage(plugin.id, { updates: [update] })
  }

  const publishValue = (path, value) => publish([{ path, value }])

  function publishState() {
    publish(
      [
        { path: PATH_DROP, value: monitor.armed },
        { path: PATH_MAX_RADIUS, value: monitor.maxRadius },
        { path: PATH_POSITION, value: monitor.armed ? monitor.anchor : null }
      ],
      [
        { path: PATH_MAX_RADIUS, value: { units: 'm' } },
        { path: PATH_CURRENT_RADIUS, value: { units: 'm' } }
      ]
    )
    if (!monitor.armed) publishValue(PATH_CURRENT_RADIUS, null)
  }

  // ---- input -----------------------------------------------------------------

  function subscribe(opts) {
    const wanted = [
      { path: opts.positionPath, period: 1000, minPeriod: 1000, policy: 'instant' },
      { path: opts.headingPath, period: 2000, minPeriod: 2000, policy: 'instant' }
    ]
    app.subscriptionmanager.subscribe(
      { context: 'vessels.self', subscribe: wanted },
      unsubscribes,
      err => app.error('anchor-alarm subscription error: ' + err),
      delta => {
        for (const update of delta.updates || []) {
          const source = update.$source || ''
          const t = update.timestamp ? Date.parse(update.timestamp) : NaN
          const now = Date.now()
          // use the data timestamp so cached/replayed values do not look fresh
          const stamp = Number.isFinite(t) && t <= now ? t : now
          for (const v of update.values || []) {
            if (v.path === opts.positionPath && (!opts.positionSource || source === opts.positionSource)) {
              monitor.onPosition(v.value, stamp)
            } else if (v.path === opts.headingPath && (!opts.headingSource || source === opts.headingSource)) {
              monitor.onHeading(v.value, stamp)
            }
          }
        }
      }
    )
  }

  // ---- commands (shared by PUT handlers and the web routes) -------------------

  function afterCommand() {
    publishState()
  }

  const commands = {
    drop() {
      const r = monitor.drop(Date.now())
      if (r.ok) afterCommand()
      return r
    },
    raise() {
      const r = monitor.raise(Date.now())
      if (r.ok) afterCommand()
      return r
    },
    setRadius(value) {
      const r = monitor.setRadius(Number(value), Date.now())
      if (r.ok) afterCommand()
      return r
    },
    changeRadius(direction) {
      const r = monitor.changeRadius(direction, Date.now())
      if (r.ok) afterCommand()
      return r
    },
    nudge(direction) {
      const r = monitor.nudge(direction, Date.now())
      if (r.ok) afterCommand()
      return r
    }
  }
  plugin.commands = commands

  const putResult = r =>
    r.ok ? { state: 'COMPLETED', statusCode: 200 } : { state: 'COMPLETED', statusCode: 400, message: r.error }

  // ---- lifecycle --------------------------------------------------------------

  plugin.start = function (options) {
    const opts = { ...defaults, ...options }
    stateFile = createStateFile(app.getDataDirPath())
    monitor = new AnchorMonitor(opts, {
      notify: n => publishValue(PATH_NOTIFICATION, n),
      persist: state => stateFile.save(state),
      distance: (d, point) =>
        publish([
          { path: PATH_CURRENT_RADIUS, value: Math.round(d * 10) / 10 },
          { path: PATH_BOAT_POINT, value: point }
        ])
    })

    const now = Date.now()
    monitor.restore(stateFile.load(), now)
    publishState()
    monitor.announce(now)
    app.setPluginStatus(monitor.armed ? 'Anchor dropped (restored)' : 'Anchor raised')

    subscribe(opts)

    app.registerPutHandler('vessels.self', PATH_DROP, (ctx, p, value, cb) => {
      return putResult(value ? commands.drop() : commands.raise())
    }, plugin.id)
    app.registerPutHandler('vessels.self', PATH_MAX_RADIUS, (ctx, p, value, cb) => {
      return putResult(commands.setRadius(value))
    }, plugin.id)

    // {radius: 'up'|'down'} or {nudge: 'north'|'south'|'east'|'west'}
    app.registerPutHandler('vessels.self', PATH_COMMAND, (ctx, p, value, cb) => {
      if (value && value.radius) return putResult(commands.changeRadius(value.radius === 'up' ? 1 : -1))
      if (value && value.nudge) return putResult(commands.nudge(value.nudge))
      return putResult({ ok: false, error: 'Unknown command' })
    }, plugin.id)

    tickTimer = setInterval(() => {
      monitor.tick(Date.now())
      app.setPluginStatus(monitor.armed ? 'Anchor dropped' : 'Anchor raised')
    }, 1000)
    heartbeatTimer = setInterval(() => publishValue(PATH_HEARTBEAT, new Date().toISOString()), 5000)
  }

  plugin.stop = function () {
    clearInterval(tickTimer)
    clearInterval(heartbeatTimer)
    unsubscribes.forEach(f => f())
    unsubscribes = []
    if (stateFile) stateFile.flush()
    monitor = null
  }

  // web routes for the UI: /plugins/signalk-anchor-alarm/...
  plugin.registerWithRouter = function (router) {
    const send = (res, r) => res.status(r.ok ? 200 : 400).json(r)
    router.get('/status', (req, res) => {
      if (!monitor) return res.status(503).json({ error: 'plugin not running' })
      res.json(monitor.getStatus(Date.now()))
    })
    router.post('/drop', (req, res) => send(res, commands.drop()))
    router.post('/raise', (req, res) => send(res, commands.raise()))
    router.post('/radius/:direction', (req, res) => send(res, commands.changeRadius(req.params.direction === 'up' ? 1 : -1)))
    router.post('/nudge/:direction', (req, res) => send(res, commands.nudge(req.params.direction)))
  }

  return plugin
}
