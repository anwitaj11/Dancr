import { Suspense, lazy, useState } from 'react'

const CoachSession = lazy(() => import('./CoachSession.jsx'))

/** Floating "talk to your coach" button, available on every page. */
export default function VoiceCoach() {
  const [open, setOpen] = useState(false)
  return (
    <div className="voice-coach">
      {open ? (
        <Suspense fallback={<div className="coach-loading"><div className="spinner" /></div>}>
          <CoachSession onClose={() => setOpen(false)} />
        </Suspense>
      ) : (
        <button className="coach-fab" onClick={() => setOpen(true)} aria-label="Talk to Dancr Coach">
          🎙️<span>talk to your coach</span>
        </button>
      )}
    </div>
  )
}
