import { useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useWebcamPose } from '../hooks/useWebcamPose.js'
import { bodyInFrame, computeAngles, isTPose } from '../lib/angles.js'
import { drawSkeleton } from '../lib/skeleton.js'

const HOLD_MS = 2000

export function markCalibrated() {
  try {
    sessionStorage.setItem('dablab.calibrated', '1')
  } catch {
    // storage blocked: calibration just repeats next time
  }
}

export function isCalibrated() {
  try {
    return sessionStorage.getItem('dablab.calibrated') === '1'
  } catch {
    return false
  }
}

export default function Calibrate() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const canvasRef = useRef(null)
  const holdStart = useRef(null)
  const [stage, setStage] = useState('frame') // frame | tpose | done
  const [hold, setHold] = useState(0)

  const { videoRef, status, error } = useWebcamPose(({ pose, video, now }) => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (!pose) {
      setStage((s) => (s === 'done' ? s : 'frame'))
      return
    }
    const inFrame = bodyInFrame(pose).ok
    drawSkeleton(ctx, pose, { color: inFrame ? '#39ff88' : '#ff3b6b' })
    if (stage === 'done') return
    if (!inFrame) {
      holdStart.current = null
      setHold(0)
      setStage('frame')
      return
    }
    setStage('tpose')
    if (isTPose(computeAngles(pose, video.videoWidth / video.videoHeight))) {
      holdStart.current ??= now
      const held = (now - holdStart.current) / HOLD_MS
      setHold(Math.min(1, held))
      if (held >= 1) {
        markCalibrated()
        setStage('done')
        setTimeout(() => navigate(params.get('next') || '/'), 900)
      }
    } else {
      holdStart.current = null
      setHold(0)
    }
  })

  const message = {
    frame: '📏 Step back until your whole body (head to feet) is visible',
    tpose: '🙆 Hold a T-pose: arms straight out to the sides',
    done: '✅ You\'re all set! Tracking works.',
  }[stage]

  return (
    <section className="narrow">
      <h1>Calibration</h1>
      {error && <p className="warn">{error}</p>}
      {status === 'starting' && <p className="muted">Starting camera and loading the pose model…</p>}
      <div className="cam">
        <video ref={videoRef} playsInline muted />
        <canvas ref={canvasRef} />
      </div>
      <p className="big">{message}</p>
      {stage === 'tpose' && <progress value={hold} max={1} />}
      <button className="btn ghost" onClick={() => { markCalibrated(); navigate(params.get('next') || '/') }}>Skip</button>
    </section>
  )
}
