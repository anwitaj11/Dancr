import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { api, currentUser } from '../lib/api.js'
import { AngleSmoother, bodyInFrame, computeAngles } from '../lib/angles.js'
import { BODY_PARTS, JOINT_NAMES, LABELS, P } from '../lib/joints.js'
import { LoopStats, PASS_SCORE, colorFor, countAt, matchWithTiming, timingLabel } from '../lib/scoring.js'
import { buildChunks } from '../lib/steps.js'
import { click, say } from '../lib/voice.js'
import { useWebcamPose } from '../hooks/useWebcamPose.js'
import SkeletonPlayer from '../components/SkeletonPlayer.jsx'
import ReferenceVideo from '../components/ReferenceVideo.jsx'
import { drawMistakeLimbs } from '../lib/skeleton.js'
import VineRecorder from '../components/VineRecorder.jsx'
import SpeedPicker, { formatSpeed, nearestSpeed } from '../components/SpeedPicker.jsx'
import RailButton from '../components/RailButton.jsx'
import { isCalibrated } from './Calibrate.jsx'

const COUNT_IN_BEATS = 4
const PART_ICONS = { arms: '💪', torso: '🧍', legs: '🦵' }
const SKELETON_KEY = 'dablab.skeleton'

function loadSkeletonPref() {
  try {
    return localStorage.getItem(SKELETON_KEY) !== 'off'
  } catch {
    return true
  }
}

function saveSkeletonPref(on) {
  try {
    localStorage.setItem(SKELETON_KEY, on ? 'on' : 'off')
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
  const navigate = useNavigate()
  const user = currentUser()
  const [dance, setDance] = useState(null)
  const [profile, setProfile] = useState(null)
  const [chunkCounts, setChunkCounts] = useState(8)
  const [chunkIdx, setChunkIdx] = useState(0)
  const [unlocked, setUnlocked] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [mirror, setMirror] = useState(true)
  const [loop, setLoop] = useState(true)
  const [drillOn, setDrillOn] = useState(false)
  const [skeletonOn, setSkeletonOn] = useState(loadSkeletonPref)
  const [hasVideo, setHasVideo] = useState(false)
  const [phase, setPhase] = useState('idle') // idle | countin | dancing | results
  const [countIn, setCountIn] = useState(null)
  const [live, setLive] = useState(null)
  const [outOfFrame, setOutOfFrame] = useState(false)
  const [result, setResult] = useState(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [tip, setTip] = useState(null)
  const [celebrate, setCelebrate] = useState(null) // step | dance

  const canvasRef = useRef(null)
  const progressRef = useRef(null)
  const clock = useRef({ phase: 'idle', t0: 0 })
  const smoother = useRef(new AngleSmoother(4))
  const stats = useRef(new LoopStats())
  const lastCount = useRef(null)
  const cropX = useRef(null)
  const tries = useRef({})
  const timers = useRef([])

  useEffect(() => {
    api.getDance(id).then((d) => { setDance(d.data); setHasVideo(d.hasVideo) })
    api.getProfile(user).then((p) => {
      setProfile(p)
      setChunkCounts(p.adaptations.chunkCounts)
      setSpeed(nearestSpeed(p.adaptations.speed))
    }).catch(() => {})
    return () => timers.current.forEach(clearTimeout)
  }, [id, user])

  const chunks = useMemo(() => (dance ? buildChunks(dance.steps, chunkCounts) : []), [dance, chunkCounts])
  const chunk = chunks[chunkIdx]
  const adapt = profile?.adaptations
  const drill = adapt?.drill
  const scoredJoints = drillOn && drill ? BODY_PARTS[drill.part] : JOINT_NAMES
  const loud = adapt?.rhythmMode
  const busy = phase === 'dancing' || phase === 'countin'

  const refTime = useCallback(() => {
    const c = clock.current
    if (!chunk) return 0
    if (c.phase !== 'dancing') return chunk.start
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

  function start() {
    if (!chunk) return
    // The last loop's results stay available until this loop finishes.
    setCelebrate(null)
    setSheetOpen(false)
    stats.current = new LoopStats()
    smoother.current.reset()
    lastCount.current = null
    setClockPhase('countin')
    const beatMs = (60 / (dance.bpm * speed)) * 1000
    say('5, 6, 7, 8!', { volume: loud ? 1 : 0.8 })
    for (let i = 0; i < COUNT_IN_BEATS; i++) {
      later(() => { setCountIn(5 + i); click({ accent: i === 0, loud }) }, i * beatMs)
    }
    later(() => {
      setCountIn(null)
      clock.current.t0 = performance.now()
      setClockPhase('dancing')
    }, COUNT_IN_BEATS * beatMs)
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

    if (summary.passed) {
      const last = chunkIdx === chunks.length - 1
      setUnlocked((u) => Math.max(u, chunkIdx + 1))
      setCelebrate(last ? 'dance' : 'step')
      say(last ? 'You nailed it!' : 'Step complete!')
    } else {
      setSheetOpen(true)
    }

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
        say(text)
      } catch {
        setTip(null)
      }
      if (loop) later(start, 4000)
    }
  }

  const { videoRef, status, error } = useWebcamPose(({ pose, video }) => {
    const canvas = canvasRef.current
    if (!canvas || !dance || !chunk) return
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
      const match = matchWithTiming(angles, dance.frames, t, { mirror, joints: scoredJoints })
      if (skeletonOn) {
        // Same selfie flip and crop as the video, so limbs line up with the body.
        const kx = canvas.width / cropW, ky = canvas.height / cropH
        ctx.save()
        ctx.translate(canvas.width, 0)
        ctx.scale(-1, 1)
        drawMistakeLimbs(ctx, pose, match.joints, ([x, y]) => [(x * vw - sx) * kx, (y * vh - sy) * ky],
          { width: Math.max(8, canvas.height / 45) })
        ctx.restore()
      }
      if (dancing) {
        const count = countAt(t, dance.bpm, dance.countStart)
        stats.current.add({ count, joints: match.joints, overall: match.overall, offset: match.offset })
        setLive({ overall: match.overall, offset: match.offset, count, parts: partScores(match.joints) })
      }
      // Burn the score into the frame so it shows up in Vine recordings.
      ctx.font = `800 ${Math.round(canvas.height / 14)}px Montserrat, system-ui`
      ctx.fillStyle = colorFor(match.overall)
      ctx.fillText(`${Math.round(match.overall * 100)}%`, 16, canvas.height - 20)
    } else {
      setOutOfFrame(true)
    }
    ctx.font = `italic ${Math.round(canvas.height / 26)}px "Grand Hotel", cursive`
    ctx.fillStyle = '#ffffffcc'
    ctx.fillText('Dab Lab', canvas.width - ctx.measureText('Dab Lab').width - 14, 32)

    if (dancing) {
      const t = refTime()
      if (progressRef.current) {
        progressRef.current.style.width = `${Math.min(100, ((t - chunk.start) / (chunk.end - chunk.start)) * 100)}%`
      }
      const count = countAt(t, dance.bpm, dance.countStart)
      if (count !== lastCount.current) {
        lastCount.current = count
        click({ accent: count === 1, loud })
      }
      if (t >= chunk.end) finishLoop()
    }
  })

  if (!isCalibrated()) return <Navigate to={`/calibrate?next=/practice/${id}`} replace />
  if (!dance) return <div className="duet-loading"><div className="spinner" /></div>

  const patterns = profile?.patterns ?? []
  const ringValue = live?.overall ?? result?.overall ?? 0

  return (
    <section className="duet-screen">
      {/* Story-style progress: one segment per step */}
      <div className="story-bars">
        {chunks.map((c, i) => (
          <button key={i} className="story-seg" disabled={i > unlocked || busy} onClick={() => pickChunk(i)}
            aria-label={`${c.label}${i > unlocked ? ' (locked)' : ''}`}>
            <span className="seg-fill" ref={i === chunkIdx ? progressRef : undefined}
              style={{ width: i < unlocked ? '100%' : i === chunkIdx ? undefined : '0%' }} />
          </button>
        ))}
      </div>

      <header className="duet-top">
        <button className="icon-btn" onClick={() => navigate('/')} aria-label="Back to library">✕</button>
        <div className="duet-title">
          <b>{dance.name}</b>
          <span className="marquee"><span>♫ {chunk?.label} · {Math.round(dance.bpm)} BPM · {formatSpeed(speed)} · {chunks.length} steps · ♫ {dance.name}</span></span>
        </div>
        <span className="step-chip">{chunkIdx + 1}/{chunks.length}</span>
      </header>

      {(patterns.length > 0 || adapt?.suggestBreak) && (
        <div className="pattern-chips">
          {patterns.map((p) => <span key={p.id} className="glass-chip">{p.emoji} {p.label}</span>)}
          {adapt?.suggestBreak && <span className="glass-chip">📉 Take a short break</span>}
        </div>
      )}

      <div className="duet">
        <div className="duet-half tutorial">
          {hasVideo ? (
            <ReferenceVideo src={api.videoUrl(id)} getTime={refTime} offset={dance.videoOffset ?? 0}
              speed={speed} playing={phase === 'dancing'} mirror={mirror} className="fill" />
          ) : (
            <SkeletonPlayer dance={dance} getTime={refTime} mirror={mirror} width={360} height={480}
              highlight={drillOn ? drill?.joint : undefined} className="fill" />
          )}
          <span className="half-tag">Tutorial{mirror ? ' · mirrored' : ''}</span>
        </div>

        <div className="duet-half you">
          <video ref={videoRef} playsInline muted className="hidden-video" />
          <canvas ref={canvasRef} className="fill" />
          <span className="half-tag">@{user}</span>
          <button className={`skeleton-toggle ${skeletonOn ? 'on' : ''}`} aria-pressed={skeletonOn}
            title="Show limbs that don't match the tutorial"
            onClick={() => setSkeletonOn((on) => { saveSkeletonPref(!on); return !on })}>
            🦴 Skeleton: {skeletonOn ? 'ON' : 'OFF'}
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
          {countIn && <div className="countin" key={countIn}>{countIn}</div>}
          {outOfFrame && phase !== 'idle' && <div className="frame-warn">Step back so your whole body is in the frame</div>}
          {status === 'starting' && <div className="cam-status"><div className="spinner" /> Starting camera…</div>}
          {error && <div className="cam-status warn">{error}</div>}
        </div>

        <div className="rail">
          <SpeedPicker speed={speed} onChange={setSpeed} disabled={busy} />
          <RailButton icon="🪞" label="Mirror" active={mirror} onClick={() => setMirror((m) => !m)} />
          <RailButton icon="🔁" label="Loop" active={loop} onClick={() => setLoop((l) => !l)} />
          {drill && <RailButton icon="🎯" label={`Drill ${drill.part}`} active={drillOn} onClick={() => setDrillOn((d) => !d)} />}
          <RailButton icon={<span className="speed-icon">{chunkCounts}</span>} label="Counts" disabled={busy}
            onClick={() => { setChunkCounts((c) => (c === 4 ? 8 : c === 8 ? 16 : 4)); pickChunk(0); setUnlocked(0) }} />
          <VineRecorder canvasRef={canvasRef} name={dance.name.toLowerCase().replace(/\W+/g, '-')} />
        </div>
      </div>

      <footer className="duet-bottom">
        <div className="caption">
          <b>@{user}</b> learning <b>{dance.name}</b> {result && <button className="link" onClick={() => setSheetOpen(true)}>· last try {Math.round(result.overall * 100)}%</button>}
        </div>
        <button className={`record-btn ${busy ? 'live' : ''}`} onClick={busy ? stop : start} disabled={!chunk}
          aria-label={busy ? 'Stop' : 'Start dancing'}>
          <span />
        </button>
        <div className="hint">{busy ? 'Tap to stop' : phase === 'results' ? 'Tap to go again' : 'Tap to dance'}</div>
      </footer>

      {result && sheetOpen && (
        <div className="sheet-backdrop" onClick={() => setSheetOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-head">
              <ScoreRing value={result.overall} />
              <div>
                <h2>{result.passed ? 'Passed! 🔥' : 'So close!'}</h2>
                <p className="muted">
                  {result.passed ? 'Next step unlocked.' : `${PASS_SCORE * 100}% unlocks the next step`} · {timingLabel(result.timingOffset)}
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
            <div className="row center">
              <button className="btn" onClick={start}>Try again</button>
              {result.passed && chunkIdx < chunks.length - 1 && (
                <button className="btn ghost" onClick={() => pickChunk(chunkIdx + 1)}>Next step →</button>
              )}
            </div>
            {loop && !result.passed && <p className="muted small center">Looping automatically…</p>}
          </div>
        </div>
      )}

      {celebrate && (
        <div className="celebrate" onClick={() => setCelebrate(null)}>
          <div className="burst" aria-hidden="true">{'🔥💯👌✨🔥💯👌✨'.match(/\p{Extended_Pictographic}/gu).map((e, i) => <span key={i} style={{ '--i': i }}>{e}</span>)}</div>
          <h1>{celebrate === 'dance' ? 'Dance complete' : 'Step complete'}</h1>
          <p>{celebrate === 'dance' ? 'You learned the whole thing. Iconic.' : 'On to the next one!'}</p>
          <div className="row center" onClick={(e) => e.stopPropagation()}>
            {celebrate === 'step' && chunkIdx < chunks.length - 1 && (
              <button className="btn" onClick={() => pickChunk(chunkIdx + 1)}>Next step →</button>
            )}
            {celebrate === 'dance' && <Link className="btn" to="/profile">See your progress</Link>}
            {celebrate === 'dance' && <Link className="btn ghost" to={`/remix/${id}`}>Remix it</Link>}
          </div>
        </div>
      )}
    </section>
  )
}
