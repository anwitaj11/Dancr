import { useEffect, useState } from 'react'
import { PERSON_COLORS } from '../lib/processVideo.js'
import { trackDancer, trackReport } from '../lib/people.js'
import DancerCheck from './DancerCheck.jsx'
import { Win } from './Retro.jsx'

/** A dancer's details as stored on the lesson (dance.dancer). */
export function dancerInfo(result, person) {
  return result.people > 1
    ? { number: person + 1, people: result.people, color: PERSON_COLORS[person % PERSON_COLORS.length] }
    : undefined
}

/**
 * "Who are we learning from?" for a processed video (processVideoFile result):
 * pick a dancer when there are several, then check the highlighted dancer on
 * the video before confirming. onConfirm(tracked, person) gets their frames.
 */
export default function DancerChooser({ result, src, onConfirm, confirmLabel = "✓ YES, THAT'S THEM", busy = false }) {
  const several = result.people > 1
  const [check, setCheck] = useState(null) // { person, tracked, report }
  const [error, setError] = useState(null)

  function choose(person) {
    setError(null)
    const tracked = trackDancer(result.raw, result.anchor, person)
    if (tracked.length < 30) {
      setError("Couldn't follow that dancer for long enough. Try a clip where they stay in frame, or pick someone else.")
      return
    }
    setCheck({ person, tracked, report: trackReport(result.raw, tracked) })
  }

  // One person: nothing to pick, go straight to the check.
  useEffect(() => {
    setCheck(null)
    if (!several) choose(0)
  }, [result]) // eslint-disable-line react-hooks/exhaustive-deps

  // Bring each window into view as it appears.
  const stage = check ? 'check' : 'pick'
  useEffect(() => {
    document.getElementById(`dancer-${stage}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [stage])

  if (!check) {
    return (
      <Win id="dancer-pick" title="WHO_ARE_WE_LEARNING_FROM.jpg" color="purple" className="upload-win">
        <p className="script pink">we spotted {result.people} people ↓</p>
        <h2 className="section-title small">Who are we learning from?</h2>
        <p className="muted">Pick the dancer to copy. We'll follow just them through the whole video.</p>
        <img src={result.snapshot} alt={`Video frame with ${result.people} people, numbered left to right`} className="people-snapshot" />
        <div className="row people-picks">
          {Array.from({ length: result.people }, (_, i) => (
            <button key={i} type="button" className={`btn-pink person-${i}`} onClick={() => choose(i)}>
              DANCER {i + 1}{i === 0 ? ' (LEFT)' : i === result.people - 1 ? ' (RIGHT)' : ''}
            </button>
          ))}
        </div>
        {error && <p className="warn">{error}</p>}
      </Win>
    )
  }

  const who = several ? `Dancer ${check.person + 1}` : 'them'
  return (
    <Win id="dancer-check" title="CHECK_YOUR_DANCER.exe" color="lime" className="upload-win">
      <p className="script pink">quick check ↓</p>
      <h2 className="section-title small">
        {several ? `You picked Dancer ${check.person + 1}. Is this who you want to learn from?` : 'Is this the dancer you want to learn from?'}
      </h2>
      <p className="muted">
        Press play: the dancer we're following is drawn in colour with a tag over their head
        {several ? ', everyone else is faint' : ''}.
        Make sure the coloured skeleton stays on the same person the whole way through.
      </p>
      <DancerCheck src={src} aspect={result.aspect} raw={result.raw} tracked={check.tracked}
        color={PERSON_COLORS[check.person % PERSON_COLORS.length]}
        label={several ? `DANCER ${check.person + 1} ✓` : 'FOLLOWING ✓'}
        suspects={check.report.suspects} />
      <p className="dancer-coverage">
        👀 We could see {who} in <b>{Math.round(check.report.coverage * 100)}%</b> of their part of the video
        {check.report.coverage < 0.8 ? ' (they were hidden or blocked a lot: scores may be patchy)' : ''}.
      </p>
      <div className="row people-picks">
        <button type="button" className="btn-teal" disabled={busy} onClick={() => onConfirm(check.tracked, check.person)}>{confirmLabel}</button>
        {several && (
          <button type="button" className="btn-orange" disabled={busy} onClick={() => setCheck(null)}>↺ PICK A DIFFERENT DANCER</button>
        )}
      </div>
    </Win>
  )
}
