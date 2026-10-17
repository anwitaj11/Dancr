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

// Overlay limbs for the user's webcam: arms, legs and torso only (no face).
// Torso sides take the hip angle's score, since that's the joint they bend at.
const OVERLAY_BONES = [
  ...BONES.filter((b) => b.joint),
  { from: P.lShoulder, to: P.lHip, joint: 'leftHip' },
  { from: P.rShoulder, to: P.rHip, joint: 'rightHip' },
]

export const WRONG_LIMB = 0.5 // below this a limb counts as wrong (the red band)

/**
 * Glowing neon limbs over the webcam, in the 2016 pink/purple style.
 * Only limbs scoring below WRONG_LIMB are drawn, as hot red with a pink/purple halo.
 * - map: [x, y] normalized video coords → canvas pixels
 */
export function drawMistakeLimbs(ctx, pose, jointScores, map, { width = 14 } = {}) {
  const wrong = OVERLAY_BONES.filter((b) => (jointScores[b.joint] ?? 1) < WRONG_LIMB)
  if (!wrong.length) return
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  // Halo, glowing core, then a white-hot centre line.
  const passes = [
    { color: '#b026ff88', w: width * 2.2, blur: 28, shadow: '#b026ff' },
    { color: '#ff2d55', w: width, blur: 22, shadow: '#ff2fd1' },
    { color: '#ffd6e0', w: width * 0.3, blur: 0, shadow: 'transparent' },
  ]
  for (const p of passes) {
    ctx.strokeStyle = p.color
    ctx.lineWidth = p.w
    ctx.shadowBlur = p.blur
    ctx.shadowColor = p.shadow
    for (const b of wrong) {
      const a = map(pose[b.from]), c = map(pose[b.to])
      ctx.beginPath()
      ctx.moveTo(a[0], a[1])
      ctx.lineTo(c[0], c[1])
      ctx.stroke()
    }
  }
  ctx.restore()
}
