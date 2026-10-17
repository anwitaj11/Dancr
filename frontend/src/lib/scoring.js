import { JOINT_NAMES } from './joints.js'
import { mirrorAngles } from './angles.js'

// Forgiving scoring: small differences from the tutorial still count as a
// full match, and scores are shown as a plain percentage.
export const FULL_CREDIT_ZONE = 20 // degrees off that still earn full credit
export const ZERO_AT = 75 // degrees off where a joint earns nothing
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

/** Scores every joint both the dancer and the tutorial show; hidden joints are skipped, not counted wrong. */
export function scorePose(userAngles, refAngles, joints = JOINT_NAMES) {
  const scores = {}
  for (const j of joints) {
    if (j in userAngles && j in refAngles) scores[j] = jointScore(userAngles[j] - refAngles[j])
  }
  const values = Object.values(scores)
  return { joints: scores, overall: values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0 }
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
export function matchWithTiming(userAngles, frames, t, { mirror = false, joints, window = TIMING_WINDOW, step = 1 / 30 } = {}) {
  let best = null
  for (let d = -window; d <= window + 1e-9; d += step) {
    let ref = sampleAt(frames, t + d).angles
    if (mirror) ref = mirrorAngles(ref)
    const s = scorePose(userAngles, ref, joints)
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
