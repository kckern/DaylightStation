# Pose Analysis Architecture

## Raw-Geometry-Semantic-Metrics-Activity Data Layer Model

This document outlines a comprehensive, layered data architecture for the Fitness pose detection system. The design enables games, fitness apps, and other consumers to leverage processed pose data at various abstraction levels without reimplementing detection logic.

---

## Executive Summary

| Layer | Name | Description | Update Rate | Example Data |
|-------|------|-------------|-------------|--------------|
| **Raw** | Raw Pose | Keypoint coordinates + confidence | 30 FPS | `{ x: 245, y: 180, z: 0.3, score: 0.92 }` |
| **Geometry** | Relational | Computed angles, distances, relative positions | 30 FPS | `{ leftKneeAngle: 90, handsAboveShoulders: true }` |
| **Semantic** | Semantic States | Named body states and pose classifications | 30 FPS | `{ squatting: true, jumpingJackPhase: 'high' }` |
| **Metrics** | Temporal Analytics | Rep counts, sequences, workout metrics | 30 FPS | `{ pushupCount: 12, lastRepDuration: 1.2s }` |
| **Activity** | Activity Recognition | Sustained activity detection from metric patterns | 5 FPS | `{ isMarching: true, isSquatting: false, currentActivity: 'highKnees' }` |

---

## Architectural Principles

### 1. Layer Abstraction
Each layer only depends on the layer immediately below it. Higher layers never bypass intermediate layers to access raw data.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        ACTIVITY LAYER (Recognition)                          │
│     Activity states: isMarching, isSquatting, isJumpingJacking, isResting   │
├─────────────────────────────────────────────────────────────────────────────┤
│                        METRICS LAYER (Temporal)                              │
│     Rep counters, sequence detection, workout analytics                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                         SEMANTIC LAYER (Semantic)                            │
│     Named states: squatting, handsRaised, pushupHigh, jumpingJackLow        │
├─────────────────────────────────────────────────────────────────────────────┤
│                        GEOMETRY LAYER (Relational)                           │
│     Angles: kneeAngle, hipAngle | Positions: handHeightRatio, orientation   │
├─────────────────────────────────────────────────────────────────────────────┤
│                         RAW LAYER (Raw)                                      │
│     33 BlazePose keypoints: { x, y, z, score } per point                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2. Single Source of Truth
- Raw data flows from `PoseDetectorService` (singleton)
- Each layer transforms data exactly once
- Downstream consumers subscribe to the appropriate layer

### 3. Config-Driven Design
All thresholds, timing windows, and detection parameters are externalized to configuration objects, enabling:
- Runtime tuning without code changes
- Per-exercise customization
- A/B testing of detection parameters

### 4. Observability
Each layer exposes:
- Current state snapshot
- Historical buffer (configurable depth)
- Performance metrics (computation time, update frequency)
- Debug events for development tooling

### 5. Known Limitations & Edge Cases
- **Multi-Person Detection:** The current design assumes a single user. If multiple people enter the frame, the `RawLayer` (via MediaPipe) may flicker between IDs. Future work must implement ID tracking/smoothing or explicit filtering for the "primary" user (e.g., largest bounding box).
- **Camera Orientation:** The `GeometryLayer` assumes an upright camera. Exercises performed on the floor (like side planks) or with a rotated device may break `handHeight` logic. We need to detect gravity/orientation or allow manual overrides.
- **Z-Axis Dependency:** While MediaPipe provides 3D keypoints, many "flat" exercises (pushups facing camera) rely heavily on the Z-axis for depth. The `GeometryLayer` must prioritize Z-depth for these specific movements, rather than just 2D angles.

---

## Market Analysis & Alternatives

Before designing this custom architecture, we evaluated existing solutions to avoid reinventing the wheel:

1.  **MediaPipe Tasks (Google)**: Excellent for the *Raw* layer (which we use via `PoseDetectorService`), but lacks the semantic state machine for specific fitness exercises. It provides the "what" (landmarks) but not the "meaning" (is this a squat?).
2.  **Kalidokit**: Great for VTubing and solving 3D pose from 2D points, but optimized for avatar animation, not fitness repetition counting or form correction.
3.  **TensorFlow.js Models**: Provide the raw inference but no higher-level logic.

**Conclusion**: A custom stack on top of MediaPipe/TF.js is necessary to handle the specific business logic of fitness tracking (rep counting, form correction, exercise phases) which is not provided by general-purpose computer vision libraries.

---

## Layer Specifications

### Raw Layer: Raw Pose Data

**Location:** `frontend/src/modules/Fitness/domain/pose/`

**Current Implementation:** ✅ Exists as `PoseDetectorService.js`
**Dependencies:** `frontend/src/modules/Fitness/lib/pose/poseGeometry.js` (Utility)

**Interface:**
```javascript
/**
 * @typedef {Object} RawLayer
 * @property {Keypoint[]} keypoints - 33 BlazePose keypoints
 * @property {number} confidence - Overall pose confidence (0-1)
 * @property {number} timestamp - Frame timestamp
 * @property {number} frameId - Sequential frame counter
 * @property {number} inferenceMs - Model inference time
 * @property {string} backend - 'webgl' | 'wasm' | 'cpu'
 * @property {Keypoint|null} hipCenter
 * @property {Keypoint|null} shoulderCenter
 * @property {Keypoint|null} bodyCenter
 */
```

**Responsibilities:**
1. TensorFlow.js model lifecycle management
2. Video frame capture and inference
3. Temporal smoothing (EMA filter)
4. Keypoint normalization options
5. NaN/outlier detection and recovery

**Configuration:**
```javascript
// raw.config.js
export const RAW_CONFIG = {
  // Model settings
  modelType: 'full',              // 'lite' | 'full' | 'heavy'
  targetFps: 30,
  
  // Quality thresholds
  minPoseConfidence: 0.5,
  minKeypointConfidence: 0.3,
  
  // Smoothing
  temporalSmoothing: true,
  smoothingFactor: 0.5,           // 0=none, 1=max
  maxVelocity: 300,               // Max px/frame movement
  
  // Output options
  normalizeCoordinates: false,    // Output as 0-1 or pixels
  mirrorHorizontal: false,        // Webcam mirroring
};
```

---

### Geometry Layer: Relational Data

**Location:** `frontend/src/modules/Fitness/domain/pose/geometry/`

**Status:** 🆕 New implementation required

**Interface:**
```javascript
/**
 * @typedef {Object} GeometryLayer
 * @property {number} timestamp
 * @property {number} frameId
 * @property {Object} angles - Joint angles (degrees, 0-180)
 * @property {number} angles.leftKnee
 * @property {number} angles.rightKnee
 * @property {number} angles.leftHip
 * @property {number} angles.rightHip
 * @property {number} angles.leftElbow
 * @property {number} angles.rightElbow
 * @property {number} angles.leftShoulder - Arm raise angle
 * @property {number} angles.rightShoulder
 * @property {number} angles.torsoLean - Forward/backward lean
 * @property {number} angles.spineAngle - Curvature of spine
 * @property {Object} positions - Relative positions (normalized ratios)
 * @property {number} positions.leftHandHeight - -1 (below hip) to +1 (above head)
 * @property {number} positions.rightHandHeight
 * @property {number} positions.leftHandWidth - -1 (crossed) to +1 (extended)
 * @property {number} positions.rightHandWidth
 * @property {number} positions.stanceWidth - Distance between feet / hip width
 * @property {number} positions.leftFootForward - -1 (behind) to +1 (in front of hip)
 * @property {number} positions.rightFootForward
 * @property {number} positions.facingAngle - 0=facing camera, 180=facing away
 * @property {number} positions.bodyTilt - Side lean angle
 * @property {Object} symmetry - Symmetry metrics
 * @property {number} symmetry.armSymmetry - 0=asymmetric, 1=symmetric
 * @property {number} symmetry.legSymmetry
 * @property {number} symmetry.overallSymmetry
 * @property {Object} motion - Velocity/acceleration
 * @property {number} motion.hipVelocityY - Vertical movement speed
 * @property {number} motion.handSpread - Rate of hands moving apart
 * @property {number} motion.overallMotion - Aggregate body movement
 */
```

**Computation Strategy:**

```javascript
// GeometryProcessor.js
export class GeometryProcessor {
  constructor(config = {}) {
    this.config = { ...GEOMETRY_DEFAULTS, ...config };
    this.previousFrame = null;
    this.torsoHeight = null;  // Cached for normalization
  }
  
  /**
   * Process raw data into geometry layer
   * @param {RawLayer} raw - Raw pose data
   * @returns {GeometryLayer}
   */
  process(raw) {
    const { keypoints } = raw;
    
    // Update torso height for normalization
    this.torsoHeight = this._computeTorsoHeight(keypoints);
    
    const angles = this._computeAngles(keypoints);
    const positions = this._computePositions(keypoints);
    const symmetry = this._computeSymmetry(angles, positions);
    const motion = this._computeMotion(keypoints, this.previousFrame);
    
    this.previousFrame = keypoints;
    
    return {
      timestamp: raw.timestamp,
      frameId: raw.frameId,
      angles,
      positions,
      symmetry,
      motion,
    };
  }
  
  _computeAngles(kp) {
    // Note: calculateAngle(a, b, c) uses 'b' as the vertex
    return {
      leftKnee: calculateAngle(kp[23], kp[25], kp[27]),   // Hip(23) -> Knee(25) -> Ankle(27)
      rightKnee: calculateAngle(kp[24], kp[26], kp[28]),
      leftHip: calculateAngle(kp[11], kp[23], kp[25]),    // Shoulder(11) -> Hip(23) -> Knee(25)
      rightHip: calculateAngle(kp[12], kp[24], kp[26]),
      leftElbow: calculateAngle(kp[11], kp[13], kp[15]),  // Shoulder(11) -> Elbow(13) -> Wrist(15)
      rightElbow: calculateAngle(kp[12], kp[14], kp[16]),
      leftShoulder: this._computeArmRaiseAngle(kp, 'left'),
      rightShoulder: this._computeArmRaiseAngle(kp, 'right'),
      torsoLean: this._computeTorsoLean(kp),
      spineAngle: this._computeSpineAngle(kp),
    };
  }
  
  _computePositions(kp) {
    const hipCenter = getMidpoint(kp[23], kp[24]);
    const shoulderCenter = getMidpoint(kp[11], kp[12]);
    const nose = kp[0]; // Using nose as head reference
    
    // Hand height: -1 at hip level, 0 at shoulder, +1 above head
    const leftHandHeight = this._normalizeHeight(kp[15], hipCenter, nose);
    const rightHandHeight = this._normalizeHeight(kp[16], hipCenter, nose);
    
    // Hand width: normalized by shoulder width
    const shoulderWidth = getKeypointDistance(kp[11], kp[12]);
    const leftHandWidth = (kp[15].x - hipCenter.x) / shoulderWidth;
    const rightHandWidth = (kp[16].x - hipCenter.x) / shoulderWidth;
    
    // Stance width: normalized by hip width
    const hipWidth = getKeypointDistance(kp[23], kp[24]);
    const footDistance = getKeypointDistance(kp[27], kp[28]);
    const stanceWidth = footDistance / hipWidth;
    
    // Facing angle calculation
    const facingAngle = this._computeFacingAngle(kp);
    
    return {
      leftHandHeight,
      rightHandHeight,
      leftHandWidth,
      rightHandWidth,
      stanceWidth,
      leftFootForward: this._computeFootForward(kp, 'left'),
      rightFootForward: this._computeFootForward(kp, 'right'),
      facingAngle,
      bodyTilt: this._computeBodyTilt(kp),
    };
  }
}
```

**Configuration:**
```javascript
// geometry.config.js
export const GEOMETRY_CONFIG = {
  // Angle computation
  minConfidenceForAngle: 0.4,     // Skip angles with low-confidence keypoints
  angleSmoothing: 0.3,            // Additional angle smoothing
  
  // Position normalization
  useNormalizedPositions: true,   // Output positions as ratios
  // defaultTorsoHeight: 400,     // REMOVED: Magic number. Use relative normalization.
  
  // Motion detection
  motionHistoryFrames: 5,         // Frames for velocity calculation
  velocityScale: 1.0,             // Multiplier for motion values
  
  // Thresholds for "significant" values
  significantAngleChange: 5,      // Degrees
  significantPositionChange: 0.05, // Ratio
};
```

---

### Semantic Layer: Semantic States

**Location:** `frontend/src/modules/Fitness/domain/pose/semantic/`

**Status:** 🆕 New implementation required

**Interface:**
```javascript
/**
 * @typedef {Object} SemanticLayer
 * @property {number} timestamp
 * @property {number} frameId
 * @property {Object} posture - Body position states
 * @property {boolean} posture.standing
 * @property {boolean} posture.squatting
 * @property {boolean} posture.lunging
 * @property {boolean} posture.kneeling
 * @property {boolean} posture.sitting
 * @property {boolean} posture.prone - Face down
 * @property {boolean} posture.supine - Face up
 * @property {boolean} posture.plank
 * @property {Object} arms - Arm states
 * @property {Object} arms.raised
 * @property {Object} arms.extended
 * @property {boolean} arms.crossed
 * @property {Object} arms.overhead
 * @property {boolean} arms.tPose
 * @property {Object} exercisePhases - Exercise phase states
 * @property {string|null} exercisePhases.jumpingJack
 * @property {string|null} exercisePhases.squat
 * @property {string|null} exercisePhases.pushup
 * @property {string|null} exercisePhases.lunge
 * @property {string|null} exercisePhases.burpee
 * @property {Object} movement - Movement qualities
 * @property {boolean} movement.isStill
 * @property {boolean} movement.isMoving
 * @property {boolean} movement.isJumping
 * @property {string} movement.direction
 * @property {Object} form - Form quality indicators
 * @property {boolean} form.spineNeutral
 * @property {boolean} form.kneesTracking
 * @property {boolean} form.balanceStable
 * @property {Object} confidence - Confidence in state detection
 * @property {number} confidence.posture
 * @property {number} confidence.arms
 * @property {number} confidence.overall
 */
```

**State Detection Engine:**

```javascript
// SemanticProcessor.js
import { StateDetector } from './StateDetector.js';
import { SEMANTIC_CONFIG } from './semantic.config.js';

export class SemanticProcessor {
  constructor(config = {}) {
    this.config = { ...SEMANTIC_CONFIG, ...config };
    this.stateDetectors = this._initializeDetectors();
    this.previousStates = null;
  }
  
  /**
   * Process geometry data into semantic states
   */
  process(geometry, raw) {
    const posture = this._detectPosture(geometry);
    const arms = this._detectArmStates(geometry);
    const exercisePhases = this._detectExercisePhases(geometry, posture, arms);
    const movement = this._detectMovement(geometry);
    const form = this._assessForm(geometry, posture);
    const confidence = this._computeConfidence(raw, geometry);
    
    const states = {
      timestamp: geometry.timestamp,
      frameId: geometry.frameId,
      posture,
      arms,
      exercisePhases,
      movement,
      form,
      confidence,
    };
    
    this.previousStates = states;
    return states;
  }
  
  _detectPosture(geometry) {
    const { angles, positions } = geometry;
    const cfg = this.config.posture;
    
    // Squat detection: knees bent significantly, hips lowered
    const avgKneeAngle = (angles.leftKnee + angles.rightKnee) / 2;
    const squatting = avgKneeAngle < cfg.squatKneeThreshold && 
                      avgKneeAngle > cfg.squatKneeMin;
    
    // Standing: legs relatively straight
    const standing = avgKneeAngle > cfg.standingKneeThreshold && 
                     !this._isHorizontal(geometry);
    
    // Plank: body horizontal, arms extended
    const plank = this._isHorizontal(geometry) && 
                  angles.leftElbow > cfg.plankElbowThreshold;
    
    // Prone/supine based on facing angle and horizontal
    const isHoriz = this._isHorizontal(geometry);
    const prone = isHoriz && positions.facingAngle > 90;
    const supine = isHoriz && positions.facingAngle < 90;
    
    return {
      standing,
      squatting,
      lunging: this._detectLunge(geometry),
      kneeling: this._detectKneeling(geometry),
      sitting: this._detectSitting(geometry),
      prone,
      supine,
      plank,
    };
  }
  
  _detectArmStates(geometry) {
    const { positions } = geometry;
    const cfg = this.config.arms;
    
    const leftRaised = positions.leftHandHeight > cfg.raisedThreshold;
    const rightRaised = positions.rightHandHeight > cfg.raisedThreshold;
    
    const leftOverhead = positions.leftHandHeight > cfg.overheadThreshold;
    const rightOverhead = positions.rightHandHeight > cfg.overheadThreshold;
    
    const leftExtended = Math.abs(positions.leftHandWidth) > cfg.extendedThreshold;
    const rightExtended = Math.abs(positions.rightHandWidth) > cfg.extendedThreshold;
    
    const tPose = leftExtended && rightExtended && 
                  Math.abs(positions.leftHandHeight) < cfg.tPoseHeightTolerance &&
                  Math.abs(positions.rightHandHeight) < cfg.tPoseHeightTolerance;
    
    return {
      raised: {
        left: leftRaised,
        right: rightRaised,
        both: leftRaised && rightRaised,
      },
      extended: {
        left: leftExtended,
        right: rightExtended,
        both: leftExtended && rightExtended,
      },
      crossed: this._detectArmsCrossed(geometry),
      overhead: {
        left: leftOverhead,
        right: rightOverhead,
        both: leftOverhead && rightOverhead,
      },
      tPose,
    };
  }
  
  _detectExercisePhases(geometry, posture, arms) {
    return {
      jumpingJack: this._detectJumpingJackPhase(geometry, posture, arms),
      squat: this._detectSquatPhase(geometry, posture),
      pushup: this._detectPushupPhase(geometry, posture),
      lunge: this._detectLungePhase(geometry, posture),
      burpee: this._detectBurpeePhase(geometry, posture, arms),
    };
  }
  
  _detectJumpingJackPhase(geometry, posture, arms) {
    if (!posture.standing) return null;
    
    const cfg = this.config.exercises.jumpingJack;
    const { positions } = geometry;
    
    // High phase: arms up, legs spread
    const armsUp = arms.overhead.both || arms.raised.both;
    const legsSpread = positions.stanceWidth > cfg.legSpreadThreshold;
    
    // Low phase: arms down, legs together
    const armsDown = !arms.raised.left && !arms.raised.right;
    const legsTogether = positions.stanceWidth < cfg.legTogetherThreshold;
    
    if (armsUp && legsSpread) return 'high';
    if (armsDown && legsTogether) return 'low';
    return 'transition';
  }
}
```

**Configuration:**
```javascript
// semantic.config.js
// NOTE: This file is generated from the Exercise Catalog (see below).
// The Catalog is the single source of truth for exercise thresholds.
export const SEMANTIC_CONFIG = {
  posture: {
    squatKneeThreshold: 120,      // Below this = squatting
    squatKneeMin: 45,             // Above this = valid squat (not collapsed)
    standingKneeThreshold: 160,   // Above this = standing
    plankElbowThreshold: 150,     // Above this = arms extended
    horizontalTorsoThreshold: 30, // Torso angle from horizontal
  },
  
  arms: {
    raisedThreshold: 0.3,         // Hand height ratio
    overheadThreshold: 0.8,
    extendedThreshold: 1.2,       // Shoulder widths
    tPoseHeightTolerance: 0.2,
  },
  
  // Exercise catalog - derived from industry standard movement definitions
  // Each exercise defines phase detection thresholds and preferred camera view
  //
  // VARIANT SYSTEM:
  // Exercises can define `variants` for different effort/mobility levels.
  // Each variant overrides specific thresholds from the base exercise.
  // - `defaultVariant`: Which variant to use if none specified
  // - Variants inherit all base properties and only override what's specified
  // - Common variant patterns:
  //   - ROM (Range of Motion): shallow/medium/deep, partial/full
  //   - Effort: min/mid/max, easy/moderate/intense
  //   - Speed: slow/normal/explosive
  //
  exercises: {
    // === DYNAMIC EXERCISES ===
    jumpingJack: {
      id: 'jumpingJack',
      name: 'Jumping Jacks',
      bodyZone: ['lower', 'upper'],
      preferredView: 'front',
      phases: ['low', 'high'],
      thresholds: {
        legSpreadThreshold: 1.5,    // Stance width ratio for 'high'
        legTogetherThreshold: 0.8,  // Stance width ratio for 'low'
        armsUpThreshold: 0.7,       // Hand height for 'high'
      },
      minConfidence: 0.6,
      // Variants based on range of motion
      variants: {
        min: {
          label: 'Minimal',
          description: 'Small arm/leg movements, low impact',
          thresholds: {
            legSpreadThreshold: 1.2,
            armsUpThreshold: 0.4,
          },
        },
        mid: {
          label: 'Standard',
          description: 'Normal jumping jack form',
          // Uses base thresholds
        },
        max: {
          label: 'Full Extension',
          description: 'Maximum arm/leg spread',
          thresholds: {
            legSpreadThreshold: 1.8,
            armsUpThreshold: 0.9,
          },
        },
      },
      defaultVariant: 'mid',
    },
    squat: {
      id: 'squat',
      name: 'Air Squat',
      bodyZone: ['lower'],
      preferredView: 'front',
      phases: ['standing', 'bottom'],
      thresholds: {
        bottomKneeAngle: 90,        // Below this = bottom phase
        standingKneeAngle: 160,     // Above this = standing phase
        hipDropThreshold: 0.3,      // Hip Y displacement ratio
      },
      minConfidence: 0.6,
      // Variants based on depth (knee angle at bottom)
      variants: {
        shallow: {
          label: 'Quarter Squat',
          description: 'Knees bend to ~120°, minimal depth',
          thresholds: {
            bottomKneeAngle: 120,
            hipDropThreshold: 0.15,
          },
        },
        medium: {
          label: 'Parallel',
          description: 'Thighs parallel to ground, ~90° knee angle',
          // Uses base thresholds
        },
        deep: {
          label: 'Deep Squat',
          description: 'Below parallel, ~60° knee angle or less',
          thresholds: {
            bottomKneeAngle: 60,
            hipDropThreshold: 0.45,
          },
        },
      },
      defaultVariant: 'medium',
    },
    squatSumo: {
      id: 'squatSumo',
      name: 'Sumo Squat',
      bodyZone: ['lower'],
      preferredView: 'front',
      phases: ['standing', 'bottom'],
      thresholds: {
        bottomKneeAngle: 90,
        standingKneeAngle: 160,
        minStanceWidth: 1.8,        // Wider stance required
      },
      minConfidence: 0.6,
      variants: {
        shallow: {
          label: 'Quarter',
          thresholds: { bottomKneeAngle: 120 },
        },
        medium: {
          label: 'Parallel',
        },
        deep: {
          label: 'Deep',
          thresholds: { bottomKneeAngle: 60 },
        },
      },
      defaultVariant: 'medium',
    },
    squatNarrow: {
      id: 'squatNarrow',
      name: 'Narrow Squat',
      bodyZone: ['lower'],
      preferredView: 'front',
      phases: ['standing', 'bottom'],
      thresholds: {
        bottomKneeAngle: 90,
        standingKneeAngle: 160,
        maxStanceWidth: 1.0,        // Narrower stance required
      },
      minConfidence: 0.6,
      variants: {
        shallow: {
          label: 'Quarter',
          thresholds: { bottomKneeAngle: 120 },
        },
        medium: {
          label: 'Parallel',
        },
        deep: {
          label: 'Deep',
          thresholds: { bottomKneeAngle: 60 },
        },
      },
      defaultVariant: 'medium',
    },
    squatOverhead: {
      id: 'squatOverhead',
      name: 'Overhead Squat',
      bodyZone: ['lower', 'upper', 'back'],
      preferredView: 'front',
      phases: ['standing', 'bottom'],
      thresholds: {
        bottomKneeAngle: 90,
        standingKneeAngle: 160,
        armsOverheadThreshold: 0.9, // Hands must be overhead
      },
      minConfidence: 0.6,
      variants: {
        shallow: {
          label: 'Quarter',
          thresholds: { bottomKneeAngle: 120 },
        },
        medium: {
          label: 'Parallel',
        },
        deep: {
          label: 'Deep',
          thresholds: { bottomKneeAngle: 60 },
        },
      },
      defaultVariant: 'medium',
    },
    pushup: {
      id: 'pushup',
      name: 'Push-up',
      bodyZone: ['upper', 'abs'],
      preferredView: 'side',
      phases: ['high', 'low'],
      thresholds: {
        highElbowAngle: 160,        // Above this = high/top
        lowElbowAngle: 90,          // Below this = low/bottom
        bodyLineThreshold: 20,      // Max spine deviation from straight
      },
      minConfidence: 0.6,
      // Variants based on depth (elbow angle at bottom)
      variants: {
        partial: {
          label: 'Partial ROM',
          description: 'Half range, elbows to ~110°',
          thresholds: {
            lowElbowAngle: 110,
          },
        },
        full: {
          label: 'Full ROM',
          description: 'Standard push-up, elbows to ~90°',
          // Uses base thresholds
        },
        chestToGround: {
          label: 'Chest to Ground',
          description: 'Maximum depth, chest nearly touches floor',
          thresholds: {
            lowElbowAngle: 45,
          },
        },
      },
      defaultVariant: 'full',
    },
    pushupNarrow: {
      id: 'pushupNarrow',
      name: 'Narrow Push-up',
      bodyZone: ['upper', 'abs'],
      preferredView: 'side',
      phases: ['high', 'low'],
      thresholds: {
        highElbowAngle: 160,
        lowElbowAngle: 90,
        maxHandWidth: 1.0,          // Shoulder width or less
      },
      minConfidence: 0.6,
      variants: {
        partial: { label: 'Partial', thresholds: { lowElbowAngle: 110 } },
        full: { label: 'Full' },
        chestToGround: { label: 'Chest to Ground', thresholds: { lowElbowAngle: 45 } },
      },
      defaultVariant: 'full',
    },
    pushupWide: {
      id: 'pushupWide',
      name: 'Wide Push-up',
      bodyZone: ['upper', 'abs'],
      preferredView: 'side',
      phases: ['high', 'low'],
      thresholds: {
        highElbowAngle: 160,
        lowElbowAngle: 90,
        minHandWidth: 1.5,          // Wider than shoulder width
      },
      minConfidence: 0.6,
      variants: {
        partial: { label: 'Partial', thresholds: { lowElbowAngle: 110 } },
        full: { label: 'Full' },
        chestToGround: { label: 'Chest to Ground', thresholds: { lowElbowAngle: 45 } },
      },
      defaultVariant: 'full',
    },
    pushupKnees: {
      id: 'pushupKnees',
      name: 'Knee Push-up',
      bodyZone: ['upper', 'abs'],
      preferredView: 'side',
      phases: ['high', 'low'],
      thresholds: {
        highElbowAngle: 160,
        lowElbowAngle: 90,
        kneesOnGround: true,        // Knees as pivot point
      },
      minConfidence: 0.6,
      variants: {
        partial: { label: 'Partial', thresholds: { lowElbowAngle: 110 } },
        full: { label: 'Full' },
        chestToGround: { label: 'Chest to Ground', thresholds: { lowElbowAngle: 45 } },
      },
      defaultVariant: 'full',
    },
    lungeFront: {
      id: 'lungeFront',
      name: 'Forward Lunge',
      bodyZone: ['lower'],
      preferredView: 'side',
      bilateral: true,              // Track left/right separately
      phases: ['standing', 'down'],
      thresholds: {
        downKneeAngle: 90,          // Both knees ~90° at bottom
        standingKneeAngle: 160,
        footForwardThreshold: 0.3,  // Lead foot ahead of hip
      },
      minConfidence: 0.6,
      variants: {
        shallow: {
          label: 'Quarter Lunge',
          description: 'Minimal knee bend, ~120°',
          thresholds: { downKneeAngle: 120 },
        },
        medium: {
          label: 'Standard',
          description: 'Knees at 90°',
        },
        deep: {
          label: 'Deep Lunge',
          description: 'Back knee nearly touches ground',
          thresholds: { downKneeAngle: 60 },
        },
      },
      defaultVariant: 'medium',
    },
    lungeSide: {
      id: 'lungeSide',
      name: 'Side Lunge',
      bodyZone: ['lower'],
      preferredView: 'front',
      bilateral: true,
      phases: ['standing', 'down'],
      thresholds: {
        downKneeAngle: 90,
        standingKneeAngle: 160,
        lateralDisplacement: 0.4,   // Hip shift to side
      },
      minConfidence: 0.6,
      variants: {
        shallow: { label: 'Shallow', thresholds: { downKneeAngle: 120, lateralDisplacement: 0.25 } },
        medium: { label: 'Standard' },
        deep: { label: 'Deep', thresholds: { downKneeAngle: 60, lateralDisplacement: 0.5 } },
      },
      defaultVariant: 'medium',
    },
    burpee: {
      id: 'burpee',
      name: 'Burpees',
      bodyZone: ['lower', 'upper', 'abs'],
      preferredView: 'front',
      phases: ['standing', 'squat', 'plank', 'squat', 'jump'],
      thresholds: {
        squatKneeAngle: 90,
        plankBodyLine: 20,
        jumpThreshold: 0.1,         // Vertical displacement
      },
      minConfidence: 0.5,           // Lower due to complex movement
      variants: {
        walkOut: {
          label: 'Walk-out (No Jump)',
          description: 'Step back to plank, no jump at end',
          thresholds: { jumpThreshold: 0 },
        },
        standard: {
          label: 'Standard',
          description: 'Full burpee with jump',
        },
        explosive: {
          label: 'Explosive',
          description: 'Higher jump, faster pace',
          thresholds: { jumpThreshold: 0.2 },
        },
      },
      defaultVariant: 'standard',
    },
    highKnees: {
      id: 'highKnees',
      name: 'High Knees',
      bodyZone: ['lower'],
      preferredView: 'front',
      continuous: true,             // No discrete phases, count alternations
      thresholds: {
        kneeHeightThreshold: 0.0,   // Knee at or above hip level
        minCadence: 60,             // Min alternations per minute
      },
      minConfidence: 0.6,
      // Variants based on knee height relative to hip
      variants: {
        low: {
          label: 'Low Knees',
          description: 'Knee rises to mid-thigh height',
          thresholds: { kneeHeightThreshold: -0.2 },
        },
        hip: {
          label: 'Hip Height',
          description: 'Knee rises to hip level',
        },
        high: {
          label: 'High Knees',
          description: 'Knee rises above hip level',
          thresholds: { kneeHeightThreshold: 0.15 },
        },
      },
      defaultVariant: 'hip',
    },
    crunches: {
      id: 'crunches',
      name: 'Crunches',
      bodyZone: ['abs'],
      preferredView: 'side',
      phases: ['down', 'up'],
      thresholds: {
        upTorsoAngle: 45,           // Torso lift angle
        downTorsoAngle: 10,
      },
      minConfidence: 0.6,
      variants: {
        mini: {
          label: 'Mini Crunch',
          description: 'Shoulders barely off ground, ~30° lift',
          thresholds: { upTorsoAngle: 30 },
        },
        standard: {
          label: 'Standard',
          description: 'Shoulder blades off ground, ~45° lift',
        },
        full: {
          label: 'Full Crunch',
          description: 'Maximum lift, ~60° angle',
          thresholds: { upTorsoAngle: 60 },
        },
      },
      defaultVariant: 'standard',
    },
    glutesBridge: {
      id: 'glutesBridge',
      name: 'Glutes Bridge',
      bodyZone: ['back', 'lower'],
      preferredView: 'side',
      phases: ['down', 'up'],
      thresholds: {
        upHipAngle: 180,            // Hips fully extended
        downHipAngle: 90,
      },
      minConfidence: 0.6,
      variants: {
        partial: {
          label: 'Partial',
          description: 'Hips rise but not to full extension',
          thresholds: { upHipAngle: 150 },
        },
        full: {
          label: 'Full Extension',
          description: 'Hips fully extended, straight line',
        },
        overextended: {
          label: 'Overextended',
          description: 'Slight hyperextension for glute squeeze',
          thresholds: { upHipAngle: 190 },
        },
      },
      defaultVariant: 'full',
    },
    skaterHops: {
      id: 'skaterHops',
      name: 'Skater Hops',
      bodyZone: ['lower'],
      preferredView: 'front',
      continuous: true,
      thresholds: {
        lateralDisplacement: 0.5,   // Side-to-side distance
        trailingLegCross: true,     // Leg crosses behind
      },
      minConfidence: 0.5,
      variants: {
        small: {
          label: 'Small Hops',
          description: 'Minimal lateral movement',
          thresholds: { lateralDisplacement: 0.3 },
        },
        medium: {
          label: 'Standard',
        },
        wide: {
          label: 'Wide Bounds',
          description: 'Maximum lateral distance',
          thresholds: { lateralDisplacement: 0.7 },
        },
      },
      defaultVariant: 'medium',
    },
    mountainClimber: {
      id: 'mountainClimber',
      name: 'Mountain Climbers',
      bodyZone: ['abs', 'lower'],
      preferredView: 'side',
      continuous: true,
      bilateral: true,
      thresholds: {
        kneeToChestAngle: 60,       // Knee drive threshold
        plankBodyLine: 20,
      },
      minConfidence: 0.5,
      variants: {
        slow: {
          label: 'Slow/Controlled',
          description: 'Deliberate movement, less knee drive',
          thresholds: { kneeToChestAngle: 75 },
        },
        standard: {
          label: 'Standard',
        },
        explosive: {
          label: 'Explosive',
          description: 'Maximum knee drive, fast pace',
          thresholds: { kneeToChestAngle: 45 },
        },
      },
      defaultVariant: 'standard',
    },
    birdDog: {
      id: 'birdDog',
      name: 'Bird Dog',
      bodyZone: ['back', 'abs'],
      preferredView: 'side',
      bilateral: true,
      phases: ['neutral', 'extended'],
      thresholds: {
        armExtension: 160,          // Arm straight ahead
        legExtension: 160,          // Opposite leg straight back
      },
      minConfidence: 0.6,
      variants: {
        partial: {
          label: 'Partial Extension',
          description: 'Arm/leg not fully extended',
          thresholds: { armExtension: 135, legExtension: 135 },
        },
        full: {
          label: 'Full Extension',
          description: 'Arm and leg fully extended, parallel to floor',
        },
      },
      defaultVariant: 'full',
    },
    sitToStand: {
      id: 'sitToStand',
      name: 'Sit to Stand',
      bodyZone: ['lower'],
      preferredView: 'front',
      phases: ['seated', 'standing'],
      thresholds: {
        seatedHipAngle: 90,
        standingKneeAngle: 160,
      },
      minConfidence: 0.6,
      // No ROM variants - it's a functional movement test
    },
    
    // === STATIC/ISOMETRIC EXERCISES ===
    // Isometric variants are based on form strictness rather than ROM
    plankHigh: {
      id: 'plankHigh',
      name: 'High Plank Hold',
      bodyZone: ['abs', 'upper', 'lower'],
      preferredView: 'side',
      isometric: true,
      thresholds: {
        bodyLineThreshold: 15,      // Max spine deviation
        elbowAngle: 160,            // Arms straight
      },
      minConfidence: 0.6,
      variants: {
        relaxed: {
          label: 'Relaxed Form',
          description: 'Allows more spine deviation',
          thresholds: { bodyLineThreshold: 25 },
        },
        strict: {
          label: 'Strict Form',
          description: 'Standard plank alignment',
        },
        perfect: {
          label: 'Perfect Form',
          description: 'Minimal deviation allowed',
          thresholds: { bodyLineThreshold: 8 },
        },
      },
      defaultVariant: 'strict',
    },
    plankLow: {
      id: 'plankLow',
      name: 'Low Plank Hold',
      bodyZone: ['abs', 'upper'],
      preferredView: 'side',
      isometric: true,
      thresholds: {
        bodyLineThreshold: 15,
        elbowAngle: 90,             // Forearm plank
      },
      minConfidence: 0.6,
      variants: {
        relaxed: { label: 'Relaxed', thresholds: { bodyLineThreshold: 25 } },
        strict: { label: 'Strict' },
        perfect: { label: 'Perfect', thresholds: { bodyLineThreshold: 8 } },
      },
      defaultVariant: 'strict',
    },
    plankSide: {
      id: 'plankSide',
      name: 'Side Plank',
      bodyZone: ['upper', 'abs'],
      preferredView: 'front',
      bilateral: true,
      isometric: true,
      thresholds: {
        hipSagThreshold: 15,        // Max hip drop
        bodyLineThreshold: 15,
      },
      minConfidence: 0.6,
      variants: {
        relaxed: { label: 'Relaxed', thresholds: { hipSagThreshold: 25, bodyLineThreshold: 25 } },
        strict: { label: 'Strict' },
        perfect: { label: 'Perfect', thresholds: { hipSagThreshold: 8, bodyLineThreshold: 8 } },
      },
      defaultVariant: 'strict',
    },
    squatHold: {
      id: 'squatHold',
      name: 'Squat Hold',
      bodyZone: ['lower'],
      preferredView: 'front',
      isometric: true,
      thresholds: {
        kneeAngle: 90,              // Hold at ~90°
        kneeAngleTolerance: 15,
      },
      minConfidence: 0.6,
      // Variants based on hold depth
      variants: {
        high: {
          label: 'High Hold',
          description: 'Quarter squat position',
          thresholds: { kneeAngle: 120 },
        },
        parallel: {
          label: 'Parallel',
          description: 'Thighs parallel to ground',
        },
        deep: {
          label: 'Deep Hold',
          description: 'Below parallel',
          thresholds: { kneeAngle: 60 },
        },
      },
      defaultVariant: 'parallel',
    },
    lungeHold: {
      id: 'lungeHold',
      name: 'Lunge Hold',
      bodyZone: ['lower'],
      preferredView: 'side',
      bilateral: true,
      isometric: true,
      thresholds: {
        frontKneeAngle: 90,
        backKneeAngle: 90,
      },
      minConfidence: 0.6,
      variants: {
        shallow: { label: 'Shallow', thresholds: { frontKneeAngle: 120, backKneeAngle: 120 } },
        standard: { label: 'Standard' },
        deep: { label: 'Deep', thresholds: { frontKneeAngle: 60, backKneeAngle: 60 } },
      },
      defaultVariant: 'standard',
    },
  },
  
  movement: {
    stillThreshold: 0.02,         // Motion below this = still
    movingThreshold: 0.1,         // Motion above this = moving
    jumpVelocityThreshold: 0.5,   // Vertical velocity for jump
  },
  
  form: {
    spineNeutralThreshold: 15,    // Degrees from neutral
    kneeTrackingTolerance: 0.2,   // Knee x vs foot x ratio
    balanceThreshold: 0.05,       // CoM movement threshold
  },
  
  // Hysteresis to prevent state flickering
  hysteresis: {
    enabled: true,
    framesRequired: 3,            // Frames before state change
    confidenceBoost: 0.1,         // Bonus for consistent state
  },
};

/**
 * Utility: Resolve exercise config with variant applied
 * @param {string} exerciseId - Base exercise ID
 * @param {string} [variantId] - Optional variant ID
 * @returns {Object} - Merged config with variant thresholds applied
 */
export function getExerciseConfig(exerciseId, variantId = null) {
  const base = SEMANTIC_CONFIG.exercises[exerciseId];
  if (!base) throw new Error(`Unknown exercise: ${exerciseId}`);
  
  // Determine which variant to use
  const effectiveVariant = variantId || base.defaultVariant;
  const variant = base.variants?.[effectiveVariant];
  
  // If no variant or no threshold overrides, return base
  if (!variant?.thresholds) {
    return { ...base, activeVariant: effectiveVariant };
  }
  
  // Merge variant thresholds into base
  return {
    ...base,
    activeVariant: effectiveVariant,
    thresholds: {
      ...base.thresholds,
      ...variant.thresholds,
    },
  };
}

/**
 * Utility: Get all variant options for an exercise
 * @param {string} exerciseId 
 * @returns {Array<{id: string, label: string, description?: string}>}
 */
export function getExerciseVariants(exerciseId) {
  const base = SEMANTIC_CONFIG.exercises[exerciseId];
  if (!base?.variants) return [];
  
  return Object.entries(base.variants).map(([id, variant]) => ({
    id,
    label: variant.label,
    description: variant.description,
    isDefault: id === base.defaultVariant,
  }));
}

// Usage example:
// const squatConfig = getExerciseConfig('squat', 'deep');
// squatConfig.thresholds.bottomKneeAngle === 60
// squatConfig.activeVariant === 'deep'
```

---

### Metrics Layer: Temporal Analytics

**Location:** `frontend/src/modules/Fitness/domain/pose/metrics/`

**Status:** 🆕 New implementation required (extends existing `MoveDetectorBase`)

**Interface:**
```javascript
/**
 * @typedef {Object} MetricsLayer
 * @property {number} timestamp
 * @property {number} sessionDuration - Seconds since start
 * @property {Object.<string, RepCounter>} reps - Rep counting per exercise
 * @property {string|null} activeExercise
 * @property {number} exerciseConfidence
 * @property {Object} metrics - Workout metrics
 * @property {Object} quality - Quality metrics
 * @property {MetricsEvent[]} recentEvents
 */
```

**Rep Counter Implementation:**

```javascript
// RepCounter.js
import { MoveDetectorBase } from '../MoveDetectorBase.js';

export class RepCounter extends MoveDetectorBase {
  constructor(exerciseId, config = {}) {
    super(exerciseId, exerciseId, {
      config: {
        minRepDuration: 500,
        maxRepDuration: 5000,
        cooldownMs: 300,
        ...config
      }
    });
    
    this.requiredPhases = config.requiredPhases || ['high', 'low'];
    this.phaseOrder = config.phaseOrder || ['low', 'high', 'low'];
    
    this.currentPhase = null;
    this.phaseHistory = [];
    this.phaseStartTime = null;
    this.repDurations = [];
  }
  
  /**
   * Process a new semantic state
   * @param {SemanticLayer} semantic - Current semantic layer state
   * @returns {MetricsEvent | null} - Rep event if completed
   */
  processState(semantic) {
    const phase = semantic.exercisePhases[this.exerciseId];
    if (!phase || phase === 'transition') return null;
    
    const now = semantic.timestamp;
    
    // Phase changed?
    if (phase !== this.currentPhase) {
      this._recordPhaseTransition(phase, now);
      
      // Check if rep completed
      const repEvent = this._checkRepCompletion(now);
      if (repEvent) return repEvent;
    }
    
    return null;
  }
  
  _recordPhaseTransition(newPhase, timestamp) {
    if (this.currentPhase) {
      this.phaseHistory.push({
        phase: this.currentPhase,
        startTime: this.phaseStartTime,
        endTime: timestamp,
        duration: timestamp - this.phaseStartTime,
      });
      
      // Keep only recent history
      if (this.phaseHistory.length > 10) {
        this.phaseHistory.shift();
      }
    }
    
    this.currentPhase = newPhase;
    this.phaseStartTime = timestamp;
  }
  
  /**
   * Check if phase sequence constitutes a completed rep
   * IMPORTANT: Handles fencepost problem correctly
   */
  _checkRepCompletion(now) {
    const { phaseOrder, minRepDuration, maxRepDuration, cooldownMs } = this.config;
    
    // Need enough history to match the pattern
    if (this.phaseHistory.length < phaseOrder.length - 1) return null;
    
    // Check cooldown
    if (this.lastRepTime && (now - this.lastRepTime) < cooldownMs) return null;
    
    // Get recent phases (including current)
    const recentPhases = [
      ...this.phaseHistory.slice(-(phaseOrder.length - 1)).map(p => p.phase),
      this.currentPhase,
    ];
    
    // Match against expected order
    const matches = phaseOrder.every((expected, i) => recentPhases[i] === expected);
    
    if (!matches) return null;
    
    // Calculate rep duration
    const repStartIdx = this.phaseHistory.length - (phaseOrder.length - 1);
    const repStart = this.phaseHistory[repStartIdx]?.startTime;
    const repDuration = now - repStart;
    
    // Validate duration
    if (repDuration < minRepDuration || repDuration > maxRepDuration) {
      return null;
    }
    
    // Rep is valid!
    this.count++;
    this.lastRepTime = now;
    this.repDurations.push(repDuration);
    
    // Keep only last N durations for averaging
    if (this.repDurations.length > 20) {
      this.repDurations.shift();
    }
    
    // FENCEPOST FIX: Do not clear entire history.
    // Only remove the phases that were consumed by this rep.
    // This allows the "end" of this rep to serve as the "start" of the next rep
    // for continuous exercises (like squats: stand -> squat -> stand -> squat).
    const phasesConsumed = phaseOrder.length - 1; // Keep the last one
    this.phaseHistory.splice(0, phasesConsumed);
    
    return {
      type: 'rep_complete',
      timestamp: now,
      data: {
        exerciseId: this.exerciseId,
        repNumber: this.count,
        duration: repDuration,
        averageDuration: this.getAverageDuration(),
      },
    };
  }
  
  getAverageDuration() {
    if (this.repDurations.length === 0) return null;
    const sum = this.repDurations.reduce((a, b) => a + b, 0);
    return sum / this.repDurations.length;
  }
  
  reset() {
    this.count = 0;
    this.currentPhase = null;
    this.phaseHistory = [];
    this.lastRepTime = null;
    this.repDurations = [];
    this.phaseStartTime = null;
  }
}
```

**Metrics Processor:**

```javascript
// MetricsProcessor.js
export class MetricsProcessor {
  constructor(config = {}) {
    this.config = { ...METRICS_DEFAULTS, ...config };
    this.repCounters = new Map();
    this.sessionStart = null;
    this.recentEvents = [];
    this.metrics = this._initMetrics();
  }
  
  /**
   * Register exercise types to track
   */
  registerExercise(exerciseId, exerciseConfig = {}) {
    const counter = new RepCounter(exerciseId, {
      ...this.config.exercises[exerciseId],
      ...exerciseConfig,
    });
    this.repCounters.set(exerciseId, counter);
  }
  
  /**
   * Process semantic state into metrics analytics
   */
  process(semantic, geometry) {
    if (!this.sessionStart) {
      this.sessionStart = semantic.timestamp;
    }
    
    const events = [];
    
    // Process each registered exercise
    this.repCounters.forEach((counter, exerciseId) => {
      const event = counter.processState(semantic);
      if (event) {
        events.push(event);
        this._updateMetrics(event);
      }
    });
    
    // Update activity tracking
    this._trackActivity(semantic, geometry);
    
    // Add events to recent buffer
    events.forEach(e => this._recordEvent(e));
    
    // Detect active exercise
    const activeExercise = this._detectActiveExercise(semantic);
    
    return {
      timestamp: semantic.timestamp,
      sessionDuration: (semantic.timestamp - this.sessionStart) / 1000,
      reps: this._getRepSummary(),
      activeExercise: activeExercise?.id || null,
      exerciseConfidence: activeExercise?.confidence || 0,
      metrics: { ...this.metrics },
      quality: this._computeQuality(semantic),
      recentEvents: [...this.recentEvents],
    };
  }
  
  _detectActiveExercise(semantic) {
    // Find which exercise phase is most confidently detected
    const phases = semantic.exercisePhases;
    let bestMatch = null;
    
    Object.entries(phases).forEach(([exerciseId, phase]) => {
      if (phase && phase !== 'transition') {
        const confidence = semantic.confidence.overall;
        if (!bestMatch || confidence > bestMatch.confidence) {
          bestMatch = { id: exerciseId, phase, confidence };
        }
      }
    });
    
    return bestMatch;
  }
}
```

**Configuration:**
```javascript
// metrics.config.js
export const METRICS_CONFIG = {
  // Global settings
  eventBufferSize: 50,           // Recent events to keep
  
  // Exercise-specific rep counting configs
  // Phase patterns define what sequence constitutes one rep
  exercises: {
    // === DYNAMIC EXERCISES ===
    jumpingJack: {
      phaseOrder: ['low', 'high', 'low'],
      minRepDuration: 400,
      maxRepDuration: 2000,
      cooldownMs: 200,
    },
    squat: {
      phaseOrder: ['standing', 'bottom', 'standing'],
      minRepDuration: 800,
      maxRepDuration: 4000,
      cooldownMs: 300,
    },
    squatSumo: {
      phaseOrder: ['standing', 'bottom', 'standing'],
      minRepDuration: 800,
      maxRepDuration: 4000,
      cooldownMs: 300,
    },
    squatNarrow: {
      phaseOrder: ['standing', 'bottom', 'standing'],
      minRepDuration: 800,
      maxRepDuration: 4000,
      cooldownMs: 300,
    },
    squatOverhead: {
      phaseOrder: ['standing', 'bottom', 'standing'],
      minRepDuration: 1000,
      maxRepDuration: 5000,
      cooldownMs: 400,
    },
    pushup: {
      phaseOrder: ['high', 'low', 'high'],
      minRepDuration: 600,
      maxRepDuration: 3000,
      cooldownMs: 250,
    },
    pushupNarrow: {
      phaseOrder: ['high', 'low', 'high'],
      minRepDuration: 600,
      maxRepDuration: 3000,
      cooldownMs: 250,
    },
    pushupWide: {
      phaseOrder: ['high', 'low', 'high'],
      minRepDuration: 600,
      maxRepDuration: 3000,
      cooldownMs: 250,
    },
    pushupKnees: {
      phaseOrder: ['high', 'low', 'high'],
      minRepDuration: 500,
      maxRepDuration: 2500,
      cooldownMs: 200,
    },
    lungeFront: {
      phaseOrder: ['standing', 'down', 'standing'],
      minRepDuration: 800,
      maxRepDuration: 3500,
      cooldownMs: 300,
      bilateral: true,            // Count left/right separately
    },
    lungeSide: {
      phaseOrder: ['standing', 'down', 'standing'],
      minRepDuration: 800,
      maxRepDuration: 3500,
      cooldownMs: 300,
      bilateral: true,
    },
    burpee: {
      phaseOrder: ['standing', 'squat', 'plank', 'squat', 'jump'],
      minRepDuration: 1500,
      maxRepDuration: 6000,
      cooldownMs: 500,
    },
    highKnees: {
      continuous: true,           // Count alternating movements
      minAlternationMs: 150,
      maxAlternationMs: 500,
      cooldownMs: 100,
    },
    crunches: {
      phaseOrder: ['down', 'up', 'down'],
      minRepDuration: 500,
      maxRepDuration: 2500,
      cooldownMs: 200,
    },
    glutesBridge: {
      phaseOrder: ['down', 'up', 'down'],
      minRepDuration: 600,
      maxRepDuration: 3000,
      cooldownMs: 250,
    },
    skaterHops: {
      continuous: true,
      minAlternationMs: 200,
      maxAlternationMs: 800,
      cooldownMs: 150,
    },
    mountainClimber: {
      continuous: true,
      bilateral: true,
      minAlternationMs: 150,
      maxAlternationMs: 600,
      cooldownMs: 100,
    },
    birdDog: {
      phaseOrder: ['neutral', 'extended', 'neutral'],
      minRepDuration: 1000,
      maxRepDuration: 4000,
      cooldownMs: 300,
      bilateral: true,
    },
    sitToStand: {
      phaseOrder: ['seated', 'standing', 'seated'],
      minRepDuration: 1000,
      maxRepDuration: 4000,
      cooldownMs: 400,
    },
    
    // === ISOMETRIC EXERCISES ===
    // Isometrics use hold duration instead of rep counting
    plankHigh: {
      isometric: true,
      minHoldMs: 1000,            // Min to count as valid hold
      targetHoldMs: 30000,        // Default target (30s)
    },
    plankLow: {
      isometric: true,
      minHoldMs: 1000,
      targetHoldMs: 30000,
    },
    plankSide: {
      isometric: true,
      bilateral: true,
      minHoldMs: 1000,
      targetHoldMs: 30000,
    },
    squatHold: {
      isometric: true,
      minHoldMs: 1000,
      targetHoldMs: 30000,
    },
    lungeHold: {
      isometric: true,
      bilateral: true,
      minHoldMs: 1000,
      targetHoldMs: 30000,
    },
  },
  
  // Activity tracking
  activity: {
    stillThresholdMs: 2000,      // Time before counting as rest
    activeThresholdMs: 500,      // Time before counting as active
  },
  
  // Quality scoring weights
  quality: {
    formWeight: 0.4,
    consistencyWeight: 0.3,
    romWeight: 0.3,
  },
};
```

---

### Activity Layer: Activity Recognition

**Location:** `frontend/src/modules/Fitness/domain/pose/activity/`

**Status:** 🆕 New implementation required

**Purpose:** Analyzes metric patterns over sliding time windows to detect sustained activities. While the Metrics layer tracks individual rep events, the Activity layer answers "what is the user doing right now?"

**Interface:**
```javascript
/**
 * @typedef {Object} ActivityLayer
 * @property {number} timestamp
 * @property {string|null} currentActivity - Primary detected activity ID
 * @property {number} activityConfidence - Confidence in current activity (0-1)
 * @property {number} activityDurationMs - How long current activity has been sustained
 * @property {ActivityState} states - Boolean flags for all trackable activities
 * @property {Object} velocities - Rep velocity (reps/min) per exercise
 * @property {string} phase - Workout phase: 'warmup' | 'active' | 'cooldown' | 'rest'
 * @property {Object} transitions - Recent activity transitions
 */

/**
 * @typedef {Object} ActivityState
 * @property {boolean} isMarching - High knees detected
 * @property {boolean} isButtKicking - Butt kicks detected
 * @property {boolean} isJumpingJacking - Jumping jacks detected
 * @property {boolean} isSquatting - Squats detected
 * @property {boolean} isPushingUp - Push-ups detected
 * @property {boolean} isLunging - Lunges detected
 * @property {boolean} isBurpeeing - Burpees detected
 * @property {boolean} isPlanking - Plank hold detected
 * @property {boolean} isResting - No significant activity
 * @property {boolean} isMoving - General movement without specific exercise
 */
```

**Activity Processor Implementation:**

```javascript
// ActivityProcessor.js
export class ActivityProcessor {
  constructor(config = {}) {
    this.config = { ...ACTIVITY_DEFAULTS, ...config };
    
    // Sliding window buffers for rep velocity calculation
    this.repHistory = {};           // { exerciseId: [{ count, timestamp }] }
    this.windowMs = config.windowMs || 3000;  // 3 second sliding window
    
    // Activity state tracking
    this.currentActivity = null;
    this.activityStartTime = null;
    this.lastActivityChange = null;
    
    // Debounce/hysteresis
    this.pendingActivity = null;
    this.pendingStartTime = null;
  }
  
  /**
   * Process metrics into activity states
   * @param {MetricsLayer} metrics - Current metrics layer state
   * @param {SemanticLayer} semantic - Current semantic layer state
   * @returns {ActivityLayer}
   */
  process(metrics, semantic) {
    const now = metrics.timestamp;
    
    // Update rep history for velocity calculation
    this._updateRepHistory(metrics, now);
    
    // Calculate rep velocities (reps per minute)
    const velocities = this._calculateVelocities(now);
    
    // Detect activity states based on velocities
    const states = this._detectActivityStates(velocities, semantic, metrics);
    
    // Determine primary activity with hysteresis
    const { activity, confidence } = this._determinePrimaryActivity(states, velocities, now);
    
    // Update activity tracking
    if (activity !== this.currentActivity) {
      this._handleActivityTransition(activity, now);
    }
    
    // Determine workout phase
    const phase = this._determineWorkoutPhase(states, metrics);
    
    return {
      timestamp: now,
      currentActivity: this.currentActivity,
      activityConfidence: confidence,
      activityDurationMs: this.currentActivity ? now - this.activityStartTime : 0,
      states,
      velocities,
      phase,
      transitions: this._getRecentTransitions(),
    };
  }
  
  /**
   * Track rep counts over time for velocity calculation
   */
  _updateRepHistory(metrics, now) {
    const exercises = Object.keys(this.config.activities);
    
    exercises.forEach(exerciseId => {
      if (!this.repHistory[exerciseId]) {
        this.repHistory[exerciseId] = [];
      }
      
      const repData = metrics.reps[exerciseId];
      const currentCount = repData?.count || 0;
      const history = this.repHistory[exerciseId];
      
      // Add current snapshot
      history.push({ count: currentCount, timestamp: now });
      
      // Trim to window
      const cutoff = now - this.windowMs;
      while (history.length > 0 && history[0].timestamp < cutoff) {
        history.shift();
      }
    });
  }
  
  /**
   * Calculate reps per minute for each exercise
   * IMPROVED: Uses moving average of rep duration instead of simple count/time
   */
  _calculateVelocities(now) {
    const velocities = {};
    
    Object.entries(this.repHistory).forEach(([exerciseId, history]) => {
      if (history.length < 2) {
        velocities[exerciseId] = 0;
        return;
      }
      
      // Use the average duration of recent reps to calculate "instant" velocity
      // This is smoother than integer division of count / time
      const recentReps = history.slice(-3); // Last 3 reps
      if (recentReps.length < 2) {
         velocities[exerciseId] = 0;
         return;
      }

      const durationSum = recentReps.reduce((sum, item, i) => {
          if (i === 0) return 0;
          return sum + (item.timestamp - recentReps[i-1].timestamp);
      }, 0);
      
      const avgDuration = durationSum / (recentReps.length - 1);
      
      if (avgDuration > 0) {
        // 60000 ms / avgDuration = reps per minute
        velocities[exerciseId] = 60000 / avgDuration;
      } else {
        velocities[exerciseId] = 0;
      }
    });
    
    return velocities;
  }
  
  /**
   * Generate boolean activity states from velocities
   */
  _detectActivityStates(velocities, semantic, metrics) {
    const { minVelocity } = this.config;
    
    const states = {
      // Dynamic exercises - detected by ongoing rep velocity
      isMarching: velocities.highKnees >= minVelocity.highKnees,
      isButtKicking: velocities.buttKicks >= minVelocity.buttKicks,
      isJumpingJacking: velocities.jumpingJack >= minVelocity.jumpingJack,
      isSquatting: (
        velocities.squat >= minVelocity.squat ||
        velocities.squatSumo >= minVelocity.squat ||
        velocities.squatNarrow >= minVelocity.squat
      ),
      isPushingUp: (
        velocities.pushup >= minVelocity.pushup ||
        velocities.pushupNarrow >= minVelocity.pushup ||
        velocities.pushupWide >= minVelocity.pushup ||
        velocities.pushupKnees >= minVelocity.pushup
      ),
      isLunging: (
        velocities.lungeFront >= minVelocity.lunge ||
        velocities.lungeSide >= minVelocity.lunge
      ),
      isBurpeeing: velocities.burpee >= minVelocity.burpee,
      isCrunching: velocities.crunches >= minVelocity.crunches,
      isBridging: velocities.glutesBridge >= minVelocity.glutesBridge,
      isClimbing: velocities.mountainClimber >= minVelocity.mountainClimber,
      
      // Isometric - detected by hold state from semantic layer
      isPlanking: semantic.exercisePhases?.plankHigh === 'holding' ||
                  semantic.exercisePhases?.plankLow === 'holding' ||
                  semantic.exercisePhases?.plankSide === 'holding',
      isHolding: metrics.activeExercise?.endsWith('Hold') || false,
      
      // Meta states
      isResting: false,  // Set below
      isMoving: semantic.movement?.isMoving || false,
    };
    
    // Determine if resting (no exercises detected)
    const anyExerciseActive = Object.entries(states)
      .filter(([key]) => !['isResting', 'isMoving'].includes(key))
      .some(([_, value]) => value);
    
    states.isResting = !anyExerciseActive && !states.isMoving;
    
    return states;
  }
  
  /**
   * Determine primary activity with hysteresis to prevent flickering
   */
  _determinePrimaryActivity(states, velocities, now) {
    // Find highest-velocity active exercise
    let bestActivity = null;
    let bestVelocity = 0;
    let confidence = 0;
    
    const activityMap = {
      isMarching: 'highKnees',
      isButtKicking: 'buttKicks',
      isJumpingJacking: 'jumpingJack',
      isSquatting: 'squat',
      isPushingUp: 'pushup',
      isLunging: 'lunge',
      isBurpeeing: 'burpee',
      isCrunching: 'crunches',
      isBridging: 'glutesBridge',
      isClimbing: 'mountainClimber',
      isPlanking: 'plank',
      isHolding: 'hold',
    };
    
    Object.entries(activityMap).forEach(([stateKey, activityId]) => {
      if (states[stateKey]) {
        const velocity = velocities[activityId] || 0;
        if (velocity > bestVelocity) {
          bestVelocity = velocity;
          bestActivity = activityId;
        }
      }
    });
    
    // Calculate confidence based on velocity relative to expected range
    if (bestActivity && bestVelocity > 0) {
      const expected = this.config.expectedVelocity[bestActivity] || 30;
      confidence = Math.min(1, bestVelocity / expected);
    }
    
    // Hysteresis: require new activity to be sustained before switching
    const { transitionDelayMs, stickiness } = this.config.hysteresis;
    
    if (bestActivity !== this.pendingActivity) {
      this.pendingActivity = bestActivity;
      this.pendingStartTime = now;
    }
    
    // Stick with current activity unless pending has been sustained
    if (this.currentActivity && bestActivity !== this.currentActivity) {
      const pendingDuration = now - this.pendingStartTime;
      if (pendingDuration < transitionDelayMs) {
        return { activity: this.currentActivity, confidence: stickiness };
      }
    }
    
    return { activity: bestActivity, confidence };
  }
  
  _handleActivityTransition(newActivity, now) {
    const transition = {
      from: this.currentActivity,
      to: newActivity,
      timestamp: now,
      duration: this.currentActivity ? now - this.activityStartTime : 0,
    };
    
    this.transitions = this.transitions || [];
    this.transitions.push(transition);
    
    // Keep only last 20 transitions
    if (this.transitions.length > 20) {
      this.transitions.shift();
    }
    
    this.currentActivity = newActivity;
    this.activityStartTime = now;
    this.lastActivityChange = now;
  }
  
  _determineWorkoutPhase(states, metrics) {
    // Simple heuristics for workout phase
    const sessionDuration = metrics.sessionDuration || 0;
    const totalReps = Object.values(metrics.reps || {})
      .reduce((sum, r) => sum + (r?.count || 0), 0);
    
    if (sessionDuration < 120 && totalReps < 10) {
      return 'warmup';
    }
    
    if (states.isResting) {
      return 'rest';
    }
    
    // Could enhance with heart rate data, time since last rep, etc.
    return 'active';
  }
  
  _getRecentTransitions() {
    return this.transitions?.slice(-5) || [];
  }
  
  reset() {
    this.repHistory = {};
    this.currentActivity = null;
    this.activityStartTime = null;
    this.transitions = [];
  }
}
```

**Configuration:**

```javascript
// activity.config.js
export const ACTIVITY_CONFIG = {
  // Sliding window for velocity calculation
  windowMs: 3000,               // 3 seconds
  updateRateMs: 200,            // Process at 5 FPS (lower than frame rate)
  
  // Minimum rep velocity (reps/min) to trigger activity state
  minVelocity: {
    highKnees: 40,              // ~0.67 reps/sec (fast alternating)
    buttKicks: 40,
    jumpingJack: 20,            // ~0.33 reps/sec
    squat: 6,                   // ~1 rep every 10 sec
    pushup: 6,
    lunge: 6,
    burpee: 4,                  // ~1 rep every 15 sec
    crunches: 15,
    glutesBridge: 10,
    mountainClimber: 30,
  },
  
  // Expected velocity for confidence calculation
  expectedVelocity: {
    highKnees: 100,             // Elite: ~1.67/sec
    buttKicks: 100,
    jumpingJack: 50,            // ~0.83/sec
    squat: 20,                  // ~0.33/sec
    pushup: 20,
    lunge: 15,
    burpee: 10,
    crunches: 30,
    glutesBridge: 20,
    mountainClimber: 80,
    plank: 1,                   // N/A for isometric
    hold: 1,
  },
  
  // Hysteresis settings
  hysteresis: {
    transitionDelayMs: 500,     // Activity must persist for 500ms before switching
    stickiness: 0.7,            // Confidence boost for current activity
  },
  
  // Activity groupings for UI
  activityGroups: {
    cardio: ['highKnees', 'buttKicks', 'jumpingJack', 'burpee', 'mountainClimber'],
    strength: ['squat', 'pushup', 'lunge'],
    core: ['crunches', 'plank', 'glutesBridge'],
    isometric: ['plank', 'hold'],
  },
};
```

---

## Service Architecture

### PoseDataService - Unified Interface

```javascript
// PoseDataService.js
/**
 * Unified service exposing all pose data layers
 * Singleton pattern for shared access across the application
 */

import { getPoseDetectorService } from './PoseDetectorService.js';
import { GeometryProcessor } from './geometry/GeometryProcessor.js';
import { SemanticProcessor } from './semantic/SemanticProcessor.js';
import { MetricsProcessor } from './metrics/MetricsProcessor.js';
import { ActivityProcessor } from './activity/ActivityProcessor.js';

class PoseDataService {
  constructor(config = {}) {
    this.config = config;
    
    // Layer processors
    this.rawService = null;
    this.geometryProcessor = new GeometryProcessor(config.geometry);
    this.semanticProcessor = new SemanticProcessor(config.semantic);
    this.metricsProcessor = new MetricsProcessor(config.metrics);
    this.activityProcessor = new ActivityProcessor(config.activity);
    
    // Current state
    this.currentState = {
      raw: null,
      geometry: null,
      semantic: null,
      metrics: null,
      activity: null,
    };
    
    // Subscribers per layer
    this.subscribers = {
      raw: new Set(),
      geometry: new Set(),
      semantic: new Set(),
      metrics: new Set(),
      activity: new Set(),
      all: new Set(),
    };
    
    // Performance metrics
    this.layerTiming = {
      raw: 0,
      geometry: 0,
      semantic: 0,
      metrics: 0,
      activity: 0,
    };
    
    // Activity layer runs at lower rate
    this.lastActivityUpdate = 0;
    this.activityUpdateInterval = config.activity?.updateRateMs || 200;
  }
  
  /**
   * Initialize the service with a video source
   */
  async initialize(videoElement) {
    // Use existing singleton for Raw layer
    this.rawService = getPoseDetectorService({
      ...this.config.raw,
      onPoseUpdate: this._handleRawUpdate.bind(this),
    });
    
    await this.rawService.initialize();
    this.rawService.setVideoSource(videoElement);
  }
  
  /**
   * Start processing pipeline
   */
  async start() {
    await this.rawService?.start();
  }
  
  /**
   * Stop processing
   */
  stop() {
    this.rawService?.stop();
  }
  
  /**
   * Handle raw layer update - cascade through all layers
   */
  _handleRawUpdate(poses, rawMetrics) {
    try {
      if (!poses || poses.length === 0) return;
      
      const pose = poses[0]; // Primary pose
      const timestamp = performance.now();
      
      // Raw layer
      const rawStart = performance.now();
      const raw = {
        keypoints: pose.keypoints,
        confidence: pose.score,
        timestamp,
        frameId: rawMetrics.frameCount || 0,
        inferenceMs: rawMetrics.latencyMs,
        backend: rawMetrics.backend,
      };
      this.currentState.raw = raw;
      this.layerTiming.raw = performance.now() - rawStart;
      this._notify('raw', raw);
      
      // Geometry layer
      const geometryStart = performance.now();
      const geometry = this.geometryProcessor.process(raw);
      this.currentState.geometry = geometry;
      this.layerTiming.geometry = performance.now() - geometryStart;
      this._notify('geometry', geometry);
      
      // Semantic layer
      const semanticStart = performance.now();
      const semantic = this.semanticProcessor.process(geometry, raw);
      this.currentState.semantic = semantic;
      this.layerTiming.semantic = performance.now() - semanticStart;
      this._notify('semantic', semantic);
      
      // Metrics layer
      const metricsStart = performance.now();
      const metrics = this.metricsProcessor.process(semantic, geometry);
      this.currentState.metrics = metrics;
      this.layerTiming.metrics = performance.now() - metricsStart;
      this._notify('metrics', metrics);
      
      // Activity layer (runs at lower rate)
      // Run every 6th frame (approx 5 FPS at 30 FPS input)
      // Using frame count is more reliable than wall clock for deterministic processing
      if (raw.frameId % 6 === 0) {
        const activityStart = performance.now();
        const activity = this.activityProcessor.process(metrics, semantic);
        this.currentState.activity = activity;
        this.layerTiming.activity = performance.now() - activityStart;
        this._notify('activity', activity);
      }
      
      // Notify 'all' subscribers
      this._notify('all', this.currentState);
    } catch (error) {
      console.error('[PoseDataService] Pipeline error:', error);
    }
  }
  
  /**
   * Subscribe to layer updates
   * @param {string} layer - 'raw' | 'geometry' | 'semantic' | 'metrics' | 'activity' | 'all'
   * @param {Function} callback - Called with layer data
   * @returns {Function} Unsubscribe function
   */
  subscribe(layer, callback) {
    if (!this.subscribers[layer]) {
      throw new Error(`Invalid layer: ${layer}`);
    }
    
    this.subscribers[layer].add(callback);
    
    // Immediately call with current state if available
    const current = layer === 'all' ? this.currentState : this.currentState[layer];
    if (current) {
      callback(current);
    }
    
    return () => this.subscribers[layer].delete(callback);
  }
  
  /**
   * Get current state snapshot
   */
  getState(layer = 'all') {
    return layer === 'all' ? { ...this.currentState } : this.currentState[layer];
  }
  
  /**
   * Get performance metrics
   */
  getMetrics() {
    return {
      layerTiming: { ...this.layerTiming },
      totalMs: Object.values(this.layerTiming).reduce((a, b) => a + b, 0),
      fps: this.rawService?.metrics?.fps || 0,
    };
  }
  
  /**
   * Update configuration for a layer
   */
  updateConfig(layer, config) {
    switch (layer) {
      case 'raw':
        this.rawService?.updateConfig(config);
        break;
      case 'geometry':
        this.geometryProcessor.updateConfig(config);
        break;
      case 'semantic':
        this.semanticProcessor.updateConfig(config);
        break;
      case 'metrics':
        this.metricsProcessor.updateConfig(config);
        break;
    }
  }
  
  /**
   * Register custom exercise for metrics tracking
   */
  registerExercise(exerciseId, config) {
    this.semanticProcessor.registerExercise?.(exerciseId, config);
    this.metricsProcessor.registerExercise(exerciseId, config);
  }
  
  _notify(layer, data) {
    // PERFORMANCE FIX: Decouple notification from the animation loop.
    // Using setTimeout(..., 0) or scheduler.postTask prevents heavy subscribers
    // from killing the pose detection FPS.
    const notifySubscribers = () => {
      this.subscribers[layer].forEach(cb => {
        try {
          cb(data);
        } catch (e) {
          console.error(`[PoseDataService] Subscriber error (${layer}):`, e);
        }
      });
    };

    if (window.scheduler?.postTask) {
      window.scheduler.postTask(notifySubscribers, { priority: 'user-visible' });
    } else {
      setTimeout(notifySubscribers, 0);
    }
  }
  
  dispose() {
    this.stop();
    // Do not dispose rawService as it is a shared singleton
    this.subscribers = {
      raw: new Set(),
      geometry: new Set(),
      semantic: new Set(),
      metrics: new Set(),
      all: new Set(),
    };
  }
}

// LIFECYCLE NOTE:
// We avoid the Singleton pattern here to prevent "zombie" instances when
// React components unmount/remount. The Context Provider should own the instance.
export default PoseDataService;
```

---

## React Integration

### Context Provider

```jsx
// PoseDataContext.jsx
import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import PoseDataService from '../domain/pose/PoseDataService.js';

/**
 * @deprecated Use PoseDataContext instead of PoseContext
 */
const PoseDataContext = createContext(null);

export const PoseDataProvider = ({ children, config = {}, autoStart = false }) => {
  const serviceRef = useRef(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState(null);
  
  // Layer states
  const [raw, setRaw] = useState(null);
  const [geometry, setGeometry] = useState(null);
  const [semantic, setSemantic] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [activity, setActivity] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  
  // Initialize service
  useEffect(() => {
    // Create new instance (no singleton)
    serviceRef.current = new PoseDataService(config);
    
    // Subscribe to all layers
    const unsubRaw = serviceRef.current.subscribe('raw', setRaw);
    const unsubGeometry = serviceRef.current.subscribe('geometry', setGeometry);
    const unsubSemantic = serviceRef.current.subscribe('semantic', setSemantic);
    const unsubMetrics = serviceRef.current.subscribe('metrics', setMetrics);
    const unsubActivity = serviceRef.current.subscribe('activity', setActivity);
    
    // Metrics polling
    const metricsInterval = setInterval(() => {
      setAnalytics(serviceRef.current?.getMetrics());
    }, 1000);
    
    setIsReady(true);
    
    return () => {
      unsubRaw();
      unsubGeometry();
      unsubSemantic();
      unsubMetrics();
      unsubActivity();
      clearInterval(metricsInterval);
      serviceRef.current?.dispose();
      serviceRef.current = null;
    };
  }, []);
      clearInterval(metricsInterval);
      disposePoseDataService();
    };
  }, []);
  
  const initialize = useCallback(async (videoElement) => {
    try {
      await serviceRef.current?.initialize(videoElement);
      setIsReady(true);
      if (autoStart) {
        await serviceRef.current?.start();
      }
    } catch (e) {
      setError(e);
    }
  }, [autoStart]);
  
  const start = useCallback(() => serviceRef.current?.start(), []);
  const stop = useCallback(() => serviceRef.current?.stop(), []);
  
  const value = {
    // State
    isReady,
    error,
    
    // Layer data
    raw,
    geometry,
    semantic,
    metrics,
    activity,
    
    // Analytics
    analytics,
    
    // Controls
    initialize,
    start,
    stop,
    
    // Config
    updateConfig: (layer, cfg) => serviceRef.current?.updateConfig(layer, cfg),
    registerExercise: (id, cfg) => serviceRef.current?.registerExercise(id, cfg),
    
    // Direct service access (escape hatch)
    service: serviceRef.current,
  };
  
  return (
    <PoseDataContext.Provider value={value}>
      {children}
    </PoseDataContext.Provider>
  );
};

export const usePoseData = () => {
  const ctx = useContext(PoseDataContext);
  if (!ctx) {
    throw new Error('usePoseData must be used within PoseDataProvider');
  }
  return ctx;
};

export default PoseDataContext;
```

### Layer-Specific Hooks

```javascript
// hooks/usePoseLayers.js

/**
 * Hook for accessing specific pose data layers
 */
export const useRawLayer = () => {
  const { raw, isReady } = usePoseData();
  return { data: raw, isReady };
};

export const useGeometryLayer = () => {
  const { geometry, isReady } = usePoseData();
  return { data: geometry, isReady };
};

export const useSemanticLayer = () => {
  const { semantic, isReady } = usePoseData();
  return { data: semantic, isReady };
};

export const useMetricsLayer = () => {
  const { metrics, isReady, registerExercise } = usePoseData();
  return { data: metrics, isReady, registerExercise };
};

export const useActivityLayer = () => {
  const { activity, isReady } = usePoseData();
  return { data: activity, isReady };
};

/**
 * Hook for detecting current activity state
 * Returns boolean flags for all trackable activities
 */
export const useActivityState = () => {
  const { activity } = usePoseData();
  
  return {
    // Current activity
    currentActivity: activity?.currentActivity || null,
    confidence: activity?.activityConfidence || 0,
    durationMs: activity?.activityDurationMs || 0,
    
    // Boolean states
    isMarching: activity?.states?.isMarching || false,
    isButtKicking: activity?.states?.isButtKicking || false,
    isJumpingJacking: activity?.states?.isJumpingJacking || false,
    isSquatting: activity?.states?.isSquatting || false,
    isPushingUp: activity?.states?.isPushingUp || false,
    isLunging: activity?.states?.isLunging || false,
    isBurpeeing: activity?.states?.isBurpeeing || false,
    isPlanking: activity?.states?.isPlanking || false,
    isResting: activity?.states?.isResting || false,
    isMoving: activity?.states?.isMoving || false,
    
    // Workout phase
    phase: activity?.phase || 'rest',
    
    // Velocities (reps per minute)
    velocities: activity?.velocities || {},
  };
};

/**
 * Hook to check if a specific activity is happening
 */
export const useIsActivity = (activityId) => {
  const { activity } = usePoseData();
  
  const stateMap = {
    highKnees: 'isMarching',
    buttKicks: 'isButtKicking',
    jumpingJack: 'isJumpingJacking',
    squat: 'isSquatting',
    pushup: 'isPushingUp',
    lunge: 'isLunging',
    burpee: 'isBurpeeing',
    plank: 'isPlanking',
  };
  
  const stateKey = stateMap[activityId];
  return stateKey ? (activity?.states?.[stateKey] || false) : false;
};

/**
 * Hook for rep counting a specific exercise
 */
export const useRepCounter = (exerciseId, config = {}) => {
  const { metrics, registerExercise } = usePoseData();
  
  useEffect(() => {
    registerExercise?.(exerciseId, config);
  }, [exerciseId]);
  
  const repData = metrics?.reps?.[exerciseId];
  
  return {
    count: repData?.count || 0,
    lastRepTime: repData?.lastRepTime,
    lastRepDuration: repData?.lastRepDuration,
    averageDuration: repData?.averageRepDuration,
    currentPhase: repData?.currentPhase,
  };
};

/**
 * Hook for semantic state checks
 */
export const useBodyState = () => {
  const { semantic } = usePoseData();
  
  return {
    posture: semantic?.posture || {},
    arms: semantic?.arms || {},
    movement: semantic?.movement || {},
    form: semantic?.form || {},
    confidence: semantic?.confidence?.overall || 0,
  };
};

/**
 * Hook for specific exercise phase
 */
export const useExercisePhase = (exerciseId) => {
  const { semantic } = usePoseData();
  return semantic?.exercisePhases?.[exerciseId] || null;
};
```

---

## Consumer Examples

### Jumping Jack Game (Refactored)

```jsx
// JumpingJackGame.jsx
import React, { useState, useEffect } from 'react';
import { usePoseData, useRepCounter, useExercisePhase } from '../../hooks/usePoseLayers';

const JumpingJackGame = ({ duration = 30, onComplete }) => {
  const { isReady, initialize, start, stop } = usePoseData();
  const { count, currentPhase } = useRepCounter('jumpingJack');
  const phase = useExercisePhase('jumpingJack');
  
  const [timeLeft, setTimeLeft] = useState(duration);
  const [gameState, setGameState] = useState('waiting'); // waiting, playing, finished
  
  // Countdown timer
  useEffect(() => {
    if (gameState !== 'playing') return;
    
    const timer = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          setGameState('finished');
          stop();
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    
    return () => clearInterval(timer);
  }, [gameState]);
  
  const handleStart = async () => {
    setTimeLeft(duration);
    setGameState('playing');
    await start();
  };
  
  return (
    <div className="jumping-jack-game">
      {gameState === 'waiting' && (
        <button onClick={handleStart} disabled={!isReady}>
          {isReady ? 'START' : 'Loading...'}
        </button>
      )}
      
      {gameState === 'playing' && (
        <>
          <div className="timer">{timeLeft}s</div>
          <div className="score">{count} JUMPS</div>
          <div className="phase-indicator" data-phase={phase}>
            {phase === 'high' && '🙌'}
            {phase === 'low' && '🧍'}
            {phase === 'transition' && '...'}
          </div>
        </>
      )}
      
      {gameState === 'finished' && (
        <div className="results">
          <h2>Time's Up!</h2>
          <p>You did {count} jumping jacks!</p>
          <button onClick={() => onComplete?.(count)}>Done</button>
        </div>
      )}
    </div>
  );
};
```

### Form Feedback Component

```jsx
// FormFeedback.jsx
import React from 'react';
import { useBodyState, useGeometryLayer } from '../../hooks/usePoseLayers';

const FormFeedback = ({ exercise }) => {
  const { form, confidence } = useBodyState();
  const { data: geometry } = useGeometryLayer();
  
  if (confidence < 0.5) {
    return <div className="feedback warning">Move into frame</div>;
  }
  
  const issues = [];
  
  if (!form.spineNeutral) {
    issues.push('Keep your back straight');
  }
  
  if (!form.kneesTracking && exercise === 'squat') {
    issues.push('Knees should track over toes');
  }
  
  if (geometry?.symmetry?.overallSymmetry < 0.7) {
    issues.push('Try to keep both sides balanced');
  }
  
  if (issues.length === 0) {
    return <div className="feedback success">Great form! 💪</div>;
  }
  
  return (
    <div className="feedback">
      {issues.map((issue, i) => (
        <div key={i} className="issue">{issue}</div>
      ))}
    </div>
  );
};
```

### Activity Detection Display

```jsx
// ActivityDisplay.jsx
import React from 'react';
import { useActivityState, useIsActivity } from '../../hooks/usePoseLayers';

/**
 * Component that displays current detected activity
 * Uses the Activity layer for sustained activity recognition
 */
const ActivityDisplay = () => {
  const { 
    currentActivity, 
    confidence, 
    durationMs,
    phase,
    velocities,
    isMarching,
    isJumpingJacking,
    isSquatting,
    isPushingUp,
    isResting,
  } = useActivityState();
  
  const formatDuration = (ms) => {
    const seconds = Math.floor(ms / 1000);
    return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  };
  
  const getActivityEmoji = () => {
    if (isMarching) return '🏃';
    if (isJumpingJacking) return '🙌';
    if (isSquatting) return '🏋️';
    if (isPushingUp) return '💪';
    if (isResting) return '😌';
    return '🧍';
  };
  
  return (
    <div className="activity-display">
      <div className="activity-icon">{getActivityEmoji()}</div>
      
      <div className="activity-info">
        <div className="activity-name">
          {currentActivity || 'Idle'}
          {confidence > 0 && (
            <span className="confidence">({Math.round(confidence * 100)}%)</span>
          )}
        </div>
        
        {currentActivity && (
          <div className="activity-duration">
            Active for: {formatDuration(durationMs)}
          </div>
        )}
        
        <div className="workout-phase">
          Phase: <span className={`phase-${phase}`}>{phase}</span>
        </div>
      </div>
      
      {/* Velocity indicators for active exercises */}
      <div className="velocities">
        {Object.entries(velocities)
          .filter(([_, v]) => v > 0)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([exercise, velocity]) => (
            <div key={exercise} className="velocity-bar">
              <span className="exercise-name">{exercise}</span>
              <span className="velocity-value">{Math.round(velocity)} rpm</span>
            </div>
          ))}
      </div>
    </div>
  );
};

/**
 * Component that responds when a specific activity is detected
 */
const ActivityTrigger = ({ activity, onActive, onInactive, children }) => {
  const isActive = useIsActivity(activity);
  
  React.useEffect(() => {
    if (isActive) {
      onActive?.();
    } else {
      onInactive?.();
    }
  }, [isActive, onActive, onInactive]);
  
  return children?.(isActive) || null;
};

// Usage example:
// <ActivityTrigger 
//   activity="jumpingJack" 
//   onActive={() => playSound('jump')}
// >
//   {(isActive) => isActive && <div>Jumping!</div>}
// </ActivityTrigger>
```

### Activity-Driven Workout Tracker

```jsx
// WorkoutTracker.jsx
import React, { useState, useEffect } from 'react';
import { useActivityState, useMetricsLayer } from '../../hooks/usePoseLayers';

/**
 * Automatically tracks workout progress based on Activity layer detection
 */
const WorkoutTracker = ({ onWorkoutComplete }) => {
  const { currentActivity, phase, isResting } = useActivityState();
  const { data: metrics } = useMetricsLayer();
  
  const [workoutLog, setWorkoutLog] = useState([]);
  const [currentSet, setCurrentSet] = useState(null);
  
  // Track activity transitions
  useEffect(() => {
    if (currentActivity && currentActivity !== currentSet?.activity) {
      // End previous set
      if (currentSet) {
        setWorkoutLog(log => [...log, {
          ...currentSet,
          endTime: Date.now(),
          reps: metrics?.reps?.[currentSet.activity]?.count || 0,
        }]);
      }
      
      // Start new set
      setCurrentSet({
        activity: currentActivity,
        startTime: Date.now(),
        startReps: metrics?.reps?.[currentActivity]?.count || 0,
      });
    } else if (isResting && currentSet) {
      // Activity ended, close the set
      setWorkoutLog(log => [...log, {
        ...currentSet,
        endTime: Date.now(),
        reps: (metrics?.reps?.[currentSet.activity]?.count || 0) - currentSet.startReps,
      }]);
      setCurrentSet(null);
    }
  }, [currentActivity, isResting]);
  
  return (
    <div className="workout-tracker">
      <h3>Workout Log</h3>
      
      {currentSet && (
        <div className="current-set active">
          Currently: {currentSet.activity}
          <br />
          Reps: {(metrics?.reps?.[currentSet.activity]?.count || 0) - currentSet.startReps}
        </div>
      )}
      
      <div className="completed-sets">
        {workoutLog.map((set, i) => (
          <div key={i} className="set-entry">
            <span className="set-activity">{set.activity}</span>
            <span className="set-reps">{set.reps} reps</span>
            <span className="set-duration">
              {Math.round((set.endTime - set.startTime) / 1000)}s
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
```

---

## File Structure

```
frontend├── PoseDetectorService.js      # (Existing Raw Layer)
│       ├── MoveDetectorBase.js         # (Existing Base Class)
│       │
│       ├── geometry/
│       │   ├── index.js
│       │   ├── geometry.config.js
│       │   ├── GeometryProcessor.js
│       │   └── __tests__/
│       │
│       ├── semantic/
│       │   ├── index.js
│       │   ├── semantic.config.js
│       │   ├── SemanticProcessor.js
│       │   ├── stateDetectors/
│       │   └── __tests__/
│       │
│       ├── metrics/
│       │   ├── index.js
│       │   ├── metrics.config.js
│       │   ├── MetricsProcessor.js
│       │   ├── RepCounter.js           # Extends MoveDetectorBase
│       │   └── __tests__/
│       │
│       └── activity/
│           ├── index.js
│           ├── activity.config.js
│           ├── ActivityProcessor.js
│           └── __tests__/
│
├── context/
│   ├── PoseContext.jsx                 # (Deprecated)
│   └── PoseDataContext.jsx             # New unified context
│
├── hooks/
│   ├── usePoseProvider.js              # (Deprecated)
│   └── usePoseLayers.js                # New layer-specific hooks
│
└── lib/
    └── pose/
        ├── poseGeometry.js             # (Existing - used by geometry)
        ├── poseConnections.js          # (Existing)
        ├── poseConfidence.js           # (Existing)
        └── poseColors.js               # (E
    └── pose/
        ├── poseGeometry.js             # (existing - used by geometry)
        ├── poseConnections.js          # (existing)
        ├── poseConfidence.js           # (existing - used by all)
        └── poseColors.js               # (existing)
```

---

## Testing Strategy

### Unit Tests

```javascript
// __tests__/RepCounter.test.js
import { RepCounter } from '../metrics/RepCounter.js';

describe('RepCounter', () => {
  let counter;
  
  beforeEach(() => {
    counter = new RepCounter('jumpingJack', {
      phaseOrder: ['low', 'high', 'low'],
      minRepDuration: 400,
      maxRepDuration: 2000,
    });
  });
  
  describe('fencepost problem handling', () => {
    it('should not double-count at phase boundaries', () => {
      const states = [
        { phase: 'low', time: 0 },
        { phase: 'high', time: 500 },
        { phase: 'low', time: 1000 },
        { phase: 'high', time: 1500 },   // Start of second rep
        { phase: 'low', time: 2000 },    // End of second rep
      ];
      
      let repCount = 0;
      states.forEach(({ phase, time }) => {
        const event = counter.processState({
          timestamp: time,
          exercisePhases: { jumpingJack: phase },
        });
        if (event?.type === 'rep_complete') repCount++;
      });
      
      expect(repCount).toBe(2);
      expect(counter.count).toBe(2);
    });
    
    it('should reject reps that are too fast', () => {
      // Simulate impossibly fast transitions
      counter.processState({ timestamp: 0, exercisePhases: { jumpingJack: 'low' } });
      counter.processState({ timestamp: 100, exercisePhases: { jumpingJack: 'high' } });
      counter.processState({ timestamp: 200, exercisePhases: { jumpingJack: 'low' } });
      
      expect(counter.count).toBe(0); // Too fast, rejected
    });
  });
});
```

### Integration Tests

```javascript
// __tests__/PoseDataService.integration.test.js
describe('PoseDataService Integration', () => {
  it('should cascade data through all layers', async () => {
    const service = getPoseDataService();
    const layerUpdates = { raw: 0, geometry: 0, semantic: 0, metrics: 0 };
    
    service.subscribe('raw', () => layerUpdates.raw++);
    service.subscribe('geometry', () => layerUpdates.geometry++);
    service.subscribe('semantic', () => layerUpdates.semantic++);
    service.subscribe('metrics', () => layerUpdates.metrics++);
    
    // Simulate raw update
    service._handleRawUpdate([mockPose], { frameCount: 1 });
    
    expect(layerUpdates.raw).toBe(1);
    expect(layerUpdates.geometry).toBe(1);
    expect(layerUpdates.semantic).toBe(1);
    expect(layerUpdates.metrics).toBe(1);
  });
});
```

---

## Performance Considerations

### Layer Processing Budgets

| Layer | Target Time | Notes |
|-------|-------------|-------|
| Raw | < 30ms | Dominated by TF.js inference |
| Geometry | < 2ms | Pure math, no allocations in hot path |
| Semantic | < 3ms | State machine transitions |
| Metrics | < 1ms | Simple counters and buffers |
| **Total** | < 36ms | Allows 27+ FPS |

### Optimization Strategies

1. **Object pooling** - Reuse layer result objects to reduce GC pressure
2. **Lazy computation** - Only compute unused values on demand
3. **Web Workers** - Consider moving geometry/semantic to worker thread
4. **Throttling** - Allow apps to subscribe at lower rates (e.g., 15 FPS)

---

## Migration Path

### Phase 1: Foundation (Week 1)
1. Create folder structure
2. Implement `GeometryProcessor` with tests
3. Extract existing geometry helpers

### Phase 2: Semantic Layer (Week 2)
1. Implement `SemanticProcessor`
2. Port exercise phase detection from JumpingJackGame
3. Add posture/arm state detection

### Phase 3: Metrics Layer (Week 3)
1. Implement `RepCounter` with fencepost-safe logic
2. Create `MetricsProcessor`
3. Implement workout metrics

### Phase 4: Integration (Week 4)
1. Create `PoseDataService` unified interface
2. Update `PoseDataContext` provider
3. Create new hooks
4. Migrate JumpingJackGame as proof-of-concept

### Phase 5: Polish (Week 5)
1. Performance optimization
2. Debug tooling
3. Documentation
4. Additional exercise configurations

---

## Exercise Catalog & Extensibility

This section defines the architecture for managing exercises as a catalog system, making it easy to add new exercises, tweak thresholds, and maintain consistency across the codebase.

### Design Goals

1. **One Exercise = One Folder** - All files related to an exercise live together
2. **Config-Driven Defaults** - Hardcoded defaults with external override capability
3. **Auto-Registration** - Exercises self-register when imported
4. **Type Safety** - TypeScript-friendly interfaces for all configs
5. **Hot-Reloadable Thresholds** - Change thresholds without rebuilding

### Exercise Catalog Structure

```
frontend/src/modules/Fitness/domain/pose/
├── catalog/
│   ├── index.js                      # Auto-discovers and exports all exercises
│   ├── registry.js                   # Central registration system
│   ├── types.js                      # Shared TypeScript/JSDoc type definitions
│   ├── baseExercise.js               # Base class/factory for exercises
│   │
│   ├── exercises/
│   │   ├── jumpingJack/
│   │   │   ├── index.js              # Exports exercise definition
│   │   │   ├── jumpingJack.config.js # Thresholds, phases, variants
│   │   │   ├── jumpingJack.detector.js # Phase detection logic
│   │   │   ├── jumpingJack.metrics.js  # Rep counting specifics
│   │   │   ├── jumpingJack.feedback.js # Form feedback messages
│   │   │   └── jumpingJack.test.js   # Tests
│   │   │
│   │   ├── squat/
│   │   │   ├── index.js
│   │   │   ├── squat.config.js
│   │   │   ├── squat.detector.js
│   │   │   ├── squat.metrics.js
│   │   │   ├── squat.feedback.js
│   │   │   └── squat.test.js
│   │   │
│   │   ├── pushup/
│   │   │   └── ...
│   │   │
│   │   ├── lunge/
│   │   │   └── ...
│   │   │
│   │   ├── plank/
│   │   │   └── ...
│   │   │
│   │   └── _template/                # Template for new exercises
│   │       ├── index.js
│   │       ├── _template.config.js
│   │       ├── _template.detector.js
│   │       ├── _template.metrics.js
│   │       ├── _template.feedback.js
│   │       └── README.md
│   │
│   └── overrides/
│       ├── index.js                  # Loads external config overrides
│       ├── local.config.js           # Local dev overrides (gitignored)
│       └── remote.config.js          # Fetched from server (runtime)
│
├── geometry/
├── semantic/
├── metrics/
└── activity/
```

### Naming Conventions

| Item | Convention | Example |
|------|------------|---------|
| **Exercise ID** | `camelCase`, singular | `jumpingJack`, `squat`, `pushup` |
| **Folder Name** | Same as exercise ID | `exercises/jumpingJack/` |
| **Config File** | `{exerciseId}.config.js` | `jumpingJack.config.js` |
| **Detector File** | `{exerciseId}.detector.js` | `jumpingJack.detector.js` |
| **Metrics File** | `{exerciseId}.metrics.js` | `jumpingJack.metrics.js` |
| **Feedback File** | `{exerciseId}.feedback.js` | `jumpingJack.feedback.js` |
| **Test File** | `{exerciseId}.test.js` | `jumpingJack.test.js` |
| **Variant ID** | `camelCase`, adjective | `shallow`, `deep`, `explosive` |
| **Phase ID** | `camelCase`, state noun | `standing`, `bottom`, `high`, `low` |

### Exercise Definition Schema

```javascript
// catalog/types.js

/**
 * @typedef {Object} ExerciseDefinition
 * @property {string} id - Unique exercise identifier (camelCase)
 * @property {string} name - Human-readable display name
 * @property {string} description - Brief description of the exercise
 * @property {string[]} bodyZone - Target body zones: 'upper' | 'lower' | 'core' | 'back'
 * @property {string} preferredView - Camera orientation: 'front' | 'side'
 * @property {string} category - Exercise category: 'dynamic' | 'isometric' | 'plyometric'
 * @property {boolean} [bilateral] - Whether to track left/right separately
 * @property {boolean} [continuous] - Whether reps are counted as alternations
 * @property {ExerciseConfig} config - Thresholds and detection config
 * @property {Object.<string, VariantConfig>} [variants] - Optional effort/ROM variants
 * @property {string} [defaultVariant] - Default variant ID
 * @property {Function} detectPhase - Phase detection function
 * @property {Function} [validateForm] - Form validation function
 * @property {Object} feedback - Form feedback messages
 */

/**
 * @typedef {Object} ExerciseConfig
 * @property {string[]} phases - Ordered phase names
 * @property {string[]} phaseOrder - Phase sequence for one rep
 * @property {Object} thresholds - Detection thresholds
 * @property {number} minRepDuration - Min ms for valid rep
 * @property {number} maxRepDuration - Max ms for valid rep
 * @property {number} cooldownMs - Cooldown between reps
 * @property {number} minConfidence - Min pose confidence
 */

/**
 * @typedef {Object} VariantConfig
 * @property {string} label - Display label
 * @property {string} [description] - Description of variant
 * @property {Object} [thresholds] - Threshold overrides
 */
```

### Exercise Definition Example

```javascript
// catalog/exercises/jumpingJack/index.js
import config from './jumpingJack.config.js';
import { detectPhase } from './jumpingJack.detector.js';
import { metricsConfig } from './jumpingJack.metrics.js';
import feedback from './jumpingJack.feedback.js';
import { registerExercise } from '../../registry.js';

const jumpingJack = {
  id: 'jumpingJack',
  name: 'Jumping Jacks',
  description: 'Cardiovascular exercise with coordinated arm and leg movements',
  bodyZone: ['lower', 'upper'],
  preferredView: 'front',
  category: 'plyometric',
  bilateral: false,
  continuous: false,
  
  config,
  metricsConfig,
  detectPhase,
  feedback,
  
  // Self-registration
  register() {
    registerExercise(this);
  },
};

// Auto-register on import
jumpingJack.register();

export default jumpingJack;
```

```javascript
// catalog/exercises/jumpingJack/jumpingJack.config.js
export default {
  phases: ['low', 'high'],
  phaseOrder: ['low', 'high', 'low'],
  
  thresholds: {
    // Leg spread ratio (ankles / shoulder width)
    legSpreadThreshold: 1.5,      // Above this = legs spread (high)
    legTogetherThreshold: 0.8,    // Below this = legs together (low)
    
    // Arm height ratio (hands Y relative to body height)
    armsUpThreshold: 0.7,         // Above this = arms up (high)
    armsDownThreshold: 0.3,       // Below this = arms down (low)
    
    // Combined detection
    requireBothArmsAndLegs: true, // Both must match for phase
  },
  
  minRepDuration: 400,
  maxRepDuration: 2000,
  cooldownMs: 200,
  minConfidence: 0.6,
  
  variants: {
    min: {
      label: 'Minimal Range',
      description: 'Small movements, low impact',
      thresholds: {
        legSpreadThreshold: 1.2,
        armsUpThreshold: 0.4,
      },
    },
    mid: {
      label: 'Standard',
      description: 'Normal jumping jack form',
    },
    max: {
      label: 'Full Extension',
      description: 'Maximum arm and leg spread',
      thresholds: {
        legSpreadThreshold: 1.8,
        armsUpThreshold: 0.9,
      },
    },
  },
  
  defaultVariant: 'mid',
};
```

```javascript
// catalog/exercises/jumpingJack/jumpingJack.detector.js
import config from './jumpingJack.config.js';

/**
 * Detect current phase based on geometry
 * @param {GeometryLayer} geometry - Current geometry state
 * @param {Object} [overrides] - Threshold overrides (from variant)
 * @returns {'low' | 'high' | 'transition'}
 */
export function detectPhase(geometry, overrides = {}) {
  const thresholds = { ...config.thresholds, ...overrides };
  
  const { stanceWidthRatio } = geometry.legs;
  const { leftHandHeight, rightHandHeight } = geometry.positions;
  const avgHandHeight = (leftHandHeight + rightHandHeight) / 2;
  
  const legsSpread = stanceWidthRatio >= thresholds.legSpreadThreshold;
  const legsTogether = stanceWidthRatio <= thresholds.legTogetherThreshold;
  const armsUp = avgHandHeight >= thresholds.armsUpThreshold;
  const armsDown = avgHandHeight <= thresholds.armsDownThreshold;
  
  if (thresholds.requireBothArmsAndLegs) {
    if (legsSpread && armsUp) return 'high';
    if (legsTogether && armsDown) return 'low';
    return 'transition';
  } else {
    // More lenient: either arms or legs
    if (legsSpread || armsUp) return 'high';
    if (legsTogether || armsDown) return 'low';
    return 'transition';
  }
}
```

```javascript
// catalog/exercises/jumpingJack/jumpingJack.feedback.js
export default {
  // Phase-specific feedback
  phases: {
    high: {
      armsCue: 'Reach arms fully overhead',
      legsCue: 'Jump feet wide apart',
    },
    low: {
      armsCue: 'Bring arms to your sides',
      legsCue: 'Jump feet together',
    },
  },
  
  // Form correction messages
  corrections: {
    asymmetricArms: 'Try to raise both arms evenly',
    incompleteExtension: 'Extend arms and legs fully for maximum benefit',
    tooFast: 'Slow down to maintain control',
    tooSlow: 'Pick up the pace for cardio benefit',
  },
  
  // Encouragement messages
  encouragement: [
    'Great rhythm!',
    'Keep it up!',
    'Nice form!',
    'You\'re crushing it!',
  ],
};
```

### Registry System

```javascript
// catalog/registry.js

const exerciseRegistry = new Map();
const configOverrides = new Map();

/**
 * Register an exercise definition
 */
export function registerExercise(exercise) {
  if (exerciseRegistry.has(exercise.id)) {
    console.warn(`[ExerciseRegistry] Overwriting existing exercise: ${exercise.id}`);
  }
  
  // Apply any pending overrides
  const overrides = configOverrides.get(exercise.id);
  if (overrides) {
    exercise.config = mergeConfigs(exercise.config, overrides);
  }
  
  exerciseRegistry.set(exercise.id, exercise);
  
  console.debug(`[ExerciseRegistry] Registered: ${exercise.id}`);
  return exercise;
}

/**
 * Get exercise by ID with optional variant applied
 */
export function getExercise(exerciseId, variantId = null) {
  const exercise = exerciseRegistry.get(exerciseId);
  if (!exercise) {
    throw new Error(`Unknown exercise: ${exerciseId}`);
  }
  
  // Apply variant if specified
  const effectiveVariant = variantId || exercise.defaultVariant;
  const variant = exercise.variants?.[effectiveVariant];
  
  if (variant?.thresholds) {
    return {
      ...exercise,
      config: {
        ...exercise.config,
        thresholds: {
          ...exercise.config.thresholds,
          ...variant.thresholds,
        },
      },
      activeVariant: effectiveVariant,
    };
  }
  
  return { ...exercise, activeVariant: effectiveVariant };
}

/**
 * Get all registered exercises
 */
export function getAllExercises() {
  return Array.from(exerciseRegistry.values());
}

/**
 * Get exercises filtered by criteria
 */
export function getExercisesByCategory(category) {
  return getAllExercises().filter(e => e.category === category);
}

export function getExercisesByBodyZone(zone) {
  return getAllExercises().filter(e => e.bodyZone.includes(zone));
}

/**
 * Apply config overrides (from external source)
 */
export function applyConfigOverrides(overrides) {
  Object.entries(overrides).forEach(([exerciseId, config]) => {
    configOverrides.set(exerciseId, config);
    
    // If already registered, update it
    if (exerciseRegistry.has(exerciseId)) {
      const exercise = exerciseRegistry.get(exerciseId);
      exercise.config = mergeConfigs(exercise.config, config);
    }
  });
}

/**
 * Deep merge configs with override priority
 */
function mergeConfigs(base, overrides) {
  return {
    ...base,
    ...overrides,
    thresholds: {
      ...base.thresholds,
      ...overrides.thresholds,
    },
    variants: overrides.variants ? {
      ...base.variants,
      ...overrides.variants,
    } : base.variants,
  };
}

/**
 * Export registry for debugging
 */
export function debugRegistry() {
  return {
    exercises: Object.fromEntries(exerciseRegistry),
    overrides: Object.fromEntries(configOverrides),
  };
}
```

### Auto-Discovery & Loading

```javascript
// catalog/index.js

/**
 * Auto-discover and register all exercises
 * Uses Vite's import.meta.glob for dynamic imports
 */

// Import all exercise index files
const exerciseModules = import.meta.glob('./exercises/*/index.js', { eager: true });

// Exercises self-register on import, but we can track what's loaded
export const loadedExercises = Object.keys(exerciseModules).map(path => {
  const match = path.match(/\.\/exercises\/(\w+)\/index\.js/);
  return match ? match[1] : null;
}).filter(Boolean);

console.debug(`[ExerciseCatalog] Loaded ${loadedExercises.length} exercises:`, loadedExercises);

// Re-export registry functions
export {
  registerExercise,
  getExercise,
  getAllExercises,
  getExercisesByCategory,
  getExercisesByBodyZone,
  applyConfigOverrides,
  debugRegistry,
} from './registry.js';

// Export types
export * from './types.js';
```

### External Config Override System

```javascript
// catalog/overrides/index.js

import { applyConfigOverrides } from '../registry.js';

/**
 * Load config overrides from multiple sources
 * Priority (highest to lowest):
 * 1. Runtime overrides (passed to init)
 * 2. Remote config (fetched from server)
 * 3. Local dev overrides (local.config.js, gitignored)
 */

let remoteConfig = null;
let localConfig = null;

/**
 * Initialize override system
 * @param {Object} options
 * @param {string} [options.remoteUrl] - URL to fetch remote config
 * @param {Object} [options.runtimeOverrides] - Immediate overrides
 */
export async function initOverrides(options = {}) {
  const { remoteUrl, runtimeOverrides } = options;
  
  // 1. Load local dev overrides (if exists)
  try {
    const localModule = await import('./local.config.js');
    localConfig = localModule.default;
    console.debug('[ConfigOverrides] Loaded local overrides');
  } catch (e) {
    // local.config.js doesn't exist, that's fine
  }
  
  // 2. Fetch remote config
  if (remoteUrl) {
    try {
      const response = await fetch(remoteUrl);
      remoteConfig = await response.json();
      console.debug('[ConfigOverrides] Loaded remote overrides');
    } catch (e) {
      console.warn('[ConfigOverrides] Failed to fetch remote config:', e);
    }
  }
  
  // 3. Apply in priority order (lowest first, so highest wins)
  if (localConfig) {
    applyConfigOverrides(localConfig);
  }
  if (remoteConfig) {
    applyConfigOverrides(remoteConfig);
  }
  if (runtimeOverrides) {
    applyConfigOverrides(runtimeOverrides);
  }
}

/**
 * Refresh remote config
 */
export async function refreshRemoteConfig(url) {
  try {
    const response = await fetch(url);
    remoteConfig = await response.json();
    applyConfigOverrides(remoteConfig);
    return true;
  } catch (e) {
    console.error('[ConfigOverrides] Refresh failed:', e);
    return false;
  }
}
```

```javascript
// catalog/overrides/local.config.js.example
// Copy to local.config.js for local development overrides
// This file is gitignored

export default {
  jumpingJack: {
    thresholds: {
      // Lower thresholds for testing
      legSpreadThreshold: 1.2,
      armsUpThreshold: 0.5,
    },
    minRepDuration: 200, // Faster for testing
  },
  
  squat: {
    thresholds: {
      bottomKneeAngle: 100, // Less strict for testing
    },
  },
};
```

### Adding a New Exercise (Step-by-Step)

```bash
# 1. Copy the template folder
cp -r catalog/exercises/_template catalog/exercises/burpee

# 2. Rename files
cd catalog/exercises/burpee
mv _template.config.js burpee.config.js
mv _template.detector.js burpee.detector.js
mv _template.metrics.js burpee.metrics.js
mv _template.feedback.js burpee.feedback.js
```

```javascript
// 3. Update index.js with exercise details
// catalog/exercises/burpee/index.js
import config from './burpee.config.js';
import { detectPhase } from './burpee.detector.js';
import { metricsConfig } from './burpee.metrics.js';
import feedback from './burpee.feedback.js';
import { registerExercise } from '../../registry.js';

const burpee = {
  id: 'burpee',
  name: 'Burpees',
  description: 'Full-body exercise combining squat, plank, and jump',
  bodyZone: ['upper', 'lower', 'core'],
  preferredView: 'front',
  category: 'plyometric',
  bilateral: false,
  continuous: false,
  
  config,
  metricsConfig,
  detectPhase,
  feedback,
  
  register() {
    registerExercise(this);
  },
};

burpee.register();
export default burpee;
```

```javascript
// 4. Define config with phases and thresholds
// catalog/exercises/burpee/burpee.config.js
export default {
  phases: ['standing', 'squat', 'plank', 'squat', 'jump'],
  phaseOrder: ['standing', 'squat', 'plank', 'squat', 'jump', 'standing'],
  
  thresholds: {
    // Standing detection
    standingKneeAngle: 160,
    
    // Squat detection
    squatKneeAngle: 90,
    
    // Plank detection
    plankBodyLine: 20,          // Max deviation from straight
    handsOnGround: true,
    
    // Jump detection
    jumpHeightThreshold: 0.1,   // Vertical displacement ratio
  },
  
  minRepDuration: 1500,
  maxRepDuration: 6000,
  cooldownMs: 500,
  minConfidence: 0.5,
  
  variants: {
    walkOut: {
      label: 'Walk-out (No Jump)',
      thresholds: { jumpHeightThreshold: 0 },
    },
    standard: {
      label: 'Standard',
    },
    explosive: {
      label: 'Explosive',
      thresholds: { jumpHeightThreshold: 0.2 },
    },
  },
  
  defaultVariant: 'standard',
};
```

```javascript
// 5. Implement phase detection
// catalog/exercises/burpee/burpee.detector.js
import config from './burpee.config.js';

export function detectPhase(geometry, semantic, overrides = {}) {
  const thresholds = { ...config.thresholds, ...overrides };
  
  const { leftKneeAngle, rightKneeAngle } = geometry.angles;
  const avgKneeAngle = (leftKneeAngle + rightKneeAngle) / 2;
  
  const { torsoAngle } = geometry.orientation;
  const { leftHandHeight, rightHandHeight } = geometry.positions;
  const handsLow = leftHandHeight < 0.2 && rightHandHeight < 0.2;
  
  const { verticalVelocity } = geometry.velocity || {};
  
  // Plank: horizontal torso, hands on ground
  if (Math.abs(torsoAngle) < thresholds.plankBodyLine && handsLow) {
    return 'plank';
  }
  
  // Jump: upward velocity
  if (verticalVelocity && verticalVelocity > thresholds.jumpHeightThreshold) {
    return 'jump';
  }
  
  // Squat: knees bent
  if (avgKneeAngle < thresholds.squatKneeAngle) {
    return 'squat';
  }
  
  // Standing: knees straight
  if (avgKneeAngle > thresholds.standingKneeAngle) {
    return 'standing';
  }
  
  return 'transition';
}
```

```javascript
// 6. Write tests
// catalog/exercises/burpee/burpee.test.js
import { detectPhase } from './burpee.detector.js';
import config from './burpee.config.js';

describe('Burpee', () => {
  describe('detectPhase', () => {
    it('detects standing phase', () => {
      const geometry = {
        angles: { leftKneeAngle: 170, rightKneeAngle: 170 },
        orientation: { torsoAngle: 85 },
        positions: { leftHandHeight: 0.5, rightHandHeight: 0.5 },
      };
      
      expect(detectPhase(geometry)).toBe('standing');
    });
    
    it('detects plank phase', () => {
      const geometry = {
        angles: { leftKneeAngle: 160, rightKneeAngle: 160 },
        orientation: { torsoAngle: 10 },
        positions: { leftHandHeight: 0.1, rightHandHeight: 0.1 },
      };
      
      expect(detectPhase(geometry)).toBe('plank');
    });
    
    // ... more tests
  });
});
```

```bash
# 7. The exercise auto-registers when the catalog loads!
# No manual registration needed - just restart the dev server.
```

### CLI Tooling (Future)

```bash
# Generate new exercise from template
npm run exercise:create burpee

# Validate all exercise configs
npm run exercise:validate

# Generate exercise documentation
npm run exercise:docs

# Run tests for specific exercise
npm run exercise:test jumpingJack

# Export exercise catalog as JSON (for mobile apps, etc.)
npm run exercise:export > exercises.json
```

### Config Hot-Reloading (Development)

```javascript
// In development, watch for config changes
if (import.meta.hot) {
  import.meta.hot.accept('./catalog/exercises', (newModule) => {
    console.log('[HMR] Exercise catalog updated');
    // Exercises re-register automatically on hot reload
  });
  
  import.meta.hot.accept('./catalog/overrides/local.config.js', (newModule) => {
    console.log('[HMR] Local config overrides updated');
    applyConfigOverrides(newModule.default);
  });
}
```

### Remote Config Schema

For fetching config overrides from a server (A/B testing, user-specific tuning):

```json
// GET /api/fitness/config
{
  "version": "1.2.3",
  "updatedAt": "2024-12-28T10:00:00Z",
  "exercises": {
    "jumpingJack": {
      "thresholds": {
        "legSpreadThreshold": 1.4,
        "armsUpThreshold": 0.65
      }
    },
    "squat": {
      "variants": {
        "shallow": {
          "thresholds": {
            "bottomKneeAngle": 110
          }
        }
      }
    }
  },
  "global": {
    "minConfidence": 0.55
  }
}
```

### Exercise Catalog Summary

| Exercise | ID | Category | Phases | Variants |
|----------|-----|----------|--------|----------|
| Jumping Jacks | `jumpingJack` | plyometric | low, high | min, mid, max |
| Air Squat | `squat` | dynamic | standing, bottom | shallow, medium, deep |
| Sumo Squat | `squatSumo` | dynamic | standing, bottom | shallow, medium, deep |
| Push-up | `pushup` | dynamic | high, low | partial, full, chestToGround |
| Forward Lunge | `lungeFront` | dynamic | standing, down | shallow, medium, deep |
| Burpee | `burpee` | plyometric | standing, squat, plank, jump | walkOut, standard, explosive |
| High Knees | `highKnees` | cardio | (continuous) | low, hip, high |
| Mountain Climbers | `mountainClimber` | cardio | (continuous) | slow, standard, explosive |
| High Plank | `plankHigh` | isometric | holding | relaxed, strict, perfect |
| Low Plank | `plankLow` | isometric | holding | relaxed, strict, perfect |
| ... | ... | ... | ... | ... |

---

## Extensibility

### Adding a New Exercise

```javascript
// 1. Add semantic config for phase detection
// semantic.config.js
exercises: {
  mountainClimber: {
    phases: ['start', 'leftUp', 'rightUp'],
    kneeAngleThreshold: 60,
  },
}

// 2. Register at runtime
const { registerExercise } = usePoseData();

useEffect(() => {
  registerExercise('mountainClimber', {
    phaseOrder: ['start', 'leftUp', 'start', 'rightUp', 'start'],
    minRepDuration: 300,
    maxRepDuration: 1500,
  });
}, []);

// 3. Use the counter
const { count } = useRepCounter('mountainClimber');
```

### Custom State Detectors

```javascript
// Extend semantic layer with custom state
semanticProcessor.registerStateDetector('customPose', (geometry, raw) => {
  // Custom detection logic
  return geometry.angles.leftKnee < 45 && geometry.positions.leftHandHeight > 0.5;
});
```

---

## Session Management Implementation Guide

The Pose Data Layer library is intentionally **session-agnostic**—it processes frames and tracks metrics continuously without knowledge of workout boundaries. This design keeps the library simple and flexible, but means that **consuming applications (games, fitness apps) are responsible for session lifecycle management**.

This section provides guidance on implementing sessions properly.

### Session Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SESSION LIFECYCLE                                  │
│                                                                              │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌────────┐ │
│  │  INIT    │───▶│  READY   │───▶│  ACTIVE  │───▶│  PAUSED  │───▶│  ENDED │ │
│  │          │    │          │    │          │    │          │    │        │ │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘    └────────┘ │
│       │               │               │               │               │      │
│       ▼               ▼               ▼               ▼               ▼      │
│  - Create ID     - Camera OK     - Pose stream   - Pause stream   - Save    │
│  - Init service  - User framed   - Counting reps - Save snapshot  - Cleanup │
│  - Load config   - Countdown     - Form feedback - Keep state     - Report  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Session States

| State | Description | Pose Service | UI |
|-------|-------------|--------------|-----|
| **INIT** | Creating session, loading resources | Not started | Loading screen |
| **READY** | Camera active, waiting for user | Running (not tracking) | "Get in position" |
| **ACTIVE** | Workout in progress | Running + tracking | Game/workout UI |
| **PAUSED** | Temporarily stopped | Paused or running | Pause overlay |
| **ENDED** | Session complete | Stopped | Results screen |

### Session Manager Implementation

```javascript
// session/SessionManager.js

/**
 * Manages workout session lifecycle separate from pose data layer
 */
export class SessionManager {
  constructor(poseDataService) {
    this.poseDataService = poseDataService;
    this.currentSession = null;
    this.listeners = new Set();
  }
  
  /**
   * Create a new session
   * @param {SessionConfig} config - Session configuration
   * @returns {Session}
   */
  createSession(config) {
    // Generate unique session ID
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    
    this.currentSession = {
      id: sessionId,
      state: 'INIT',
      config,
      
      // Timing
      createdAt: Date.now(),
      startedAt: null,
      endedAt: null,
      totalActiveMs: 0,
      pausedAt: null,
      
      // Metrics snapshot at session start (for delta calculation)
      initialMetrics: null,
      
      // Accumulated session data
      data: {
        exercises: {},        // Per-exercise rep counts
        events: [],           // Session events log
        formScores: [],       // Form quality samples
        activityTimeline: [], // Activity transitions
      },
      
      // Result (populated on end)
      result: null,
    };
    
    this._emit('sessionCreated', this.currentSession);
    return this.currentSession;
  }
  
  /**
   * Transition to READY state (camera active, waiting for user)
   */
  async prepareSession() {
    if (!this.currentSession || this.currentSession.state !== 'INIT') {
      throw new Error('Invalid state transition: must be in INIT state');
    }
    
    // Start pose service but don't count reps yet
    await this.poseDataService.start();
    
    this.currentSession.state = 'READY';
    this._emit('sessionReady', this.currentSession);
  }
  
  /**
   * Start the active workout
   */
  startSession() {
    if (!this.currentSession || this.currentSession.state !== 'READY') {
      throw new Error('Invalid state transition: must be in READY state');
    }
    
    const now = Date.now();
    this.currentSession.startedAt = now;
    this.currentSession.state = 'ACTIVE';
    
    // Capture initial metrics for delta calculation
    this.currentSession.initialMetrics = this._captureMetricsSnapshot();
    
    // Reset any exercise counters in the service
    this.poseDataService.resetMetrics?.();
    
    this._emit('sessionStarted', this.currentSession);
    
    // Start activity tracking
    this._startActivityTracking();
  }
  
  /**
   * Pause the session
   */
  pauseSession() {
    if (this.currentSession?.state !== 'ACTIVE') return;
    
    const now = Date.now();
    this.currentSession.pausedAt = now;
    this.currentSession.state = 'PAUSED';
    
    // Optionally pause pose detection to save CPU
    // this.poseDataService.pause?.();
    
    // Log pause event
    this.currentSession.data.events.push({
      type: 'pause',
      timestamp: now,
      activeMs: this._calculateActiveMs(),
    });
    
    this._emit('sessionPaused', this.currentSession);
  }
  
  /**
   * Resume from pause
   */
  resumeSession() {
    if (this.currentSession?.state !== 'PAUSED') return;
    
    const now = Date.now();
    const pauseDuration = now - this.currentSession.pausedAt;
    
    this.currentSession.state = 'ACTIVE';
    this.currentSession.pausedAt = null;
    
    // Don't count pause time as active time
    // (startedAt stays the same, we track totalActiveMs separately)
    
    this.currentSession.data.events.push({
      type: 'resume',
      timestamp: now,
      pauseDurationMs: pauseDuration,
    });
    
    // this.poseDataService.resume?.();
    
    this._emit('sessionResumed', this.currentSession);
  }
  
  /**
   * End the session and generate results
   */
  endSession(reason = 'completed') {
    if (!this.currentSession || this.currentSession.state === 'ENDED') return null;
    
    const now = Date.now();
    this.currentSession.endedAt = now;
    this.currentSession.totalActiveMs = this._calculateActiveMs();
    this.currentSession.state = 'ENDED';
    
    // Stop pose detection
    this.poseDataService.stop();
    
    // Capture final metrics
    const finalMetrics = this._captureMetricsSnapshot();
    
    // Calculate session result
    this.currentSession.result = this._calculateResult(finalMetrics, reason);
    
    this._emit('sessionEnded', this.currentSession);
    
    return this.currentSession.result;
  }
  
  /**
   * Abort session without saving
   */
  abortSession() {
    if (!this.currentSession) return;
    
    this.poseDataService.stop();
    
    this._emit('sessionAborted', this.currentSession);
    this.currentSession = null;
  }
  
  // --- Internal Methods ---
  
  _captureMetricsSnapshot() {
    const state = this.poseDataService.getCurrentState();
    return {
      timestamp: Date.now(),
      reps: { ...state.metrics?.reps },
      activity: { ...state.activity },
    };
  }
  
  _calculateActiveMs() {
    if (!this.currentSession?.startedAt) return 0;
    
    const now = this.currentSession.pausedAt || Date.now();
    let activeMs = now - this.currentSession.startedAt;
    
    // Subtract pause durations from events
    this.currentSession.data.events
      .filter(e => e.type === 'resume' && e.pauseDurationMs)
      .forEach(e => activeMs -= e.pauseDurationMs);
    
    return Math.max(0, activeMs);
  }
  
  _calculateResult(finalMetrics, reason) {
    const { config, data, initialMetrics, totalActiveMs } = this.currentSession;
    
    // Calculate rep deltas (in case service wasn't reset)
    const exerciseResults = {};
    Object.keys(finalMetrics.reps || {}).forEach(exerciseId => {
      const initial = initialMetrics?.reps?.[exerciseId]?.count || 0;
      const final = finalMetrics.reps[exerciseId]?.count || 0;
      exerciseResults[exerciseId] = {
        reps: final - initial,
        avgDuration: finalMetrics.reps[exerciseId]?.averageRepDuration,
      };
    });
    
    // Calculate form score
    const formScores = data.formScores;
    const avgFormScore = formScores.length > 0
      ? formScores.reduce((a, b) => a + b, 0) / formScores.length
      : null;
    
    return {
      sessionId: this.currentSession.id,
      completedAt: Date.now(),
      reason, // 'completed' | 'timeUp' | 'userEnded' | 'error'
      
      duration: {
        totalMs: this.currentSession.endedAt - this.currentSession.createdAt,
        activeMs: totalActiveMs,
        activeSec: Math.round(totalActiveMs / 1000),
      },
      
      exercises: exerciseResults,
      totalReps: Object.values(exerciseResults).reduce((sum, e) => sum + e.reps, 0),
      
      quality: {
        avgFormScore,
        formSamples: formScores.length,
      },
      
      activityBreakdown: this._calculateActivityBreakdown(),
      
      // Include raw data for detailed analysis
      rawData: {
        events: data.events,
        activityTimeline: data.activityTimeline,
      },
    };
  }
  
  _calculateActivityBreakdown() {
    const timeline = this.currentSession.data.activityTimeline;
    const breakdown = {};
    
    for (let i = 0; i < timeline.length; i++) {
      const current = timeline[i];
      const next = timeline[i + 1];
      const duration = (next?.timestamp || Date.now()) - current.timestamp;
      
      if (current.activity) {
        breakdown[current.activity] = (breakdown[current.activity] || 0) + duration;
      }
    }
    
    return breakdown;
  }
  
  _startActivityTracking() {
    // Subscribe to activity layer changes
    this._activityUnsubscribe = this.poseDataService.subscribe('activity', (activity) => {
      if (this.currentSession?.state !== 'ACTIVE') return;
      
      const lastActivity = this.currentSession.data.activityTimeline.slice(-1)[0];
      if (activity.currentActivity !== lastActivity?.activity) {
        this.currentSession.data.activityTimeline.push({
          timestamp: activity.timestamp,
          activity: activity.currentActivity,
          confidence: activity.activityConfidence,
        });
      }
      
      // Sample form scores periodically
      if (activity.timestamp - (this._lastFormSample || 0) > 1000) {
        const semantic = this.poseDataService.getCurrentState().semantic;
        if (semantic?.form?.overallScore != null) {
          this.currentSession.data.formScores.push(semantic.form.overallScore);
        }
        this._lastFormSample = activity.timestamp;
      }
    });
  }
  
  _emit(event, data) {
    this.listeners.forEach(listener => listener(event, data));
  }
  
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  
  getSession() {
    return this.currentSession;
  }
}
```

### React Hook for Sessions

```javascript
// hooks/useSession.js
import { useState, useEffect, useCallback, useRef } from 'react';
import { SessionManager } from '../session/SessionManager.js';
import { usePoseData } from './usePoseLayers.js';

export function useSession(config = {}) {
  const { service } = usePoseData();
  const managerRef = useRef(null);
  
  const [session, setSession] = useState(null);
  const [state, setState] = useState(null);
  const [result, setResult] = useState(null);
  
  // Initialize session manager
  useEffect(() => {
    if (!service) return;
    
    managerRef.current = new SessionManager(service);
    
    const unsubscribe = managerRef.current.subscribe((event, data) => {
      setSession({ ...data });
      setState(data.state);
      
      if (event === 'sessionEnded') {
        setResult(data.result);
      }
    });
    
    return () => {
      unsubscribe();
      managerRef.current?.abortSession();
    };
  }, [service]);
  
  const create = useCallback((sessionConfig) => {
    return managerRef.current?.createSession({ ...config, ...sessionConfig });
  }, [config]);
  
  const prepare = useCallback(() => managerRef.current?.prepareSession(), []);
  const start = useCallback(() => managerRef.current?.startSession(), []);
  const pause = useCallback(() => managerRef.current?.pauseSession(), []);
  const resume = useCallback(() => managerRef.current?.resumeSession(), []);
  const end = useCallback((reason) => managerRef.current?.endSession(reason), []);
  const abort = useCallback(() => managerRef.current?.abortSession(), []);
  
  return {
    session,
    state,
    result,
    
    // Lifecycle methods
    create,
    prepare,
    start,
    pause,
    resume,
    end,
    abort,
    
    // Convenience state checks
    isActive: state === 'ACTIVE',
    isPaused: state === 'PAUSED',
    isEnded: state === 'ENDED',
  };
}
```

### Session Persistence

```javascript
// session/SessionPersistence.js

/**
 * Handles saving and loading session data
 */
export class SessionPersistence {
  constructor(storageKey = 'fitness_sessions') {
    this.storageKey = storageKey;
  }
  
  /**
   * Save completed session result
   */
  async saveSession(result) {
    // 1. Save to local storage for offline access
    const sessions = this._getLocalSessions();
    sessions.push({
      ...result,
      savedAt: Date.now(),
      synced: false,
    });
    
    // Keep last 100 sessions locally
    if (sessions.length > 100) {
      sessions.shift();
    }
    
    localStorage.setItem(this.storageKey, JSON.stringify(sessions));
    
    // 2. Attempt to sync to server
    try {
      await this._syncToServer(result);
      this._markSynced(result.sessionId);
    } catch (e) {
      console.warn('[SessionPersistence] Failed to sync, will retry later:', e);
    }
    
    return result.sessionId;
  }
  
  /**
   * Get session history
   */
  getHistory(limit = 20) {
    return this._getLocalSessions()
      .slice(-limit)
      .reverse();
  }
  
  /**
   * Get session by ID
   */
  getSession(sessionId) {
    return this._getLocalSessions().find(s => s.sessionId === sessionId);
  }
  
  /**
   * Calculate aggregate stats
   */
  getStats(days = 7) {
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
    const recentSessions = this._getLocalSessions()
      .filter(s => s.completedAt > cutoff);
    
    return {
      sessionCount: recentSessions.length,
      totalActiveMinutes: recentSessions.reduce(
        (sum, s) => sum + (s.duration?.activeSec || 0) / 60, 0
      ),
      totalReps: recentSessions.reduce(
        (sum, s) => sum + (s.totalReps || 0), 0
      ),
      exerciseBreakdown: this._aggregateExercises(recentSessions),
      avgFormScore: this._averageFormScore(recentSessions),
    };
  }
  
  /**
   * Sync unsynced sessions to server
   */
  async syncPending() {
    const sessions = this._getLocalSessions();
    const unsynced = sessions.filter(s => !s.synced);
    
    for (const session of unsynced) {
      try {
        await this._syncToServer(session);
        this._markSynced(session.sessionId);
      } catch (e) {
        console.warn(`[SessionPersistence] Failed to sync ${session.sessionId}`);
      }
    }
  }
  
  // --- Private methods ---
  
  _getLocalSessions() {
    try {
      return JSON.parse(localStorage.getItem(this.storageKey) || '[]');
    } catch {
      return [];
    }
  }
  
  async _syncToServer(session) {
    const response = await fetch('/api/fitness/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(session),
    });
    
    if (!response.ok) {
      throw new Error(`Sync failed: ${response.status}`);
    }
  }
  
  _markSynced(sessionId) {
    const sessions = this._getLocalSessions();
    const session = sessions.find(s => s.sessionId === sessionId);
    if (session) {
      session.synced = true;
      localStorage.setItem(this.storageKey, JSON.stringify(sessions));
    }
  }
  
  _aggregateExercises(sessions) {
    const breakdown = {};
    sessions.forEach(s => {
      Object.entries(s.exercises || {}).forEach(([id, data]) => {
        breakdown[id] = (breakdown[id] || 0) + data.reps;
      });
    });
    return breakdown;
  }
  
  _averageFormScore(sessions) {
    const scores = sessions
      .map(s => s.quality?.avgFormScore)
      .filter(s => s != null);
    return scores.length > 0
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : null;
  }
}
```

### Game Session Example

```jsx
// games/JumpingJackChallenge.jsx
import React, { useState, useEffect } from 'react';
import { useSession } from '../../hooks/useSession.js';
import { useRepCounter, useActivityState } from '../../hooks/usePoseLayers.js';
import { SessionPersistence } from '../../session/SessionPersistence.js';

const persistence = new SessionPersistence();

const JumpingJackChallenge = ({ targetReps = 30, onComplete }) => {
  const { 
    session, state, result,
    create, prepare, start, pause, resume, end 
  } = useSession({ type: 'challenge', exercise: 'jumpingJack' });
  
  const { count } = useRepCounter('jumpingJack');
  const { isJumpingJacking } = useActivityState();
  
  const [countdown, setCountdown] = useState(null);
  
  // Create session on mount
  useEffect(() => {
    create({ targetReps });
  }, []);
  
  // Handle countdown before start
  useEffect(() => {
    if (state === 'READY' && countdown === null) {
      setCountdown(3);
    }
    
    if (countdown !== null && countdown > 0) {
      const timer = setTimeout(() => setCountdown(c => c - 1), 1000);
      return () => clearTimeout(timer);
    }
    
    if (countdown === 0) {
      start();
      setCountdown(null);
    }
  }, [state, countdown]);
  
  // Check for completion
  useEffect(() => {
    if (state === 'ACTIVE' && count >= targetReps) {
      end('completed');
    }
  }, [count, targetReps, state]);
  
  // Save result on end
  useEffect(() => {
    if (result) {
      persistence.saveSession(result);
    }
  }, [result]);
  
  // Handle visibility change (pause when tab hidden)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden && state === 'ACTIVE') {
        pause();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [state, pause]);
  
  // --- Render ---
  
  if (state === 'INIT') {
    return <div className="loading">Setting up camera...</div>;
  }
  
  if (state === 'READY') {
    return (
      <div className="ready-screen">
        {countdown !== null ? (
          <div className="countdown">{countdown}</div>
        ) : (
          <>
            <p>Get in position!</p>
            <button onClick={() => setCountdown(3)}>Start</button>
          </>
        )}
      </div>
    );
  }
  
  if (state === 'PAUSED') {
    return (
      <div className="paused-overlay">
        <h2>Paused</h2>
        <p>{count} / {targetReps} jumping jacks</p>
        <button onClick={resume}>Resume</button>
        <button onClick={() => end('userEnded')}>End Workout</button>
      </div>
    );
  }
  
  if (state === 'ENDED') {
    return (
      <div className="results-screen">
        <h2>Challenge Complete! 🎉</h2>
        <div className="stat">{result.totalReps} jumping jacks</div>
        <div className="stat">{result.duration.activeSec}s active time</div>
        {result.quality.avgFormScore && (
          <div className="stat">
            Form: {Math.round(result.quality.avgFormScore * 100)}%
          </div>
        )}
        <button onClick={() => onComplete?.(result)}>Done</button>
      </div>
    );
  }
  
  // ACTIVE state
  return (
    <div className="game-screen">
      <div className="progress">
        {count} / {targetReps}
        <div 
          className="progress-bar" 
          style={{ width: `${(count / targetReps) * 100}%` }} 
        />
      </div>
      
      <div className={`activity-indicator ${isJumpingJacking ? 'active' : ''}`}>
        {isJumpingJacking ? '🙌 Jumping!' : '🧍 Ready'}
      </div>
      
      <button className="pause-btn" onClick={pause}>⏸</button>
    </div>
  );
};
```

### Best Practices

#### 1. State Cleanup Between Sessions

```javascript
// Always reset metrics when starting a new session
startSession() {
  // ...
  this.poseDataService.resetMetrics?.();
  // ...
}

// Or use delta calculation if resetMetrics isn't available
const initialMetrics = this._captureMetricsSnapshot();
// Later: finalCount - initialCount = session reps
```

#### 2. Handle Browser Tab Visibility

```javascript
useEffect(() => {
  const handleVisibility = () => {
    if (document.hidden && session.state === 'ACTIVE') {
      pause();
    }
  };
  
  document.addEventListener('visibilitychange', handleVisibility);
  return () => document.removeEventListener('visibilitychange', handleVisibility);
}, [session.state]);
```

#### 3. Handle Network Disconnection

```javascript
useEffect(() => {
  const handleOffline = () => {
    // Don't interrupt session, just note it
    session.data.events.push({
      type: 'offline',
      timestamp: Date.now(),
    });
  };
  
  const handleOnline = () => {
    session.data.events.push({
      type: 'online', 
      timestamp: Date.now(),
    });
    // Attempt to sync any pending sessions
    persistence.syncPending();
  };
  
  window.addEventListener('offline', handleOffline);
  window.addEventListener('online', handleOnline);
  
  return () => {
    window.removeEventListener('offline', handleOffline);
    window.removeEventListener('online', handleOnline);
  };
}, []);
```

#### 4. Graceful Error Recovery

```javascript
try {
  await poseDataService.start();
} catch (error) {
  if (error.name === 'NotAllowedError') {
    // Camera permission denied
    showError('Camera access required for workout tracking');
  } else if (error.name === 'NotFoundError') {
    // No camera available
    showError('No camera found');
  } else {
    // Unknown error
    console.error('Pose service error:', error);
    showError('Failed to start workout tracking');
  }
  
  abortSession();
}
```

#### 5. Session Data Retention Policy

```javascript
// Clean up old session data periodically
function cleanupOldSessions(maxAgeDays = 90) {
  const cutoff = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
  const sessions = getLocalSessions();
  
  const filtered = sessions.filter(s => 
    s.completedAt > cutoff || !s.synced // Keep unsynced sessions
  );
  
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
}
```

#### 6. Multi-Exercise Sessions

```javascript
// For sessions with multiple exercises, track each separately
const sessionConfig = {
  exercises: ['jumpingJack', 'squat', 'pushup'],
  type: 'circuit',
  rounds: 3,
};

// The Activity layer will automatically detect transitions
// between exercises - use activityTimeline in results
```

---

