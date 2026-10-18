import { useEffect, useState } from 'react'
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { currentUser, setCurrentUser } from './lib/api.js'
import { supabase } from './lib/supabase.js'
import Login from './pages/Login.jsx'
import { APP_NAME, Logo } from './components/Retro.jsx'
import Library from './pages/Library.jsx'
import Upload from './pages/Upload.jsx'
import Calibrate from './pages/Calibrate.jsx'
import Practice from './pages/Practice.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Remix from './pages/Remix.jsx'
import EditSteps from './pages/EditSteps.jsx'
import ChooseDancer from './pages/ChooseDancer.jsx'
import VoiceCoach from './components/VoiceCoach.jsx'
import { CoachContextProvider } from './lib/coachContext.jsx'

function Shell() {
  const user = currentUser()
  const { pathname } = useLocation()
  // Calibration is full-screen camera.
  const immersive = pathname.startsWith('/calibrate')

  return (
    <>
      {!immersive && (
        <header className="topbar">
          <Link to="/" aria-label={`${APP_NAME} home`}><Logo /></Link>
          <nav className="topnav">
            <NavLink to="/" end>Discover</NavLink>
            <a href="/#how">How It Works</a>
            <NavLink to="/upload">Upload</NavLink>
            <NavLink to="/profile">My Practice</NavLink>
          </nav>
          <span className="user" title="Signed-in account">@{user.slice(0, 12)}</span>
          <button type="button" className="link-btn" onClick={() => supabase.auth.signOut()}>Log out</button>
          <a href="/#dances" className="cta">Let's Dance! <span aria-hidden="true">→</span></a>
        </header>
      )}
      <main key={user} className={immersive ? 'immersive' : ''}>
        <Routes>
          <Route path="/" element={<Library />} />
          <Route path="/upload" element={<Upload />} />
          <Route path="/calibrate" element={<Calibrate />} />
          <Route path="/practice/:id" element={<Practice />} />
          <Route path="/remix/:id" element={<Remix />} />
          <Route path="/steps/:id" element={<EditSteps />} />
          <Route path="/dancer/:id" element={<ChooseDancer />} />
          <Route path="/profile" element={<Dashboard />} />
          <Route path="/dashboard" element={<Navigate to="/profile" replace />} />
        </Routes>
      </main>
      {!immersive && <VoiceCoach />}
      {!immersive && (
        <footer className="footer-band">
          Made with rhythm, glitter &amp; a little bit of internet magic ✦ {APP_NAME} 2016–forever
        </footer>
      )}
    </>
  )
}

export default function App() {
  const [session, setSession] = useState(undefined)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session)).catch(() => setSession(null))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setCurrentUser(next?.user?.id || 'guest')
    })
    return () => subscription.unsubscribe()
  }, [])
  if (session === undefined) return <div className="page-loading"><div className="spinner" /></div>
  if (!session) return <Login />
  return (
    <BrowserRouter>
      <CoachContextProvider>
        <Shell />
      </CoachContextProvider>
    </BrowserRouter>
  )
}
