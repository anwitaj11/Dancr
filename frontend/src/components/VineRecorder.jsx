import { useState } from 'react'
import RailButton from './RailButton.jsx'

const SECONDS = 6

/** Rail button that records 6 seconds of a canvas into a looping, downloadable clip. */
export default function VineRecorder({ canvasRef, name = 'dab-lab' }) {
  const [state, setState] = useState('idle') // idle | recording | done
  const [url, setUrl] = useState(null)

  function record() {
    const stream = canvasRef.current.captureStream(30)
    const type = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'].find((t) => MediaRecorder.isTypeSupported(t))
    const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined)
    const chunks = []
    recorder.ondataavailable = (e) => chunks.push(e.data)
    recorder.onstop = () => {
      if (url) URL.revokeObjectURL(url)
      setUrl(URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType })))
      setState('done')
    }
    recorder.start()
    setState('recording')
    setTimeout(() => recorder.stop(), SECONDS * 1000)
  }

  return (
    <>
      <RailButton icon={state === 'recording' ? <span className="rec-dot" /> : '🎬'}
        label={state === 'recording' ? 'Rec…' : '6s Vine'} active={state === 'recording'}
        disabled={state === 'recording'} onClick={record} />
      {url && state === 'done' && (
        <div className="modal" onClick={() => setState('idle')}>
          <div className="vine-result" onClick={(e) => e.stopPropagation()}>
            <video src={url} autoPlay loop muted playsInline />
            <div className="row center">
              <a className="btn" href={url} download={`${name}-vine.webm`}>Save</a>
              <button className="btn ghost" onClick={() => setState('idle')}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
