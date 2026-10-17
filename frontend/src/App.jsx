import { useState } from 'react'
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom'
import { currentUser, setCurrentUser } from './lib/api.js'
import Library from './pages/Library.jsx'
import Upload from './pages/Upload.jsx'
import Calibrate from './pages/Calibrate.jsx'
import Practice from './pages/Practice.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Remix from './pages/Remix.jsx'

export default function App() {
  const [user, setUser] = useState(currentUser())

  return (
    <BrowserRouter>
      <header className="topbar">
        <NavLink to="/" className="logo">🕺 Dab Lab</NavLink>
        <nav>
          <NavLink to="/">Library</NavLink>
          <NavLink to="/upload">Upload</NavLink>
          <NavLink to="/dashboard">Dashboard</NavLink>
        </nav>
        <input
          className="user"
          aria-label="Your name"
          value={user}
          onChange={(e) => { setUser(e.target.value); setCurrentUser(e.target.value || 'guest') }}
        />
      </header>
      <main key={user}>
        <Routes>
          <Route path="/" element={<Library />} />
          <Route path="/upload" element={<Upload />} />
          <Route path="/calibrate" element={<Calibrate />} />
          <Route path="/practice/:id" element={<Practice />} />
          <Route path="/remix/:id" element={<Remix />} />
          <Route path="/dashboard" element={<Dashboard />} />
        </Routes>
      </main>
    </BrowserRouter>
  )
}
