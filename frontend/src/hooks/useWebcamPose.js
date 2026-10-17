import { useEffect, useRef, useState } from 'react'
import { getLandmarker } from '../lib/pose.js'
import { toPose } from '../lib/angles.js'
import { pickLargest } from '../lib/people.js'

/**
 * Webcam + PoseLandmarker loop. Calls onFrame({ pose, people, video, now }) every
 * animation frame. pose is the person closest to the camera (null when no one
 * is found); people is how many were seen, so the UI can say who it's scoring.
 */
export function useWebcamPose(onFrame) {
  // Callback ref: the camera starts once the <video> is actually mounted,
  // even if the page renders a loading state first.
  const [video, videoRef] = useState(null)
  const onFrameRef = useRef(onFrame)
  const [status, setStatus] = useState('starting') // starting | ready | error
  const [error, setError] = useState(null)
  onFrameRef.current = onFrame

  useEffect(() => {
    if (!video) return
    let stream, raf, cancelled = false
    let lastTs = -1

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
          audio: false,
        })
        // Unmounted while waiting for permission (e.g. React StrictMode's double effect).
        if (cancelled) return stream.getTracks().forEach((t) => t.stop())
        video.srcObject = stream
        await video.play()
        const landmarker = await getLandmarker('webcam', { numPoses: 3 })
        if (cancelled) return
        setStatus('ready')
        const loop = () => {
          const now = performance.now()
          if (video.readyState >= 2 && now > lastTs) {
            lastTs = now
            const result = landmarker.detectForVideo(video, now)
            const poses = (result.landmarks ?? []).map(toPose)
            onFrameRef.current?.({ pose: poses.length ? pickLargest(poses) : null, people: poses.length, video, now })
          }
          raf = requestAnimationFrame(loop)
        }
        loop()
      } catch (e) {
        if (cancelled) return
        setStatus('error')
        setError(e.name === 'NotAllowedError' ? 'Camera access was blocked. Allow it in your browser and reload.' : e.message)
      }
    }
    start()
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [video])

  return { videoRef, status, error }
}
