import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api.js'
import { PRESETS, remixDance } from '../lib/remix.js'
import SkeletonPlayer from '../components/SkeletonPlayer.jsx'

export default function Remix() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [dance, setDance] = useState(null)
  const [settings, setSettings] = useState(null)
  const [label, setLabel] = useState('')
  const [request, setRequest] = useState('')
  const [explanation, setExplanation] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.getDance(id).then((d) => setDance(d.data))
  }, [id])

  const remixed = useMemo(() => (dance && settings ? remixDance(dance, settings, `${dance.name} · ${label}`) : null), [dance, settings, label])

  async function ask() {
    setBusy(true)
    try {
      const r = await api.remix(request)
      setSettings(r)
      setLabel(request)
      setExplanation(r.explanation)
    } finally {
      setBusy(false)
    }
  }

  async function practice() {
    const { id: newId } = await api.createDance(remixed)
    navigate(`/practice/${newId}`)
  }

  if (!dance) return <p className="muted">Loading…</p>

  return (
    <section>
      <h1>Remix {dance.name} 🎛️</h1>
      <div className="row wrap">
        {Object.entries(PRESETS).map(([key, p]) => (
          <button key={key} className={`chip ${label === p.label ? 'on' : ''}`}
            onClick={() => { setSettings(p); setLabel(p.label); setExplanation(null) }}>
            {p.emoji} {p.label}
          </button>
        ))}
      </div>
      <div className="row">
        <input className="grow" value={request} onChange={(e) => setRequest(e.target.value)} placeholder='Or describe it: "make it more K-pop"' />
        <button className="btn" onClick={ask} disabled={!request || busy}>{busy ? 'Thinking…' : '✨ Remix'}</button>
      </div>
      {explanation && <p className="tip">🤖 {explanation}</p>}
      <div className="stage">
        <div className="panel"><h3>Original</h3><SkeletonPlayer dance={dance} width={360} height={360} /></div>
        {remixed && <div className="panel"><h3>{label}</h3><SkeletonPlayer dance={remixed} width={360} height={360} color="#ff7ad9" /></div>}
      </div>
      {remixed && <button className="btn" onClick={practice}>💃 Practice this remix</button>}
    </section>
  )
}
