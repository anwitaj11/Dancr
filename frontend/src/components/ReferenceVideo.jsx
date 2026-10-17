import { useEffect, useRef } from 'react'

const DRIFT = 0.15 // seconds before we hard-seek back into sync

/**
 * The original reference video, kept in sync with the practice clock.
 * getTime() returns dance time; offset maps it to video time (frames are
 * re-based to the first detected pose when a dance is processed).
 */
export default function ReferenceVideo({ src, getTime, offset = 0, speed = 1, playing, mirror, className }) {
  const ref = useRef(null)

  useEffect(() => {
    const video = ref.current
    let raf
    const sync = () => {
      const target = getTime() + offset
      video.playbackRate = speed
      if (playing) {
        if (video.paused) video.play().catch(() => {})
        if (Math.abs(video.currentTime - target) > DRIFT) video.currentTime = target
      } else {
        if (!video.paused) video.pause()
        if (Math.abs(video.currentTime - target) > 0.04) video.currentTime = target
      }
      raf = requestAnimationFrame(sync)
    }
    sync()
    return () => cancelAnimationFrame(raf)
  }, [getTime, offset, speed, playing])

  return (
    <video ref={ref} src={src} muted playsInline preload="auto" className={className}
      style={mirror ? { transform: 'scaleX(-1)' } : undefined} />
  )
}
