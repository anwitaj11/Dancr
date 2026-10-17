import { closeLandmarker, getLandmarker } from './pose.js'
import { toPose } from './angles.js'

/**
 * Run PoseLandmarker over every frame of a video file.
 * Returns { frames: [{ t, pose }], aspect }; frames with no detected body are skipped.
 */
export async function processVideoFile(file, { fps = 30, onProgress } = {}) {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.src = url
  video.muted = true
  video.playsInline = true
  await once(video, 'loadeddata')

  // A fresh landmarker per upload keeps VIDEO-mode timestamps increasing.
  closeLandmarker('upload')
  const landmarker = await getLandmarker('upload')
  const frames = []
  const total = Math.floor(video.duration * fps)
  try {
    for (let i = 0; i <= total; i++) {
      const t = i / fps
      video.currentTime = Math.min(t + 0.001, video.duration)
      await once(video, 'seeked')
      const result = landmarker.detectForVideo(video, Math.round(t * 1000) + 1)
      if (result.landmarks?.[0]) frames.push({ t: Math.round(t * 1000) / 1000, pose: toPose(result.landmarks[0]) })
      onProgress?.(i / total)
    }
  } finally {
    URL.revokeObjectURL(url)
    closeLandmarker('upload')
  }
  if (frames.length < fps) throw new Error('Could not find a full body in the video. Try better light and a plain background.')
  // Re-base time so the dance starts at the first detected frame.
  const t0 = frames[0].t
  return {
    frames: frames.map((f) => ({ ...f, t: Math.round((f.t - t0) * 1000) / 1000 })),
    aspect: video.videoWidth / video.videoHeight,
    trimmed: t0,
  }
}

function once(el, event) {
  return new Promise((resolve, reject) => {
    el.addEventListener(event, resolve, { once: true })
    el.addEventListener('error', () => reject(new Error('Could not read that video file.')), { once: true })
  })
}
