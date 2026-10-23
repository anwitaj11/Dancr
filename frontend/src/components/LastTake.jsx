import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api.js'
import { usePrivateVideoUrl } from '../lib/usePrivateVideoUrl.js'
import { pct } from '../lib/scoring.js'
import { Win } from './Retro.jsx'

const DRIFT = 0.2 // seconds before the tutorial is pulled back in line with the take

function ago(seconds) {
  const s = Date.now() / 1000 - seconds
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86400)} days ago`
}

/**
 * The dancer's latest recorded try, played next to the same part of the
 * tutorial (same speed, same mirroring) so they can compare side by side.
 */
export default function LastTake({ user }) {
  const [take, setTake] = useState(undefined) // undefined = loading, null = none
  const [hasRef, setHasRef] = useState(false)
  const [takeUrl, setTakeUrl] = useState(null)
  const referenceUrl = usePrivateVideoUrl(take?.danceId, hasRef)
  const mine = useRef(null)
  const ref = useRef(null)

  useEffect(() => {
    api.getTake(user).then((t) => {
      setTake(t)
      if (t) api.takeVideoUrl(user).then(setTakeUrl).catch(() => setTakeUrl(null))
      if (t) api.getDance(t.danceId).then((d) => setHasRef(d.hasVideo)).catch(() => setHasRef(false))
    }).catch(() => setTake(null))
  }, [user])

  // Keep the tutorial on the same moment as the take.
  useEffect(() => {
    if (!take || !hasRef) return
    let raf
    const sync = () => {
      raf = requestAnimationFrame(sync)
      const a = mine.current, b = ref.current
      if (!a || !b) return
      const target = take.start + a.currentTime * take.speed
      b.playbackRate = take.speed
      if (a.paused !== b.paused) (a.paused ? b.pause() : b.play().catch(() => {}))
      if (Math.abs(b.currentTime - target) > DRIFT) b.currentTime = target
    }
    sync()
    return () => cancelAnimationFrame(raf)
  }, [take, hasRef])

  async function remove() {
    if (!window.confirm('Delete your last take?')) return
    await api.deleteTake(user).catch(() => {})
    setTake(null)
  }

  if (take === undefined) return null
  return (
    <Win title="LAST_TAKE.webm" color="lime">
      <span className="script pink">ur latest try ↓</span>
      {!take ? (
        <p className="muted">
          Practice any step and your latest try shows up here, next to the tutorial, so you can compare.
          (Turn it off with 🎥 on the practice screen.)
        </p>
      ) : (
        <>
          <p className="take-meta">
            <b>{take.danceName}</b> · {take.step} · <b>{pct(take.score)}</b> {take.passed ? '✓' : ''}
            {take.speed !== 1 && <> · {take.speed}× speed</>} · {ago(take.recordedAt)}
          </p>
          <div className={`take-duet ${hasRef ? '' : 'solo'}`}>
            <figure>
              <video ref={mine} src={takeUrl || undefined} autoPlay loop muted playsInline controls />
              <figcaption>YOU</figcaption>
            </figure>
            {hasRef && (
              <figure>
                <video ref={ref} src={referenceUrl || undefined} muted playsInline preload="auto"
                  style={take.mirror ? { transform: 'scaleX(-1)' } : undefined} />
                <figcaption>TUTORIAL</figcaption>
              </figure>
            )}
          </div>
          <div className="row">
            <Link to={`/practice/${take.danceId}`} className="btn-teal">practice it again →</Link>
            <a className="btn-bracket" href={takeUrl || undefined} download={`dancr-${take.danceName}-take`}>[ SAVE ]</a>
            <button type="button" className="link-btn" onClick={remove}>🗑 delete</button>
          </div>
        </>
      )}
    </Win>
  )
}
