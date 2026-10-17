import { useEffect, useRef, useState } from 'react'
import RailButton from './RailButton.jsx'

export const SPEEDS = [0.3, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1]

/** Snap any speed (e.g. from the learner profile) to the closest menu option. */
export function nearestSpeed(value) {
  return SPEEDS.reduce((best, s) => (Math.abs(s - value) < Math.abs(best - value) ? s : best), 1)
}

export const formatSpeed = (s) => `${s.toFixed(1)}x`

/** One rail button showing the current speed; tapping opens all speed options. */
export default function SpeedPicker({ speed, onChange, disabled }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false)
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  return (
    <div className="speed-picker" ref={ref}>
      <RailButton icon={<span className="speed-icon">{formatSpeed(speed)}</span>} label="Speed"
        active={open} disabled={disabled} onClick={() => setOpen((o) => !o)} />
      {open && (
        <div className="speed-menu" role="menu">
          {SPEEDS.map((s) => (
            <button key={s} role="menuitemradio" aria-checked={s === speed} className={s === speed ? 'on' : ''}
              onClick={() => { onChange(s); setOpen(false) }}>
              {formatSpeed(s)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
