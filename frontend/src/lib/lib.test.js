import { describe, expect, it } from 'vitest'
import { angle, computeAngles, isTPose, mirrorAngles, AngleSmoother } from './angles.js'
import { buildChunks, fromCuts, mergeWithNext, moveCut, splitAt, splitIntoSteps, toCuts } from './steps.js'
import { LoopStats, countAt, jointScore, matchWithTiming, ratingFor, sampleAt, scorePose } from './scoring.js'
import { demoDances } from './demoDances.js'
import { PRESETS, remixDance } from './remix.js'
import { JOINT_NAMES, P } from './joints.js'

describe('angles', () => {
  it('measures the angle at the middle point', () => {
    expect(angle([1, 0], [0, 0], [0, 1])).toBeCloseTo(90)
    expect(angle([-1, 0], [0, 0], [1, 0])).toBeCloseTo(180)
  })

  it('corrects for video aspect ratio', () => {
    // A right angle on a 16:9 frame looks skewed in normalized coords.
    const pose = Array.from({ length: 13 }, () => [0.5, 0.5, 1])
    pose[P.lShoulder] = [0.5, 0.3, 1]
    pose[P.lElbow] = [0.5, 0.5, 1]
    pose[P.lWrist] = [0.5 + 0.2 * (9 / 16), 0.5, 1]
    expect(computeAngles(pose, 16 / 9).leftElbow).toBeCloseTo(90, 0)
  })

  it('mirrors left and right', () => {
    expect(mirrorAngles({ leftKnee: 10, rightKnee: 20 })).toEqual({ rightKnee: 10, leftKnee: 20 })
  })

  it('detects a T-pose', () => {
    expect(isTPose({ leftShoulder: 92, rightShoulder: 85, leftElbow: 175, rightElbow: 170 })).toBe(true)
    expect(isTPose({ leftShoulder: 20, rightShoulder: 85, leftElbow: 175, rightElbow: 170 })).toBe(false)
  })

  it('smooths over the last frames', () => {
    const s = new AngleSmoother(2)
    s.push({ leftKnee: 100 })
    expect(s.push({ leftKnee: 120 }).leftKnee).toBe(110)
    expect(s.push({ leftKnee: 140 }).leftKnee).toBe(130)
  })
})

describe('scoring', () => {
  it('gives full credit within 20° and falls to 0 at 75°', () => {
    expect(jointScore(0)).toBe(1)
    expect(jointScore(-20)).toBe(1)
    expect(jointScore(47.5)).toBeCloseTo(0.5)
    expect(jointScore(-90)).toBe(0)
  })

  it('maps scores to rating tiers', () => {
    expect(ratingFor(0.9).label).toBe('PERFECT')
    expect(ratingFor(0.72).label).toBe('SUPER')
    expect(ratingFor(0.5).label).toBe('GOOD')
    expect(ratingFor(0.3).label).toBe('OK')
    expect(ratingFor(0.1).label).toBe('KEEP GOING')
  })

  it('averages joint scores', () => {
    const ref = Object.fromEntries(JOINT_NAMES.map((j) => [j, 90]))
    const user = { ...ref, leftKnee: 165 }
    expect(scorePose(user, ref).overall).toBeCloseTo(7 / 8)
    expect(scorePose({ ...ref, leftKnee: 105 }, ref).overall).toBe(1)
  })

  it('counts 1–8 from BPM', () => {
    expect(countAt(0, 120)).toBe(1)
    expect(countAt(0.5, 120)).toBe(2)
    expect(countAt(4.0, 120)).toBe(1)
  })

  const { dance } = demoDances()[0]

  it('interpolates reference frames', () => {
    const f = sampleAt(dance.frames, 1 / 60)
    expect(f.pose).toHaveLength(13)
  })

  it('labels a lagging dancer as late', () => {
    const t = 1.0 // mid-move from standing into the dab
    const userAngles = sampleAt(dance.frames, t - 0.3).angles
    const m = matchWithTiming(userAngles, dance.frames, t)
    expect(m.offset).toBeLessThan(-0.15)
    expect(m.overall).toBeGreaterThan(0.95)
  })

  it('summarizes a loop', () => {
    const stats = new LoopStats()
    stats.add({ count: 1, joints: { leftKnee: 1, rightKnee: 0.8 }, overall: 0.9, offset: 0 })
    stats.add({ count: 2, joints: { leftKnee: 0.6, rightKnee: 0.6 }, overall: 0.6, offset: -0.2 })
    const s = stats.summary()
    expect(s.overall).toBeCloseTo(0.75)
    expect(s.worstCount).toBe(2)
    expect(s.weakestJoint).toBe('rightKnee')
    expect(s.passed).toBe(true) // 75% is SUPER, which completes a step
  })
})

describe('steps', () => {
  it('splits into 8-count steps', () => {
    const steps = splitIntoSteps(10, 120, 1)
    expect(steps.map((s) => [s.start, s.end])).toEqual([[1, 5], [5, 9]])
  })

  it('re-chunks for slow and fast learners', () => {
    const steps = splitIntoSteps(16, 120)
    expect(buildChunks(steps, 4)).toHaveLength(8)
    expect(buildChunks(steps, 16)).toHaveLength(2)
    expect(buildChunks(steps, 16)[1].steps).toEqual([2, 3])
  })
})

describe('remix', () => {
  const { dance } = demoDances()[0]

  it('chill halves the speed', () => {
    const r = remixDance(dance, PRESETS.chill)
    expect(r.frames.at(-1).t).toBeCloseTo(dance.frames.at(-1).t * 2, 1)
    expect(r.bpm).toBe(dance.bpm / 2)
  })

  it('seated freezes the legs', () => {
    const r = remixDance(dance, PRESETS.seated)
    const knees = new Set(r.frames.map((f) => f.angles.leftKnee))
    expect(knees.size).toBe(1)
  })

  it('every preset keeps a playable dance', () => {
    for (const p of Object.values(PRESETS)) {
      const r = remixDance(dance, p)
      expect(r.frames).toHaveLength(dance.frames.length)
      expect(r.steps).toHaveLength(dance.steps.length)
      expect(Object.values(r.frames[10].angles).every(Number.isFinite)).toBe(true)
    }
  })
})

describe('manual step editing', () => {
  const steps = splitIntoSteps(16, 120) // 4 steps of 4s
  const { cuts, labels } = toCuts(steps)

  it('round-trips steps through cuts', () => {
    expect(cuts).toEqual([0, 4, 8, 12, 16])
    expect(fromCuts(cuts, labels, 120)).toEqual(steps)
  })

  it('splits a step and renumbers default labels', () => {
    const r = splitAt(cuts, labels, 2)
    expect(r.cuts).toEqual([0, 2, 4, 8, 12, 16])
    expect(r.labels).toEqual(['Step 1', 'Step 2', 'Step 3', 'Step 4', 'Step 5'])
    expect(fromCuts(r.cuts, r.labels, 120)[0].counts).toBe(4)
    expect(splitAt(cuts, labels, 4.1)).toBeNull() // too close to an existing cut
  })

  it('merges steps and keeps custom names', () => {
    const r = mergeWithNext(cuts, ['Intro', 'Step 2', 'Step 3', 'Step 4'], 1)
    expect(r.cuts).toEqual([0, 4, 12, 16])
    expect(r.labels).toEqual(['Intro', 'Step 2', 'Step 3'])
    expect(mergeWithNext(cuts, labels, 3)).toBeNull()
  })

  it('moves a boundary but never past its neighbours', () => {
    expect(moveCut(cuts, 1, 5)).toEqual([0, 5, 8, 12, 16])
    expect(moveCut(cuts, 1, 100)).toEqual([0, 7.5, 8, 12, 16])
    expect(moveCut(cuts, 0, 3)).toBe(cuts)
  })
})
