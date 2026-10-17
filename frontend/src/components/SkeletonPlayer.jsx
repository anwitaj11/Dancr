import { useEffect, useMemo, useRef } from 'react'
import { danceBounds } from '../lib/dance.js'
import { sampleAt } from '../lib/scoring.js'
import { drawSkeleton } from '../lib/skeleton.js'
import { mirrorPose } from '../lib/angles.js'

/**
 * Plays a dance's reference skeleton.
 * - Self-clocked loop (previews): pass start/end/speed.
 * - Externally clocked (practice): pass getTime() returning reference seconds.
 */
export default function SkeletonPlayer({
  dance, start = 0, end, speed = 1, getTime, mirror = false, width = 360, height = 360,
  color = '#ffffff', highlight, className,
}) {
  const canvasRef = useRef(null)
  const bounds = useMemo(() => danceBounds(dance.frames, dance.aspect), [dance])
  const stop = end ?? dance.frames[dance.frames.length - 1].t

  useEffect(() => {
    const ctx = canvasRef.current.getContext('2d')
    const t0 = performance.now()
    let raf
    const draw = () => {
      const t = getTime ? getTime() : start + ((((performance.now() - t0) / 1000) * speed) % (stop - start))
      let { pose } = sampleAt(dance.frames, t)
      if (mirror) pose = mirrorPose(pose)
      const b = mirror ? { ...bounds, minX: 1 - bounds.maxX, maxX: 1 - bounds.minX } : bounds
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
      drawSkeleton(ctx, pose, { bounds: b, color, highlight })
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [dance, bounds, start, stop, speed, getTime, mirror, color, highlight])

  return <canvas ref={canvasRef} width={width} height={height} className={className} />
}
