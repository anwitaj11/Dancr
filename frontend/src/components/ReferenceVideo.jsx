import { useEffect, useRef } from 'react'
import { poseAt } from '../lib/people.js'
import { containRect, drawDancerMarker } from '../lib/skeleton.js'

const DRIFT = 0.6 // allow natural playback; frequent hard seeks cause visible stutter

/**
 * The original reference video, kept in sync with the practice clock.
 * getTime() returns dance time; offset maps it to video time (frames are
 * re-based to the first detected pose when a dance is processed).
 * With muted={false} the clip's own music plays along; the browser keeps the
 * pitch natural at slower speeds.
 * dancer: { frames, color, label, body } marks who to copy when the clip has several people
 * (a tag over their head, plus their skeleton when body is true).
 */
export default function ReferenceVideo({ src, getTime, offset = 0, speed = 1, playing, mirror, muted = true, volume = 1, className, dancer }) {
  const ref = useRef(null)
  const marker = useRef(null)

  useEffect(() => {
    const video = ref.current
    let raf
    const sync = () => {
      const target = getTime() + offset
      video.playbackRate = speed
      if (playing) {
        if (video.paused) video.play().catch(() => {})
        if (!video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - target) > DRIFT) video.currentTime = target
      } else {
        if (!video.paused) video.pause()
        if (!video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - target) > 0.12) video.currentTime = target
      }
      if (dancer && marker.current) drawMarker(marker.current, video, dancer, getTime(), mirror)
      raf = requestAnimationFrame(sync)
    }
    sync()
    return () => cancelAnimationFrame(raf)
  }, [getTime, offset, speed, playing, dancer, mirror])

  useEffect(() => {
    const video = ref.current
    video.muted = muted
    video.volume = Math.min(1, Math.max(0, volume))
    video.preservesPitch = true
  }, [muted, volume])

  return (
    <>
      <video ref={ref} src={src} muted={muted} playsInline preload="auto" className={className}
        style={mirror ? { transform: 'scaleX(-1)' } : undefined} />
      {dancer && <canvas ref={marker} className="fill dancer-marker" />}
    </>
  )
}

function drawMarker(canvas, video, { frames, color, label, body }, t, mirror) {
  const w = canvas.clientWidth, h = canvas.clientHeight
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, w, h)
  const pose = poseAt(frames, t)
  if (pose) drawDancerMarker(ctx, pose, containRect(w, h, video.videoWidth, video.videoHeight), { color, label, mirror, body, lineWidth: 4 })
}
