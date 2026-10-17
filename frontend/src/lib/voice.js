import { api } from './api.js'

// Audio is cached per line, so "5, 6, 7, 8!" and "Nice!" are fetched once.
const cache = new Map()
let audioCtx = null

/** Speak with the ElevenLabs voice, falling back to the browser's built-in voice. */
export async function say(text, { volume = 1 } = {}) {
  try {
    if (!cache.has(text)) cache.set(text, api.tts(text).then((blob) => URL.createObjectURL(blob)))
    const url = await cache.get(text)
    const audio = new Audio(url)
    audio.volume = volume
    await audio.play()
  } catch {
    cache.delete(text)
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(text)
      // Always English, even when the computer's own language is something else.
      u.lang = 'en-US'
      u.voice = englishVoice()
      u.volume = volume
      u.rate = 1.1
      speechSynthesis.speak(u)
    }
  }
}

function englishVoice() {
  const voices = speechSynthesis.getVoices()
  return voices.find((v) => v.lang === 'en-US' && v.localService)
    ?? voices.find((v) => v.lang?.startsWith('en'))
    ?? null
}

// ---------- count-in: "five, six, seven, eight" ----------
// Each number is its own short clip, decoded ahead of time into the same
// AudioContext as the metronome, so the voice lands exactly on the beat the
// screen shows (one long "5, 6, 7, 8!" recording can't follow the tempo).
const COUNT_WORDS = { 5: 'Five!', 6: 'Six!', 7: 'Seven!', 8: 'Eight!' }
const countBuffers = {}
let countsLoading = null

function context() {
  audioCtx ??= new AudioContext()
  return audioCtx
}

/** Fetch and decode the four count clips (ElevenLabs voice). Safe to call repeatedly. */
export function preloadCounts() {
  countsLoading ??= Promise.all(Object.entries(COUNT_WORDS).map(async ([n, word]) => {
    const blob = await api.tts(word)
    countBuffers[n] = await context().decodeAudioData(await blob.arrayBuffer())
  })).catch(() => {
    countsLoading = null // no ElevenLabs key or offline: fall back to the browser voice
  })
  return countsLoading
}

const LEAD_IN = 0.08 // seconds of headroom so the first beat is never scheduled in the past

/**
 * Schedule the whole "5, 6, 7, 8" count-in on the audio clock, which keeps
 * exact time even while the page is busy tracking poses (separate timers drift).
 * Returns the performance.now() time of count 5; the dance starts 4 beats later.
 */
export function scheduleCountIn(beatMs, { loud = false, beats = 4 } = {}) {
  const ctx = context()
  if (ctx.state === 'suspended') ctx.resume()
  const firstBeat = ctx.currentTime + LEAD_IN
  for (let i = 0; i < beats; i++) {
    const n = 5 + i
    const at = firstBeat + (i * beatMs) / 1000
    click({ accent: i === 0, loud, at })
    const buffer = countBuffers[n]
    if (buffer) {
      const source = ctx.createBufferSource()
      const gain = ctx.createGain()
      gain.gain.value = loud ? 1 : 0.85
      source.buffer = buffer
      source.connect(gain).connect(ctx.destination)
      source.start(at)
    } else if ('speechSynthesis' in window) {
      // Browser voice can't be scheduled precisely; it's the fallback without an ElevenLabs key.
      setTimeout(() => {
        speechSynthesis.cancel() // never let a late word pile up behind the next beat
        const u = new SpeechSynthesisUtterance(String(n))
        u.lang = 'en-US'
        u.voice = englishVoice()
        u.rate = 1.6
        speechSynthesis.speak(u)
      }, LEAD_IN * 1000 + i * beatMs)
    }
  }
  return performance.now() + LEAD_IN * 1000
}

/** Short metronome click (now, or at an audio-clock time). Accented on count 1; louder in rhythm mode. */
export function click({ accent = false, loud = false, at } = {}) {
  context()
  const when = at ?? audioCtx.currentTime
  const osc = audioCtx.createOscillator()
  const gain = audioCtx.createGain()
  osc.frequency.value = accent ? 1320 : 880
  const peak = (loud ? 0.6 : 0.15) * (accent ? 1.4 : 1)
  gain.gain.setValueAtTime(peak, when)
  gain.gain.exponentialRampToValueAtTime(0.001, when + 0.08)
  osc.connect(gain).connect(audioCtx.destination)
  osc.start(when)
  osc.stop(when + 0.09)
}
