export const API_URL = import.meta.env?.VITE_API_URL ?? 'http://localhost:8000'

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status}`)
  return res
}

const json = (path, opts) => request(path, opts).then((r) => r.json())

export const api = {
  listDances: () => json('/dances'),
  getDance: (id) => json(`/dances/${id}`),
  createDance: (dance, { builtin = false, difficulty = 1 } = {}) =>
    json('/dances', { method: 'POST', body: { name: dance.name, bpm: dance.bpm, builtin, difficulty, data: dance } }),
  saveAttempt: (attempt) => json('/attempts', { method: 'POST', body: attempt }),
  getProfile: (user) => json(`/profile/${encodeURIComponent(user)}`),
  coachTip: (user, context) => json('/coach', { method: 'POST', body: { user, context } }),
  report: (user) => json(`/report/${encodeURIComponent(user)}`, { method: 'POST' }),
  tts: (text) => request('/tts', { method: 'POST', body: { text } }).then((r) => r.blob()),
  remix: (text) => json('/remix', { method: 'POST', body: { request: text } }),
}

export function currentUser() {
  try {
    return localStorage.getItem('dablab.user') || 'guest'
  } catch {
    return 'guest'
  }
}

export function setCurrentUser(name) {
  try {
    localStorage.setItem('dablab.user', name)
  } catch {
    // private mode: name lasts for this page only
  }
}
