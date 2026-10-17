import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, currentUser } from '../lib/api.js'
import SkeletonPlayer from '../components/SkeletonPlayer.jsx'

const TILE_COLORS = ['#25f4ee', '#fe2c55', '#ffd166', '#b388ff', '#7cff6b']

function useDance(id) {
  const [dance, setDance] = useState(null)
  useEffect(() => {
    api.getDance(id).then((d) => setDance(d.data)).catch(() => {})
  }, [id])
  return dance
}

function Story({ summary, i }) {
  const dance = useDance(summary.id)
  return (
    <Link to={`/practice/${summary.id}`} className="story">
      <span className="story-ring">
        <span className="story-inner">
          {dance && <SkeletonPlayer dance={dance} end={Math.min(6, summary.duration)} width={120} height={120}
            color={TILE_COLORS[i % TILE_COLORS.length]} glow={8} lineWidth={5} />}
        </span>
      </span>
      <span className="story-name">{summary.name}</span>
    </Link>
  )
}

function Tile({ summary, i, unlocked }) {
  const dance = useDance(summary.id)
  return (
    <Link to={`/practice/${summary.id}`} className="tile">
      {dance && <SkeletonPlayer dance={dance} end={Math.min(6, summary.duration)} width={270} height={480}
        color={TILE_COLORS[i % TILE_COLORS.length]} className="fill" />}
      <div className="tile-top">
        {summary.difficulty >= 3 && unlocked && <span className="glass-chip">⚡ Unlocked</span>}
        {!summary.builtin && <span className="glass-chip">Uploaded</span>}
      </div>
      <div className="tile-info">
        <b>{summary.name}</b>
        <span>♫ {Math.round(summary.bpm)} BPM · {summary.steps} steps</span>
        <span className="stars">{'★'.repeat(summary.difficulty)}<i>{'★'.repeat(3 - Math.min(3, summary.difficulty))}</i></span>
      </div>
      <span className="tile-play">▶</span>
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
    <section className="feed">
      <div className="stories">
        <Link to="/upload" className="story">
          <span className="story-ring add"><span className="story-inner">＋</span></span>
          <span className="story-name">Upload</span>
        </Link>
        {dances?.map((d, i) => <Story key={d.id} summary={d} i={i} />)}
      </div>

      <div className="feed-head">
        <h2>Trending in 2016 🔥</h2>
        <span className="muted small">Tap a dance to learn it. Your webcam is the controller.</span>
      </div>

      {error && <p className="notice warn">Can't reach the backend ({error}). Is it running on port 8000?</p>}
      {dances && dances.length === 0 && (
        <p className="notice">No dances yet. Run <code>npm run seed</code> in <code>frontend/</code>, or upload one.</p>
      )}
      {!dances && !error && <div className="spinner center-block" />}

      <div className="tiles">
        {dances?.map((d, i) => <Tile key={d.id} summary={d} i={i} unlocked={unlockHarder} />)}
      </div>
    </section>
  )
}
