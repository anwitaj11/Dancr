// MediaPipe Pose landmark indices we keep (out of 33), in stored order.
// "left" / "right" are the dancer's own left and right. The feet (31, 32) come
// last so dances saved before they were added (13 points) still line up.
export const POSE_LANDMARKS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 31, 32]

// Index into a stored pose array (15 points; 13 in older dances).
export const P = {
  nose: 0,
  lShoulder: 1, rShoulder: 2,
  lElbow: 3, rElbow: 4,
  lWrist: 5, rWrist: 6,
  lHip: 7, rHip: 8,
  lKnee: 9, rKnee: 10,
  lAnkle: 11, rAnkle: 12,
  lFoot: 13, rFoot: 14, // tip of the foot (MediaPipe foot_index)
}

// Scored angles at a joint: [a, vertex, c].
export const JOINTS = {
  leftElbow: [P.lShoulder, P.lElbow, P.lWrist],
  rightElbow: [P.rShoulder, P.rElbow, P.rWrist],
  leftShoulder: [P.lElbow, P.lShoulder, P.lHip],
  rightShoulder: [P.rElbow, P.rShoulder, P.rHip],
  leftHip: [P.lShoulder, P.lHip, P.lKnee],
  rightHip: [P.rShoulder, P.rHip, P.rKnee],
  leftKnee: [P.lHip, P.lKnee, P.lAnkle],
  rightKnee: [P.rHip, P.rKnee, P.rAnkle],
  leftAnkle: [P.lKnee, P.lAnkle, P.lFoot],
  rightAnkle: [P.rKnee, P.rAnkle, P.rFoot],
}

// Whole-body angles that aren't at a single joint (see computeAngles):
// legSpread  = angle between the two thighs (side steps, wide stances)
// torsoLean  = upper body tilt from upright, signed (+ = toward image right)
export const BODY_ANGLES = ['legSpread', 'torsoLean']

export const JOINT_NAMES = [...Object.keys(JOINTS), ...BODY_ANGLES]

export const BODY_PARTS = {
  arms: ['leftElbow', 'rightElbow', 'leftShoulder', 'rightShoulder'],
  torso: ['leftHip', 'rightHip', 'torsoLean'],
  legs: ['leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle', 'legSpread'],
}

export const LABELS = {
  leftElbow: 'left elbow', rightElbow: 'right elbow',
  leftShoulder: 'left arm', rightShoulder: 'right arm',
  leftHip: 'left hip', rightHip: 'right hip',
  leftAnkle: 'left foot', rightAnkle: 'right foot',
  legSpread: 'leg spread', torsoLean: 'torso lean',
  leftKnee: 'left knee', rightKnee: 'right knee',
}

// Bones to draw; `joint` is the scored angle whose color the bone takes.
export const BONES = [
  { from: P.lShoulder, to: P.lElbow, joint: 'leftShoulder' },
  { from: P.lElbow, to: P.lWrist, joint: 'leftElbow' },
  { from: P.rShoulder, to: P.rElbow, joint: 'rightShoulder' },
  { from: P.rElbow, to: P.rWrist, joint: 'rightElbow' },
  { from: P.lHip, to: P.lKnee, joint: 'leftHip' },
  { from: P.lKnee, to: P.lAnkle, joint: 'leftKnee' },
  { from: P.rHip, to: P.rKnee, joint: 'rightHip' },
  { from: P.rKnee, to: P.rAnkle, joint: 'rightKnee' },
  { from: P.lAnkle, to: P.lFoot, joint: 'leftAnkle' },
  { from: P.rAnkle, to: P.rFoot, joint: 'rightAnkle' },
  { from: P.lShoulder, to: P.rShoulder },
  { from: P.lHip, to: P.rHip },
  { from: P.lShoulder, to: P.lHip },
  { from: P.rShoulder, to: P.rHip },
]

// Swapping left/right point indices, used for mirror mode.
export const MIRROR_POINTS = [0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13]
