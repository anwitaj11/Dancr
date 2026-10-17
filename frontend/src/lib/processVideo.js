import { closeLandmarker, getLandmarker } from './pose.js'
import { toPose } from './angles.js'
import { poseCenter, sortLeftToRight } from './people.js'

const MAX_PEOPLE = 4
const PERSON_COLORS = ['#ff3ea5', '#1f4bff', '#ff8a3d', '#00b3a4']

/**
 * Run PoseLandmarker over every frame of a video file, keeping everyone it sees.
 * Returns {
 *   raw: [{ t, poses }]   every sampled frame (poses may be empty),
 *   aspect, people        most people seen in one frame,
 *   anchor, snapshot      that frame's index and a JPEG of it with each person numbered left to right
 * }. Use trackDancer() from people.js to turn this into one dancer's frames.
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
  const landmarker = await getLandmarker('upload', { numPoses: MAX_PEOPLE })
  const raw = []
  let people = 0, anchor = -1, snapshot = null
  const total = Math.floor(video.duration * fps)
  try {
    for (let i = 0; i <= total; i++) {
      const t = i / fps
      video.currentTime = Math.min(t + 0.001, video.duration)
      await once(video, 'seeked')
      const result = landmarker.detectForVideo(video, Math.round(t * 1000) + 1)
      const poses = (result.landmarks ?? []).map(toPose)
      raw.push({ t: Math.round(t * 1000) / 1000, poses })
      if (poses.length > people) {
        people = poses.length
        anchor = raw.length - 1
        snapshot = drawSnapshot(video, poses)
      }
      onProgress?.(i / total)
    }
  } finally {
    URL.revokeObjectURL(url)
    closeLandmarker('upload')
  }
  if (people === 0) throw new Error('Could not find anyone in the video. Try better light and a plain background.')
  return { raw, aspect: video.videoWidth / video.videoHeight, people, anchor, snapshot }
}

/** A still of the frame with a numbered badge over each person (left to right). */
function drawSnapshot(video, poses) {
  const w = 640, h = Math.round((640 * video.videoHeight) / video.videoWidth)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.drawImage(video, 0, 0, w, h)
  sortLeftToRight(poses).forEach((pose, i) => {
    const [cx] = poseCenter(pose)
    const top = Math.min(...pose.map((p) => p[1]))
    const x = cx * w, y = Math.max(28, top * h - 26)
    ctx.fillStyle = PERSON_COLORS[i % PERSON_COLORS.length]
    ctx.strokeStyle = '#1d1030'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.arc(x, y, 22, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 24px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(i + 1), x, y + 1)
  })
  return canvas.toDataURL('image/jpeg', 0.85)
}

function once(el, event) {
  return new Promise((resolve, reject) => {
    el.addEventListener(event, resolve, { once: true })
    el.addEventListener('error', () => reject(new Error('Could not read that video file.')), { once: true })
  })
}
