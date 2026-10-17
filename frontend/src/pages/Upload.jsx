import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api.js'
import { buildDance } from '../lib/dance.js'
import { PERSON_COLORS, processVideoFile } from '../lib/processVideo.js'
import { rebase, trackDancer, trackReport } from '../lib/people.js'
import DancerCheck from '../components/DancerCheck.jsx'
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
  const [check, setCheck] = useState(null) // the chosen dancer, before they're confirmed
  const [crowd, setCrowd] = useState(null) // the multi-person video the current lesson came from
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
    setCheck(null)
    setCrowd(null)
    setProgress(0)
    try {
      const result = await processVideoFile(file, { onProgress: setProgress })
      // More than one person: always ask who to learn from, then let them check it.
      if (result.people > 1) setPicking(result)
      else {
        const tracked = follow(result, 0)
        if (tracked) build(result, tracked)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setProgress(null)
    }
  }

  /** Follow one dancer (0 = leftmost) through the video; null if they're barely in it. */
  function follow(result, person) {
    const tracked = trackDancer(result.raw, result.anchor, person)
    if (tracked.length < 30) {
      setError("Couldn't follow that dancer for long enough. Try a clip where they stay in frame, or pick someone else.")
      return null
    }
    return tracked
  }

  /** Picked from several people: show who we're following so they can check it. */
  function choose(result, person) {
    setError(null)
    const tracked = follow(result, person)
    if (!tracked) return
    setPicking(null)
    setCheck({ result, person, tracked, report: trackReport(result.raw, tracked) })
  }

  function chooseAgain(result) {
    setCheck(null)
    setDance(null)
    setPicking(result)
  }

  /** Turn the followed dancer's moves into a lesson. */
  function build(result, tracked) {
    const { frames, trimmed } = rebase(tracked)
    setPicking(null)
    setCheck(null)
    setCrowd(result.people > 1 ? result : null)
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
              <button key={i} type="button" className={`btn-pink person-${i}`} onClick={() => choose(picking, i)}>
                DANCER {i + 1}{i === 0 ? ' (LEFT)' : i === picking.people - 1 ? ' (RIGHT)' : ''}
              </button>
            ))}
          </div>
        </Win>
      )}

      {check && (
        <Win title="CHECK_YOUR_DANCER.exe" color="lime" className="upload-win">
          <p className="script pink">quick check ↓</p>
          <h2 className="section-title small">Is this who you want to learn from?</h2>
          <p className="muted">
            Press play: Dancer {check.person + 1} is drawn in their colour, everyone else is faint.
            Make sure the coloured skeleton stays on the same person the whole way through.
          </p>
          <DancerCheck src={fileUrl} aspect={check.result.aspect} raw={check.result.raw} tracked={check.tracked}
            color={PERSON_COLORS[check.person % PERSON_COLORS.length]} suspects={check.report.suspects} />
          <p className="dancer-coverage">
            👀 We could see Dancer {check.person + 1} in <b>{Math.round(check.report.coverage * 100)}%</b> of their part of the video
            {check.report.coverage < 0.8 ? ' (they were hidden or blocked a lot: scores may be patchy)' : ''}.
          </p>
          <div className="row people-picks">
            <button type="button" className="btn-teal" onClick={() => build(check.result, check.tracked)}>✓ YES, THAT'S THEM</button>
            <button type="button" className="btn-orange" onClick={() => chooseAgain(check.result)}>↺ PICK A DIFFERENT DANCER</button>
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
          {crowd && (
            <p className="muted">
              Wrong person? <button type="button" className="link-btn" onClick={() => chooseAgain(crowd)}>choose a different dancer</button>
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
