import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api.js'
import { buildDance } from '../lib/dance.js'
import { processVideoFile } from '../lib/processVideo.js'
import { rebase, trackDancer } from '../lib/people.js'
import StepEditor from '../components/StepEditor.jsx'
import { Headline, Sticker, Win } from '../components/Retro.jsx'

export default function Upload() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const fileInput = useRef(null)
  const [library, setLibrary] = useState([])
  const [replaceId, setReplaceId] = useState(params.get('replace') ?? '')
  const [file, setFile] = useState(null)
  const [name, setName] = useState('')
  const [bpm, setBpm] = useState(100)
  const [countStart, setCountStart] = useState(0)
  const [builtin, setBuiltin] = useState(false)
  const [progress, setProgress] = useState(null)
  const [dance, setDance] = useState(null)
  const [picking, setPicking] = useState(null) // processed video with several people in it
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  // Local preview of the chosen file, for the step editor.
  const fileUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  useEffect(() => () => fileUrl && URL.revokeObjectURL(fileUrl), [fileUrl])
  const setSteps = useCallback((steps) => setDance((d) => (d ? { ...d, steps } : d)), [])
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    api.listDances().then(setLibrary).catch(() => {})
  }, [])

  const replacing = library.find((d) => String(d.id) === String(replaceId))

  // Replacing a built-in: start from its name and tempo.
  useEffect(() => {
    if (!replacing) return
    setName(replacing.name)
    setBpm(Math.round(replacing.bpm))
  }, [replacing])

  async function process() {
    setError(null)
    setDance(null)
    setPicking(null)
    setProgress(0)
    try {
      const result = await processVideoFile(file, { onProgress: setProgress })
      // More than one person: ask who to learn from before building the lesson.
      if (result.people > 1) setPicking(result)
      else buildFrom(result, 0)
    } catch (e) {
      setError(e.message)
    } finally {
      setProgress(null)
    }
  }

  /** Follow the chosen dancer (0 = leftmost) and turn their moves into a lesson. */
  function buildFrom(result, person) {
    const tracked = trackDancer(result.raw, result.anchor, person)
    if (tracked.length < 30) {
      setError("Couldn't follow that dancer for long enough. Try a clip where they stay in frame.")
      return
    }
    const { frames, trimmed } = rebase(tracked)
    setPicking(null)
    setDance(buildDance({
      name: name || file.name.replace(/\.[^.]+$/, ''),
      bpm: Number(bpm),
      // Count 1 was marked in original video time; frames were re-based to the dancer's first frame.
      countStart: Math.max(0, Number(countStart) - trimmed),
      aspect: result.aspect,
      videoOffset: trimmed,
      frames,
    }))
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const id = replacing
        ? (await api.replaceDance(replacing.id, dance)).id
        : (await api.createDance(dance, { builtin })).id
      // Keep the original clip so the feed and practice screen can show it.
      await api.uploadVideo(id, file)
      navigate(`/practice/${id}`)
    } catch (e) {
      setError(`Couldn't save: ${e.message}`)
      setSaving(false)
    }
  }

  function pick(f) {
    if (!f) return
    if (!f.type.startsWith('video/')) return setError("That's not a video file. Try an MP4, MOV or WEBM.")
    setError(null)
    setDance(null)
    setFile(f)
  }

  return (
    <section className="upload-page grid-bg cool">
      <div className="upload-head">
        <Sticker color="lime" tilt={-2}>★ STEP_01 // FILE SELECT ★</Sticker>
        <Headline lines={[['OKAYYY, WHAT ARE'], ['WE LEARNING?', 'yellow']]} size="lg" />
        <span className="script tilted">your new obsession starts here ↘</span>
        <div className="status-card" aria-hidden="true">STORAGE: plenty<br />INTERNET: super fast<br />VIBE: IMMACULATE</div>
      </div>

      <Win title={replacing ? `${replacing.name.toUpperCase().replace(/\W+/g, '_')}_REAL.MOV` : 'NEW_DANCE_UPLOAD.MOV'}
        dots controls={false} extra={<span className="win-heart">♡</span>} className="upload-win">
        <div className={`dropzone ${dragging ? 'over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files[0]) }}>
          <span className="drop-icon" aria-hidden="true">↑<i>★</i></span>
          <h2 className="drop-title">{file ? file.name : 'DROP YOUR DANCE VIDEO HERE!'}</h2>
          <span className="drop-sub">drag &amp; drop // browse files // become iconic</span>
          <input ref={fileInput} type="file" accept="video/*" hidden onChange={(e) => pick(e.target.files[0])} />
          <button type="button" className="btn-orange" onClick={() => fileInput.current.click()}>
            {file ? 'choose a different video' : 'choose my video'}
          </button>
          <span className="drop-types">MP4 · MOV · WEBM · MAX 200MB</span>
        </div>

        <div className="upload-form">
          <label>Add it as
            <select value={replaceId} onChange={(e) => setReplaceId(e.target.value)}>
              <option value="">A new dance</option>
              {library.filter((d) => d.builtin).map((d) => (
                <option key={d.id} value={d.id}>Replace {d.name}{d.hasVideo ? '' : ' (demo figure)'}</option>
              ))}
            </select>
          </label>
          <label>Name <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Juju On That Beat" /></label>
          <label>BPM <input type="number" value={bpm} min={40} max={200} onChange={(e) => setBpm(e.target.value)} /></label>
          <label>Count 1 starts at (seconds)
            <input type="number" step="0.05" value={countStart} min={0} onChange={(e) => setCountStart(e.target.value)} />
          </label>
          {!replacing && (
            <label className="check"><input type="checkbox" checked={builtin} onChange={(e) => setBuiltin(e.target.checked)} /> Add to the built-in library</label>
          )}
          <p className="hint-text">Tip: full body in frame, plain background, good light, phone held still. Clap or count "5, 6, 7, 8" at the start, and put the time of count 1 above.</p>
          <button className="btn-pink wide" disabled={!file || progress !== null} onClick={process}>
            {progress !== null ? `PROCESSING… ${Math.round(progress * 100)}%` : 'TURN IT INTO A LESSON ✦'}
          </button>
          {error && <p className="warn">{error}</p>}
        </div>
      </Win>

      {picking && (
        <Win title="WHO_ARE_WE_LEARNING_FROM.jpg" color="purple" className="upload-win">
          <p className="script pink">we spotted {picking.people} people ↓</p>
          <h2 className="section-title small">Who are we learning from?</h2>
          <p className="muted">Pick the dancer to copy. We'll follow just them through the whole video.</p>
          <img src={picking.snapshot} alt={`Video frame with ${picking.people} people, numbered left to right`} className="people-snapshot" />
          <div className="row people-picks">
            {Array.from({ length: picking.people }, (_, i) => (
              <button key={i} type="button" className={`btn-pink person-${i}`} onClick={() => buildFrom(picking, i)}>
                DANCER {i + 1}{i === 0 ? ' (LEFT)' : i === picking.people - 1 ? ' (RIGHT)' : ''}
              </button>
            ))}
          </div>
        </Win>
      )}

      {dance && (
        <Win title="STEP_SPLITTER.exe" color="pink" className="upload-win">
          <h2 className="section-title small">{dance.name}</h2>
          <p className="muted">
            We split it into {dance.steps.length} {dance.steps.length === 1 ? 'step' : 'steps'} automatically
            (8 counts each). Happy with that? Save it. Want different steps? Edit them below.
          </p>
          <StepEditor key={dance.frames.length} dance={dance} videoSrc={fileUrl} onChange={setSteps} />
          <button className="btn-teal wide" onClick={save} disabled={saving}>
            {saving ? 'saving…' : replacing ? `replace ${replacing.name} & practice →` : 'save & practice →'}
          </button>
        </Win>
      )}
    </section>
  )
}
