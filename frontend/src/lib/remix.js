import { computeAngles } from './angles.js'
import { P } from './joints.js'
import { buildDance } from './dance.js'

export const PRESETS = {
  hype: { emoji: '🔥', label: 'Hype', amplitude: 1.4, speed: 1, sharpness: 0, smoothing: 0, upperBodyOnly: false },
  chill: { emoji: '🐢', label: 'Chill', amplitude: 0.7, speed: 0.5, sharpness: 0, smoothing: 0, upperBodyOnly: false },
  sharp: { emoji: '💥', label: 'Sharp', amplitude: 1, speed: 1, sharpness: 0.8, smoothing: 0, upperBodyOnly: false },
  smooth: { emoji: '🌊', label: 'Smooth', amplitude: 1, speed: 1, sharpness: 0, smoothing: 9, upperBodyOnly: false },
  seated: { emoji: '♿', label: 'Low-impact / Seated', amplitude: 1, speed: 1, sharpness: 0, smoothing: 0, upperBodyOnly: true },
}

const LOWER_BODY = [P.lHip, P.rHip, P.lKnee, P.rKnee, P.lAnkle, P.rAnkle]

/**
 * Remix a dance by transforming its pose sequence, then recomputing angles,
 * so the result can be scored and practiced like any other dance.
 */
export function remixDance(dance, settings, name) {
  const { amplitude = 1, speed = 1, sharpness = 0, smoothing = 0, upperBodyOnly = false } = settings
  // Work in hip-centred coordinates so scaling and freezing don't drift the body around.
  const centers = dance.frames.map((f) => hipCenter(f.pose))
  let rel = dance.frames.map((f, i) => f.pose.map(([x, y, v]) => [x - centers[i][0], y - centers[i][1], v]))
  const meanPose = average(rel)
  const meanCenter = [
    centers.reduce((s, c) => s + c[0], 0) / centers.length,
    centers.reduce((s, c) => s + c[1], 0) / centers.length,
  ]

  if (amplitude !== 1) {
    rel = rel.map((pose) => pose.map((p, j) => lerpPoint(meanPose[j], p, amplitude)))
  }
  if (smoothing > 0) rel = movingAverage(rel, smoothing)
  if (sharpness > 0) rel = snapToCounts(rel, dance, sharpness)

  let outCenters = centers
  if (upperBodyOnly) {
    rel = rel.map((pose) => pose.map((p, j) => (LOWER_BODY.includes(j) ? [...meanPose[j]] : p)))
    outCenters = centers.map(() => meanCenter)
  }

  const frames = rel.map((pose, i) => {
    const abs = pose.map(([x, y, v]) => [round(x + outCenters[i][0]), round(y + outCenters[i][1]), v])
    return { t: round(dance.frames[i].t / speed), pose: abs, angles: computeAngles(abs, dance.aspect ?? 16 / 9) }
  })
  const steps = dance.steps.map((s) => ({ ...s, start: round(s.start / speed), end: round(s.end / speed) }))
  return buildDance({
    name: name ?? `${dance.name} (remix)`,
    bpm: dance.bpm * speed,
    countStart: (dance.countStart ?? 0) / speed,
    fps: dance.fps,
    aspect: dance.aspect,
    frames,
    steps,
    source: 'remix',
  })
}

function hipCenter(pose) {
  return [(pose[P.lHip][0] + pose[P.rHip][0]) / 2, (pose[P.lHip][1] + pose[P.rHip][1]) / 2]
}

function average(poses) {
  return poses[0].map((_, j) => {
    const x = poses.reduce((s, p) => s + p[j][0], 0) / poses.length
    const y = poses.reduce((s, p) => s + p[j][1], 0) / poses.length
    return [x, y, poses[0][j][2]]
  })
}

function lerpPoint(a, b, k) {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, b[2]]
}

function movingAverage(poses, size) {
  const half = Math.floor(size / 2)
  return poses.map((_, i) => average(poses.slice(Math.max(0, i - half), i + half + 1)))
}

/** Hold the pose from each count's start, then snap to the next count's pose quickly. */
function snapToCounts(poses, dance, sharpness) {
  const beat = 60 / dance.bpm
  const start = dance.countStart ?? 0
  const frameAt = (t) => {
    let best = 0
    for (let i = 0; i < dance.frames.length; i++) if (dance.frames[i].t <= t) best = i
    return best
  }
  return poses.map((pose, i) => {
    const t = dance.frames[i].t
    const beatIndex = Math.floor((t - start) / beat)
    const phase = (t - start) / beat - beatIndex
    const from = poses[frameAt(start + beatIndex * beat)]
    const to = poses[frameAt(start + (beatIndex + 1) * beat)]
    const k = phase < sharpness ? 0 : (phase - sharpness) / (1 - sharpness)
    return from.map((p, j) => lerpPoint(p, to[j], k))
  })
}

function round(v) {
  return Math.round(v * 10000) / 10000
}
