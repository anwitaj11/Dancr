import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api.js'
import StepEditor from '../components/StepEditor.jsx'
import { Headline, Sticker, Win } from '../components/Retro.jsx'

/** Re-split the steps of a dance that's already in the library. */
export default function EditSteps() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [entry, setEntry] = useState(null)
  const [steps, setSteps] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.getDance(id).then(setEntry).catch((e) => setError(e.message))
  }, [id])

  const onChange = useCallback((next) => setSteps(next), [])

  async function save() {
    setSaving(true)
    try {
      await api.replaceDance(id, { ...entry.data, steps })
      navigate(`/practice/${id}`)
    } catch (e) {
      setError(`Couldn't save: ${e.message}`)
      setSaving(false)
    }
  }

  if (error && !entry) return <p className="note-card warn">{error}</p>
  if (!entry) return <div className="page-loading"><div className="spinner" /></div>

  return (
    <section className="upload-page grid-bg cool">
      <div className="upload-head">
        <Sticker color="lime" tilt={-2}>★ STEP_SPLITTER.exe ★</Sticker>
        <Headline lines={[['EDIT THE'], ['STEPS', 'yellow']]} size="lg" />
      </div>
      <Win title={`${entry.name.toUpperCase().replace(/\W+/g, '_')}_STEPS.txt`} color="pink" className="upload-win">
        <h2 className="section-title small">{entry.name}</h2>
        <p className="muted">Practice history stays attached to the dance; step numbers follow your new split.</p>
        <StepEditor dance={entry.data} videoSrc={entry.hasVideo ? api.videoUrl(id) : null} onChange={onChange} />
        <div className="row">
          <button className="btn-teal" onClick={save} disabled={saving || !steps}>{saving ? 'saving…' : 'save steps & practice →'}</button>
          <Link to={`/practice/${id}`} className="btn-bracket">[ CANCEL ]</Link>
        </div>
        {error && <p className="warn">{error}</p>}
      </Win>
    </section>
  )
}
