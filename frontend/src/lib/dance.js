import { computeAngles } from './angles.js'
import { splitIntoSteps } from './steps.js'

export const DANCE_FORMAT_VERSION = 1

/** Assemble the dance JSON stored by the backend (see docs/dance-format.md). */
export function buildDance({ name, bpm, countStart = 0, fps = 30, aspect = 16 / 9, frames, steps, source = 'upload' }) {
  const withAngles = frames.map((f) => ({ t: f.t, angles: f.angles ?? computeAngles(f.pose, aspect), pose: f.pose }))
  const duration = withAngles[withAngles.length - 1].t
  return {
    version: DANCE_FORMAT_VERSION,
    name,
    bpm,
    fps,
    aspect: Math.round(aspect * 1000) / 1000,
    countStart,
    source,
    frames: withAngles,
    steps: steps ?? splitIntoSteps(duration, bpm, countStart),
  }
}

/** Bounding box of every pose in the dance, so playback doesn't jitter in scale. */
export function danceBounds(frames, aspect = 16 / 9) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const f of frames) {
    for (const [x, y] of f.pose) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x)
      minY = Math.min(minY, y); maxY = Math.max(maxY, y)
    }
  }
  return { minX, minY, maxX, maxY, aspect }
}
