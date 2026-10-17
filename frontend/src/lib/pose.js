import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'

// Served from public/ (wasm is copied there on `npm install`), so tracking works offline.
const WASM_URL = `${import.meta.env.BASE_URL}mediapipe/wasm`
const MODEL_URL = `${import.meta.env.BASE_URL}mediapipe/pose_landmarker_lite.task`

let fileset = null

/**
 * One landmarker per use ("webcam", "upload"): VIDEO mode needs increasing
 * timestamps, so the webcam and the video processor can't share one.
 * Both look for several people so we can pick the right dancer (see people.js).
 */
const landmarkers = {}

export function getLandmarker(key = 'webcam', { numPoses = 1 } = {}) {
  landmarkers[key] ??= (async () => {
    fileset ??= await FilesetResolver.forVisionTasks(WASM_URL)
    const options = {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numPoses,
    }
    try {
      return await PoseLandmarker.createFromOptions(fileset, options)
    } catch {
      // Some laptops lack WebGL2; CPU is slower but works.
      return PoseLandmarker.createFromOptions(fileset, { ...options, baseOptions: { ...options.baseOptions, delegate: 'CPU' } })
    }
  })()
  return landmarkers[key]
}

export function closeLandmarker(key) {
  const pending = landmarkers[key]
  delete landmarkers[key]
  pending?.then((l) => l.close())
}
