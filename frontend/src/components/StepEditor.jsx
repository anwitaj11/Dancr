import { useCallback, useEffect, useRef, useState } from 'react'
import { fromCuts, mergeWithNext, moveCut, splitAt, splitByMotion, toCuts } from '../lib/steps.js'
import SkeletonPlayer from './SkeletonPlayer.jsx'

const fmt = (t) => `${t.toFixed(2)}s`
const STEP_COLORS = ['var(--hot)', 'var(--cyan)', 'var(--yellow)', 'var(--lilac)', 'var(--teal)', 'var(--orange)']

/**
 * Manual step splitting. Starts from whatever steps the dance has (the
 * automatic 8-count split), and lets you add, move, merge and rename steps
 * while scrubbing through the video (or the stick figure if there's no video).
 * Calls onChange(steps) on every edit.
 */
export default function StepEditor({ dance, videoSrc, onChange }) {
  const duration = dance.frames.at(-1).t
  const offset = dance.videoOffset ?? 0
  const [{ cuts, labels }, setEdit] = useState(() => toCuts(dance.steps))
  const [time, setTime] = useState(cuts[0])
  const videoRef = useRef(null)
  const timeRef = useRef(time)
  timeRef.current = time

  useEffect(() => {
    onChange(fromCuts(cuts, labels, dance.bpm))
  }, [cuts, labels, dance.bpm, onChange])

  function apply(next) {
    if (next) setEdit(next)
  }

  function seek(t) {
    const clamped = Math.min(duration, Math.max(0, t))
    setTime(clamped)
    if (videoRef.current) videoRef.current.currentTime = clamped + offset
  }

  function resetToAuto() {
    apply(toCuts(splitByMotion(dance.frames, dance.bpm, dance.countStart ?? 0)))
  }

  const getTime = useCallback(() => timeRef.current, [])
  const currentStep = cuts.findIndex((c) => c > time) - 1

  return (
    <div className="step-editor">
      <div className="step-editor-view">
        {videoSrc ? (
          <video ref={videoRef} src={videoSrc} controls playsInline muted className="step-video"
            onTimeUpdate={(e) => setTime(Math.max(0, e.currentTarget.currentTime - offset))}
            onLoadedMetadata={(e) => { e.currentTarget.currentTime = time + offset }} />
        ) : (
          <div className="step-figure"><SkeletonPlayer dance={dance} getTime={getTime} className="fill" /></div>
        )}
      </div>

      {/* Timeline: coloured blocks are steps, white line is the playhead. Click to seek. */}
      <div className="step-timeline" role="slider" aria-label="Dance timeline" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={time}
        onClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect()
          seek(((e.clientX - box.left) / box.width) * duration)
        }}>
        {labels.map((label, i) => (
          <span key={i} className="step-block" title={label}
            style={{ left: `${(cuts[i] / duration) * 100}%`, width: `${((cuts[i + 1] - cuts[i]) / duration) * 100}%`, background: STEP_COLORS[i % STEP_COLORS.length] }}>
            {i + 1}
          </span>
        ))}
        <span className="playhead" style={{ left: `${(time / duration) * 100}%` }} />
      </div>
      <input type="range" min={0} max={duration} step={0.01} value={time} onChange={(e) => seek(Number(e.target.value))}
        aria-label="Scrub" className="step-scrub" />

      <div className="row step-actions">
        <span className="tag tag-white">⏱ {fmt(time)}</span>
        <button type="button" className="btn-pink small-btn" onClick={() => apply(splitAt(cuts, labels, time))}>✂ SPLIT HERE</button>
        <button type="button" className="btn-bracket small-btn" onClick={resetToAuto}>[ AUTO-SPLIT AGAIN ]</button>
      </div>
      <p className="hint-text">
        Scrub to where a new move starts and hit <b>split here</b>. Rename steps, nudge their start times, or merge two into one.
      </p>

      <ol className="step-list">
        {labels.map((label, i) => (
          <li key={i} className={i === currentStep ? 'current' : ''}>
            <span className="step-dot" style={{ background: STEP_COLORS[i % STEP_COLORS.length] }}>{i + 1}</span>
            <input className="step-name" value={label} aria-label={`Name of step ${i + 1}`}
              onChange={(e) => apply({ cuts, labels: labels.map((l, j) => (j === i ? e.target.value : l)) })} />
            <label className="step-time">starts
              <input type="number" step={0.05} value={cuts[i]} disabled={i === 0} aria-label={`Start of step ${i + 1}`}
                onChange={(e) => apply({ cuts: moveCut(cuts, i, Number(e.target.value)), labels })} />
            </label>
            <span className="step-len">{fmt(cuts[i + 1] - cuts[i])}</span>
            <button type="button" className="link-btn" onClick={() => seek(cuts[i])}>▶ go</button>
            {i < labels.length - 1 && (
              <button type="button" className="link-btn" onClick={() => apply(mergeWithNext(cuts, labels, i))}>⤵ merge</button>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}
