import { useState } from 'react'

const SECONDS = 6

/** Records 6 seconds of a canvas into a looping, downloadable Vine-style clip. */
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
    <div className="vine">
      <button className="btn" onClick={record} disabled={state === 'recording'}>
        {state === 'recording' ? '🔴 Recording…' : '🎬 Record a 6s Vine'}
      </button>
      {url && state === 'done' && (
        <div className="vine-result">
          <video src={url} autoPlay loop muted playsInline />
          <a className="btn" href={url} download={`${name}-vine.webm`}>⬇️ Download</a>
        </div>
      )}
    </div>
  )
}
