/** Split a dance into 8-count steps from its BPM and the time of count 1. */
export function splitIntoSteps(duration, bpm, countStart = 0, countsPerStep = 8) {
  const stepLength = (countsPerStep * 60) / bpm
  const steps = []
  for (let start = countStart, i = 0; start + stepLength / 2 < duration; start += stepLength, i++) {
    steps.push({
      index: i,
      start: round(start),
      end: round(Math.min(start + stepLength, duration)),
      counts: countsPerStep,
      label: `Step ${i + 1}`,
    })
  }
  return steps
}


/**
 * Segment by movement phrases rather than forcing one cut every eight beats.
 * Body-motion troughs, changes in direction and beat alignment determine cuts.
 * Phrases may span 4, 8, 12 or 16 counts depending on movement.
 */
export function splitByMotion(frames, bpm, countStart = 0, countsPerStep = 8) {
  if (!frames?.length || !Number.isFinite(bpm) || bpm <= 0) return []
  const duration = frames.at(-1).t
  const fallback = splitIntoSteps(duration, bpm, countStart, countsPerStep)
  if (frames.length < 12 || !frames.some(f => f.pose?.length >= 13)) return fallback
  const beat = 60 / bpm
  const start = Math.max(0, Math.min(duration, countStart))
  const joints = [1, 2, 3, 4, 5, 6, 9, 10, 11, 12]
  const motion = frames.map((f, i) => {
    if (!i || !f.pose || !frames[i - 1].pose) return 0
    const prev = frames[i - 1]
    const dt = f.t - prev.t
    if (dt <= 0 || dt > 0.35) return 0
    let total = 0, count = 0
    for (const j of joints) {
      const a = f.pose[j], b = prev.pose[j]
      if (!a || !b) continue
      total += Math.hypot(a[0] - b[0], a[1] - b[1]) / dt
      count++
    }
    return count ? total / count : 0
  })
  // Smooth over ~0.15 seconds, independent of scan frame rate.
  const smooth = motion.map((_, i) => {
    let total = 0, n = 0
    for (let j = i; j >= 0 && frames[i].t - frames[j].t <= 0.075; j--) { total += motion[j]; n++ }
    for (let j = i + 1; j < frames.length && frames[j].t - frames[i].t <= 0.075; j++) { total += motion[j]; n++ }
    return total / Math.max(1, n)
  })
  const ordered = [...smooth].sort((a, b) => a - b)
  const median = ordered[Math.floor(ordered.length / 2)] || 0
  const high = ordered[Math.floor(ordered.length * 0.8)] || median
  if (high < 0.015) return fallback

  // Candidate phrase boundaries: meaningful motion dips or sharp transitions.
  const candidates = []
  for (let i = 3; i < frames.length - 3; i++) {
    const t = frames[i].t
    if (t <= start + 2 * beat || t >= duration - 2 * beat) continue
    const left = smooth[Math.max(0, i - 3)]
    const right = smooth[Math.min(smooth.length - 1, i + 3)]
    const here = smooth[i]
    const dip = Math.max(0, (left + right) / 2 - here) / Math.max(0.03, high)
    const transition = Math.abs(left - right) / Math.max(0.03, high)
    const isMinimum = here <= smooth[i - 1] && here <= smooth[i + 1]
    if (!isMinimum && transition < 0.4) continue
    // Prefer half-bar and bar boundaries, but do not require them.
    const beatsFromStart = (t - start) / beat
    const beatDistance = Math.abs(beatsFromStart - Math.round(beatsFromStart))
    const halfBarDistance = Math.abs(beatsFromStart / 4 - Math.round(beatsFromStart / 4))
    const rhythm = 0.18 * (1 - Math.min(1, beatDistance * 2)) +
      0.18 * (1 - Math.min(1, halfBarDistance * 4))
    const score = dip * 1.3 + transition * 0.45 + rhythm
    if (score >= 0.35) candidates.push({ t, score })
  }
  // Suppress multiple nearby candidates from the same transition.
  candidates.sort((a, b) => b.score - a.score)
  const peaks = []
  for (const c of candidates) {
    if (peaks.every(p => Math.abs(p.t - c.t) >= beat * 1.5)) peaks.push(c)
  }
  peaks.sort((a, b) => a.t - b.t)

  const cuts = [start]
  const minLength = Math.max(1, 3.5 * beat)
  const ideal = 8 * beat
  const maxLength = 16 * beat
  while (duration - cuts.at(-1) > maxLength) {
    const prev = cuts.at(-1)
    const eligible = peaks.filter(p => p.t >= prev + minLength && p.t <= Math.min(duration - minLength, prev + maxLength))
    // Strong motion evidence can beat the 8-count default.
    const best = eligible.map(p => ({
      ...p, rank: p.score - 0.42 * Math.abs(p.t - (prev + ideal)) / ideal,
    })).sort((a, b) => b.rank - a.rank)[0]
    const next = best && best.rank > 0.25 ? best.t : Math.min(prev + ideal, duration - minLength)
    if (next <= prev + 0.5) break
    cuts.push(round(next))
  }
  // For the final phrase, use a good transition when it avoids a long section.
  const prev = cuts.at(-1)
  if (duration - prev > ideal * 1.3) {
    const eligible = peaks.filter(p => p.t >= prev + minLength && p.t <= duration - minLength)
    const best = eligible.sort((a, b) => b.score - a.score)[0]
    if (best && best.score > 0.5) cuts.push(round(best.t))
  }
  cuts.push(round(duration))
  return fromCuts(cuts, cuts.slice(0, -1).map((_, i) => `Step ${i + 1}`), bpm)
}

/**
 * Re-chunk steps for the learner: 4 counts (half steps), 8 (as-is) or 16 (pairs).
 * Each chunk remembers which original steps it covers.
 */
export function buildChunks(steps, chunkCounts = 8) {
  if (chunkCounts === 4) {
    return steps.flatMap((s) => {
      const mid = round((s.start + s.end) / 2)
      return [
        { start: s.start, end: mid, counts: s.counts / 2, steps: [s.index], label: `${s.label} · part 1` },
        { start: mid, end: s.end, counts: s.counts / 2, steps: [s.index], label: `${s.label} · part 2` },
      ]
    }).map((c, i) => ({ ...c, index: i }))
  }
  if (chunkCounts === 16) {
    const chunks = []
    for (let i = 0; i < steps.length; i += 2) {
      const pair = steps.slice(i, i + 2)
      chunks.push({
        index: chunks.length,
        start: pair[0].start,
        end: pair[pair.length - 1].end,
        counts: pair.reduce((s, p) => s + p.counts, 0),
        steps: pair.map((p) => p.index),
        label: pair.map((p) => p.label).join(' + '),
      })
    }
    return chunks
  }
  return steps.map((s, i) => ({ ...s, index: i, steps: [s.index] }))
}

function round(v) {
  return Math.round(v * 1000) / 1000
}

// ---------- manual step editing ----------
// Steps are edited as a sorted list of cut times: [start of step 1, start of
// step 2, ..., end of the last step]. Labels are kept per step.

/** Steps → { cuts, labels }. */
export function toCuts(steps) {
  return { cuts: [...steps.map((s) => s.start), steps.at(-1).end], labels: steps.map((s) => s.label) }
}

/** { cuts, labels } → steps, with counts worked out from the tempo. */
export function fromCuts(cuts, labels, bpm) {
  return cuts.slice(0, -1).map((start, i) => ({
    index: i,
    start: round(start),
    end: round(cuts[i + 1]),
    counts: Math.max(1, Math.round(((cuts[i + 1] - start) * bpm) / 60)),
    label: labels[i] || `Step ${i + 1}`,
  }))
}

const MIN_STEP = 0.5 // seconds

/** Add a split at time t, unless it's too close to an existing one or outside the dance. */
export function splitAt(cuts, labels, t) {
  if (t <= cuts[0] + MIN_STEP || t >= cuts.at(-1) - MIN_STEP) return null
  if (cuts.some((c) => Math.abs(c - t) < MIN_STEP)) return null
  const i = cuts.findIndex((c) => c > t) // the step being split is i - 1
  const nextCuts = [...cuts.slice(0, i), round(t), ...cuts.slice(i)]
  const nextLabels = [...labels.slice(0, i), `${labels[i - 1]} (b)`, ...labels.slice(i)]
  return { cuts: nextCuts, labels: renumber(nextLabels) }
}

/** Merge step i with the one after it (removes cut i + 1). */
export function mergeWithNext(cuts, labels, i) {
  if (i < 0 || i >= labels.length - 1) return null
  return {
    cuts: [...cuts.slice(0, i + 1), ...cuts.slice(i + 2)],
    labels: renumber([...labels.slice(0, i + 1), ...labels.slice(i + 2)]),
  }
}

/** Move the boundary between step i - 1 and step i, kept between its neighbours. */
export function moveCut(cuts, i, t) {
  if (i <= 0 || i >= cuts.length - 1) return cuts
  const clamped = Math.min(cuts[i + 1] - MIN_STEP, Math.max(cuts[i - 1] + MIN_STEP, t))
  return cuts.map((c, j) => (j === i ? round(clamped) : c))
}

/** Default "Step N" labels follow position; custom names are kept. */
function renumber(labels) {
  return labels.map((l, i) => (/^Step \d+( \(b\))?$/.test(l) ? `Step ${i + 1}` : l))
}
