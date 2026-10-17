import { closeLandmarker, getLandmarker } from './pose.js'
import { toPose } from './angles.js'
import { P } from './joints.js'
import { crowdSize, dedupePoses, poseCenter, sortLeftToRight } from './people.js'

const MAX_PEOPLE = 8
export const PERSON_COLORS = ['#ff3ea5', '#1f4bff', '#ff8a3d', '#00b3a4', '#7b3dff', '#e0b400', '#00a3e0', '#d6336c']

const SAMPLES_PER_SECOND = 20 // poses per second of video: plenty for dance moves, a third less work than 30
const MAX_RATE = 4 // fastest we'll play the video while scanning it

/**
 * Run PoseLandmarker over a video file, keeping everyone it sees.
 * Returns {
 *   raw: [{ t, poses }]   every sampled frame (poses may be empty),
 *   aspect, people        most people seen together (in enough frames to not be a glitch),
 *   anchor, snapshot      that frame's index and a JPEG of it with each person numbered left to right
 * }. Use trackDancer() from people.js to turn this into one dancer's frames.
 */
export async function processVideoFile(file, { fps = SAMPLES_PER_SECOND, onProgress } = {}) {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.src = url
  video.muted = true
  video.playsInline = true
  // On the page (but invisible) so the browser keeps decoding it at full speed.
  video.style.cssText = 'position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none'
  document.body.appendChild(video)
  await once(video, 'loadeddata')

  // A fresh landmarker per upload keeps VIDEO-mode timestamps increasing.
  closeLandmarker('upload')
  const landmarker = await getLandmarker('upload', { numPoses: MAX_PEOPLE })
  const raw = []
  let lastTs = 0
  const looks = lookSampler(video)
  const detect = (t) => {
    lastTs = Math.max(lastTs + 1, Math.round(t * 1000) + 1)
    const result = landmarker.detectForVideo(video, lastTs)
    const poses = dedupePoses((result.landmarks ?? []).map(toPose))
    raw.push({ t: Math.round(t * 1000) / 1000, poses, ...(poses.length && { looks: looks(poses) }) })
  }
  try {
    try {
      if (!('requestVideoFrameCallback' in video)) throw new Error('not supported')
      await scanWhilePlaying(video, detect, fps, onProgress)
    } catch {
      raw.length = 0
      video.pause()
      await scanBySeeking(video, detect, fps, onProgress)
    }
    const { people, anchor } = crowdSize(raw)
    if (people === 0) throw new Error('Could not find anyone in the video. Try better light and a plain background.')
    // Grab the anchor frame again for the "who are we learning from?" picture.
    video.currentTime = Math.min(raw[anchor].t + 0.001, video.duration)
    await once(video, 'seeked')
    const snapshot = drawSnapshot(video, raw[anchor].poses)
    return { raw, fps, aspect: video.videoWidth / video.videoHeight, people, anchor, snapshot }
  } finally {
    video.pause()
    video.remove()
    URL.revokeObjectURL(url)
    closeLandmarker('upload')
  }
}

/**
 * Fast path: play the video (muted) and look at frames as they're shown,
 * speeding playback up as far as pose detection can keep up. Seeking to every
 * frame instead is several times slower, since each seek decodes from scratch.
 */
function scanWhilePlaying(video, detect, fps, onProgress) {
  return new Promise((resolve, reject) => {
    let last = -Infinity, cost = 40 // ms per detection, running average
    // If no frames ever arrive (some browsers won't play a hidden video), fall back to seeking.
    let stopped = false
    const fail = (e) => {
      stopped = true
      clearTimeout(stalled)
      document.removeEventListener('visibilitychange', onVisibility)
      reject(e)
    }
    const stalled = setTimeout(() => fail(new Error('no frames')), 4000)
    const onFrame = (_, { mediaTime }) => {
      if (stopped) return
      clearTimeout(stalled)
      if (mediaTime - last >= 0.9 / fps) {
        const start = performance.now()
        detect(mediaTime)
        cost = cost * 0.8 + (performance.now() - start) * 0.2
        last = mediaTime
        // As fast as possible while still getting `fps` poses per second of video.
        video.playbackRate = Math.min(MAX_RATE, Math.max(0.25, (0.8 * 1000) / (cost * fps)))
        onProgress?.(mediaTime / video.duration)
      }
      if (!video.ended) video.requestVideoFrameCallback(onFrame)
    }
    // Browsers stop handing over frames in background tabs: pause until we're back.
    const onVisibility = () => (document.hidden ? video.pause() : video.play().catch(() => {}))
    document.addEventListener('visibilitychange', onVisibility)
    video.addEventListener('ended', () => {
      clearTimeout(stalled)
      document.removeEventListener('visibilitychange', onVisibility)
      onProgress?.(1)
      resolve()
    }, { once: true })
    video.requestVideoFrameCallback(onFrame)
    video.play().catch(fail)
  })
}

/** Fallback for browsers without requestVideoFrameCallback: seek frame by frame. */
async function scanBySeeking(video, detect, fps, onProgress) {
  const total = Math.floor(video.duration * fps)
  for (let i = 0; i <= total; i++) {
    const t = i / fps
    video.currentTime = Math.min(t + 0.001, video.duration)
    await once(video, 'seeked')
    detect(t)
    onProgress?.(i / total)
  }
}

/** A scan made smaller for storage (3 decimals is well under a pixel), so changing the dancer later needs no rescan. */
export function packScan({ raw, fps, aspect, people, anchor, snapshot }) {
  const r = (v) => Math.round(v * 1000) / 1000
  return {
    raw: raw.map((f) => ({
      t: f.t,
      poses: f.poses.map((pose) => pose.map((p) => p.map(r))),
      ...(f.looks && { looks: f.looks.map((look) => look.map(Math.round)) }),
    })),
    fps, aspect, people, anchor, snapshot,
  }
}

const LOOK_WIDTH = 160 // a small copy of the frame is plenty to read clothing colours

/**
 * Returns looks(poses): each person's clothing colours in the current frame
 * ([chest rgb, belly rgb, thighs rgb]), so tracking can tell people apart when
 * they cross paths or swap places.
 */
function lookSampler(video) {
  const w = LOOK_WIDTH, h = Math.max(1, Math.round((LOOK_WIDTH * video.videoHeight) / video.videoWidth))
  const ctx = Object.assign(document.createElement('canvas'), { width: w, height: h }).getContext('2d', { willReadFrequently: true })
  return (poses) => {
    ctx.drawImage(video, 0, 0, w, h)
    const { data } = ctx.getImageData(0, 0, w, h)
    const patch = ([x, y]) => { // average colour of a 5×5 patch
      const cx = Math.round(x * w), cy = Math.round(y * h)
      const sum = [0, 0, 0]
      let n = 0
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const px = cx + dx, py = cy + dy
          if (px < 0 || py < 0 || px >= w || py >= h) continue
          const o = (py * w + px) * 4
          sum[0] += data[o]; sum[1] += data[o + 1]; sum[2] += data[o + 2]
          n++
        }
      }
      return n ? sum.map((v) => v / n) : [128, 128, 128]
    }
    const lerp = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]
    return poses.map((pose) => {
      const shoulders = lerp(pose[P.lShoulder], pose[P.rShoulder], 0.5)
      const hips = lerp(pose[P.lHip], pose[P.rHip], 0.5)
      const left = patch(lerp(pose[P.lHip], pose[P.lKnee], 0.4)), right = patch(lerp(pose[P.rHip], pose[P.rKnee], 0.4))
      return [...patch(lerp(shoulders, hips, 0.35)), ...patch(lerp(shoulders, hips, 0.75)), ...left.map((v, i) => (v + right[i]) / 2)]
    })
  }
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
