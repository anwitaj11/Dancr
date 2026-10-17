// Serve MediaPipe's WASM from our own origin so the app doesn't depend on a CDN
// (venue Wi-Fi). Runs automatically after `npm install`.
import { cpSync, mkdirSync } from 'node:fs'

mkdirSync('public/mediapipe/wasm', { recursive: true })
cpSync('node_modules/@mediapipe/tasks-vision/wasm', 'public/mediapipe/wasm', { recursive: true })
console.log('copied MediaPipe wasm → public/mediapipe/wasm')
