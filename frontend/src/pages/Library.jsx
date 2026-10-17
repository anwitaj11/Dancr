import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, currentUser } from '../lib/api.js'
import { ratingFor } from '../lib/scoring.js'
import { useCoachSummary } from '../lib/coachContext.jsx'
import SkeletonPlayer from '../components/SkeletonPlayer.jsx'
import { APP_NAME, Headline, Marquee, Polaroid, Sticker, Win } from '../components/Retro.jsx'

const FIGURE_COLORS = ['#ff3ea5', '#1f4bff', '#ff8a3d', '#7b3dff', '#00b3a4']
const LEVELS = ['Beginner', 'Beginner', 'Intermediate', 'Advanced']
const TILTS = [-2, 1.5, -1, 2, -1.5, 1]

/** Stick-figure data, fetched only for dances that have no real video yet. */
function useDance(summary) {
  const [dance, setDance] = useState(null)
  useEffect(() => {
    if (!summary || summary.hasVideo) return
    api.getDance(summary.id).then((d) => setDance(d.data)).catch(() => {})
  }, [summary?.id, summary?.hasVideo])
  return dance
}

/** A dance's real video on loop, or its neon demo figure until a video is added. */
function DancePreview({ summary, i = 0, small = false }) {
  const dance = useDance(summary)
  if (!summary) return <div className="preview-empty">✦</div>
  if (summary.hasVideo) {
    return <video src={api.videoUrl(summary.id)} className="fill cover" autoPlay loop muted playsInline preload="metadata" />
  }
  return dance ? (
    <SkeletonPlayer dance={dance} end={Math.min(6, summary.duration)} width={small ? 160 : 300} height={small ? 160 : 400}
      color={FIGURE_COLORS[i % FIGURE_COLORS.length]} glow={small ? 6 : 12} lineWidth={small ? 5 : 7} className="fill" />
  ) : <div className="preview-empty"><div className="spinner" /></div>
}

function ProfileSidebar({ dances, user }) {
  const featured = dances[0]
  return (
    <aside className="myspace">
      <div className="myspace-title">★ {APP_NAME.toUpperCase()} ★</div>
      <div className="myspace-photo"><DancePreview summary={featured} /></div>
      <div className="myspace-row dark">STATUS: DANCING</div>
      <div className="myspace-row yellow">MOOD: iconic</div>
      <div className="myspace-label">♫ now playing:</div>
      <div className="myspace-row white">{featured ? featured.name : 'nothing yet'} — @{user}</div>
      {dances.length > 0 && <div className="myspace-label">TOP {Math.min(8, dances.length)} DANCE BFFS</div>}
      <div className="top8">
        {dances.slice(0, 8).map((d, i) => (
          <Link key={d.id} to={`/practice/${d.id}`} title={d.name}><DancePreview summary={d} i={i} small /></Link>
        ))}
      </div>
      <div className="checker" aria-hidden="true" />
      <div className="myspace-foot">● online now</div>
    </aside>
  )
}

export default function Library() {
  const user = currentUser()
  const [dances, setDances] = useState(null)
  const [error, setError] = useState(null)
  const [profile, setProfile] = useState(null)

  const [removing, setRemoving] = useState(false)

  async function remove(ids, message) {
    if (!window.confirm(message)) return
    setRemoving(true)
    try {
      for (const id of ids) await api.deleteDance(id)
      setDances(await api.listDances())
    } catch (e) {
      setError(e.message)
    } finally {
      setRemoving(false)
    }
  }

  useEffect(() => {
    api.listDances().then(setDances).catch((e) => setError(e.message))
    api.getProfile(user).then(setProfile).catch(() => {})
  }, [user])

  const list = dances ?? []
  useCoachSummary(list.length
    ? `The dancer (@${user}) is browsing the Dancr library. Dances available: ${list.map((d) => `${d.name} (${d.steps} steps, ${Math.round(d.bpm)} BPM)`).join(', ')}.`
    : `The dancer (@${user}) is on the Dancr home page; the library is empty so far.`)
  const featured = list.find((d) => d.hasVideo) ?? list[0]
  const second = list.find((d) => d !== featured && d.hasVideo) ?? list.find((d) => d !== featured)
  const lastScore = profile?.history?.at(-1)?.avg

  return (
    <>
      <section className="hero dots">
        <ProfileSidebar dances={list} user={user} />

        <div className="hero-copy">
          <Sticker color="yellow" tilt={-3}>● YOUR 24/7 DANCE BESTIE.exe</Sticker>
          <Headline lines={[['LEARN'], ['THE'], ['DANCE.', 'yellow'], ['OWN THE'], ['INTERNET.', 'pink', true]]} />
          <p className="hero-blurb">
            Your favorite dances, broken down step by step. Practice with your own AI dance buddy and find your rhythm.
          </p>
          <div className="hero-actions">
            <Link to="/upload" className="btn-pink">UPLOAD YOUR VIDEO ✦</Link>
            <a href="#how" className="btn-bracket">[ HOW IT WORKS? ]</a>
          </div>
          {error && <p className="note-card warn">Can't reach the backend ({error}). Is it running on port 8000?</p>}
        </div>

        <div className="hero-art">
          <Win title={featured ? `${featured.name.toUpperCase().replace(/\W+/g, '_')}_FINAL.mp4` : 'FINAL.mp4'} className="hero-win">
            <span className="star-burst" aria-hidden="true">★</span>
            {featured ? <Link to={`/practice/${featured.id}`} className="hero-video"><DancePreview summary={featured} /></Link> : <div className="hero-video" />}
            <div className="fake-scrub" aria-hidden="true"><span>▶</span><i /></div>
          </Win>
          {featured && (
            <div className="now-playing">
              <small>♫ NOW PLAYING</small>
              <b>{featured.name}</b>
              <span aria-hidden="true">|◀ ■ ▶|</span>
            </div>
          )}
          <div className="speech">omg you're getting it!! ♡</div>
          <div className="match-pill">{lastScore != null ? `${ratingFor(lastScore).label}! ${ratingFor(lastScore).emoji}` : 'READY TO MATCH?'}</div>
          <div className="msg-box"><b>NEW MESSAGE (1)</b><span>ur dance coach is ready!!!</span></div>
          {second && (
            <Link to={`/practice/${second.id}`} className="hero-polaroid">
              <Polaroid caption={`practice clip #${String(second.id).padStart(2, '0')}`} tilt={4}>
                <DancePreview summary={second} i={1} />
              </Polaroid>
            </Link>
          )}
        </div>
      </section>

      <Marquee text="YOUR NEW DANCE OBSESSION STARTS HERE" />

      <section id="dances" className="dances grid-bg">
        <p className="script center">pick ur obsession ↓</p>
        <h2 className="section-title">the dance library</h2>
        {list.some((d) => !d.hasVideo) && (
          <div className="note-card add-video">
            🎥 Some dances are still demo stick figures.{' '}
            <Link to="/upload"><b>Add the real video →</b></Link>{' '}
            <button type="button" className="link-btn" disabled={removing}
              onClick={() => {
                const demos = list.filter((d) => !d.hasVideo)
                remove(demos.map((d) => d.id), `Remove ${demos.length} demo ${demos.length === 1 ? 'dance' : 'dances'} (and their practice history)?`)
              }}>
              {removing ? 'removing…' : '🗑 remove all demo figures'}
            </button>
          </div>
        )}
        {dances && dances.length === 0 && (
          <div className="empty-library">
            <p className="script">it's giving… empty ✨</p>
            <p>Your library is ready for real dances. Upload your first one!</p>
            <Link to="/upload" className="btn-pink">UPLOAD A DANCE ✦</Link>
          </div>
        )}
        {!dances && !error && <div className="spinner center-block" />}
        <div className="polaroid-grid">
          {list.map((d, i) => (
            <div key={d.id} className="dance-card">
              <Link to={`/practice/${d.id}`}>
                <Polaroid caption={d.name} tilt={TILTS[i % TILTS.length]} badge={i + 1}>
                  <DancePreview summary={d} i={i} />
                </Polaroid>
              </Link>
              <div className="dance-meta">
                <span className="tag tag-pink">{d.steps} {d.steps === 1 ? 'STEP' : 'STEPS'} · {LEVELS[d.difficulty] ?? 'Advanced'}</span>
                <span className="tag tag-blue">♫ {Math.round(d.bpm)} BPM</span>
                {!d.hasVideo && <span className="tag tag-ghost">demo figure</span>}
                <button type="button" className="link-btn remove-btn" disabled={removing} aria-label={`Remove ${d.name}`}
                  onClick={() => remove([d.id], `Remove "${d.name}" from the library (and its practice history)?`)}>
                  🗑 remove
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="how" className="how rainbow">
        <p className="script center">it's literally this easy ↓</p>
        <h2 className="section-title">from saved video to slay</h2>
        <div className="how-cards">
          <div className="how-card orange"><span className="how-num">01</span><span className="how-icon">📼</span><h3>upload it</h3><p>Drop in any dance clip you've been replaying 47 times.</p></div>
          <div className="how-card lilac"><span className="how-num">02</span><span className="how-icon">✂️</span><h3>learn it</h3><p>We split the choreo into bite-size, replayable 8-counts.</p></div>
          <div className="how-card teal"><span className="how-num">03</span><span className="how-icon">★</span><h3>get grooving</h3><p>Practice with live, friendly feedback from your AI dance bestie.</p></div>
        </div>
      </section>
    </>
  )
}
