import { JOINT_NAMES } from './joints.js'
import { mirrorAngles } from './angles.js'

// Forgiving scoring: small differences from the tutorial still count as a
// full match, and scores are shown as a plain percentage.
export const FULL_CREDIT_ZONE = 15 // degrees off that still earn full credit
export const ZERO_AT = 60 // degrees off where a joint earns nothing
export const PASS_SCORE = 0.7 // 70%+ completes a step
export const TIMING_WINDOW = 0.5 // seconds, each side
const TIMING_LABEL_THRESHOLD = 0.15

/** 1 within FULL_CREDIT_ZONE degrees, falling linearly to 0 at ZERO_AT degrees off. */
export function jointScore(diff) {
  const off = Math.abs(diff)
  if (off <= FULL_CREDIT_ZONE) return 1
  return Math.max(0, 1 - (off - FULL_CREDIT_ZONE) / (ZERO_AT - FULL_CREDIT_ZONE))
}

/** A 0–1 score as the percentage dancers see, e.g. "72%". */
export function pct(score) {
  return `${Math.round(score * 100)}%`
}

/**
 * Scores every joint both the dancer and the tutorial show; hidden joints are skipped, not counted wrong.
 * diffs[j] = dancer angle − tutorial angle (which way they're off, for spoken fixes).
 */
export function scorePose(userAngles, refAngles, joints = JOINT_NAMES, weights = null) {
  const scores = {}, diffs = {}
  let sum = 0, total = 0
  for (const j of joints) {
    if (j in userAngles && j in refAngles) {
      diffs[j] = userAngles[j] - refAngles[j]
      scores[j] = jointScore(diffs[j])
      const w = weights?.[j] ?? 1
      sum += scores[j] * w
      total += w
    }
  }
  return { joints: scores, diffs, overall: total ? sum / total : 0 }
}

/**
 * How much each joint matters in one step: joints that move a lot in the tutorial
 * count fully, joints that barely move (standing legs, an upright torso) count
 * for little, so just standing there can't match "most of the body".
 */
export function jointWeights(frames, start, end, { full = 40, min = 0.15 } = {}) {
  const lo = {}, hi = {}
  for (const f of frames) {
    if (f.t < start || f.t > end) continue
    for (const [j, v] of Object.entries(f.angles)) {
      lo[j] = Math.min(lo[j] ?? v, v)
      hi[j] = Math.max(hi[j] ?? v, v)
    }
  }
  const weights = {}
  for (const j of Object.keys(lo)) weights[j] = Math.min(1, Math.max(min, (hi[j] - lo[j]) / full))
  return weights
}

/**
 * Compares how much the dancer is moving with how much the tutorial moves over
 * the last couple of seconds. ratio() is ~1 when they move as much (or more),
 * and drops toward 0 when they stand still while the tutorial dances.
 */
export class MotionMeter {
  constructor(windowSec = 2) {
    this.windowSec = windowSec
    this.samples = []
  }
  add(t, userAngles, refAngles) {
    this.samples.push({ t, user: userAngles, ref: refAngles })
    while (this.samples.length && this.samples[0].t < t - this.windowSec) this.samples.shift()
  }
  static travel(samples, key) {
    let total = 0
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1][key], b = samples[i][key]
      for (const j of Object.keys(b)) if (j in a) total += Math.abs(b[j] - a[j])
    }
    return total
  }
  ratio() {
    if (this.samples.length < 3) return 1
    const ref = MotionMeter.travel(this.samples, 'ref')
    if (ref < 60) return 1 // the tutorial is (nearly) holding still here: nothing to compare
    return Math.min(1, MotionMeter.travel(this.samples, 'user') / ref)
  }
  reset() {
    this.samples = []
  }
}

/** Final score for a moment: pose match, scaled down when the dancer isn't moving like the tutorial. */
export function withMotion(poseScore, motionRatio) {
  return poseScore * (0.25 + 0.75 * motionRatio)
}

export function colorFor(score) {
  if (score > 0.8) return '#39ff88'
  if (score >= 0.5) return '#ffe14d'
  return '#ff3b6b'
}

/** Reference frame at time t, linearly interpolated (angles and pose). */
export function sampleAt(frames, t) {
  if (t <= frames[0].t) return frames[0]
  const last = frames[frames.length - 1]
  if (t >= last.t) return last
  let lo = 0, hi = frames.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (frames[mid].t <= t) lo = mid
    else hi = mid
  }
  const a = frames[lo], b = frames[hi]
  const k = (t - a.t) / (b.t - a.t)
  const angles = {}
  for (const j of Object.keys(a.angles)) angles[j] = j in b.angles ? a.angles[j] + (b.angles[j] - a.angles[j]) * k : a.angles[j]
  const pose = a.pose && b.pose
    ? a.pose.map((p, i) => [p[0] + (b.pose[i][0] - p[0]) * k, p[1] + (b.pose[i][1] - p[1]) * k, p[2]])
    : a.pose
  return { t, angles, pose }
}

/**
 * Compare the user's pose with the reference within ±window seconds of t.
 * offset > 0: the user matches a later reference moment (early); < 0: late.
 */
export function matchWithTiming(userAngles, frames, t, { mirror = false, joints, weights, window = TIMING_WINDOW, step = 1 / 30 } = {}) {
  let best = null
  for (let d = -window; d <= window + 1e-9; d += step) {
    let ref = sampleAt(frames, t + d).angles
    if (mirror) ref = mirrorAngles(ref)
    const s = scorePose(userAngles, ref, joints, weights)
    // Prefer offsets near 0 on ties so a static pose doesn't read as off-beat.
    if (!best || s.overall > best.overall + 1e-6 || (Math.abs(s.overall - best.overall) <= 1e-6 && Math.abs(d) < Math.abs(best.offset))) {
      best = { ...s, offset: d }
    }
  }
  return best
}

export function timingLabel(offset) {
  if (offset > TIMING_LABEL_THRESHOLD) return 'early'
  if (offset < -TIMING_LABEL_THRESHOLD) return 'late'
  return 'on beat'
}

/** Which count (1–8) the reference is on at time t. */
export function countAt(t, bpm, countStart = 0) {
  const beats = Math.floor(((t - countStart) * bpm) / 60)
  return (((beats % 8) + 8) % 8) + 1
}

/** Accumulates per-frame scores over one loop of a step. */
export class LoopStats {
  constructor() {
    this.samples = []
  }
  add(sample) {
    // sample: { count, joints, overall, offset }
    this.samples.push(sample)
  }
  summary() {
    const n = this.samples.length
    if (!n) return null
    // Each joint is averaged over the frames where it was visible.
    const joints = {}
    for (const j of new Set(this.samples.flatMap((x) => Object.keys(x.joints)))) {
      const seen = this.samples.filter((x) => j in x.joints)
      joints[j] = seen.reduce((s, x) => s + x.joints[j], 0) / seen.length
    }
    const overall = this.samples.reduce((s, x) => s + x.overall, 0) / n
    const offsets = this.samples.map((x) => x.offset).sort((a, b) => a - b)
    const timingOffset = offsets[Math.floor(n / 2)]
    const byCount = {}
    for (const x of this.samples) (byCount[x.count] ??= []).push(x.overall)
    const countAvg = Object.entries(byCount).map(([c, v]) => [Number(c), v.reduce((a, b) => a + b, 0) / v.length])
    const worstCount = countAvg.sort((a, b) => a[1] - b[1])[0]?.[0]
    const weakestJoint = Object.keys(joints).sort((a, b) => joints[a] - joints[b])[0]
    return { overall, joints, timingOffset, worstCount, weakestJoint, passed: overall >= PASS_SCORE }
  }
}
