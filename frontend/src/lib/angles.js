import { JOINTS, MIRROR_POINTS, POSE_LANDMARKS } from './joints.js'

/** Angle at vertex b, in degrees (0–180), from 2D points [x, y]. */
export function angle(a, b, c) {
  const abx = a[0] - b[0], aby = a[1] - b[1]
  const cbx = c[0] - b[0], cby = c[1] - b[1]
  const dot = abx * cbx + aby * cby
  const mag = Math.hypot(abx, aby) * Math.hypot(cbx, cby)
  if (mag === 0) return 0
  return (Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180) / Math.PI
}

/** MediaPipe landmarks (33) → stored pose: 13 × [x, y, visibility], rounded. */
export function toPose(landmarks) {
  return POSE_LANDMARKS.map((i) => {
    const l = landmarks[i]
    return [round(l.x, 4), round(l.y, 4), round(l.visibility ?? 1, 2)]
  })
}

/**
 * Stored pose → { leftElbow: deg, ... } for the 8 scored joints.
 * Normalized x and y use different units on a non-square video, so x is
 * scaled by the aspect ratio (width / height) first.
 */
export function computeAngles(pose, aspect = 1) {
  const pt = (i) => [pose[i][0] * aspect, pose[i][1]]
  const out = {}
  for (const [name, [a, b, c]] of Object.entries(JOINTS)) {
    out[name] = round(angle(pt(a), pt(b), pt(c)), 1)
  }
  return out
}

/** Swap left/right so the user can copy the reference like a mirror. */
export function mirrorAngles(angles) {
  const out = {}
  for (const [name, value] of Object.entries(angles)) {
    const other = name.startsWith('left') ? name.replace('left', 'right') : name.replace('right', 'left')
    out[other] = value
  }
  return out
}

export function mirrorPose(pose) {
  return MIRROR_POINTS.map((i) => [1 - pose[i][0], pose[i][1], pose[i][2]])
}

/** Moving average of the last `size` angle readings (3–5 frames smooths jitter). */
export class AngleSmoother {
  constructor(size = 4) {
    this.size = size
    this.history = []
  }
  push(angles) {
    this.history.push(angles)
    if (this.history.length > this.size) this.history.shift()
    const out = {}
    for (const name of Object.keys(angles)) {
      out[name] = this.history.reduce((s, a) => s + a[name], 0) / this.history.length
    }
    return out
  }
  reset() {
    this.history = []
  }
}

/** Every tracked point is confidently visible and inside the frame. */
export function bodyInFrame(pose, { minVisibility = 0.5, margin = 0.02 } = {}) {
  const missing = pose.filter(
    ([x, y, v]) => v < minVisibility || x < margin || x > 1 - margin || y < margin || y > 1 - margin,
  )
  return { ok: missing.length === 0, missing: missing.length }
}

export function isTPose(angles, tolerance = 25) {
  return (
    Math.abs(angles.leftShoulder - 90) < tolerance &&
    Math.abs(angles.rightShoulder - 90) < tolerance &&
    angles.leftElbow > 180 - tolerance &&
    angles.rightElbow > 180 - tolerance
  )
}

function round(v, digits) {
  const f = 10 ** digits
  return Math.round(v * f) / f
}
