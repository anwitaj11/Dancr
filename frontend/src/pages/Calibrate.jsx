import { useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useWebcamPose } from '../hooks/useWebcamPose.js'
import { bodyInFrame, computeAngles, isTPose } from '../lib/angles.js'

const HOLD_MS = 1200
const TRACKING_GRACE_MS = 350

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
  const holdStart = useRef(null)
  const lastGood = useRef(null)
  const [stage, setStage] = useState('frame') // frame | tpose | done
  const [hold, setHold] = useState(0)
  const next = params.get('next') || '/'

  const { videoRef, status, error } = useWebcamPose(({ pose, video, now }) => {
    if (stage === 'done') return
    if (!pose || !bodyInFrame(pose).ok) {
      if (lastGood.current != null && now - lastGood.current < TRACKING_GRACE_MS) return
      holdStart.current = null
      lastGood.current = null
      setHold(0)
      setStage('frame')
      return
    }
    setStage('tpose')
    if (isTPose(computeAngles(pose, video.videoWidth / video.videoHeight))) {
      if (lastGood.current != null && now - lastGood.current > TRACKING_GRACE_MS) holdStart.current = null
      holdStart.current ??= now
      lastGood.current = now
      const held = (now - holdStart.current) / HOLD_MS
      setHold(Math.min(1, held))
      if (held >= 1) {
        markCalibrated()
        setStage('done')
        setTimeout(() => navigate(next), 900)
      }
    } else {
      if (lastGood.current != null && now - lastGood.current < TRACKING_GRACE_MS) return
      holdStart.current = null
      lastGood.current = null
      setHold(0)
    }
  })

  const message = {
    frame: { emoji: '📏', title: 'Step back', body: 'Get your whole body, head to feet, inside the frame' },
    tpose: { emoji: '🙆', title: 'Hold a T-pose', body: 'Raise both arms to shoulder height and hold briefly' },
    done: { emoji: '✅', title: "You're all set", body: 'Tracking works. Let’s dance!' },
  }[stage]

  return (
    <section className="calibrate">
      <div className={`calib-cam stage-${stage}`} style={{ '--hold': hold }}>
        <video ref={videoRef} playsInline muted />
        <div className="frame-guide" aria-hidden="true"><i /><i /><i /><i /></div>
        {status === 'starting' && <div className="cam-status"><div className="spinner" /> Starting camera…</div>}
        {error && <div className="cam-status warn">{error}</div>}
        <div className="calib-card">
          <span className="calib-emoji">{message.emoji}</span>
          <div>
            <b>{message.title}</b>
            <span>{message.body}</span>
          </div>
          {stage === 'tpose' && <div className="hold-bar"><div /></div>}
        </div>
      </div>
      <button className="skip" onClick={() => { markCalibrated(); navigate(next) }}>Skip</button>
    </section>
  )
}
