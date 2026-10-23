const previewBackend = 'https://dancr-2w68-git-fix-no-login-reliability-anwitaj11.vercel.app'
const productionBackend = 'https://dancr-2w68.vercel.app'
const isPreview = typeof window !== 'undefined' && window.location.hostname.includes('fix-no-login-reliability')
const defaultBackend = import.meta.env.PROD ? (isPreview ? previewBackend : productionBackend) : 'http://localhost:8000'
export const API_URL = import.meta.env.VITE_API_URL || defaultBackend

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
  uploadVideo: async (id, file) => {
    const contentType = file.type || 'video/mp4'
    const { url, path } = await json(`/dances/${id}/video-upload?content_type=${encodeURIComponent(contentType)}`, { method: 'POST' })
    const uploaded = await send(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file })
    if (!uploaded.ok) throw new Error(`Video storage upload failed: ${uploaded.status}`)
    await json(`/dances/${id}/video-complete`, { method: 'POST', body: { path } })
  },
  // Saved multi-person scan: null when the dance doesn't have one (older uploads).
  savePeople: (id, scan) => request(`/dances/${id}/people`, { method: 'PUT', body: scan }),
  getPeople: (id) => send(`${API_URL}/dances/${id}/people`).then((r) => (r.ok ? r.json() : null)),
  // The dancer's latest recorded try (one per user, replaced each time).
  saveTake: (user, blob, meta) =>
    send(`${API_URL}/takes/${encodeURIComponent(user)}?${new URLSearchParams(meta)}`, {
      method: 'PUT', headers: { 'Content-Type': blob.type }, body: blob,
    }),
  getTake: (user) => send(`${API_URL}/takes/${encodeURIComponent(user)}`).then((r) => (r.ok ? r.json() : null)),
  takeVideoUrl: (user, version = '') => `${API_URL}/takes/${encodeURIComponent(user)}/video?v=${version}`,
  deleteTake: (user) => json(`/takes/${encodeURIComponent(user)}`, { method: 'DELETE' }),
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
