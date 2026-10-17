import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { api, currentUser } from '../lib/api.js'
import { AngleSmoother, bodyInFrame, computeAngles, mirrorAngles } from '../lib/angles.js'
import { BODY_PARTS, JOINT_NAMES, LABELS, P } from '../lib/joints.js'
import { LoopStats, MotionMeter, PASS_SCORE, colorFor, countAt, jointWeights, matchWithTiming, pct, sampleAt, timingLabel, withMotion } from '../lib/scoring.js'
import { ALL_CUES, averageWindow, pickCue } from '../lib/cues.js'
import { buildChunks } from '../lib/steps.js'
import { click, preloadCounts, preloadLines, say, scheduleCountIn } from '../lib/voice.js'
import { useWebcamPose } from '../hooks/useWebcamPose.js'
import SkeletonPlayer from '../components/SkeletonPlayer.jsx'
import ReferenceVideo from '../components/ReferenceVideo.jsx'
import { drawBodyOverlay } from '../lib/skeleton.js'
import { refreshAngles } from '../lib/dance.js'
import VineRecorder from '../components/VineRecorder.jsx'
import SpeedPicker, { formatSpeed, nearestSpeed } from '../components/SpeedPicker.jsx'
import RailButton from '../components/RailButton.jsx'
import { isCalibrated } from './Calibrate.jsx'
import { useCoachContext, useCoachSummary } from '../lib/coachContext.jsx'
import { APP_NAME, Headline, Polaroid, Win } from '../components/Retro.jsx'

const COUNT_IN_BEATS = 4
const PART_ICONS = { arms: '💪', torso: '🧍', legs: '🦵' }
const LEVELS = ['Beginner', 'Beginner', 'Intermediate', 'Advanced']
const SEGMENT_COLORS = ['pink', 'cyan', 'yellow', 'pink', 'cyan', 'yellow']
const fmtTime = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const SKELETON_KEY = 'dablab.skeleton'
const PREVIEW_KEY = 'dablab.preview'

/** Watch the step once before dancing it (on unless turned off). */
function loadPreviewPref() {
  try {
    return localStorage.getItem(PREVIEW_KEY) !== 'off'
  } catch {
    return true
  }
}

function savePreviewPref(on) {
  try {
    localStorage.setItem(PREVIEW_KEY, on ? 'on' : 'off')
  } catch {
    // storage blocked: the choice lasts for this visit only
  }
}

/** Remembered on/off settings (music, spoken cues); on unless turned off. */
function loadFlag(key) {
  try {
    return localStorage.getItem(key) !== 'off'
  } catch {
    return true
  }
}

function saveFlag(key, on) {
  try {
    localStorage.setItem(key, on ? 'on' : 'off')
  } catch {
    // storage blocked: the choice lasts for this visit only
  }
}

/** Swap left/right weight names for mirror mode (weights are sizes, so nothing is negated). */
function mirrorWeights(weights) {
  return Object.fromEntries(Object.entries(weights).map(([j, w]) => [
    j.startsWith('left') ? j.replace('left', 'right') : j.startsWith('right') ? j.replace('right', 'left') : j, w,
  ]))
}

// Skeleton overlay: whole body (default), only the limbs that are wrong, or none.
const SKELETON_MODES = ['full', 'mistakes', 'off']
const SKELETON_LABELS = { full: 'FULL BODY', mistakes: 'MISTAKES', off: 'OFF' }

function loadSkeletonPref() {
  try {
    const saved = localStorage.getItem(SKELETON_KEY)
    return SKELETON_MODES.includes(saved) ? saved : 'full'
  } catch {
    return 'full'
  }
}

function saveSkeletonPref(mode) {
  try {
    localStorage.setItem(SKELETON_KEY, mode)
  } catch {
    // storage blocked: the choice lasts for this visit only
  }
}

function partScores(joints) {
  const out = {}
  for (const [part, members] of Object.entries(BODY_PARTS)) {
    const vals = members.filter((j) => j in joints).map((j) => joints[j])
    if (vals.length) out[part] = vals.reduce((a, b) => a + b, 0) / vals.length
  }
  return out
}

function ScoreRing({ value }) {
  const r = 26, c = 2 * Math.PI * r
  return (
    <div className="score-ring" style={{ '--ring': colorFor(value) }}>
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r={r} className="track" />
        <circle cx="32" cy="32" r={r} className="fill" strokeDasharray={`${value * c} ${c}`} />
      </svg>
      <span>{Math.round(value * 100)}</span>
    </div>
  )
}

export default function Practice() {
  const { id } = useParams()
  const user = currentUser()
  const [dance, setDance] = useState(null)
  const [profile, setProfile] = useState(null)
  const [chunkCounts, setChunkCounts] = useState(8)
  const [chunkIdx, setChunkIdx] = useState(0)
  const [passed, setPassed] = useState(() => new Set()) // steps completed this session
  const [speed, setSpeed] = useState(1)
  const [mirror, setMirror] = useState(true)
  const [musicOn, setMusicOn] = useState(() => loadFlag('dablab.music'))
  const [cuesOn, setCuesOn] = useState(() => loadFlag('dablab.cues'))
  const [ducked, setDucked] = useState(false) // music quieter while a spoken line plays
  const [drillOn, setDrillOn] = useState(false)
  const [skeletonMode, setSkeletonMode] = useState(loadSkeletonPref)
  const [previewFirst, setPreviewFirst] = useState(loadPreviewPref)
  const [hasVideo, setHasVideo] = useState(false)
  const [difficulty, setDifficulty] = useState(1)
  const [phase, setPhase] = useState('idle') // idle | countin | dancing | results
  const [countIn, setCountIn] = useState(null)
  const [live, setLive] = useState(null)
  const [outOfFrame, setOutOfFrame] = useState(false)
  const [crowd, setCrowd] = useState(0) // people in the webcam view
  const [result, setResult] = useState(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [tip, setTip] = useState(null)
  const voiceCoach = useCoachContext()
  const [celebrate, setCelebrate] = useState(null) // 'dance' when the whole dance is done

  const canvasRef = useRef(null)
  const progressRef = useRef(null)
  const timeRef = useRef(null)
  const clock = useRef({ phase: 'idle', t0: 0 })
  const smoother = useRef(new AngleSmoother(4))
  const stats = useRef(new LoopStats())
  const lastCount = useRef(null)
  const cropX = useRef(null)
  const tries = useRef({})
  const timers = useRef([])
  const motion = useRef(new MotionMeter())
  const cueSamples = useRef([])
  const lastCue = useRef(null)
  const speaking = useRef(false)
  const lastCueBeat = useRef(0)

  useEffect(() => {
    api.getDance(id).then((d) => { setDance(refreshAngles(d.data)); setHasVideo(d.hasVideo); setDifficulty(d.difficulty) })
    // Count-in first (needed soonest), then the spoken cues, all in the ElevenLabs voice.
    preloadCounts().then(() => preloadLines(['Step complete!', 'You nailed it!', ...ALL_CUES]))
    api.getProfile(user).then((p) => {
      setProfile(p)
      setChunkCounts(p.adaptations.chunkCounts)
      setSpeed(nearestSpeed(p.adaptations.speed))
    }).catch(() => {})
    return () => timers.current.forEach(clearTimeout)
  }, [id, user])

  const chunks = useMemo(() => (dance ? buildChunks(dance.steps, chunkCounts) : []), [dance, chunkCounts])
  // Video with several people: mark the one this lesson follows.
  const dancerMarker = useMemo(() => (dance?.dancer ? {
    frames: dance.frames, color: dance.dancer.color, label: `COPY DANCER ${dance.dancer.number}`,
  } : undefined), [dance])
  const chunk = chunks[chunkIdx]
  const adapt = profile?.adaptations
  // Joints that move in this step count most; mirrored to match the mirrored tutorial.
  const weights = useMemo(() => {
    if (!dance || !chunk) return null
    const w = jointWeights(dance.frames, chunk.start, chunk.end)
    return mirror ? mirrorWeights(w) : w
  }, [dance, chunk, mirror])
  const drill = adapt?.drill
  const scoredJoints = drillOn && drill ? BODY_PARTS[drill.part] : JOINT_NAMES
  const loud = adapt?.rhythmMode
  const busy = phase === 'dancing' || phase === 'countin' || phase === 'preview'

  const refTime = useCallback(() => {
    const c = clock.current
    if (!chunk) return 0
    // The clock runs while watching the preview and while dancing.
    if (c.phase !== 'dancing' && c.phase !== 'preview') return chunk.start
    return chunk.start + ((performance.now() - c.t0) / 1000) * speed
  }, [chunk, speed])

  const later = (fn, ms) => timers.current.push(setTimeout(fn, ms))

  function setClockPhase(p) {
    clock.current.phase = p
    setPhase(p)
  }

  function stop() {
    timers.current.forEach(clearTimeout)
    timers.current = []
    setCountIn(null)
    setClockPhase('idle')
  }

  /** Say a line in the ElevenLabs voice, ducking the music underneath it. */
  function speak(text) {
    if (speaking.current || voiceCoach?.voiceActive) return // never talk over ourselves or the voice coach
    speaking.current = true
    setDucked(true)
    say(text).finally(() => {
      speaking.current = false
      setDucked(false)
    })
  }

  /** Every half bar while dancing: one fix for the worst body part, or some encouragement. */
  function maybeCue() {
    const samples = cueSamples.current
    cueSamples.current = []
    if (!cuesOn || samples.length < 3) return
    const cue = pickCue(averageWindow(samples), lastCue.current)
    if (!cue) return
    lastCue.current = cue
    speak(cue)
  }

  function beginCountIn() {
    setClockPhase('countin')
    const beatMs = (60 / (dance.bpm * speed)) * 1000
    // Audio is scheduled on the audio clock; the screen and the dance clock follow
    // the same start time, so the numbers, the voice and the music line up.
    const firstBeat = scheduleCountIn(beatMs, { loud })
    clock.current.t0 = firstBeat + COUNT_IN_BEATS * beatMs // dancing starts exactly one bar later
    const tick = () => {
      if (clock.current.phase !== 'countin') return
      const beat = Math.floor((performance.now() - firstBeat) / beatMs)
      if (beat >= COUNT_IN_BEATS) {
        setCountIn(null)
        setClockPhase('dancing')
        return
      }
      setCountIn(beat >= 0 ? 5 + beat : null)
      requestAnimationFrame(tick)
    }
    tick()
  }

  /** Watch-first preview (unless turned off), then the count-in, then dance. */
  function start({ withPreview = previewFirst } = {}) {
    if (!chunk) return
    // The last loop's results stay available until this loop finishes.
    setCelebrate(null)
    setSheetOpen(false)
    stats.current = new LoopStats()
    motion.current.reset()
    cueSamples.current = []
    lastCueBeat.current = 0
    smoother.current.reset()
    lastCount.current = null
    if (withPreview) {
      clock.current.t0 = performance.now()
      setClockPhase('preview')
      later(beginCountIn, ((chunk.end - chunk.start) / speed) * 1000)
    } else {
      beginCountIn()
    }
  }

  function skipPreview() {
    timers.current.forEach(clearTimeout)
    timers.current = []
    beginCountIn()
  }

  function pickChunk(i) {
    setChunkIdx(i)
    setResult(null)
    setSheetOpen(false)
    setCelebrate(null)
  }

  async function finishLoop() {
    setClockPhase('results')
    const summary = stats.current.summary()
    if (!summary) return
    const key = `${chunkCounts}:${chunkIdx}`
    tries.current[key] = (tries.current[key] ?? 0) + 1
    setResult(summary)
    setTip(null)

    // Never move on (or retry) by itself: the results popup asks what to do next.
    const lastStep = chunkIdx === chunks.length - 1
    if (summary.passed) {
      setPassed((prev) => new Set(prev).add(chunkIdx))
      speak(lastStep ? 'You nailed it!' : 'Step complete!')
    }
    if (summary.passed && lastStep) setCelebrate('dance')
    else setSheetOpen(true)

    const attempt = {
      user, dance_id: Number(id), step_index: chunk.steps[0], overall: summary.overall,
      joint_scores: summary.joints, timing_offset: summary.timingOffset, speed,
      attempt_count: tries.current[key], time_spent: (chunk.end - chunk.start) / speed, passed: summary.passed,
    }
    api.saveAttempt(attempt).then(setProfile).catch(() => {})

    if (!summary.passed) {
      const context = {
        score: summary.overall, weakestJoint: summary.weakestJoint,
        timingOffset: summary.timingOffset, worstCount: summary.worstCount,
      }
      try {
        const { tip: text } = await api.coachTip(user, context)
        setTip(text)
        speak(text)
      } catch {
        setTip(null)
      }
    }
  }

  const { videoRef, status, error } = useWebcamPose(({ pose, people, video }) => {
    const canvas = canvasRef.current
    if (!canvas || !dance || !chunk) return
    setCrowd(people)
    const vw = video.videoWidth, vh = video.videoHeight
    // Crop the webcam to the panel's shape (portrait side-by-side on desktop,
    // stacked on phones), following the dancer's hips so they stay centred.
    const box = canvas.getBoundingClientRect()
    const panelAspect = Math.min(16 / 9, Math.max(0.5, box.width / box.height || 3 / 4))
    const cropW = Math.min(vw, vh * panelAspect), cropH = cropW / panelAspect
    if (canvas.width !== Math.round(cropW) || canvas.height !== Math.round(cropH)) {
      canvas.width = Math.round(cropW)
      canvas.height = Math.round(cropH)
    }
    if (pose) {
      const hipX = ((pose[P.lHip][0] + pose[P.rHip][0]) / 2) * vw
      cropX.current = cropX.current == null ? hipX : cropX.current * 0.9 + hipX * 0.1
    }
    const center = cropX.current ?? vw / 2
    const sx = Math.max(0, Math.min(vw - cropW, center - cropW / 2))
    const sy = (vh - cropH) / 2

    const ctx = canvas.getContext('2d')
    ctx.save()
    ctx.translate(canvas.width, 0)
    ctx.scale(-1, 1) // selfie view
    ctx.drawImage(video, sx, sy, cropW, cropH, 0, 0, canvas.width, canvas.height)
    ctx.restore()

    const dancing = clock.current.phase === 'dancing'
    if (pose) {
      setOutOfFrame(!bodyInFrame(pose).ok)
      const angles = smoother.current.push(computeAngles(pose, vw / vh))
      const t = refTime()
      const match = matchWithTiming(angles, dance.frames, t, { mirror, joints: scoredJoints, weights })
      // Standing still while the tutorial dances scores low, however good the pose.
      let score = match.overall
      if (dancing) {
        const refNow = sampleAt(dance.frames, t).angles
        motion.current.add(performance.now() / 1000, angles, mirror ? mirrorAngles(refNow) : refNow)
        score = withMotion(match.overall, motion.current.ratio())
      }
      if (skeletonMode !== 'off') {
        // Same selfie flip and crop as the video, so limbs line up with the body.
        const kx = canvas.width / cropW, ky = canvas.height / cropH
        ctx.save()
        ctx.translate(canvas.width, 0)
        ctx.scale(-1, 1)
        drawBodyOverlay(ctx, pose, match.joints, ([x, y]) => [(x * vw - sx) * kx, (y * vh - sy) * ky],
          { mode: skeletonMode, width: Math.max(8, canvas.height / 45) })
        ctx.restore()
      }
      if (dancing) {
        const count = countAt(t, dance.bpm, dance.countStart)
        stats.current.add({ count, joints: match.joints, overall: score, offset: match.offset })
        cueSamples.current.push({ joints: match.joints, diffs: match.diffs, overall: score })
        setLive({ overall: score, offset: match.offset, count, parts: partScores(match.joints) })
      }
      // Burn the score into the frame so it shows up in Vine recordings.
      ctx.font = `900 ${Math.round(canvas.height / 14)}px 'DM Sans', system-ui`
      const label = pct(score)
      ctx.fillStyle = colorFor(score)
      ctx.strokeStyle = '#1d1030'
      ctx.lineWidth = Math.max(3, canvas.height / 160)
      const x = (canvas.width - ctx.measureText(label).width) / 2, y = canvas.height * 0.17
      ctx.strokeText(label, x, y)
      ctx.fillText(label, x, y)
    } else {
      setOutOfFrame(true)
    }
    ctx.font = `700 ${Math.round(canvas.height / 22)}px Caveat, cursive`
    ctx.fillStyle = '#ffffffdd'
    ctx.fillText(APP_NAME, canvas.width - ctx.measureText(APP_NAME).width - 14, canvas.height - 56) // clear of the score ring

    if (clock.current.phase === 'preview' || dancing) {
      const t = refTime()
      if (progressRef.current) {
        progressRef.current.style.width = `${Math.min(100, ((t - chunk.start) / (chunk.end - chunk.start)) * 100)}%`
      }
      if (timeRef.current) {
        timeRef.current.textContent = `${fmtTime(Math.max(0, t - chunk.start))} / ${fmtTime(chunk.end - chunk.start)}`
      }
    }
    if (dancing) {
      const t = refTime()
      const count = countAt(t, dance.bpm, dance.countStart)
      if (count !== lastCount.current) {
        lastCount.current = count
        // With the song playing, the music is the beat; clicks only in rhythm mode.
        if (!(hasVideo && musicOn) || loud) click({ accent: count === 1, loud })
      }
      // A spoken cue every half bar (4 beats), even if a slow frame skips a count.
      const beat = Math.floor(((t - chunk.start) * dance.bpm) / 60)
      if (beat - lastCueBeat.current >= 4) {
        lastCueBeat.current = beat
        maybeCue()
      }
      if (t >= chunk.end) finishLoop()
    }
  })

  // What the Dancr Coach voice agent is told: only things Dancr actually measured.
  useCoachSummary(dance && chunk ? [
    `The dancer (@${user}) is practicing "${dance.name}" (${Math.round(dance.bpm)} BPM),`,
    `${chunk.label} of ${chunks.length}, at ${speed}x speed${mirror ? ', mirrored' : ''}.`,
    result
      ? `Their last try on this step scored ${pct(result.overall)} (${PASS_SCORE * 100}% completes a step); weakest joint: ${LABELS[result.weakestJoint]};`
        + ` lowest-scoring count: ${result.worstCount}; timing: ${timingLabel(result.timingOffset)}.`
        + ` Body parts: ${Object.entries(partScores(result.joints)).map(([p, v]) => `${p} ${pct(v)}`).join(', ')}.`
      : 'They have not finished a try on this step yet.',
    profile?.patterns?.length ? `Learning patterns Dancr noticed: ${profile.patterns.map((p) => `${p.label} (${p.detail})`).join('; ')}.` : '',
    tip ? `Dancr's last written tip: "${tip}"` : '',
  ].filter(Boolean).join(' ') : '')

  if (!isCalibrated()) return <Navigate to={`/calibrate?next=/practice/${id}`} replace />
  if (!dance) return <div className="page-loading"><div className="spinner" /></div>

  const patterns = profile?.patterns ?? []
  const ringValue = live?.overall ?? result?.overall ?? 0
  const totalTime = dance.frames.at(-1).t
  const levelName = LEVELS[difficulty] ?? 'Advanced'

  // Cheat-sheet pointers come from this dancer's real data when we have it.
  const pointers = []
  if (result?.weakestJoint) pointers.push(`Watch your ${LABELS[result.weakestJoint]}: it scored lowest last try`)
  if (result && timingLabel(result.timingOffset) !== 'on beat') pointers.push(`You were a little ${timingLabel(result.timingOffset)}, lock in on count 1`)
  if (drill) pointers.push(`Drill mode can focus scoring on your ${drill.part}`)
  for (const fallback of ['Start in your ready pose, full body in frame', 'Follow the tutorial’s arms with your eyes', 'Hit the beat on count 1']) {
    if (pointers.length < 3) pointers.push(fallback)
  }

  return (
    <section className="practice-page grid-bg sunny">
      <div className="ticker-strip">
        <span>{APP_NAME.toUpperCase()} VIDEO TUTORIAL NETWORK™</span>
        <span>★ {chunks.length} {chunks.length === 1 ? 'STEP' : 'STEPS'} ★ {Math.round(dance.bpm)} BPM ★ @{user.toUpperCase()} IS PRACTICING</span>
      </div>

      <div className="practice-head">
        <div>
          <Link to="/" className="now-watching">◀ BACK // ▶ NOW WATCHING // YOUR TUTORIAL IS READY</Link>
          <Headline lines={[[dance.name.toUpperCase()]]} size="lg" />
          <span className="tag tag-pink">{chunks.length} {chunks.length === 1 ? 'STEP' : 'STEPS'} · {levelName.toUpperCase()} · {fmtTime(totalTime)}</span>
        </div>
        {profile?.badge && <span className="badge-pill">{profile.badge.emoji} {profile.badge.label} ♡</span>}
      </div>

      {(patterns.length > 0 || adapt?.suggestBreak) && (
        <div className="pattern-chips">
          {patterns.map((p) => <span key={p.id} className="tag tag-white">{p.emoji} {p.label}</span>)}
          {adapt?.suggestBreak && <span className="tag tag-white">📉 Take a short break</span>}
        </div>
      )}

      <div className="practice-grid">
        <div className="player-col">
          <Win title={`DANCR_PLAYER_v4.16 · ${chunk?.label ?? ''}`} extra={<span className="win-res">LIVE ●</span>} className="player-win">
            <div className="duet">
              <div className="duet-half tutorial">
                {hasVideo ? (
                  <ReferenceVideo src={api.videoUrl(id)} getTime={refTime} offset={dance.videoOffset ?? 0}
                    speed={speed} playing={phase === 'dancing' || phase === 'preview'} mirror={mirror}
                    muted={!musicOn} volume={ducked ? 0.25 : 0.9} className="fill" dancer={dancerMarker} />
                ) : (
                  <SkeletonPlayer dance={dance} getTime={refTime} mirror={mirror} width={360} height={480}
                    color="#ff3ea5" highlight={drillOn ? drill?.joint : undefined} className="fill" />
                )}
                <span className="step-flag">STEP {chunkIdx + 1}</span>
                {hasVideo && (
                  <Link to={`/dancer/${id}`} className="dancer-flag" title="Choose which person in the video to learn from"
                    style={dance.dancer ? { background: dance.dancer.color } : undefined}>
                    {dance.dancer ? `👤 DANCER ${dance.dancer.number} · change` : '👥 choose dancer'}
                  </Link>
                )}
                <span className="half-note">watch the arms! ↖</span>
              </div>

              <div className="duet-half you">
                <video ref={videoRef} playsInline muted className="hidden-video" />
                <canvas ref={canvasRef} className="fill" />
                <span className="half-tag">@{user}</span>
                <button className={`skeleton-toggle ${skeletonMode !== 'off' ? 'on' : ''}`}
                  title="Tap to switch: full body, only mistakes, or off"
                  onClick={() => setSkeletonMode((m) => {
                    const next = SKELETON_MODES[(SKELETON_MODES.indexOf(m) + 1) % SKELETON_MODES.length]
                    saveSkeletonPref(next)
                    return next
                  })}>
                  🦴 Skeleton: {SKELETON_LABELS[skeletonMode]}
                </button>
                {phase === 'dancing' && live && (
                  <>
                    <ScoreRing value={ringValue} />
                    <span className={`beat-count ${loud ? 'loud' : ''}`}>{live.count}</span>
                    <span className={`timing-tag ${timingLabel(live.offset).replace(' ', '-')}`}>{timingLabel(live.offset)}</span>
                    <div className="part-pills">
                      {Object.entries(live.parts).map(([part, v]) => (
                        <span key={part} className="part-pill" style={{ '--c': colorFor(v) }}>{PART_ICONS[part]} {part}</span>
                      ))}
                    </div>
                  </>
                )}
                {phase === 'preview' && (
                  <div className="preview-banner">
                    <span className="preview-eyes">👀</span>
                    <b>WATCH FIRST</b>
                    <span>{chunk?.label}: copy along on the left, then it's your turn</span>
                    <button type="button" className="btn-bracket small-btn" onClick={skipPreview}>[ SKIP ⏭ ]</button>
                  </div>
                )}
                {countIn && <div className="countin" key={countIn}>{countIn}</div>}
                {crowd > 1 && <div className="crowd-note">👥 {crowd} people in view: scoring whoever is closest</div>}
                {outOfFrame && phase !== 'idle' && <div className="frame-warn">Step back so your whole body is in the frame</div>}
                {status === 'starting' && <div className="cam-status"><div className="spinner" /> Starting camera…</div>}
                {error && <div className="cam-status warn">{error}</div>}
              </div>
            </div>

            <div className="player-controls">
              <button className={`round-btn play ${busy ? 'live' : ''}`} onClick={busy ? stop : () => start()} disabled={!chunk}
                aria-label={busy ? 'Stop' : 'Start dancing'}>{busy ? '■' : '▶'}</button>
              <div className="scrub"><span className="scrub-fill" ref={progressRef} /></div>
              <span className="scrub-time" ref={timeRef}>00:00 / {fmtTime(chunk ? chunk.end - chunk.start : 0)}</span>
              <span aria-hidden="true">♫</span>
            </div>
            <div className="control-rail">
              <SpeedPicker speed={speed} onChange={setSpeed} disabled={busy} />
              <RailButton icon="👀" label="Preview" active={previewFirst}
                onClick={() => setPreviewFirst((on) => { savePreviewPref(!on); return !on })} />
              <RailButton icon="🪞" label="Mirror" active={mirror} onClick={() => setMirror((m) => !m)} />
              {hasVideo && (
                <RailButton icon={musicOn ? '🔊' : '🔇'} label="Music" active={musicOn}
                  onClick={() => setMusicOn((on) => { saveFlag('dablab.music', !on); return !on })} />
              )}
              <RailButton icon="🗣️" label="Voice cues" active={cuesOn}
                onClick={() => setCuesOn((on) => { saveFlag('dablab.cues', !on); return !on })} />
              {drill && <RailButton icon="🎯" label={`Drill ${drill.part}`} active={drillOn} onClick={() => setDrillOn((d) => !d)} />}
              <RailButton icon={<span className="speed-icon">{chunkCounts}</span>} label="Counts" disabled={busy}
                onClick={() => { setChunkCounts((c) => (c === 4 ? 8 : c === 8 ? 16 : 4)); pickChunk(0); setPassed(new Set()) }} />
              <VineRecorder canvasRef={canvasRef} name={dance.name.toLowerCase().replace(/\W+/g, '-')} />
            </div>
            <div className="segments">
              {chunks.map((c, i) => (
                <button key={i} className={`segment seg-${SEGMENT_COLORS[i % SEGMENT_COLORS.length]} ${i === chunkIdx ? 'on' : ''}`}
                  disabled={busy} onClick={() => pickChunk(i)}>
                  {passed.has(i) ? '✓ ' : ''}{c.label.toUpperCase()}
                </button>
              ))}
            </div>
          </Win>

          <div className="step-polaroids">
            {chunks.map((c, i) => (
              <button key={i} className="polaroid-btn" disabled={busy} onClick={() => pickChunk(i)}>
                <Polaroid caption={c.label.toLowerCase()} badge={i + 1} tilt={i % 2 ? 1.5 : -1.5} active={i === chunkIdx}>
                  {hasVideo ? (
                    <video src={`${api.videoUrl(id)}#t=${(c.start + (dance.videoOffset ?? 0)).toFixed(2)}`} muted playsInline preload="auto" className="fill cover" />
                  ) : (
                    <SkeletonPlayer dance={dance} start={c.start} end={c.end} width={160} height={160} color="#ff3ea5" glow={6} lineWidth={5} className="fill" />
                  )}
                  {passed.has(i) && <span className="done-mark">✓</span>}
                </Polaroid>
                {i === chunkIdx && <span className="here-sticker">you're here!</span>}
              </button>
            ))}
          </div>
        </div>

        <Win title="CHEAT_SHEET.txt — NOTEPAD" color="purple" controls={false} className="notepad">
          <span className="script pink">pssst... the details ↓</span>
          <h2 className="notepad-title">the choreo cheat sheet</h2>
          <hr />
          <span className="tag tag-lilac">STEP {chunkIdx + 1} OF {chunks.length}</span>
          <h3 className="notepad-step">{chunk?.label.toLowerCase()}</h3>
          <p className="notepad-text">
            {tip ?? `Watch the tutorial, then hit practice. Score ${PASS_SCORE * 100}% or more to complete the step, or jump to any step you like. Your coach will chime in if you get stuck.`}
          </p>
          {result && (
            <div className="last-try" onClick={() => setSheetOpen(true)}>
              <ScoreRing value={result.overall} />
              <div><b>last try: {pct(result.overall)}</b><span>{result.passed ? 'step complete!' : 'tap for details'}</span></div>
            </div>
          )}
          <hr />
          <ol className="pointers">
            {pointers.slice(0, 3).map((t, i) => <li key={i}><span>{String(i + 1).padStart(2, '0')}</span>{t}</li>)}
          </ol>
          <button className="btn-teal wide" onClick={busy ? stop : () => start()} disabled={!chunk}>
            {busy ? 'stop ■' : phase === 'results' ? 'practice it again →' : 'practice this move →'}
          </button>
          <span className="script pink center">you've totally got this ♡</span>
          <Link to={`/steps/${id}`} className="edit-steps-link">✂ split the steps differently</Link>
          {hasVideo && <Link to={`/dancer/${id}`} className="edit-steps-link">👥 choose a different dancer</Link>}
        </Win>
      </div>

      {result && sheetOpen && (
        <div className="sheet-backdrop" onClick={() => setSheetOpen(false)}>
          <Win title="RESULTS.txt" color="pink" className="sheet" extra={
            <button className="win-close" onClick={() => setSheetOpen(false)} aria-label="Close">×</button>} controls={false}>
            <div onClick={(e) => e.stopPropagation()}>
              <div className="sheet-head">
                <ScoreRing value={result.overall} />
                <div>
                  <h2>{result.passed ? `${pct(result.overall)} 🔥` : pct(result.overall)}</h2>
                  <p className="muted">
                    {result.passed ? 'Step complete!' : `${PASS_SCORE * 100}% completes this step`} · {timingLabel(result.timingOffset)}
                    {' '}({result.timingOffset >= 0 ? '+' : ''}{result.timingOffset.toFixed(2)}s)
                  </p>
                </div>
              </div>
              {tip && <p className="coach-bubble"><span>🎙️</span>{tip}</p>}
              <div className="joint-grid">
                {Object.entries(result.joints).map(([j, s]) => (
                  <div key={j} className="joint-row">
                    <span>{LABELS[j]}</span>
                    <div className="bar"><div style={{ width: `${s * 100}%`, background: colorFor(s) }} /></div>
                    <b>{Math.round(s * 100)}</b>
                  </div>
                ))}
              </div>
              {chunkIdx < chunks.length - 1 && (
                <p className="move-on-question">
                  {result.passed ? `Do you wanna move on to ${chunks[chunkIdx + 1].label}?` : `Practice more, or move on to ${chunks[chunkIdx + 1].label} anyway?`}
                </p>
              )}
              <div className="row center">
                <button className="btn-teal" onClick={() => start()}>↺ try again</button>
                {chunkIdx < chunks.length - 1 && (
                  <button className="btn-pink" onClick={() => pickChunk(chunkIdx + 1)}>
                    {result.passed ? 'YES, MOVE ON →' : 'MOVE ON ANYWAY →'}
                  </button>
                )}
                {chunkIdx === chunks.length - 1 && !result.passed && (
                  <button className="btn-bracket" onClick={() => setSheetOpen(false)}>[ CLOSE ]</button>
                )}
              </div>
            </div>
          </Win>
        </div>
      )}

      {celebrate && (
        <div className="celebrate dots" onClick={() => setCelebrate(null)}>
          <div className="burst" aria-hidden="true">{'🔥💯👌✨🔥💯👌✨'.match(/\p{Extended_Pictographic}/gu).map((e, i) => <span key={i} style={{ '--i': i }}>{e}</span>)}</div>
          <Headline lines={[['DANCE'], ['COMPLETE!', 'yellow']]} size="lg" as="h2" />
          <p className="script big">you learned the whole thing. iconic.</p>
          <div className="row center" onClick={(e) => e.stopPropagation()}>
            <button className="btn-teal" onClick={() => { setCelebrate(null); start() }}>↺ dance it again</button>
            <Link className="btn-pink" to="/profile">SEE MY PROGRESS →</Link>
            <Link className="btn-bracket" to={`/remix/${id}`}>[ REMIX IT ]</Link>
          </div>
        </div>
      )}
    </section>
  )
}
