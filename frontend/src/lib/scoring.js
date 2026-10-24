import { JOINT_NAMES } from './joints.js'
import { mirrorAngles } from './angles.js'

// Forgiving scoring: small differences from the tutorial still count as a
// full match, and scores are shown as a plain percentage.
export const FULL_CREDIT_ZONE = 8 // degrees off that still earn full credit
export const ZERO_AT = 45 // degrees off where a joint earns nothing
export const PASS_SCORE = 0.75 // 70%+ completes a step
export const TIMING_WINDOW = 0.2 // seconds, each side
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
  let sum = 0, total = 0, expected = 0
  for (const j of joints) {
    expected += weights?.[j] ?? 1
  }
  for (const j of joints) {
    if (j in userAngles && j in refAngles) {
      diffs[j] = userAngles[j] - refAngles[j]
      scores[j] = jointScore(diffs[j])
      const w = weights?.[j] ?? 1
      sum += scores[j] * w
      total += w
    }
  }
  // Missing/occluded joints cannot silently produce a near-perfect score.
  const coverage = expected ? total / expected : 0
  return { joints: scores, diffs, overall: total ? (sum / total) * Math.min(1, coverage / 0.7) : 0 }
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
const FULL_MOTION = 0.9

export class MotionMeter {
  constructor(windowSec = 2) {
    this.windowSec = windowSec
    this.samples = []
  }
  add(t, userAngles, refAngles) {
    this.samples.push({ t, user: userAngles, ref: refAngles })
    while (this.samples.length && this.samples[0].t < t - this.windowSec) this.samples.shift()
  }
  /**
   * How far the dancer's and the tutorial's joints travelled, counting only joints
   * the camera saw on both frames: a joint that's out of view (feet, often) must not
   * count as "not moving".
   */
  travel() {
    let user = 0, ref = 0, aligned = 0, observed = 0
    for (let i = 1; i < this.samples.length; i++) {
      const a = this.samples[i - 1], b = this.samples[i]
      for (const j of Object.keys(b.user)) {
        if (!(j in a.user) || !(j in a.ref) || !(j in b.ref)) continue
        const du = b.user[j] - a.user[j]
        const dr = b.ref[j] - a.ref[j]
        const u = Math.max(0, Math.abs(du) - 1.5)
        const r = Math.max(0, Math.abs(dr) - 1.5)
        user += u
        ref += r
        observed++
        // Moving equally far in the opposite direction is not a match.
        if (du * dr > 0) aligned += Math.min(u, r)
      }
    }
    return { user, ref, aligned, observed }
  }
  /** Score both movement amount AND direction relative to the reference. */
  ratio() {
    if (this.samples.length < 3) return 0.5 // not enough evidence for full credit
    const { user, ref, aligned } = this.travel()
    if (ref < 35) return 1 // reference pose is held; pose accuracy still applies
    const amount = Math.min(1, user / (ref * FULL_MOTION))
    const direction = Math.min(1, aligned / Math.max(1, ref * 0.65))
    // Directional agreement matters; vigorous unrelated motion cannot score full.
    return amount * (0.2 + 0.8 * direction)
  }
  reset() {
    this.samples = []
  }
}

/** Final score for a moment: pose match, scaled down when the dancer isn't moving like the tutorial. */
export function withMotion(poseScore, motionRatio) {
  return poseScore * (0.1 + 0.9 * motionRatio)
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
    // A tiny improvement at a distant frame is often pose noise, not actual timing.
    // Regularize toward the current beat, and keep the reported pose score honest.
    const rank = s.overall - 0.06 * Math.abs(d) / Math.max(window, 0.01)
    if (!best || rank > best.rank + 1e-6 || (Math.abs(rank - best.rank) <= 1e-6 && Math.abs(d) < Math.abs(best.offset))) {
      best = { ...s, offset: d, rank }
    }
  }
  if (!best) return { overall: 0, joints: {}, diffs: {}, offset: 0 }
  const { rank, ...result } = best
  return result
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
    // sample: { count, joints, overall, offset, shape?, motion? }
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
    // The score is pose match × movement: keep both so the dancer can see which one held it back.
    const avg = (key) => this.samples.reduce((s, x) => s + (x[key] ?? x.overall), 0) / n
    const shape = avg('shape')
    const motion = this.samples.some((x) => x.motion !== undefined) ? avg('motion') : 1
    return { overall, shape, motion, joints, timingOffset, worstCount, weakestJoint, passed: overall >= PASS_SCORE }
  }
}
