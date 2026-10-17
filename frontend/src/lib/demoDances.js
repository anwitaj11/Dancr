// Keyframed placeholder dances so the app works end to end before the
// reference videos are recorded. Replace them with real recordings via the
// Upload page (tick "built-in") once you have them.
import { mirrorPose } from './angles.js'
import { buildDance } from './dance.js'

const FPS = 30

// 13 points in stored order (see joints.js): nose, shoulders, elbows, wrists, hips, knees, ankles.
// x grows to the image right, which is the dancer's left when they face the camera.
const STAND = [
  [0.5, 0.15], [0.56, 0.28], [0.44, 0.28], [0.58, 0.42], [0.42, 0.42], [0.59, 0.55], [0.41, 0.55],
  [0.54, 0.55], [0.46, 0.55], [0.545, 0.72], [0.455, 0.72], [0.545, 0.9], [0.455, 0.9],
]

const pose = (overrides) => STAND.map((p, i) => [...(overrides[i] ?? p), 1])
const flip = (p) => mirrorPose(p)

const KNEE_BEND = { 9: [0.56, 0.72], 10: [0.44, 0.72], 7: [0.54, 0.57], 8: [0.46, 0.57] }

const DAB_RIGHT = pose({
  0: [0.47, 0.22], // head dips into the right elbow
  4: [0.45, 0.2], 6: [0.56, 0.12], // right arm bent across the face
  3: [0.66, 0.2], 5: [0.75, 0.1], // left arm straight up and out
  ...KNEE_BEND,
})

const WHIP = pose({ 3: [0.62, 0.3], 5: [0.6, 0.18], 4: [0.36, 0.3], 6: [0.3, 0.3], ...KNEE_BEND })
const NAE_NAE = pose({ 0: [0.52, 0.16], 3: [0.62, 0.18], 5: [0.64, 0.06], 4: [0.42, 0.44], 6: [0.44, 0.52], ...KNEE_BEND })
const SWAY = pose({ 0: [0.48, 0.16], 3: [0.6, 0.18], 5: [0.6, 0.06], 4: [0.4, 0.44], 6: [0.42, 0.52] })

const RUN_L = pose({
  9: [0.56, 0.62], 11: [0.57, 0.76], 7: [0.54, 0.56], // left knee up
  3: [0.6, 0.38], 5: [0.56, 0.3], 4: [0.4, 0.42], 6: [0.38, 0.5],
})
const RUN_R = flip(RUN_L)

const JUJU_A = pose({ 3: [0.62, 0.38], 5: [0.6, 0.3], 4: [0.38, 0.38], 6: [0.4, 0.3], ...KNEE_BEND })
const JUJU_B = pose({ 0: [0.53, 0.17], 3: [0.63, 0.34], 5: [0.7, 0.3], 4: [0.4, 0.42], 6: [0.42, 0.5], 9: [0.57, 0.71], 11: [0.6, 0.88] })

/** One keyframe per count, eased in between. */
function fromKeyframes(keys, bpm, repeats = 2) {
  const beat = 60 / bpm
  const seq = Array.from({ length: repeats }, () => keys).flat()
  const frames = []
  const total = seq.length * beat
  for (let i = 0; i <= Math.round(total * FPS); i++) {
    const t = i / FPS
    const k = Math.min(seq.length - 1, Math.floor(t / beat))
    const a = seq[k], b = seq[Math.min(seq.length - 1, k + 1)]
    const phase = t / beat - k
    const e = phase < 0.5 ? 2 * phase * phase : 1 - (-2 * phase + 2) ** 2 / 2
    frames.push({ t: Math.round(t * 1000) / 1000, pose: a.map((p, j) => [round(p[0] + (b[j][0] - p[0]) * e), round(p[1] + (b[j][1] - p[1]) * e), 1]) })
  }
  return frames
}

const round = (v) => Math.round(v * 10000) / 10000
const stand = pose({})

export function demoDances() {
  const make = (name, bpm, keys, difficulty) => ({
    difficulty,
    dance: buildDance({ name, bpm, frames: fromKeyframes(keys, bpm), aspect: 1, source: 'builtin' }),
  })
  return [
    make('Dab', 100, [stand, stand, DAB_RIGHT, DAB_RIGHT, stand, stand, flip(DAB_RIGHT), flip(DAB_RIGHT)], 1),
    make('Whip / Nae Nae', 100, [WHIP, WHIP, stand, WHIP, NAE_NAE, SWAY, NAE_NAE, SWAY], 2),
    make('Juju On That Beat', 96, [JUJU_A, JUJU_B, JUJU_A, flip(JUJU_B), JUJU_A, JUJU_B, stand, stand], 2),
    make('Running Man', 110, [RUN_L, stand, RUN_R, stand, RUN_L, stand, RUN_R, stand], 3),
  ]
}
