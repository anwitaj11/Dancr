import { computeAngles } from './angles.js'
import { splitByMotion } from './steps.js'

export const DANCE_FORMAT_VERSION = 1

/** Assemble the dance JSON stored by the backend (see docs/dance-format.md). */
export function buildDance({ name, bpm, countStart = 0, fps = 30, aspect = 16 / 9, videoOffset = 0, frames, steps, source = 'upload', dancer }) {
  const withAngles = frames.map((f) => ({ t: f.t, angles: f.angles ?? computeAngles(f.pose, aspect), pose: f.pose }))
  const duration = withAngles[withAngles.length - 1].t
  return {
    version: DANCE_FORMAT_VERSION,
    name,
    bpm,
    fps,
    aspect: Math.round(aspect * 1000) / 1000,
    countStart,
    videoOffset, // add to frame time to get source-video time
    source,
    ...(dancer && { dancer }), // { number, people, color } when the video had several people
    frames: withAngles,
    steps: steps ?? splitByMotion(withAngles, bpm, countStart),
  }
}

/**
 * Recompute every frame's angles from its pose with the current angle set, so
 * dances saved before an angle existed (e.g. leg spread, torso lean) score it too.
 * Angles that need points the old recording didn't keep (feet) are simply skipped.
 */
export function refreshAngles(dance) {
  const aspect = dance.aspect ?? 16 / 9
  return { ...dance, frames: dance.frames.map((f) => (f.pose ? { ...f, angles: computeAngles(f.pose, aspect) } : f)) }
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
