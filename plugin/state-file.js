'use strict'

const fs = require('fs')
const path = require('path')

// Atomic (temp file + rename) state file with a short debounce, so a power cut never
// leaves a half-written file behind.
function createStateFile(dir, { debounceMs = 2000, name = 'anchor-state.json' } = {}) {
  const file = path.join(dir, name)
  let timer = null
  let pending = null

  function writeNow() {
    if (pending === null) return
    const data = pending
    pending = null
    fs.mkdirSync(dir, { recursive: true })
    const tmp = file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(data))
    fs.renameSync(tmp, file)
  }

  return {
    file,
    load() {
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8'))
      } catch (e) {
        return null // missing or corrupt: start fresh
      }
    },
    save(state) {
      pending = state
      if (!timer) {
        timer = setTimeout(() => {
          timer = null
          try {
            writeNow()
          } catch (e) {
            console.error('anchor-alarm: cannot write state', e.message)
          }
        }, debounceMs)
      }
    },
    flush() {
      if (timer) clearTimeout(timer)
      timer = null
      writeNow()
    }
  }
}

module.exports = { createStateFile }
