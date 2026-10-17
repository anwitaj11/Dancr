import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { api, currentUser } from '../lib/api.js'
import { AngleSmoother, bodyInFrame, computeAngles } from '../lib/angles.js'
import { BODY_PARTS, JOINT_NAMES, LABELS } from '../lib/joints.js'
import { LoopStats, PASS_SCORE, colorFor, countAt, matchWithTiming, timingLabel } from '../lib/scoring.js'
import { drawSkeleton } from '../lib/skeleton.js'
import { buildChunks } from '../lib/steps.js'
import { click, say } from '../lib/voice.js'
import { useWebcamPose } from '../hooks/useWebcamPose.js'
import SkeletonPlayer from '../components/SkeletonPlayer.jsx'
import VineRecorder from '../components/VineRecorder.jsx'
import { isCalibrated } from './Calibrate.jsx'

const SPEEDS = [0.5, 0.75, 1]
const COUNT_IN_BEATS = 4

export default function Practice() {
  const { id } = useParams()
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
  const [phase, setPhase] = useState('idle') // idle | countin | dancing | results
  const [countIn, setCountIn] = useState(null)
  const [live, setLive] = useState(null)
  const [outOfFrame, setOutOfFrame] = useState(false)
  const [result, setResult] = useState(null)
  const [tip, setTip] = useState(null)
  const [celebrate, setCelebrate] = useState(null) // step | dance

  const canvasRef = useRef(null)
  const clock = useRef({ phase: 'idle', t0: 0 })
  const smoother = useRef(new AngleSmoother(4))
  const stats = useRef(new LoopStats())
  const lastCount = useRef(null)
  const tries = useRef({})
  const timers = useRef([])

  useEffect(() => {
    api.getDance(id).then((d) => setDance(d.data))
    api.getProfile(user).then((p) => {
      setProfile(p)
      setChunkCounts(p.adaptations.chunkCounts)
      setSpeed(p.adaptations.speed)
    }).catch(() => {})
    return () => timers.current.forEach(clearTimeout)
  }, [id, user])

  const chunks = useMemo(() => (dance ? buildChunks(dance.steps, chunkCounts) : []), [dance, chunkCounts])
  const chunk = chunks[chunkIdx]
  const adapt = profile?.adaptations
  const drill = adapt?.drill
  const scoredJoints = drillOn && drill ? BODY_PARTS[drill.part] : JOINT_NAMES
  const loud = adapt?.rhythmMode

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

  function start() {
    if (!chunk) return
    // The last loop's results and tip stay up until this loop finishes.
    setCelebrate(null)
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

  async function finishLoop() {
    setClockPhase('results')
    const summary = stats.current.summary()
    if (!summary) return
    const key = `${chunkCounts}:${chunkIdx}`
    tries.current[key] = (tries.current[key] ?? 0) + 1
    setResult(summary)

    if (summary.passed) {
      const last = chunkIdx === chunks.length - 1
      setUnlocked((u) => Math.max(u, chunkIdx + 1))
      setCelebrate(last ? 'dance' : 'step')
      say(last ? 'You nailed it!' : 'Step complete!')
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
      if (loop) later(start, 3500)
    }
  }

  const { videoRef, status, error } = useWebcamPose(({ pose, video }) => {
    const canvas = canvasRef.current
    if (!canvas || !dance || !chunk) return
    if (canvas.width !== video.videoWidth) {
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
    }
    const ctx = canvas.getContext('2d')
    // Selfie view: flip the video and the user's skeleton together.
    ctx.save()
    ctx.translate(canvas.width, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    const dancing = clock.current.phase === 'dancing'
    let match = null
    if (pose) {
      setOutOfFrame(!bodyInFrame(pose).ok)
      const angles = smoother.current.push(computeAngles(pose, video.videoWidth / video.videoHeight))
      const t = refTime()
      match = matchWithTiming(angles, dance.frames, t, { mirror, joints: scoredJoints })
      const colors = Object.fromEntries(Object.entries(match.joints).map(([j, s]) => [j, colorFor(s)]))
      drawSkeleton(ctx, pose, { colors, lineWidth: 8, highlight: drillOn ? drill?.joint : undefined })
      if (dancing) {
        const count = countAt(t, dance.bpm, dance.countStart)
        stats.current.add({ count, joints: match.joints, overall: match.overall, offset: match.offset })
        setLive({ overall: match.overall, offset: match.offset, count })
      }
    } else {
      setOutOfFrame(true)
    }
    ctx.restore()

    if (dancing) {
      const t = refTime()
      const count = countAt(t, dance.bpm, dance.countStart)
      if (count !== lastCount.current) {
        lastCount.current = count
        click({ accent: count === 1, loud })
      }
      if (t >= chunk.end) finishLoop()
    }
    // Score overlay is part of the canvas so it shows up in Vine recordings.
    if (match) {
      ctx.font = 'bold 48px system-ui'
      ctx.fillStyle = colorFor(match.overall)
      ctx.fillText(`${Math.round(match.overall * 100)}%`, 24, 64)
    }
  })

  if (!isCalibrated()) return <Navigate to={`/calibrate?next=/practice/${id}`} replace />
  if (!dance) return <p className="muted">Loading dance…</p>

  const patterns = profile?.patterns ?? []

  return (
    <section>
      <div className="practice-head">
        <h1>{dance.name}</h1>
        <div className="chunks">
          {chunks.map((c, i) => (
            <button key={i} className={`chip ${i === chunkIdx ? 'on' : ''}`} disabled={i > unlocked || phase === 'dancing' || phase === 'countin'}
              onClick={() => { setChunkIdx(i); setResult(null); setCelebrate(null) }}>
              {i > unlocked ? '🔒' : i < unlocked ? '✅' : '▶️'} {c.label}
            </button>
          ))}
        </div>
      </div>

      {patterns.length > 0 && (
        <div className="patterns">
          {patterns.map((p) => <span key={p.id} className="badge">{p.emoji} {p.label}: {p.detail}</span>)}
          {adapt?.suggestBreak && <span className="badge alt">📉 Take a 2-minute break, or try the next step</span>}
        </div>
      )}

      <div className="stage">
        <div className="panel">
          <h3>Reference {mirror && '(mirrored)'}</h3>
          <SkeletonPlayer dance={dance} getTime={refTime} mirror={mirror} width={420} height={420} highlight={drillOn ? drill?.joint : undefined} />
        </div>
        <div className="panel">
          <h3>You</h3>
          <div className="cam">
            <video ref={videoRef} playsInline muted className="hidden-video" />
            <canvas ref={canvasRef} className="composite" />
            {countIn && <div className="countin">{countIn}</div>}
            {outOfFrame && phase !== 'idle' && <div className="frame-warn">⚠️ Step back, I can't see your whole body</div>}
          </div>
          {status === 'starting' && <p className="muted">Starting camera…</p>}
          {error && <p className="warn">{error}</p>}
        </div>
      </div>

      <div className="hud">
        {phase === 'dancing' && live && (
          <>
            <span className={`count ${loud ? 'loud' : ''}`}>{live.count}</span>
            <span>Match <b style={{ color: colorFor(live.overall) }}>{Math.round(live.overall * 100)}%</b></span>
            <span>{timingLabel(live.offset)}</span>
          </>
        )}
      </div>

      <div className="controls">
        <button className="btn" onClick={start} disabled={phase === 'dancing' || phase === 'countin' || !chunk}>
          {phase === 'results' ? '🔁 Again' : '▶️ Start'}
        </button>
        {SPEEDS.map((s) => (
          <button key={s} className={`chip ${speed === s ? 'on' : ''}`} onClick={() => setSpeed(s)} disabled={phase === 'dancing'}>{s}x</button>
        ))}
        <label className="row"><input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} /> Mirror</label>
        <label className="row"><input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> Loop step</label>
        {drill && (
          <label className="row"><input type="checkbox" checked={drillOn} onChange={(e) => setDrillOn(e.target.checked)} /> 🎯 Drill {drill.part}</label>
        )}
        <select value={chunkCounts} onChange={(e) => { setChunkCounts(Number(e.target.value)); setChunkIdx(0); setUnlocked(0) }} disabled={phase === 'dancing'}>
          <option value={4}>4-count chunks</option>
          <option value={8}>8-count steps</option>
          <option value={16}>16-count chunks</option>
        </select>
      </div>

      {result && (
        <div className="card results">
          <h2>{result.passed ? 'Passed! 🔥' : `${Math.round(result.overall * 100)}% — need ${PASS_SCORE * 100}% to pass`}</h2>
          <div className="joint-bars">
            {Object.entries(result.joints).map(([j, s]) => (
              <div key={j} className="bar-row">
                <span>{LABELS[j]}</span>
                <div className="bar"><div style={{ width: `${s * 100}%`, background: colorFor(s) }} /></div>
              </div>
            ))}
          </div>
          <p>Timing: {timingLabel(result.timingOffset)} ({result.timingOffset >= 0 ? '+' : ''}{result.timingOffset.toFixed(2)}s)</p>
          {tip && <p className="tip">🎙️ {tip}</p>}
          {result.passed && chunkIdx < chunks.length - 1 && (
            <button className="btn" onClick={() => { setChunkIdx(chunkIdx + 1); setResult(null); setCelebrate(null) }}>Next step ➡️</button>
          )}
        </div>
      )}

      <VineRecorder canvasRef={canvasRef} name={dance.name.toLowerCase().replace(/\W+/g, '-')} />

      {celebrate && (
        <div className="celebrate" onClick={() => setCelebrate(null)}>
          <div>
            <div className="emoji-rain">🔥💯👌🔥💯</div>
            <h1>{celebrate === 'dance' ? 'DANCE COMPLETE' : 'STEP COMPLETE'}</h1>
            <p>{celebrate === 'dance' ? 'You learned the whole thing. Iconic.' : 'On to the next one!'}</p>
            {celebrate === 'dance' && (
              <div className="row">
                <Link className="btn" to="/dashboard">📊 See your progress</Link>
                <Link className="btn ghost" to={`/remix/${id}`}>🎛️ Remix it</Link>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
