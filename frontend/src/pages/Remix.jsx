import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api.js'
import { PRESETS, remixDance } from '../lib/remix.js'
import SkeletonPlayer from '../components/SkeletonPlayer.jsx'
import { Headline, Polaroid, Sticker } from '../components/Retro.jsx'

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

  if (!dance) return <div className="page-loading"><div className="spinner" /></div>

  return (
    <section className="remix-page grid-bg cool">
      <Sticker color="lime" tilt={-2}>★ STYLE_REMIX.exe ★</Sticker>
      <Headline lines={[['REMIX'], [dance.name.toUpperCase(), 'yellow']]} size="lg" />
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
        <button className="btn-pink" onClick={ask} disabled={!request || busy}>{busy ? 'Thinking…' : '✨ Remix'}</button>
      </div>
      {explanation && <p className="tip">🤖 {explanation}</p>}
      <div className="stage">
        <Polaroid caption="original" tilt={-2}><SkeletonPlayer dance={dance} color="#1f4bff" className="fill" /></Polaroid>
        {remixed && <Polaroid caption={label.toLowerCase()} tilt={2}><SkeletonPlayer dance={remixed} color="#ff3ea5" className="fill" /></Polaroid>}
      </div>
      {remixed && <button className="btn-teal wide" onClick={practice}>practice this remix →</button>}
    </section>
  )
}
