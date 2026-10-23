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
 * Movement-aware phrasing: find transitions near musical count boundaries.
 * Candidate boundaries are spaced on the BPM grid, then shifted toward local
 * changes in pose velocity (a stop, accent, or direction change).
 * Falls back to plain BPM splitting if pose data is unavailable.
 */
export function splitByMotion(frames, bpm, countStart = 0, countsPerStep = 8) {
  if (!frames?.length || !Number.isFinite(bpm) || bpm <= 0) return []
  const duration = frames.at(-1).t
  const base = splitIntoSteps(duration, bpm, countStart, countsPerStep)
  if (base.length < 2 || frames.length < 8) return base
  const stepLength = countsPerStep * 60 / bpm
  const beat = 60 / bpm
  const energy = frames.map((frame, i) => {
    if (!i || !frame.pose || !frames[i - 1].pose) return 0
    const dt = Math.max(0.025, frame.t - frames[i - 1].t)
    const a = frame.pose, b = frames[i - 1].pose
    const joints = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    let total = 0, n = 0
    for (const j of joints) {
      if (!a[j] || !b[j]) continue
      total += Math.hypot(a[j][0] - b[j][0], a[j][1] - b[j][1]) / dt
      n++
    }
    return n ? total / n : 0
  })
  const smooth = energy.map((_, i) => {
    const lo = Math.max(0, i - 2), hi = Math.min(energy.length, i + 3)
    return energy.slice(lo, hi).reduce((a, b) => a + b, 0) / (hi - lo)
  })
  const cuts = [base[0].start]
  for (let i = 1; i < base.length; i++) {
    const nominal = base[i].start
    const window = Math.min(beat * 1.5, stepLength * 0.22)
    let best = nominal, score = -Infinity
    for (let j = 2; j < frames.length - 2; j++) {
      const t = frames[j].t
      if (Math.abs(t - nominal) > window || t <= cuts.at(-1) + stepLength * 0.55) continue
      const before = smooth[j - 2], now = smooth[j], after = smooth[j + 2]
      const pause = Math.max(0, (before + after) / 2 - now)
      const accent = Math.abs(after - before)
      const closeness = 1 - Math.abs(t - nominal) / window
      const candidate = pause * 1.4 + accent * 0.55 + closeness * 0.18
      if (candidate > score) { score = candidate; best = t }
    }
    cuts.push(round(best))
  }
  cuts.push(base.at(-1).end)
  return fromCuts(cuts, base.map(s => s.label), bpm)
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
