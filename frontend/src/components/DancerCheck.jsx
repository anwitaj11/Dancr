import { useEffect, useRef } from 'react'
import { poseAt } from '../lib/people.js'
import { drawDancerMarker, drawSkeleton } from '../lib/skeleton.js'

const OTHERS = '#ffffff66'

/**
 * Plays the uploaded video with the dancer we're following drawn over it in
 * their colour (everyone else faint), so the uploader can check we picked and
 * kept the right person the whole way through.
 */
export default function DancerCheck({ src, aspect, raw, tracked, color, label, suspects = [] }) {
  const video = useRef(null)
  const canvas = useRef(null)
  const lost = useRef(null)

  useEffect(() => {
    let frame
    const fps = raw.length > 1 ? 1 / (raw[1].t - raw[0].t) : 30
    const draw = () => {
      frame = requestAnimationFrame(draw)
      const v = video.current, c = canvas.current
      if (!v || !c) return
      const w = c.clientWidth, h = c.clientHeight
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h }
      const ctx = c.getContext('2d')
      ctx.clearRect(0, 0, w, h)
      const t = v.currentTime
      const dancer = poseAt(tracked, t)
      for (const pose of raw[Math.min(raw.length - 1, Math.round(t * fps))]?.poses ?? []) {
        if (pose !== dancer) drawSkeleton(ctx, pose, { color: OTHERS, lineWidth: 3 })
      }
      if (dancer) drawDancerMarker(ctx, dancer, { x: 0, y: 0, w, h }, { color, label, lineWidth: 7 })
      if (lost.current) lost.current.hidden = Boolean(dancer)
    }
    draw()
    return () => cancelAnimationFrame(frame)
  }, [raw, tracked, color, label])

  const jump = (t) => {
    if (!video.current) return
    video.current.currentTime = Math.max(0, t - 1)
    video.current.play().catch(() => {})
  }

  return (
    <div className="dancer-check">
      <div className="dancer-check-view" style={{ aspectRatio: aspect, width: `min(100%, 640px, ${Math.round(70 * aspect)}vh)` }}>
        <video ref={video} src={src} controls playsInline muted loop />
        <canvas ref={canvas} />
        <span ref={lost} className="dancer-lost" hidden>can't see them here</span>
      </div>
      {suspects.length > 0 && (
        <p className="dancer-suspects">
          ⚠️ It might have switched to someone else at{' '}
          {suspects.map((t) => (
            <button key={t} type="button" className="chip" onClick={() => jump(t)}>
              {Math.floor(t / 60)}:{String(Math.floor(t % 60)).padStart(2, '0')}
            </button>
          ))}
          {' '}— tap a time to check.
        </p>
      )}
    </div>
  )
}
