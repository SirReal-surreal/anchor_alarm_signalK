'use strict'

// Default settings; the plugin exposes all of these in the Signal K plugin config (see SPEC.md 8.7b).
module.exports = {
  offsetLength: 9, // m, antenna -> anchor point along the boat (positive = forward)
  offsetWidth: -0.5, // m, antenna -> anchor point sideways (negative = anchor point to port)
  defaultRadius: 35, // m, used for the first drop
  minRadius: 5, // m
  maxRadiusLimit: 500, // m
  radiusStep: 1, // m
  nudgeStep: 1, // m
  windowSize: 5, // samples considered for the radius check
  alarmCount: 3, // outside samples within the window that trigger the alarm
  clearCount: 4, // inside samples within the window that clear the alarm
  hysteresis: 2, // m, sample must be this far inside the circle to count as "inside" for clearing
  reAlarmSeconds: 30, // re-send an active alarm so a KIP acknowledgement is not final
  positionTimeoutSeconds: 60, // no position for this long while armed -> alarm
  maxDataAgeSeconds: 10, // position/heading must be this fresh to drop the anchor
  positionPath: 'navigation.position',
  headingPath: 'navigation.headingTrue',
  positionSource: '', // optional $source filter, empty = any
  headingSource: ''
}
