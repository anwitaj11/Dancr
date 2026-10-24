/** Split a dance into 8-count steps from its BPM and the time of count 1. */
export function splitIntoSteps(duration, bpm, countStart = 0, countsPerStep = 8) {
  const stepLength = (countsPerStep * 60) / bpm
  const steps = []
  // Include the intro before count 1 so the timeline remains editable from 0s.
  if (countStart > 0.5 && countStart < duration) steps.push({ index: 0, start: 0, end: round(countStart), counts: Math.max(1, Math.round(countStart * bpm / 60)), label: 'Intro' })
  for (let start = Math.max(0, countStart), i = 0; start + stepLength / 2 < duration; start += stepLength, i++) {
    steps.push({
      index: steps.length,
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
  const joints = [1, 2, 3, 4, 5, 6, 9, 10, 11, 12]
  // Body-relative motion removes camera scale and whole-body translation.
  const motion = frames.map((f, i) => {
    if (!i || !f.pose || !frames[i - 1].pose) return null
    const prev = frames[i - 1], dt = f.t - prev.t
    if (dt <= 0 || dt > 0.4) return null
    const hips = p => [(p[9][0] + p[10][0]) / 2, (p[9][1] + p[10][1]) / 2]
    const center = hips(f.pose), before = hips(prev.pose)
    const scale = Math.max(0.08, Math.hypot(f.pose[1][0] - f.pose[2][0], f.pose[1][1] - f.pose[2][1]))
    let sum = 0, n = 0
    for (const j of joints) {
      const p = f.pose[j], q = prev.pose[j]
      if (!p || !q || (p[2] ?? 1) < 0.5 || (q[2] ?? 1) < 0.5) continue
      const distance = Math.hypot((p[0] - center[0]) - (q[0] - before[0]),
        (p[1] - center[1]) - (q[1] - before[1]))
      // Small landmark jitter is not choreography.
      sum += Math.max(0, distance / scale - 0.008) / dt
      n++
    }
    return n >= 4 ? sum / n : null
  })
  const valid = motion.filter(Number.isFinite).sort((a, b) => a - b)
  if (valid.length < 10 || valid[Math.floor(valid.length * 0.8)] < 0.02) return fallback
  const high = Math.max(0.02, valid[Math.floor(valid.length * 0.8)])
  const smooth = frames.map((f, i) => {
    let sum = 0, n = 0
    for (let j = i; j >= 0 && f.t - frames[j].t <= 0.18; j--) {
      if (motion[j] != null) { sum += motion[j]; n++ }
    }
    for (let j = i + 1; j < frames.length && frames[j].t - f.t <= 0.18; j++) {
      if (motion[j] != null) { sum += motion[j]; n++ }
    }
    return n ? sum / n : high
  })
  // Use actual rhythmic boundaries instead of cuts on arbitrary video frames.
  // A 4-count grid offers enough resolution for short phrases.
  const grid = [0]
  for (let k = Math.ceil((0 - countStart) / (4 * beat)); ; k++) {
    const t = countStart + k * 4 * beat
    if (t >= duration - 0.5) break
    if (t > 0.5) grid.push(t)
  }
  grid.push(duration)
  grid.sort((a, b) => a - b)
  const times = grid.filter((t, i) => !i || t - grid[i - 1] > 0.15)
  const quality = times.map((t, idx) => {
    if (idx === 0 || idx === times.length - 1) return 0
    let best = 0, distance = Infinity
    for (let i = 0; i < frames.length; i++) {
      const d = Math.abs(frames[i].t - t)
      if (d < distance) { distance = d; best = i }
    }
    const near = smooth[best]
    const before = smooth[Math.max(0, best - 3)]
    const after = smooth[Math.min(smooth.length - 1, best + 3)]
    const valley = Math.max(0, (before + after) / 2 - near) / high
    const stillness = Math.max(0, 1 - near / high)
    return Math.min(1.5, valley * 0.9 + stillness * 0.65)
  })
  // Global optimization prevents greedy cuts from creating huge or tiny final steps.
  const cost = Array(times.length).fill(Infinity), previous = Array(times.length).fill(-1)
  cost[0] = 0
  for (let i = 1; i < times.length; i++) {
    for (let j = 0; j < i; j++) {
      const length = times[i] - times[j]
      if (length < Math.max(0.5, 3 * beat) && i !== times.length - 1) continue
      if (length > 16 * beat + 0.5) continue
      const counts = length / beat
      const phraseCost = Math.min(...[4, 8, 12, 16].map(c => Math.abs(counts - c) / 4))
      const shortPenalty = counts < 3 ? 2 : 0
      const cutReward = i === times.length - 1 ? 0 : quality[i]
      const candidate = cost[j] + 0.35 + phraseCost * 0.7 + shortPenalty - cutReward * 0.6
      if (candidate < cost[i]) { cost[i] = candidate; previous[i] = j }
    }
  }
  if (previous.at(-1) < 0) return fallback
  const cuts = []
  for (let i = times.length - 1; i >= 0; i = previous[i]) {
    cuts.push(round(times[i]))
    if (i === 0) break
  }
  cuts.reverse()
  if (cuts.length < 2) return fallback
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
