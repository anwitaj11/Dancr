import { createContext, useContext, useEffect, useMemo, useState } from 'react'

// What the Dancr Coach voice agent is told about the dancer. Pages publish a
// plain-text summary of what Dancr actually knows (ratings from pose tracking,
// the current dance and step); the agent never sees the webcam itself.

const CoachContext = createContext(null)

export function CoachContextProvider({ children }) {
  const [summary, setSummary] = useState('')
  const [voiceActive, setVoiceActive] = useState(false)
  const value = useMemo(() => ({ summary, setSummary, voiceActive, setVoiceActive }), [summary, voiceActive])
  return <CoachContext.Provider value={value}>{children}</CoachContext.Provider>
}

export function useCoachContext() {
  return useContext(CoachContext)
}

/** Publish this page's summary for the voice coach while the page is open. */
export function useCoachSummary(text) {
  const ctx = useContext(CoachContext)
  const setSummary = ctx?.setSummary
  useEffect(() => {
    if (!setSummary) return
    setSummary(text)
    return () => setSummary('')
  }, [text, setSummary])
}
