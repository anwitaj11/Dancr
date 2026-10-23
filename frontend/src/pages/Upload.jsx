import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api.js'
import { buildDance } from '../lib/dance.js'
import { packScan, processVideoFile } from '../lib/processVideo.js'
import { rebase } from '../lib/people.js'
import DancerChooser, { dancerInfo } from '../components/DancerChooser.jsx'
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
  const [progress, setProgress] = useState(null)
  const [dance, setDance] = useState(null)
  const [processed, setProcessed] = useState(null) // processed video, while choosing who to follow
  const [crowd, setCrowd] = useState(null) // the multi-person video the current lesson came from
  const [scan, setScan] = useState(null) // the scan the current lesson came from, saved for changing dancers later
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

  useEffect(() => {
    if (dance) document.getElementById('upload-steps')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [dance === null]) // eslint-disable-line react-hooks/exhaustive-deps

  const replacing = library.find((d) => d.mine && String(d.id) === String(replaceId))

  // Replacing a built-in: start from its name and tempo.
  useEffect(() => {
    if (!replacing) return
    setName(replacing.name)
    setBpm(Math.round(replacing.bpm))
  }, [replacing])

  async function process() {
    setError(null)
    setDance(null)
    setProcessed(null)
    setCrowd(null)
    setProgress(0)
    try {
      // Then DancerChooser asks who to learn from (when there are several) and shows who we're following.
      setProcessed(await processVideoFile(file, { onProgress: setProgress }))
    } catch (e) {
      setError(e.message)
    } finally {
      setProgress(null)
    }
  }

  function chooseAgain(result) {
    setDance(null)
    setProcessed({ ...result }) // a fresh object restarts the chooser at the picker
  }

  /** Turn the followed dancer's moves into a lesson. */
  function build(result, tracked, person) {
    const { frames, trimmed } = rebase(tracked)
    setProcessed(null)
    setCrowd(result.people > 1 ? result : null)
    setScan(result)
    setDance(buildDance({
      dancer: dancerInfo(result, person),
      name: name || file.name.replace(/\.[^.]+$/, ''),
      bpm: Number(bpm),
      // Count 1 was marked in original video time; frames were re-based to the dancer's first frame.
      countStart: Math.max(0, Number(countStart) - trimmed),
      aspect: result.aspect,
      fps: result.fps,
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
        : (await api.createDance(dance)).id
      // Keep the original clip so the feed and practice screen can show it.
      await api.uploadVideo(id, file)
      // Optional extra: lets "change dancer" skip rescanning the video later.
      if (scan) await api.savePeople(id, packScan(scan)).catch(() => {})
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
          <details className="video-tips">
            <summary>📱 How do I get a video from TikTok, Reels or YouTube?</summary>
            <ul>
              <li><b>TikTok:</b> tap <b>Share → Save video</b> (only works if the creator allows downloads).</li>
              <li><b>Instagram Reels:</b> use your phone's <b>screen recording</b> while the reel plays.</li>
              <li><b>YouTube:</b> use <b>screen recording</b> too, and play it full-screen so the dancer is big.</li>
              <li><b>Best of all:</b> film yourself or a friend doing the dance: full body in frame, phone propped still.</li>
              <li>Then send it to your computer (AirDrop works great) and drop it here.</li>
            </ul>
            <p>We don't take links: TikTok, Instagram and YouTube don't allow other apps to download their videos, and most clips belong to the dancers who posted them. Only save videos you have permission to use.</p>
          </details>
        </div>

        <div className="upload-form">
          <label>Add it as
            <select value={replaceId} onChange={(e) => setReplaceId(e.target.value)}>
              <option value="">A new dance</option>
              {library.filter((d) => d.mine).map((d) => (
                <option key={d.id} value={d.id}>Replace {d.name}{d.hasVideo ? '' : ' (demo figure)'}</option>
              ))}
            </select>
          </label>
          <label>Name <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Juju On That Beat" /></label>
          <label>BPM <input type="number" value={bpm} min={40} max={200} onChange={(e) => setBpm(e.target.value)} /></label>
          <label>Count 1 starts at (seconds)
            <input type="number" step="0.05" value={countStart} min={0} onChange={(e) => setCountStart(e.target.value)} />
          </label>
          <p className="hint-text">Tip: full body in frame, plain background, good light, phone held still. Clap or count "5, 6, 7, 8" at the start, and put the time of count 1 above.</p>
          <button className="btn-pink wide" disabled={!file || progress !== null} onClick={process}>
            {progress !== null ? `PROCESSING… ${Math.round(progress * 100)}%` : 'TURN IT INTO A LESSON ✦'}
          </button>
          {error && <p className="warn">{error}</p>}
        </div>
      </Win>

      {processed && (
        <DancerChooser result={processed} src={fileUrl} onConfirm={(tracked, person) => build(processed, tracked, person)} />
      )}

      {dance && (
        <Win id="upload-steps" title="STEP_SPLITTER.exe" color="pink" className="upload-win">
          <h2 className="section-title small">{dance.name}</h2>
          <p className="muted">
            We split it into {dance.steps.length} {dance.steps.length === 1 ? 'step' : 'steps'} automatically
            (8 counts each). Happy with that? Save it. Want different steps? Edit them below.
          </p>
          {dance.dancer && (
            <p className="muted">
              <span className="dancer-chip" style={{ background: dance.dancer.color }}>DANCER {dance.dancer.number}</span>
              {' '}is the one you're learning. Wrong person? <button type="button" className="link-btn" onClick={() => chooseAgain(crowd)}>choose a different dancer</button>
            </p>
          )}
          <StepEditor key={dance.frames.length} dance={dance} videoSrc={fileUrl} onChange={setSteps} />
          <button className="btn-teal wide" onClick={save} disabled={saving}>
            {saving ? 'saving…' : replacing ? `replace ${replacing.name} & practice →` : 'save & practice →'}
          </button>
        </Win>
      )}
    </section>
  )
}
