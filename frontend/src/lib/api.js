export const API_URL = import.meta.env?.VITE_API_URL ?? 'http://localhost:8000'

// fetch() only throws when the request never got an answer, almost always because
// the backend isn't running. Say that instead of the browser's "Failed to fetch".
async function send(url, init) {
  try {
    return await fetch(url, init)
  } catch {
    throw new Error(`can't reach the Dancr backend at ${API_URL}. Is the backend window running (uvicorn app.main:app --reload)?`)
  }
}

async function request(path, { method = 'GET', body } = {}) {
  const res = await send(`${API_URL}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    // Prefer the backend's own explanation (FastAPI sends { detail }).
    const detail = await res.json().then((b) => b?.detail).catch(() => null)
    throw new Error(typeof detail === 'string' ? detail : `${method} ${path} failed: ${res.status}`)
  }
  return res
}

const json = (path, opts) => request(path, opts).then((r) => r.json())

export const api = {
  listDances: () => json('/dances'),
  getDance: (id) => json(`/dances/${id}`),
  replaceDance: (id, dance) =>
    json(`/dances/${id}`, { method: 'PUT', body: { name: dance.name, bpm: dance.bpm, data: dance } }),
  createDance: (dance, { builtin = false, difficulty = 1 } = {}) =>
    json('/dances', { method: 'POST', body: { name: dance.name, bpm: dance.bpm, builtin, difficulty, data: dance } }),
  saveAttempt: (attempt) => json('/attempts', { method: 'POST', body: attempt }),
  getProfile: (user) => json(`/profile/${encodeURIComponent(user)}`),
  coachTip: (user, context) => json('/coach', { method: 'POST', body: { user, context } }),
  report: (user) => json(`/report/${encodeURIComponent(user)}`, { method: 'POST' }),
  tts: (text) => request('/tts', { method: 'POST', body: { text } }).then((r) => r.blob()),
  remix: (text) => json('/remix', { method: 'POST', body: { request: text } }),
  uploadVideo: (id, file) =>
    send(`${API_URL}/dances/${id}/video`, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
      .then(async (r) => {
        if (r.ok) return
        const detail = await r.json().then((b) => b?.detail).catch(() => null)
        throw new Error(`video upload failed: ${typeof detail === 'string' ? detail : r.status}`)
      }),
  videoUrl: (id) => `${API_URL}/dances/${id}/video`,
  deleteDance: (id) => json(`/dances/${id}`, { method: 'DELETE' }),
  voiceSession: () => json('/voice-agent/session'),
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
