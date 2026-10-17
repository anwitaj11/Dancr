import { BONES, P } from './joints.js'

const NEUTRAL = '#ffffffcc'

/**
 * Draw a stored pose (normalized 0–1 coords) on a canvas.
 * - colors: { jointName: cssColor } to color limbs by score
 * - bounds: fit the pose box into the canvas (for reference playback); omit to
 *   draw in raw video coordinates (for the webcam overlay)
 */
export function drawSkeleton(ctx, pose, { colors = {}, bounds, color = NEUTRAL, lineWidth = 6, highlight, glow = 0 } = {}) {
  const { width: w, height: h } = ctx.canvas
  const map = bounds ? fitter(bounds, w, h) : ([x, y]) => [x * w, y * h]
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.shadowBlur = glow
  ctx.shadowColor = color
  for (const bone of BONES) {
    if (!pose[bone.from] || !pose[bone.to]) continue // e.g. no foot points in older dances
    const a = map(pose[bone.from]), b = map(pose[bone.to])
    ctx.strokeStyle = (bone.joint && colors[bone.joint]) || color
    ctx.lineWidth = bone.joint && bone.joint === highlight ? lineWidth * 1.8 : lineWidth
    ctx.beginPath()
    ctx.moveTo(a[0], a[1])
    ctx.lineTo(b[0], b[1])
    ctx.stroke()
  }
  // head
  const nose = map(pose[P.nose])
  const shoulderWidth = Math.hypot(...sub(map(pose[P.lShoulder]), map(pose[P.rShoulder])))
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(nose[0], nose[1], Math.max(8, shoulderWidth * 0.28), 0, Math.PI * 2)
  ctx.fill()
}

function fitter({ minX, minY, maxX, maxY, aspect = 16 / 9 }, w, h, pad = 0.12) {
  const bw = maxX - minX || 1, bh = maxY - minY || 1
  // Normalized x is relative to the source video's width, so stretch by its aspect ratio.
  const scale = Math.min((w * (1 - 2 * pad)) / (bw * aspect), (h * (1 - 2 * pad)) / bh)
  const ox = (w - bw * aspect * scale) / 2, oy = (h - bh * scale) / 2
  return ([x, y]) => [ox + (x - minX) * aspect * scale, oy + (y - minY) * scale]
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1]]
}

// Overlay limbs for the user's webcam: arms, legs, feet and torso (no face).
// Torso sides take the hip angle's score, since that's the joint they bend at.
const OVERLAY_BONES = [
  ...BONES.filter((b) => b.joint),
  { from: P.lShoulder, to: P.lHip, joint: 'leftHip' },
  { from: P.rShoulder, to: P.rHip, joint: 'rightHip' },
  { from: P.lShoulder, to: P.rShoulder, joint: 'torsoLean' },
  { from: P.lHip, to: P.rHip, joint: 'legSpread' },
]

export const WRONG_LIMB = 0.5 // below this a limb counts as wrong (red)
const GOOD_LIMB = 0.8 // at or above this a limb is a match (green)

/**
 * Glowing neon skeleton over the webcam, in the 2016 pink/purple style.
 * - mode 'full': every limb Dancr can see, green (match) / yellow (close) / red (wrong),
 *   or white when it's tracked but this tutorial doesn't score it.
 * - mode 'mistakes': only limbs scoring below WRONG_LIMB, as hot red.
 * Limbs the camera can't see clearly aren't drawn.
 * - map: [x, y] normalized video coords → canvas pixels
 */
export function drawBodyOverlay(ctx, pose, jointScores, map, { mode = 'full', width = 14 } = {}) {
  const visible = (i) => pose[i] && (pose[i][2] ?? 1) >= 0.5
  const bones = OVERLAY_BONES.filter((b) => visible(b.from) && visible(b.to)
    && (mode === 'full' || jointScores[b.joint] < WRONG_LIMB))
  if (!bones.length) return
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const line = (bone, color, w, blur, shadow) => {
    const a = map(pose[bone.from]), c = map(pose[bone.to])
    ctx.strokeStyle = color
    ctx.lineWidth = w
    ctx.shadowBlur = blur
    ctx.shadowColor = shadow
    ctx.beginPath()
    ctx.moveTo(a[0], a[1])
    ctx.lineTo(c[0], c[1])
    ctx.stroke()
  }
  for (const bone of bones) {
    const s = jointScores[bone.joint]
    if (s === undefined) {
      // Tracked, but this dance's tutorial doesn't score it (e.g. feet in older videos): plain white.
      line(bone, '#ffffff99', width * 0.5, 12, '#ffffff')
    } else if (s < WRONG_LIMB) {
      // Wrong: hot red core with a pink/purple halo and a white-hot centre.
      line(bone, '#b026ff88', width * 2.2, 28, '#b026ff')
      line(bone, '#ff2d55', width, 22, '#ff2fd1')
      line(bone, '#ffd6e0', width * 0.3, 0, 'transparent')
    } else {
      const color = s >= GOOD_LIMB ? '#39ff88' : '#ffe14d'
      line(bone, `${color}cc`, width * 0.7, 16, color)
      line(bone, '#ffffffcc', width * 0.2, 0, 'transparent')
    }
  }
  ctx.restore()
}

/** Where a video sits inside its element with object-fit: contain (or cover), in element pixels. */
export function containRect(boxW, boxH, videoW, videoH, cover = false) {
  if (!videoW || !videoH) return { x: 0, y: 0, w: boxW, h: boxH }
  const scale = (cover ? Math.max : Math.min)(boxW / videoW, boxH / videoH)
  const w = videoW * scale, h = videoH * scale
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h }
}

/**
 * Point out one dancer in a video with several people: their skeleton in their
 * colour plus a numbered tag above their head. rect = the video's on-screen box.
 */
export function drawDancerMarker(ctx, pose, rect, { color, label, mirror = false, lineWidth = 5 }) {
  const map = ([x, y]) => [rect.x + (mirror ? 1 - x : x) * rect.w, rect.y + y * rect.h]
  ctx.save()
  ctx.lineCap = 'round'
  ctx.globalAlpha = 0.9
  // Dark outline first so the colour stands out on any background.
  for (const [stroke, width, glow] of [['#1d1030', lineWidth + 4, 0], [color, lineWidth, 10]]) {
    ctx.strokeStyle = stroke
    ctx.lineWidth = width
    ctx.shadowColor = color
    ctx.shadowBlur = glow
    for (const bone of BONES) {
      if (!pose[bone.from] || !pose[bone.to]) continue
      const a = map(pose[bone.from]), b = map(pose[bone.to])
      ctx.beginPath()
      ctx.moveTo(a[0], a[1])
      ctx.lineTo(b[0], b[1])
      ctx.stroke()
    }
  }
  if (label) {
    const [hx] = map(pose[P.nose])
    const top = Math.min(...pose.map((p) => map(p)[1]))
    ctx.globalAlpha = 1
    ctx.shadowBlur = 0
    ctx.font = 'bold 13px sans-serif'
    const w = ctx.measureText(label).width + 16
    const x = Math.min(Math.max(hx - w / 2, 2), ctx.canvas.width - w - 2), y = Math.max(2, top - 34)
    ctx.fillStyle = color
    ctx.strokeStyle = '#1d1030'
    ctx.lineWidth = 2
    ctx.fillRect(x, y, w, 22)
    ctx.strokeRect(x, y, w, 22)
    ctx.beginPath() // little arrow pointing down at their head
    ctx.moveTo(hx - 6, y + 22)
    ctx.lineTo(hx + 6, y + 22)
    ctx.lineTo(hx, y + 30)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, x + 8, y + 12)
  }
  ctx.restore()
}
