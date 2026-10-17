import { P } from './joints.js'

// Videos (and webcams) can have more than one person in them. These helpers
// pick and follow one dancer so frames from different people never mix.

/** Hip centre of a stored pose, in normalized video coordinates. */
export function poseCenter(pose) {
  return [(pose[P.lHip][0] + pose[P.rHip][0]) / 2, (pose[P.lHip][1] + pose[P.rHip][1]) / 2]
}

/** Rough body size: height of the bounding box (bigger = closer to the camera). */
export function poseSize(pose) {
  const ys = pose.map((p) => p[1])
  return Math.max(...ys) - Math.min(...ys)
}

/** The person closest to the camera. */
export function pickLargest(poses) {
  return poses.reduce((best, p) => (poseSize(p) > poseSize(best) ? p : best), poses[0])
}

const TORSO = [P.lShoulder, P.rShoulder, P.lHip, P.rHip]
const SAME_PERSON = 0.05 // torso points closer than this on average (fraction of the frame) = one body

/** How confident the model is about a pose: total visibility of its points. */
function confidence(pose) {
  return pose.reduce((s, p) => s + (p[2] ?? 1), 0)
}

/**
 * The pose model sometimes finds the same body two or three times (slightly
 * shifted copies). Keep one pose per body: the most confident one.
 */
export function dedupePoses(poses) {
  const kept = []
  for (const pose of [...poses].sort((a, b) => confidence(b) - confidence(a))) {
    const duplicate = kept.some((k) => {
      const d = TORSO.reduce((s, i) => s + Math.hypot(pose[i][0] - k[i][0], pose[i][1] - k[i][1]), 0) / TORSO.length
      return d < SAME_PERSON
    })
    if (!duplicate) kept.push(pose)
  }
  return kept
}

/** Same people, ordered left to right as they appear in the video. */
export function sortLeftToRight(poses) {
  return [...poses].sort((a, b) => poseCenter(a)[0] - poseCenter(b)[0])
}

const MAX_JUMP = 0.15 // max hip movement between consecutive frames (fraction of the frame)
const MAX_GAP_JUMP = 0.4 // cap when the dancer has been hidden for a while
const SIZE_WEIGHT = 0.5 // how much a change in body size counts against a match

/**
 * Follow one dancer through all frames, even while people move around.
 * raw: [{ t, poses: [pose, ...] }]; anchor: index of a frame where the dancer is visible;
 * person: which one in that frame, counting left to right.
 *
 * Walks forwards and backwards from the anchor. Each frame it predicts where the
 * dancer should be from their recent speed and direction, then takes the pose
 * closest to that prediction and most similar in size. That keeps the right person
 * when two dancers cross paths. If the dancer is hidden for a few frames (someone
 * walks in front), the search widens until they reappear. Frames where they can't
 * be found are dropped rather than filled with someone else.
 */
export function trackDancer(raw, anchor, person) {
  const start = sortLeftToRight(raw[anchor].poses)[person]
  if (!start) return []
  const follow = (indices) => {
    const out = []
    let last = poseCenter(start), lastSize = poseSize(start)
    let vel = [0, 0], gap = 0
    for (const i of indices) {
      gap++
      const predicted = [last[0] + vel[0] * gap, last[1] + vel[1] * gap]
      const limit = Math.min(MAX_GAP_JUMP, MAX_JUMP * gap)
      let best = null, bestCost = Infinity
      for (const pose of raw[i].poses) {
        const [x, y] = poseCenter(pose)
        const dist = Math.hypot(x - predicted[0], y - predicted[1])
        if (dist > limit) continue
        const cost = dist + SIZE_WEIGHT * Math.abs(poseSize(pose) - lastSize)
        if (cost < bestCost) { best = pose; bestCost = cost }
      }
      if (!best) continue // hidden or out of frame this time
      const center = poseCenter(best)
      const step = [(center[0] - last[0]) / gap, (center[1] - last[1]) / gap]
      vel = [vel[0] * 0.5 + step[0] * 0.5, vel[1] * 0.5 + step[1] * 0.5]
      out.push({ t: raw[i].t, pose: best })
      last = center
      lastSize = poseSize(best)
      gap = 0
    }
    return out
  }
  const before = follow(range(anchor - 1, -1)).reverse()
  const after = follow(range(anchor + 1, raw.length))
  return [...before, { t: raw[anchor].t, pose: start }, ...after]
}

/** Shift times so the dance starts at 0; returns how much was trimmed. */
export function rebase(frames) {
  const t0 = frames[0]?.t ?? 0
  return { frames: frames.map((f) => ({ ...f, t: Math.round((f.t - t0) * 1000) / 1000 })), trimmed: t0 }
}

function range(from, to) {
  const step = from <= to ? 1 : -1
  const out = []
  for (let i = from; i !== to; i += step) out.push(i)
  return out
}
