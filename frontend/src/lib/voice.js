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

/** Short metronome click. Accented on count 1; louder in rhythm mode. */
export function click({ accent = false, loud = false } = {}) {
  audioCtx ??= new AudioContext()
  const osc = audioCtx.createOscillator()
  const gain = audioCtx.createGain()
  osc.frequency.value = accent ? 1320 : 880
  const peak = (loud ? 0.6 : 0.15) * (accent ? 1.4 : 1)
  gain.gain.setValueAtTime(peak, audioCtx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.08)
  osc.connect(gain).connect(audioCtx.destination)
  osc.start()
  osc.stop(audioCtx.currentTime + 0.09)
}
