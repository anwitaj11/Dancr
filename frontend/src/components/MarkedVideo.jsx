import { useEffect, useRef } from 'react'
import { poseAt } from '../lib/people.js'
import { containRect, drawDancerMarker } from '../lib/skeleton.js'

/**
 * A looping video (object-fit: cover) with a tag over the lesson's dancer,
 * for library cards. dance: the stored dance JSON (frames, videoOffset, dancer).
 */
export default function MarkedVideo({ src, dance, small = false }) {
  const video = useRef(null)
  const canvas = useRef(null)

  useEffect(() => {
    let raf
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const v = video.current, c = canvas.current
      if (!v || !c) return
      const w = c.clientWidth, h = c.clientHeight
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h }
      const ctx = c.getContext('2d')
      ctx.clearRect(0, 0, w, h)
      const pose = poseAt(dance.frames, v.currentTime - (dance.videoOffset ?? 0))
      if (pose) {
        drawDancerMarker(ctx, pose, containRect(w, h, v.videoWidth, v.videoHeight, true), {
          color: dance.dancer.color, label: small ? String(dance.dancer.number) : `COPY DANCER ${dance.dancer.number}`, body: false,
        })
      }
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [dance, small])

  return (
    <>
      <video ref={video} src={src} className="fill cover" autoPlay loop muted playsInline preload="metadata" />
      <canvas ref={canvas} className="fill dancer-marker" />
    </>
  )
}
