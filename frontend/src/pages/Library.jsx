import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, currentUser } from '../lib/api.js'
import SkeletonPlayer from '../components/SkeletonPlayer.jsx'

const STICKERS = ['🔥', '💯', '👌', '😎', '🙌']

function DanceCard({ summary, unlocked, i }) {
  const [dance, setDance] = useState(null)
  useEffect(() => {
    api.getDance(summary.id).then((d) => setDance(d.data)).catch(() => {})
  }, [summary.id])
  const harder = summary.difficulty >= 3

  return (
    <Link to={`/practice/${summary.id}`} className="card dance-card">
      <span className="sticker">{STICKERS[i % STICKERS.length]}</span>
      <div className="preview">
        {dance && <SkeletonPlayer dance={dance} end={Math.min(6, summary.duration)} width={240} height={240} />}
      </div>
      <h3>{summary.name}</h3>
      <p className="muted">
        {summary.steps} steps · {Math.round(summary.bpm)} BPM · {'⭐'.repeat(summary.difficulty)}
      </p>
      {harder && unlocked && <span className="badge">⚡ Unlocked for you</span>}
      {!summary.builtin && <span className="badge alt">Uploaded</span>}
    </Link>
  )
}

export default function Library() {
  const [dances, setDances] = useState(null)
  const [error, setError] = useState(null)
  const [unlockHarder, setUnlockHarder] = useState(false)

  useEffect(() => {
    api.listDances().then(setDances).catch((e) => setError(e.message))
    api.getProfile(currentUser()).then((p) => setUnlockHarder(p.adaptations.unlockHarder)).catch(() => {})
  }, [])

  return (
    <section>
      <div className="hero">
        <h1>Learn the dances of 2016 💯</h1>
        <p>Pick a dance. Your webcam is the controller.</p>
        <Link to="/upload" className="btn">⬆️ Upload your own dance</Link>
      </div>
      {error && <p className="warn">Can't reach the backend ({error}). Is it running on port 8000?</p>}
      {dances && dances.length === 0 && (
        <p className="warn">No dances yet. Run <code>npm run seed</code> in <code>frontend/</code>, or upload one.</p>
      )}
      <div className="grid">
        {dances?.map((d, i) => <DanceCard key={d.id} summary={d} unlocked={unlockHarder} i={i} />)}
      </div>
    </section>
  )
}
