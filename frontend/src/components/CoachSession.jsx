import { useEffect, useRef, useState } from 'react'
import { ConversationProvider, useConversation } from '@elevenlabs/react'
import { api, currentUser } from '../lib/api.js'
import { useCoachContext } from '../lib/coachContext.jsx'
import { Win } from './Retro.jsx'

// Talk to "Dancr Coach", the ElevenLabs agent configured in the ElevenLabs
// dashboard. The backend (/voice-agent/session) decides how to connect, so the
// API key never reaches the browser.

const MAX_LINES = 6

const BASE_CONTEXT = [
  'You are talking to a dancer inside Dancr, a webcam dance-learning app.',
  'Dancr tracks their pose with the webcam and scores each try as a match percentage (70% or more completes a step).',
  'You cannot see the dancer or the video. Only use the facts in these Dancr updates; never invent scores or claim to see their moves.',
].join(' ')

function friendlyError(message = '') {
  const m = message.toLowerCase()
  // The SDK says this when the agent has authentication turned on but we connected with just the Agent ID.
  if (m.includes('authentication enabled') || /\b401\b/.test(m)) {
    return 'Your Dancr Coach agent is private. Add ELEVENLABS_API_KEY to backend/.env and restart the backend.'
  }
  if (m.includes('conversation token') || m.includes('elevenlabs api returned')) {
    return `Couldn't connect to ElevenLabs. Check your internet connection and that the Agent ID is right. (${message})`
  }
  if (m.includes('permission') || m.includes('notallowed') || m.includes('microphone')) {
    return 'Dancr needs your microphone. Click the 🔒 or camera icon in the address bar, allow the microphone, then try again.'
  }
  if (m.includes('failed to fetch') || m.includes('networkerror') || m.includes('load failed')) {
    return "Can't reach the Dancr backend. Make sure it's running (uvicorn) on port 8000."
  }
  return message || 'Something went wrong. Try again.'
}

async function ensureMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser has no microphone support. Try Chrome.')
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach((t) => t.stop()) // only asking for permission; the SDK opens its own stream
  } catch (e) {
    if (e.name === 'NotAllowedError' || e.name === 'SecurityError') throw new Error('microphone permission denied')
    if (e.name === 'NotFoundError') throw new Error('No microphone found. Plug one in or check your sound settings.')
    throw e
  }
}

function CoachPanel({ onClose }) {
  const coach = useCoachContext()
  const [lines, setLines] = useState([])
  const [error, setError] = useState(null)
  const [preparing, setPreparing] = useState(false)
  const summaryRef = useRef(coach?.summary)
  summaryRef.current = coach?.summary

  const conversation = useConversation({
    onConnect: () => {
      setError(null)
      conversation.sendContextualUpdate(`${BASE_CONTEXT} ${summaryRef.current || ''}`.trim())
    },
    onMessage: ({ message, role }) => {
      if (!message) return
      setLines((prev) => [...prev, { role, text: message }].slice(-MAX_LINES))
    },
    onError: (message) => setError(friendlyError(message)),
  })
  const { status, isSpeaking, isMuted, setMuted } = conversation
  const connected = status === 'connected'
  const busy = preparing || status === 'connecting'

  // Let the practice page know (so it doesn't talk over the coach).
  useEffect(() => {
    coach?.setVoiceActive(connected)
    return () => coach?.setVoiceActive(false)
  }, [connected]) // eslint-disable-line react-hooks/exhaustive-deps

  // New ratings while talking: keep the coach up to date.
  useEffect(() => {
    if (connected && coach?.summary) conversation.sendContextualUpdate(coach.summary)
  }, [coach?.summary]) // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    setError(null)
    setPreparing(true)
    try {
      await ensureMicrophone()
      const session = await api.voiceSession()
      const common = { connectionType: 'webrtc', userId: currentUser() }
      conversation.startSession(
        session.conversationToken
          ? { ...common, conversationToken: session.conversationToken }
          : { ...common, agentId: session.agentId },
      )
    } catch (e) {
      setError(friendlyError(e.message))
    } finally {
      setPreparing(false)
    }
  }

  const statusLabel = busy ? 'connecting…' : connected ? (isSpeaking ? 'coach is talking' : 'listening to you') : 'not connected'

  return (
    <Win title="DANCR_COACH.exe — voice" color="pink" controls={false}
      extra={<button className="win-close" onClick={() => { conversation.endSession(); onClose() }} aria-label="Close voice coach">×</button>}
      className="coach-win">
      <div className={`coach-status ${connected ? (isSpeaking ? 'speaking' : 'listening') : ''}`} role="status" aria-live="polite">
        <span className="coach-dot" /> {statusLabel}
      </div>
      {!connected && !error && (
        <p className="coach-intro">
          Ask about a move, how to count a step, or what to work on. I know your ratings in Dancr, but I can't see your camera.
        </p>
      )}
      {lines.length > 0 && (
        <ul className="coach-lines">
          {lines.map((l, i) => <li key={i} className={l.role === 'agent' ? 'agent' : 'user'}>{l.text}</li>)}
        </ul>
      )}
      {error && <p className="coach-error" role="alert">⚠️ {error}</p>}
      <div className="row center">
        {connected ? (
          <>
            <button className="btn-pink" onClick={() => conversation.endSession()}>■ STOP TALKING</button>
            <button className="btn-bracket" onClick={() => setMuted(!isMuted)} aria-pressed={isMuted}>
              {isMuted ? '[ 🎙️ UNMUTE ]' : '[ 🔇 MUTE MIC ]'}
            </button>
          </>
        ) : (
          <button className="btn-teal" onClick={start} disabled={busy}>{busy ? 'connecting…' : '🎙️ start talking'}</button>
        )}
      </div>
    </Win>
  )
}

/** Loaded on demand (the ElevenLabs SDK is big), so it only costs anything once opened. */
export default function CoachSession({ onClose }) {
  return (
    <ConversationProvider>
      <CoachPanel onClose={onClose} />
    </ConversationProvider>
  )
}
