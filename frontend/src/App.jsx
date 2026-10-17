import { useState } from 'react'
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { currentUser, setCurrentUser } from './lib/api.js'
import Library from './pages/Library.jsx'
import Upload from './pages/Upload.jsx'
import Calibrate from './pages/Calibrate.jsx'
import Practice from './pages/Practice.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Remix from './pages/Remix.jsx'

function Shell() {
  const [user, setUser] = useState(currentUser())
  const { pathname } = useLocation()
  // Practice and calibration are full-screen, like recording in Musical.ly.
  const immersive = pathname.startsWith('/practice') || pathname.startsWith('/calibrate')

  return (
    <>
      {!immersive && (
        <header className="topbar">
          <NavLink to="/" className="logo">Dab Lab</NavLink>
          <label className="user">
            <span>@</span>
            <input aria-label="Your username" value={user}
              onChange={(e) => { setUser(e.target.value); setCurrentUser(e.target.value || 'guest') }} />
          </label>
        </header>
      )}
      <main key={user} className={immersive ? 'immersive' : ''}>
        <Routes>
          <Route path="/" element={<Library />} />
          <Route path="/upload" element={<Upload />} />
          <Route path="/calibrate" element={<Calibrate />} />
          <Route path="/practice/:id" element={<Practice />} />
          <Route path="/remix/:id" element={<Remix />} />
          <Route path="/profile" element={<Dashboard />} />
          <Route path="/dashboard" element={<Navigate to="/profile" replace />} />
        </Routes>
      </main>
      {!immersive && (
        <nav className="tabbar">
          <NavLink to="/" end aria-label="Home"><span>🏠</span>Home</NavLink>
          <NavLink to="/upload" className="plus" aria-label="Upload a dance"><span>＋</span></NavLink>
          <NavLink to="/profile" aria-label="Your profile"><span>👤</span>Me</NavLink>
        </nav>
      )}
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  )
}
