import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api.js'
import { buildDance } from '../lib/dance.js'
import { packScan, processVideoFile } from '../lib/processVideo.js'
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
      // A scan saved at upload means no waiting: show the dancers straight away.
      // Older dances get scanned once, automatically, and the scan is saved for next time.
      return Promise.all([api.getPeople(id).catch(() => null), fetch(api.videoUrl(id)).then((r) => r.blob())])
    }).then(([saved, video]) => {
      setBlob(video)
      if (saved) setResult(saved)
      else setAutoScan(true)
    }).catch((e) => setError(e.message))
  }, [id])

  const [autoScan, setAutoScan] = useState(false)
  useEffect(() => {
    if (autoScan && blob) findDancers()
  }, [autoScan, blob]) // eslint-disable-line react-hooks/exhaustive-deps

  const scanning = useRef(false)
  async function findDancers() {
    if (scanning.current) return // one scan at a time: they share the pose model
    scanning.current = true
    setError(null)
    setProgress(0)
    try {
      const scanned = await processVideoFile(blob, { onProgress: setProgress })
      setResult(scanned)
      api.savePeople(id, packScan(scanned)).catch(() => {}) // next time is instant
    } catch (e) {
      setError(e.message)
    } finally {
      scanning.current = false
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
      name: old.name, bpm: old.bpm, fps: result.fps, aspect: result.aspect,
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
          Pick who to copy below. Your step split and practice history stay.
          {!result && ' This video was uploaded before scans were saved, so Dancr scans it once now. After that it opens instantly.'}
        </p>
        <div className="row">
          <button className="btn-pink" disabled={!blob || progress !== null || saving} onClick={findDancers}>
            {progress !== null ? `LOOKING… ${Math.round(progress * 100)}%` : !blob && !error ? 'loading the video…' : result ? '↻ SCAN THE VIDEO AGAIN' : '👥 FIND THE DANCERS'}
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
