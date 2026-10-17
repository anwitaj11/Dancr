import { useEffect, useState } from 'react'
import { api, currentUser } from '../lib/api.js'
import { colorFor } from '../lib/scoring.js'

function ProgressChart({ history }) {
  if (history.length < 2) return <p className="muted">Practice on two different days to see your progress line.</p>
  const w = 480, h = 160, pad = 24
  const x = (i) => pad + (i * (w - 2 * pad)) / (history.length - 1)
  const y = (v) => h - pad - v * (h - 2 * pad)
  const points = history.map((d, i) => `${x(i)},${y(d.avg)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="chart" role="img" aria-label="Average score per session">
      <line x1={pad} x2={w - pad} y1={y(0.8)} y2={y(0.8)} className="pass-line" />
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="3" />
      {history.map((d, i) => (
        <g key={d.date}>
          <circle cx={x(i)} cy={y(d.avg)} r="5" fill="currentColor"><title>{`${d.date}: ${Math.round(d.avg * 100)}%`}</title></circle>
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
    api.getProfile(user).then((p) => { setProfile(p); setReport(p.lastReport) })
  }, [user])

  async function makeReport() {
    setLoading(true)
    try {
      setReport(await api.report(user))
    } finally {
      setLoading(false)
    }
  }

  if (!profile) return <p className="muted">Loading…</p>
  const parts = profile.skills.parts ?? {}

  return (
    <section className="narrow">
      <h1>{user}'s Dab Lab 📊</h1>
      <div className="card badge-card">
        <span className="big-emoji">{profile.badge.emoji}</span>
        <div>
          <h2>{profile.badge.label}</h2>
          <p className="muted">{profile.stats.attempts} attempts · {profile.stats.stepsPassed} steps passed · {Math.round(profile.stats.timeSpent / 60)} min danced</p>
        </div>
      </div>

      <div className="card">
        <h2>Skills</h2>
        {Object.keys(parts).length === 0 && <p className="muted">Finish a step to see your skills.</p>}
        {Object.entries(parts).map(([part, v]) => (
          <div key={part} className="bar-row">
            <span>{part}</span>
            <div className="bar"><div style={{ width: `${v * 100}%`, background: colorFor(v) }} /></div>
            <b>{Math.round(v * 100)}%</b>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Progress</h2>
        <ProgressChart history={profile.history} />
      </div>

      <div className="card">
        <h2>Session report</h2>
        {report ? (
          <div className="report">
            <h3>💪 Strengths</h3><ul>{report.strengths.map((s) => <li key={s}>{s}</li>)}</ul>
            <h3>🎯 Work on</h3><ul>{report.weaknesses.map((s) => <li key={s}>{s}</li>)}</ul>
            <h3>🗓️ Next time</h3><ol>{report.plan.map((s) => <li key={s}>{s}</li>)}</ol>
          </div>
        ) : <p className="muted">No report yet.</p>}
        <button className="btn" onClick={makeReport} disabled={loading}>{loading ? 'Writing…' : '✍️ Write my report'}</button>
      </div>
    </section>
  )
}
