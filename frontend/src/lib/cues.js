// Spoken coaching while dancing: short encouragement when the dancer matches,
// or one concrete fix for the body part that's furthest off. Phrases are a
// fixed set so the ElevenLabs audio can be generated once and reused.

const CLOSE_ENOUGH = 0.5 // a joint scoring below this gets a fix
const GREAT = 0.8

export const ENCOURAGEMENT = ['Yes! Keep it up!', 'Nice! That looks great!', "You're nailing it!", 'So clean! Keep going!']
export const ALMOST = ["Good! You're so close!", 'Nice energy, keep matching the shape!']

// [phrase when the dancer's angle is too small, phrase when it's too big]
// Angles grow as a joint straightens (elbow, knee), as the arm lifts away from the
// body (shoulder), as the leg swings back (hip), and as the feet go wider (leg spread).
const FIXES = {
  leftElbow: ['Straighten your left arm', 'Bend your left elbow more'],
  rightElbow: ['Straighten your right arm', 'Bend your right elbow more'],
  leftShoulder: ['Lift your left arm higher', 'Bring your left arm down'],
  rightShoulder: ['Lift your right arm higher', 'Bring your right arm down'],
  leftHip: ['Stand up taller', 'Lift your left knee higher'],
  rightHip: ['Stand up taller', 'Lift your right knee higher'],
  leftKnee: ['Straighten your left leg', 'Bend your left knee more'],
  rightKnee: ['Straighten your right leg', 'Bend your right knee more'],
  leftAnkle: ['Point your left foot', 'Flex your left foot'],
  rightAnkle: ['Point your right foot', 'Flex your right foot'],
  legSpread: ['Step your feet wider', 'Bring your feet closer together'],
  // Lean is signed (left/right), so only the size of the gap is known: one honest phrase.
  torsoLean: ['Match the lean of your upper body', 'Match the lean of your upper body'],
}

/** Every phrase pickCue can say, for preloading the audio. */
export const ALL_CUES = [...ENCOURAGEMENT, ...ALMOST, ...new Set(Object.values(FIXES).flat())]

/**
 * Choose what to say about the last few counts.
 * window: { joints: {name: 0–1}, diffs: {name: degrees}, overall: 0–1 } averaged over the window.
 * Returns a phrase, or null to stay quiet. Never repeats lastCue back to back.
 */
export function pickCue({ joints, diffs, overall }, lastCue = null, random = Math.random) {
  const worst = Object.keys(joints).filter((j) => FIXES[j] && j in diffs).sort((a, b) => joints[a] - joints[b])[0]
  if (worst && joints[worst] < CLOSE_ENOUGH) {
    const fix = FIXES[worst][diffs[worst] < 0 ? 0 : 1]
    if (fix !== lastCue) return fix
  }
  const pool = overall >= GREAT ? ENCOURAGEMENT : overall >= 0.6 ? ALMOST : null
  if (!pool) return null
  const options = pool.filter((p) => p !== lastCue)
  return options[Math.floor(random() * options.length)] ?? null
}

/** Average per-frame samples ({ joints, diffs, overall }) into one window for pickCue. */
export function averageWindow(samples) {
  const avg = (key) => {
    const out = {}
    for (const name of new Set(samples.flatMap((s) => Object.keys(s[key])))) {
      const seen = samples.filter((s) => name in s[key])
      out[name] = seen.reduce((sum, s) => sum + s[key][name], 0) / seen.length
    }
    return out
  }
  return {
    joints: avg('joints'),
    diffs: avg('diffs'),
    overall: samples.reduce((sum, s) => sum + s.overall, 0) / (samples.length || 1),
  }
}
