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

/**
 * How many people the video really has: the most seen together in at least a
 * few frames, so a one-frame glitch doesn't add a phantom dancer (and a second
 * dancer who's on screen for a moment still counts). anchor = the clearest frame
 * showing that many people.
 */
export function crowdSize(raw, minFrames = Math.min(8, Math.ceil(raw.length * 0.05))) {
  for (let n = Math.max(0, ...raw.map((f) => f.poses.length)); n > 0; n--) {
    const frames = raw.map((f, i) => [f, i]).filter(([f]) => f.poses.length >= n)
    if (frames.length < Math.max(1, minFrames) && n > 1) continue
    // Prefer frames with exactly n people, so the picture's badges match the buttons.
    const exact = frames.filter(([f]) => f.poses.length === n)
    if (exact.length) frames.splice(0, frames.length, ...exact)
    const clarity = ([f]) => f.poses.reduce((s, pose) => s + pose.reduce((v, p) => v + (p[2] ?? 1), 0), 0)
    const [, anchor] = frames.reduce((best, x) => (clarity(x) > clarity(best) ? x : best))
    return { people: n, anchor }
  }
  return { people: 0, anchor: -1 }
}

/** Same people, ordered left to right as they appear in the video. */
export function sortLeftToRight(poses) {
  return [...poses].sort((a, b) => poseCenter(a)[0] - poseCenter(b)[0])
}

const MAX_JUMP = 0.15 // max hip movement between consecutive frames (fraction of the frame)
const MAX_GAP_JUMP = 0.4 // cap when the dancer has been hidden for a while
const SIZE_WEIGHT = 0.5 // how much a change in body size counts against a match
const LOOK_WEIGHT = 1 // how much different clothing colours count against a match
const LOOK_MAX = 0.3 // colours this different = someone else, even if they're standing in the right spot

/**
 * How different two people look (clothing colours from processVideo's lookOf), 0–1.
 * null when either is unknown (scans saved before colours were recorded).
 */
export function lookDiff(a, b) {
  if (!a || !b) return null
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2
  return Math.sqrt(sum / a.length) / 255
}

/**
 * Follow one dancer through all frames, even while people move around.
 * raw: [{ t, poses: [pose, ...], looks?: [colours, ...] }]; anchor: index of a
 * frame where the dancer is visible; person: which one in that frame, counting left to right.
 *
 * Walks forwards and backwards from the anchor. Each frame it predicts where the
 * dancer should be from their recent speed and direction, then takes the pose
 * that's closest to that prediction, most similar in size and, above all, wearing
 * the same colours as the dancer that was picked. That keeps the right person when
 * dancers cross paths or swap places. Someone in clearly different clothes is never
 * taken, even in the right spot. If the dancer is hidden for a few frames, the search
 * widens until they reappear. Frames where they can't be found are dropped rather
 * than filled with someone else.
 */
export function trackDancer(raw, anchor, person) {
  const order = sortLeftToRight(raw[anchor].poses)
  const start = order[person]
  if (!start) return []
  const startLook = raw[anchor].looks?.[raw[anchor].poses.indexOf(start)] ?? null
  const follow = (indices) => {
    const out = []
    let last = poseCenter(start), lastSize = poseSize(start)
    let look = startLook // drifts slowly with the light, but always checked against the pick too
    let vel = [0, 0], gap = 0
    for (const i of indices) {
      gap++
      const predicted = [last[0] + vel[0] * gap, last[1] + vel[1] * gap]
      const limit = Math.min(MAX_GAP_JUMP, MAX_JUMP * gap)
      let best = null, bestLook = null, bestCost = Infinity
      raw[i].poses.forEach((pose, k) => {
        const [x, y] = poseCenter(pose)
        const dist = Math.hypot(x - predicted[0], y - predicted[1])
        if (dist > limit) return
        const candidate = raw[i].looks?.[k] ?? null
        const diffs = [lookDiff(candidate, look), lookDiff(candidate, startLook)].filter((d) => d !== null)
        const colour = diffs.length ? Math.min(...diffs) : 0
        if (colour > LOOK_MAX) return // different outfit: not our dancer
        const cost = dist + SIZE_WEIGHT * Math.abs(poseSize(pose) - lastSize) + LOOK_WEIGHT * colour
        if (cost < bestCost) { best = pose; bestLook = candidate; bestCost = cost }
      })
      if (!best) continue // hidden or out of frame this time
      const center = poseCenter(best)
      const step = [(center[0] - last[0]) / gap, (center[1] - last[1]) / gap]
      vel = [vel[0] * 0.5 + step[0] * 0.5, vel[1] * 0.5 + step[1] * 0.5]
      out.push({ t: raw[i].t, pose: best })
      last = center
      lastSize = poseSize(best)
      if (bestLook && look) look = look.map((v, c) => v * 0.9 + bestLook[c] * 0.1)
      else look ??= bestLook
      gap = 0
    }
    return out
  }
  const before = follow(range(anchor - 1, -1)).reverse()
  const after = follow(range(anchor + 1, raw.length))
  return [...before, { t: raw[anchor].t, pose: start }, ...after]
}

const SWITCH_JUMP = 0.1 // hips moving further than this between kept frames looks like a different person
const SWITCH_SIZE = 0.3 // or the body suddenly getting 30% bigger/smaller

/**
 * How well trackDancer followed the dancer, so the person uploading can check it.
 * coverage: share of the video (from the dancer's first to last frame) they were found in.
 * suspects: times (seconds) where the track jumped, i.e. it may have switched to someone else.
 */
export function trackReport(raw, tracked) {
  if (!tracked.length) return { coverage: 0, suspects: [] }
  const first = tracked[0].t, last = tracked[tracked.length - 1].t
  const span = raw.filter((f) => f.t >= first && f.t <= last).length
  const suspects = []
  for (let i = 1; i < tracked.length; i++) {
    const a = tracked[i - 1].pose, b = tracked[i].pose
    const [ax, ay] = poseCenter(a), [bx, by] = poseCenter(b)
    const resized = Math.abs(poseSize(b) - poseSize(a)) / (poseSize(a) || 1)
    if (Math.hypot(bx - ax, by - ay) > SWITCH_JUMP || resized > SWITCH_SIZE) {
      const t = tracked[i].t
      if (!suspects.length || t - suspects[suspects.length - 1] > 1) suspects.push(t)
    }
  }
  return { coverage: tracked.length / (span || 1), suspects }
}

/** The tracked pose nearest to time t (frames sorted by t), or null if none within 0.1 s. */
export function poseAt(frames, t) {
  let lo = 0, hi = frames.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (frames[mid].t < t) lo = mid + 1
    else hi = mid
  }
  const near = [frames[lo], frames[lo - 1]].filter(Boolean).sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0]
  return near?.pose && Math.abs(near.t - t) < 0.1 ? near.pose : null
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
