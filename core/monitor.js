'use strict'

const defaults = require('./defaults')
const geo = require('./geo')

const ALARM = ['sound', 'visual']
const DIRECTIONS = { north: [1, 0], south: [-1, 0], east: [0, 1], west: [0, -1] }

// Pure alarm logic: no Signal K, no timers, no disk. Time is always passed in (ms),
// output goes through the hooks. See SPEC.md.
//   hooks.notify({state, method, message})  notification changed or alarm re-sent
//   hooks.persist(state)                    persistent state changed
//   hooks.distance(metres, point)           new sample: distance anchor point -> anchor, and that point
class AnchorMonitor {
  constructor(config = {}, hooks = {}) {
    this.cfg = { ...defaults, ...config }
    this.hooks = hooks
    this.armed = false
    this.anchor = null
    this.maxRadius = this.cfg.defaultRadius
    this.droppedAt = null
    this.armedSince = null
    this.position = null // latest raw antenna position {latitude, longitude, t}
    this.heading = null // {value (rad), t}
    this.anchorPoint = null // latest corrected position
    this.distance = null
    this.window = []
    this.radiusAlarm = false
    this.positionLost = false
    this.normalMessage = 'Anchor is raised'
    this.sent = null // last sent {state, message, t}
  }

  // ---- inputs -------------------------------------------------------------

  onPosition(p, now) {
    if (!geo.isValidPosition(p)) return
    this.position = { latitude: p.latitude, longitude: p.longitude, t: now }
    if (!this.armed) return
    if (this.positionLost) {
      this.positionLost = false
      this.window = []
    }
    this.anchorPoint = this._correct(this.position)
    this.distance = geo.distance(this.anchorPoint, this.anchor)
    this.window.push(this.distance)
    if (this.window.length > this.cfg.windowSize) this.window.shift()
    this._evaluateWindow()
    if (this.hooks.distance) this.hooks.distance(this.distance, this.anchorPoint)
    this._publishNotification(now)
  }

  onHeading(rad, now) {
    if (!Number.isFinite(rad)) return
    this.heading = { value: rad, t: now }
  }

  // call about once per second
  tick(now) {
    if (!this.armed) return
    const lastSeen = Math.max(this.position ? this.position.t : -Infinity, this.armedSince)
    if (now - lastSeen >= this.cfg.positionTimeoutSeconds * 1000) this.positionLost = true
    this._publishNotification(now)
  }

  // ---- commands (return {ok, error?}) -------------------------------------

  drop(now) {
    if (this.armed) return { ok: true, changed: false }
    const maxAge = this.cfg.maxDataAgeSeconds * 1000
    if (!this.position || now - this.position.t > maxAge) {
      return { ok: false, error: 'No position information' }
    }
    if (!this.heading || now - this.heading.t > maxAge) {
      return { ok: false, error: 'No heading information' }
    }
    this.anchor = this._correct(this.position)
    this.anchorPoint = this.anchor
    this.distance = 0
    this.window = []
    this.radiusAlarm = false
    this.positionLost = false
    this.armed = true
    this.armedSince = now
    this.droppedAt = now
    this.normalMessage = 'Anchor is fine'
    this._publishNotification(now)
    this._persist()
    return { ok: true, changed: true }
  }

  raise(now) {
    if (!this.armed) return { ok: true, changed: false }
    this.armed = false
    this.radiusAlarm = false
    this.positionLost = false
    this.window = []
    this.distance = null
    this.normalMessage = 'Anchor is raised'
    this._publishNotification(now)
    this._persist()
    return { ok: true, changed: true }
  }

  setRadius(metres, now) {
    if (!Number.isFinite(metres)) return { ok: false, error: 'Invalid radius' }
    const r = Math.min(this.cfg.maxRadiusLimit, Math.max(this.cfg.minRadius, metres))
    this.maxRadius = Math.round(r * 10) / 10
    if (this.armed) {
      this._evaluateWindow()
      this._publishNotification(now)
    }
    this._persist()
    return { ok: true, maxRadius: this.maxRadius }
  }

  changeRadius(direction, now) {
    return this.setRadius(this.maxRadius + direction * this.cfg.radiusStep, now)
  }

  nudge(direction, now) {
    const d = DIRECTIONS[direction]
    if (!d) return { ok: false, error: 'Unknown direction' }
    if (!this.armed) return { ok: false, error: 'Anchor is not dropped' }
    this.anchor = geo.move(this.anchor, d[0] * this.cfg.nudgeStep, d[1] * this.cfg.nudgeStep)
    this.window = []
    if (this.anchorPoint) this.distance = geo.distance(this.anchorPoint, this.anchor)
    this._publishNotification(now)
    this._persist()
    return { ok: true, anchor: this.anchor }
  }

  // ---- persistence ----------------------------------------------------------

  getState() {
    return {
      armed: this.armed,
      anchor: this.anchor,
      maxRadius: this.maxRadius,
      droppedAt: this.droppedAt,
      heading: this.heading ? this.heading.value : null
    }
  }

  // Restore after a restart. If it was armed, monitoring continues immediately and the
  // position watchdog starts counting from now.
  restore(state, now) {
    if (!state) return
    if (Number.isFinite(state.maxRadius)) this.maxRadius = state.maxRadius
    if (Number.isFinite(state.heading)) this.heading = { value: state.heading, t: -Infinity }
    if (state.armed && geo.isValidPosition(state.anchor)) {
      this.anchor = state.anchor
      this.droppedAt = state.droppedAt || null
      this.armed = true
      this.armedSince = now
      this.normalMessage = 'Anchor is fine'
      this._publishNotification(now)
    }
  }

  // publish the current notification state (used once at start-up)
  announce(now) {
    this._publishNotification(now)
  }

  // ---- status for UI ----------------------------------------------------------

  getStatus(now) {
    return {
      armed: this.armed,
      anchor: this.anchor,
      maxRadius: this.maxRadius,
      distance: this.distance,
      position: this.anchorPoint,
      heading: this.heading ? this.heading.value : null,
      positionAge: this.position ? (now - this.position.t) / 1000 : null,
      headingAge: this.heading ? (now - this.heading.t) / 1000 : null,
      alarm: this._desiredNotification(),
      droppedAt: this.droppedAt
    }
  }

  // ---- internals ----------------------------------------------------------------

  _correct(pos) {
    if (!this.heading) return { latitude: pos.latitude, longitude: pos.longitude }
    return geo.antennaToAnchorPoint(pos, this.heading.value, this.cfg.offsetLength, this.cfg.offsetWidth)
  }

  _evaluateWindow() {
    const r = this.maxRadius
    const innerEdge = r - Math.min(this.cfg.hysteresis, r / 2)
    const outside = this.window.filter(d => d > r).length
    const inside = this.window.filter(d => d < innerEdge).length
    if (!this.radiusAlarm && outside >= this.cfg.alarmCount) {
      this.radiusAlarm = true
    } else if (this.radiusAlarm && inside >= this.cfg.clearCount) {
      this.radiusAlarm = false
      this.normalMessage = 'Back inside anchor circle'
    }
  }

  _desiredNotification() {
    if (!this.armed) return { state: 'normal', method: [], message: this.normalMessage }
    if (this.positionLost) return { state: 'alarm', method: ALARM, message: 'Position lost' }
    if (this.radiusAlarm) return { state: 'alarm', method: ALARM, message: 'Anchor radius exceeded' }
    return { state: 'normal', method: [], message: this.normalMessage }
  }

  _publishNotification(now) {
    const n = this._desiredNotification()
    const s = this.sent
    const changed = !s || s.state !== n.state || s.message !== n.message
    const resend = !changed && n.state === 'alarm' && now - s.t >= this.cfg.reAlarmSeconds * 1000
    if (changed || resend) {
      this.sent = { state: n.state, message: n.message, t: now }
      if (this.hooks.notify) this.hooks.notify(n)
    }
  }

  _persist() {
    if (this.hooks.persist) this.hooks.persist(this.getState())
  }
}

module.exports = { AnchorMonitor }
