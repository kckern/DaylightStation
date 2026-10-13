/**
 * BlazePose skeleton connections and keypoint definitions
 * 
 * BlazePose provides 33 keypoints with detailed face, hand, and foot tracking.
 */

export const KEYPOINT_NAMES = [
  'nose',           // 0
  'left_eye_inner', // 1
  'left_eye',       // 2
  'left_eye_outer', // 3
  'right_eye_inner',// 4
  'right_eye',      // 5
  'right_eye_outer',// 6
  'left_ear',       // 7
  'right_ear',      // 8
  'mouth_left',     // 9
  'mouth_right',    // 10
  'left_shoulder',  // 11
  'right_shoulder', // 12
  'left_elbow',     // 13
  'right_elbow',    // 14
  'left_wrist',     // 15
  'right_wrist',    // 16
  'left_pinky',     // 17
  'right_pinky',    // 18
  'left_index',     // 19
  'right_index',    // 20
  'left_thumb',     // 21
  'right_thumb',    // 22
  'left_hip',       // 23
  'right_hip',      // 24
  'left_knee',      // 25
  'right_knee',     // 26
  'left_ankle',     // 27
  'right_ankle',    // 28
  'left_heel',      // 29
  'right_heel',     // 30
  'left_foot_index',// 31
  'right_foot_index',// 32
];

/**
 * Skeleton connections for BlazePose
 * Each connection is [startIndex, endIndex]
 */
export const BLAZEPOSE_CONNECTIONS = [
  // Face - left side
  [0, 1], [1, 2], [2, 3], [3, 7],
  // Face - right side
  [0, 4], [4, 5], [5, 6], [6, 8],
  // Mouth
  [9, 10],
  // Torso
  [11, 12], // shoulders
  [11, 23], // left shoulder to hip
  [12, 24], // right shoulder to hip
  [23, 24], // hips
  // Left arm
  [11, 13], [13, 15], // shoulder to elbow to wrist
  [15, 17], [15, 19], [15, 21], // wrist to fingers
  [17, 19], // pinky to index
  // Right arm
  [12, 14], [14, 16], // shoulder to elbow to wrist
  [16, 18], [16, 20], [16, 22], // wrist to fingers
  [18, 20], // pinky to index
  // Left leg
  [23, 25], [25, 27], // hip to knee to ankle
  [27, 29], [27, 31], [29, 31], // ankle, heel, foot
  // Right leg
  [24, 26], [26, 28], // hip to knee to ankle
  [28, 30], [28, 32], [30, 32], // ankle, heel, foot
];

/**
 * Grouped connections for different rendering options
 */
export const CONNECTION_GROUPS = {
  face: [
    [0, 1], [1, 2], [2, 3], [3, 7],
    [0, 4], [4, 5], [5, 6], [6, 8],
    [9, 10],
  ],
  torso: [
    [11, 12], [11, 23], [12, 24], [23, 24],
  ],
  leftArm: [
    [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  ],
  rightArm: [
    [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  ],
  leftLeg: [
    [23, 25], [25, 27], [27, 29], [27, 31], [29, 31],
  ],
  rightLeg: [
    [24, 26], [26, 28], [28, 30], [28, 32], [30, 32],
  ],
};

/**
 * Simplified connections (no face, no fingers) for cleaner visualization
 */
export const SIMPLIFIED_CONNECTIONS = [
  // Torso
  [11, 12], [11, 23], [12, 24], [23, 24],
  // Arms (just main segments)
  [11, 13], [13, 15],
  [12, 14], [14, 16],
  // Legs (just main segments)
  [23, 25], [25, 27],
  [24, 26], [26, 28],
];

/**
 * Get keypoint index by name
 */
export const getKeypointIndex = (name) => KEYPOINT_NAMES.indexOf(name);

/**
 * Get keypoint name by index
 */
export const getKeypointName = (index) => KEYPOINT_NAMES[index] || null;

/**
 * Check if a keypoint is on the left side of the body
 */
export const isLeftSide = (index) => {
  const name = KEYPOINT_NAMES[index];
  return name?.startsWith('left_') || false;
};

/**
 * Check if a keypoint is on the right side of the body
 */
export const isRightSide = (index) => {
  const name = KEYPOINT_NAMES[index];
  return name?.startsWith('right_') || false;
};

/**
 * Get the body part category for a keypoint
 */
export const getBodyPart = (index) => {
  if (index <= 10) return 'face';
  if (index <= 12) return 'shoulder';
  if (index <= 16) return 'arm';
  if (index <= 22) return 'hand';
  if (index <= 24) return 'hip';
  if (index <= 26) return 'leg';
  if (index <= 32) return 'foot';
  return 'unknown';
};

export default {
  KEYPOINT_NAMES,
  BLAZEPOSE_CONNECTIONS,
  CONNECTION_GROUPS,
  SIMPLIFIED_CONNECTIONS,
  getKeypointIndex,
  getKeypointName,
  isLeftSide,
  isRightSide,
  getBodyPart,
};
