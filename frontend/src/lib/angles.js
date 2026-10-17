import { JOINTS, MIRROR_POINTS, P, POSE_LANDMARKS } from './joints.js'

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

export const MIN_VISIBILITY = 0.5

/**
 * Stored pose → { leftElbow: deg, ..., legSpread, torsoLean } for every
 * angle the camera can actually see. A joint is left out (not scored) when
 * any of its points is missing or MediaPipe isn't confident it's visible,
 * so a leg hidden behind furniture doesn't count as a wrong move.
 * Normalized x and y use different units on a non-square video, so x is
 * scaled by the aspect ratio (width / height) first.
 */
export function computeAngles(pose, aspect = 1) {
  const seen = (...idx) => idx.every((i) => pose[i] && (pose[i][2] ?? 1) >= MIN_VISIBILITY)
  const pt = (i) => [pose[i][0] * aspect, pose[i][1]]
  const mid = (i, j) => [(pt(i)[0] + pt(j)[0]) / 2, (pt(i)[1] + pt(j)[1]) / 2]
  const out = {}
  for (const [name, [a, b, c]] of Object.entries(JOINTS)) {
    if (seen(a, b, c)) out[name] = round(angle(pt(a), pt(b), pt(c)), 1)
  }
  if (seen(P.lHip, P.rHip, P.lKnee, P.rKnee)) {
    out.legSpread = round(angle(pt(P.lKnee), mid(P.lHip, P.rHip), pt(P.rKnee)), 1)
  }
  if (seen(P.lShoulder, P.rShoulder, P.lHip, P.rHip)) {
    const [sx, sy] = mid(P.lShoulder, P.rShoulder), [hx, hy] = mid(P.lHip, P.rHip)
    // 0 = upright; positive when the shoulders lean toward the image right.
    out.torsoLean = round((Math.atan2(sx - hx, hy - sy) * 180) / Math.PI, 1)
  }
  return out
}

/** Swap left/right so the user can copy the reference like a mirror. */
export function mirrorAngles(angles) {
  const out = {}
  for (const [name, value] of Object.entries(angles)) {
    if (name === 'torsoLean') out[name] = -value // leaning right in a mirror is leaning left
    else if (name.startsWith('left')) out[name.replace('left', 'right')] = value
    else if (name.startsWith('right')) out[name.replace('right', 'left')] = value
    else out[name] = value
  }
  return out
}

export function mirrorPose(pose) {
  // Works for 15-point poses and older 13-point ones (no feet).
  return pose.map((_, k) => {
    const p = pose[MIRROR_POINTS[k]]
    return [1 - p[0], p[1], p[2]]
  })
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
    // Average each angle over the recent frames that saw it.
    const out = {}
    for (const name of Object.keys(angles)) {
      const seen = this.history.filter((a) => name in a)
      out[name] = seen.reduce((s, a) => s + a[name], 0) / seen.length
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
