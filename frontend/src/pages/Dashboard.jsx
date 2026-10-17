import { useEffect, useState } from 'react'
import { api, currentUser } from '../lib/api.js'
import { colorFor } from '../lib/scoring.js'

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
          <stop offset="0" stopColor="#25f4ee" /><stop offset="1" stopColor="#fe2c55" />
        </linearGradient>
      </defs>
      <line x1={pad} x2={w - pad} y1={y(0.8)} y2={y(0.8)} className="pass-line" />
      <polyline points={points} fill="none" stroke="url(#line)" strokeWidth="3" strokeLinejoin="round" />
      {history.map((d, i) => (
        <g key={d.date}>
          <circle cx={x(i)} cy={y(d.avg)} r="5" fill="#fff"><title>{`${d.date}: ${Math.round(d.avg * 100)}%`}</title></circle>
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
  const [tab, setTab] = useState('skills')

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

  if (!profile) return <div className="spinner center-block" />
  const parts = profile.skills.parts ?? {}
  const { stats } = profile

  return (
    <section className="profile">
      <div className="profile-head">
        <span className="story-ring big"><span className="story-inner avatar">{user[0]?.toUpperCase()}</span></span>
        <div className="profile-stats">
          <div><b>{stats.attempts}</b><span>tries</span></div>
          <div><b>{stats.stepsPassed}</b><span>steps</span></div>
          <div><b>{Math.round(stats.timeSpent / 60)}</b><span>minutes</span></div>
        </div>
      </div>
      <div className="bio">
        <b>@{user}</b>
        <span className="learner-badge">{profile.badge.emoji} {profile.badge.label}</span>
        {profile.patterns.map((p) => <span key={p.id} className="muted small">{p.emoji} {p.label}: {p.detail}</span>)}
      </div>

      <div className="profile-tabs" role="tablist">
        {[['skills', '📊 Skills'], ['progress', '📈 Progress'], ['report', '📝 Report']].map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'on' : ''} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>

      {tab === 'skills' && (
        <div className="panel-card">
          {Object.keys(parts).length === 0 && <p className="muted small">Finish a step to see your skills.</p>}
          {Object.entries(parts).map(([part, v]) => (
            <div key={part} className="skill-row">
              <span className="skill-icon">{PART_ICONS[part]}</span>
              <span className="skill-name">{part}</span>
              <div className="bar"><div style={{ width: `${v * 100}%`, background: colorFor(v) }} /></div>
              <b>{Math.round(v * 100)}%</b>
            </div>
          ))}
        </div>
      )}

      {tab === 'progress' && <div className="panel-card"><ProgressChart history={profile.history} /></div>}

      {tab === 'report' && (
        <div className="panel-card">
          {report ? (
            <div className="report">
              <h3>💪 Strengths</h3><ul>{report.strengths.map((s) => <li key={s}>{s}</li>)}</ul>
              <h3>🎯 Work on</h3><ul>{report.weaknesses.map((s) => <li key={s}>{s}</li>)}</ul>
              <h3>🗓️ Next time</h3><ol>{report.plan.map((s) => <li key={s}>{s}</li>)}</ol>
            </div>
          ) : <p className="muted small">No report yet.</p>}
          <button className="btn wide" onClick={makeReport} disabled={loading}>{loading ? 'Writing…' : '✍️ Write my session report'}</button>
        </div>
      )}
    </section>
  )
}
