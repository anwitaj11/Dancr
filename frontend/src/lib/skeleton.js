import { BONES, P } from './joints.js'

const NEUTRAL = '#ffffffcc'

/**
 * Draw a stored pose (normalized 0–1 coords) on a canvas.
 * - colors: { jointName: cssColor } to color limbs by score
 * - bounds: fit the pose box into the canvas (for reference playback); omit to
 *   draw in raw video coordinates (for the webcam overlay)
 */
export function drawSkeleton(ctx, pose, { colors = {}, bounds, color = NEUTRAL, lineWidth = 6, highlight } = {}) {
  const { width: w, height: h } = ctx.canvas
  const map = bounds ? fitter(bounds, w, h) : ([x, y]) => [x * w, y * h]
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
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
