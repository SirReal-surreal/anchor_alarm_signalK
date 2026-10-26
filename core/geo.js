'use strict'

const R = 6371000 // mean earth radius in m
const toRad = deg => (deg * Math.PI) / 180
const toDeg = rad => (rad * 180) / Math.PI

function isValidPosition(p) {
  return (
    p != null &&
    Number.isFinite(p.latitude) &&
    Number.isFinite(p.longitude) &&
    Math.abs(p.latitude) <= 90 &&
    Math.abs(p.longitude) <= 180
  )
}

// Haversine distance in m
function distance(a, b) {
  const dLat = toRad(b.latitude - a.latitude)
  const dLon = toRad(b.longitude - a.longitude)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

// Move a position by metres north / east
function move(p, northM, eastM) {
  return {
    latitude: p.latitude + toDeg(northM / R),
    longitude: p.longitude + toDeg(eastM / (R * Math.cos(toRad(p.latitude))))
  }
}

// Shift the antenna position to the anchor point. Same maths as the old Node-RED
// "heading correction": offset rotated by the heading (rad, true).
function antennaToAnchorPoint(p, headingRad, lengthM, widthM) {
  const north = lengthM * Math.cos(headingRad) - widthM * Math.sin(headingRad)
  const east = lengthM * Math.sin(headingRad) + widthM * Math.cos(headingRad)
  return move(p, north, east)
}

module.exports = { isValidPosition, distance, move, antennaToAnchorPoint }
