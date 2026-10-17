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
