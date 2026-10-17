import { useEffect, useState } from 'react'
import { api, currentUser } from '../lib/api.js'
import { colorFor, ratingFor } from '../lib/scoring.js'
import { Headline, Sticker, Win } from '../components/Retro.jsx'

const PART_ICONS = { arms: '💪', torso: '🧍', legs: '🦵' }

function ProgressChart({ history }) {
  if (history.length < 2) return <p className="muted small">Dance on two different days to see your progress line.</p>
  const w = 480, h = 160, pad = 24
  const x = (i) => pad + (i * (w - 2 * pad)) / (history.length - 1)
  const y = (v) => h - pad - v * (h - 2 * pad)
  const points = history.map((d, i) => `${x(i)},${y(d.avg)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="chart" role="img" aria-label="Average score per session">
      <defs>
        <linearGradient id="line" x1="0" x2="1">
          <stop offset="0" stopColor="#1f4bff" /><stop offset="1" stopColor="#ff3ea5" />
        </linearGradient>
      </defs>
      <line x1={pad} x2={w - pad} y1={y(0.8)} y2={y(0.8)} className="pass-line" />
      <polyline points={points} fill="none" stroke="url(#line)" strokeWidth="3" strokeLinejoin="round" />
      {history.map((d, i) => (
        <g key={d.date}>
          <circle cx={x(i)} cy={y(d.avg)} r="6" fill="#ff3ea5" stroke="#1d1030" strokeWidth="2"><title>{`${d.date}: ${ratingFor(d.avg).label}`}</title></circle>
          <text x={x(i)} y={h - 4} textAnchor="middle">{d.date.slice(5)}</text>
        </g>
      ))}
    </svg>
  )
}

export default function Dashboard() {
  const user = currentUser()
  const [profile, setProfile] = useState(null)
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    api.getProfile(user).then((p) => { setProfile(p); setReport(p.lastReport) }).catch(() => {})
  }, [user])

  async function makeReport() {
    setLoading(true)
    try {
      setReport(await api.report(user))
    } finally {
      setLoading(false)
    }
  }

  if (!profile) return <div className="page-loading"><div className="spinner" /></div>
  const parts = profile.skills.parts ?? {}
  const { stats } = profile

  return (
    <section className="profile-page dots">
      <div className="profile-head">
        <Sticker color="lime" tilt={-2}>★ MY_PRACTICE.exe ★</Sticker>
        <Headline lines={[['MY'], ['PRACTICE', 'yellow']]} size="lg" />
      </div>

      <div className="profile-grid">
        <aside className="myspace">
          <div className="myspace-title">@{user}</div>
          <div className="myspace-photo avatar-box">{user[0]?.toUpperCase()}</div>
          <div className="myspace-row dark">STATUS: {stats.attempts ? 'PRACTICING' : 'NEW HERE'}</div>
          <div className="myspace-row yellow">MOOD: {profile.badge.emoji} {profile.badge.label}</div>
          <div className="profile-stats">
            <div><b>{stats.attempts}</b><span>tries</span></div>
            <div><b>{stats.stepsPassed}</b><span>steps</span></div>
            <div><b>{Math.round(stats.timeSpent / 60)}</b><span>minutes</span></div>
          </div>
          {profile.patterns.length > 0 && <div className="myspace-label">WHAT YOUR COACH NOTICED</div>}
          {profile.patterns.map((p) => <div key={p.id} className="myspace-row white">{p.emoji} {p.label}: {p.detail}</div>)}
          <div className="checker" aria-hidden="true" />
        </aside>

        <div className="profile-main">
          <Win title="SKILLS.exe" color="pink">
            {Object.keys(parts).length === 0 && <p className="muted">Finish a step to see your skills.</p>}
            {Object.entries(parts).map(([part, v]) => (
              <div key={part} className="skill-row">
                <span className="skill-icon">{PART_ICONS[part]}</span>
                <span className="skill-name">{part}</span>
                <div className="bar chunky"><div style={{ width: `${v * 100}%`, background: colorFor(v) }} /></div>
                <b className="skill-rating">{ratingFor(v).emoji} {ratingFor(v).label}</b>
              </div>
            ))}
          </Win>

          <Win title="PROGRESS.png">
            <ProgressChart history={profile.history} />
          </Win>

          <Win title="SESSION_REPORT.txt — NOTEPAD" color="purple" controls={false} className="notepad">
            <span className="script pink">ur coach says ↓</span>
            {report ? (
              <div className="report">
                <h3>💪 strengths</h3><ul>{report.strengths.map((s) => <li key={s}>{s}</li>)}</ul>
                <h3>🎯 work on</h3><ul>{report.weaknesses.map((s) => <li key={s}>{s}</li>)}</ul>
                <h3>🗓️ next time</h3><ol>{report.plan.map((s) => <li key={s}>{s}</li>)}</ol>
              </div>
            ) : <p className="muted">No report yet.</p>}
            <button className="btn-teal wide" onClick={makeReport} disabled={loading}>{loading ? 'writing…' : 'write my session report →'}</button>
          </Win>
        </div>
      </div>
    </section>
  )
}
