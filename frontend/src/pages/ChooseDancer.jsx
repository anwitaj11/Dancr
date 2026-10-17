import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api.js'
import { buildDance } from '../lib/dance.js'
import { processVideoFile } from '../lib/processVideo.js'
import { rebase } from '../lib/people.js'
import DancerChooser, { dancerInfo } from '../components/DancerChooser.jsx'
import { Headline, Sticker, Win } from '../components/Retro.jsx'

/**
 * Pick (or change) which person a saved dance follows, from its stored video.
 * Name, tempo, count 1 and the step split are kept; only the dancer changes.
 */
export default function ChooseDancer() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [entry, setEntry] = useState(null)
  const [blob, setBlob] = useState(null)
  const [progress, setProgress] = useState(null)
  const [result, setResult] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const src = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob])
  useEffect(() => () => src && URL.revokeObjectURL(src), [src])

  useEffect(() => {
    api.getDance(id).then((e) => {
      if (!e.hasVideo) throw new Error('This dance has no video yet, so there are no dancers to choose from.')
      setEntry(e)
      return fetch(api.videoUrl(id)).then((r) => r.blob())
    }).then(setBlob).catch((e) => setError(e.message))
  }, [id])

  async function findDancers() {
    setError(null)
    setProgress(0)
    try {
      setResult(await processVideoFile(blob, { onProgress: setProgress }))
    } catch (e) {
      setError(e.message)
    } finally {
      setProgress(null)
    }
  }

  async function save(tracked, person) {
    setSaving(true)
    const old = entry.data
    const { frames, trimmed } = rebase(tracked)
    const duration = frames.at(-1).t
    // Steps and count 1 were in the old dancer's time; move them to the new one's.
    const shift = (old.videoOffset ?? 0) - trimmed
    const at = (t) => Math.round(Math.min(duration, Math.max(0, t + shift)) * 1000) / 1000
    const steps = old.steps
      .map((s) => ({ ...s, start: at(s.start), end: at(s.end) }))
      .filter((s) => s.end > s.start)
      .map((s, i) => ({ ...s, index: i }))
    const dance = buildDance({
      name: old.name, bpm: old.bpm, fps: old.fps, aspect: result.aspect,
      countStart: at(old.countStart ?? 0), videoOffset: trimmed, frames,
      steps: steps.length ? steps : undefined, dancer: dancerInfo(result, person),
    })
    try {
      await api.replaceDance(id, dance)
      navigate(`/practice/${id}`)
    } catch (e) {
      setError(`Couldn't save: ${e.message}`)
      setSaving(false)
    }
  }

  const current = entry?.data.dancer
  return (
    <section className="upload-page grid-bg cool">
      <div className="upload-head">
        <Sticker color="lime" tilt={-2}>★ WHO_ARE_WE_COPYING.exe ★</Sticker>
        <Headline lines={[['CHOOSE THE'], ['DANCER', 'yellow']]} size="lg" />
      </div>
      <Win title={entry ? `${entry.name.toUpperCase().replace(/\W+/g, '_')}.MOV` : 'LOADING.MOV'} color="pink" className="upload-win">
        {entry && <h2 className="section-title small">{entry.name}</h2>}
        <p className="muted">
          {current
            ? <>Right now you're learning <span className="dancer-chip" style={{ background: current.color }}>DANCER {current.number}</span> of {current.people}. </>
            : 'Right now this dance follows whoever we spotted first. '}
          We'll look at the video again so you can see everyone and pick who to copy.
          Your step split and practice history stay.
        </p>
        <div className="row">
          <button className="btn-pink" disabled={!blob || progress !== null || saving} onClick={findDancers}>
            {progress !== null ? `LOOKING… ${Math.round(progress * 100)}%` : !blob && !error ? 'loading the video…' : result ? 'LOOK AGAIN' : '👥 FIND THE DANCERS'}
          </button>
          <Link to={`/practice/${id}`} className="btn-bracket">[ CANCEL ]</Link>
        </div>
        {error && <p className="warn">{error}</p>}
      </Win>
      {result && src && (
        <DancerChooser result={result} src={src} busy={saving} onConfirm={save}
          confirmLabel={saving ? 'saving…' : "✓ YES, THAT'S THEM: SAVE & PRACTICE"} />
      )}
    </section>
  )
}
