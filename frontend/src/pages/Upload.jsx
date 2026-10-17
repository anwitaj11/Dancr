import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'
import { buildDance } from '../lib/dance.js'
import { processVideoFile } from '../lib/processVideo.js'
import SkeletonPlayer from '../components/SkeletonPlayer.jsx'

export default function Upload() {
  const navigate = useNavigate()
  const [file, setFile] = useState(null)
  const [name, setName] = useState('')
  const [bpm, setBpm] = useState(100)
  const [countStart, setCountStart] = useState(0)
  const [builtin, setBuiltin] = useState(false)
  const [progress, setProgress] = useState(null)
  const [dance, setDance] = useState(null)
  const [error, setError] = useState(null)

  async function process() {
    setError(null)
    setDance(null)
    setProgress(0)
    try {
      const { frames, aspect, trimmed } = await processVideoFile(file, { onProgress: setProgress })
      setDance(buildDance({
        name: name || file.name.replace(/\.[^.]+$/, ''),
        bpm: Number(bpm),
        // Count 1 was marked in original video time; frames were re-based to the first detection.
        countStart: Math.max(0, Number(countStart) - trimmed),
        aspect,
        videoOffset: trimmed,
        frames,
      }))
    } catch (e) {
      setError(e.message)
    } finally {
      setProgress(null)
    }
  }

  async function save() {
    const { id } = await api.createDance(dance, { builtin })
    // Keep the original clip so the practice screen can show it as the tutorial.
    await api.uploadVideo(id, file).catch((e) => console.warn(e))
    navigate(`/practice/${id}`)
  }

  return (
    <section className="narrow">
      <h1>New dance</h1>
      <p className="muted">
        Full body in frame, plain background, good light, phone held still. Count "5, 6, 7, 8" or clap at the
        start, then note the time of count 1 below.
      </p>
      <div className="card form">
        <label>Video <input type="file" accept="video/*" onChange={(e) => setFile(e.target.files[0])} /></label>
        <label>Name <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Juju On That Beat" /></label>
        <label>BPM <input type="number" value={bpm} min={40} max={200} onChange={(e) => setBpm(e.target.value)} /></label>
        <label>Count 1 starts at (seconds)
          <input type="number" step="0.05" value={countStart} min={0} onChange={(e) => setCountStart(e.target.value)} />
        </label>
        <label className="row"><input type="checkbox" checked={builtin} onChange={(e) => setBuiltin(e.target.checked)} /> Add to the built-in library</label>
        <button className="btn wide" disabled={!file || progress !== null} onClick={process}>
          {progress !== null ? `Processing… ${Math.round(progress * 100)}%` : 'Turn it into a lesson ✨'}
        </button>
        {error && <p className="warn">{error}</p>}
      </div>

      {dance && (
        <div className="card">
          <h2>{dance.name}</h2>
          <p className="muted">{dance.frames.length} frames · {dance.steps.length} steps of 8 counts</p>
          <div className="panel preview-panel"><SkeletonPlayer dance={dance} /></div>
          <ol className="steps">
            {dance.steps.map((s) => <li key={s.index}>{s.label}: {s.start.toFixed(2)}s – {s.end.toFixed(2)}s</li>)}
          </ol>
          <button className="btn wide" onClick={save}>Save & practice</button>
        </div>
      )}
    </section>
  )
}
