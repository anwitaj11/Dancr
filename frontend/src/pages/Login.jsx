import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { Logo } from '../components/Retro.jsx'

export default function Login({ onRecovered }) {
  const [mode, setMode] = useState('login')
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setMode('new-password')
    })
    return () => subscription.unsubscribe()
  }, [])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    try {
      if (mode === 'new-password') {
        const { error } = await supabase.auth.updateUser({ password })
        if (error) throw error
        setMessage('Your password has been updated.')
        onRecovered?.()
      } else if (mode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
        if (error) throw error
        setMessage('Check your email for a password reset link.')
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        if (!data.session) setMessage('Check your email to confirm your account, then sign in.')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  return (
    <section className="upload-page grid-bg cool" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
      <div className="upload-win" style={{ maxWidth: 470, width: 'min(92vw, 470px)', padding: 28, background: 'white', border: '3px solid #1d1030', boxShadow: '8px 8px #ff3ea5' }}>
        <Logo />
        <h1 style={{ marginTop: 22 }}>{mode === 'signup' ? 'JOIN THE DANCE ✦' : mode === 'reset' || mode === 'new-password' ? 'RESET PASSWORD' : 'WELCOME BACK ✦'}</h1>
        <p>Save your dances, scores, and progress in your own account.</p>
        <form onSubmit={submit} className="upload-form">
          <label>Email<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
          {mode !== 'reset' && <label>Password<input type="password" minLength={6} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} required /></label>}
          {error && <p role="alert" className="warn">{error}</p>}
          {message && <p role="status">{message}</p>}
          <button className="btn-pink wide" type="submit" disabled={busy}>{busy ? 'one sec…' : mode === 'signup' ? 'CREATE ACCOUNT →' : mode === 'reset' ? 'SEND RESET LINK →' : mode === 'new-password' ? 'UPDATE PASSWORD →' : 'SIGN IN →'}</button>
        </form>
        <p style={{ marginTop: 16 }}>
          <button type="button" className="link-btn" onClick={() => { setMode(mode === 'signup' ? 'login' : 'signup'); setError(''); setMessage('') }}>{mode === 'signup' ? 'Already have an account? Sign in' : 'New here? Sign up'}</button>
        </p>
        <button type="button" className="link-btn" onClick={() => { setMode(mode === 'reset' ? 'login' : 'reset'); setError(''); setMessage('') }}>{mode === 'reset' ? 'Back to sign in' : 'Forgot password?'}</button>
      </div>
    </section>
  )
}
