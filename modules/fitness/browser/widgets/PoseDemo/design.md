# PoseDemo Plugin - Design Specification

## Overview

The **PoseDemo** plugin provides real-time human pose detection and skeleton visualization using TensorFlow.js BlazePose model. It leverages the existing `FitnessWebcam` component infrastructure while adding pose estimation capabilities with skeleton overlay rendering.

### Purpose

1. **Pose Visualization** - Real-time skeleton overlay on webcam feed
2. **Model Demonstration** - Showcase BlazePose's 33-keypoint detection
3. **Framework Foundation** - Establish patterns for future pose-based fitness features
4. **Performance Benchmarking** - Display FPS and inference metrics
5. **View Mode Flexibility** - Support overlay and side-by-side display modes
6. **Provider Reference Implementation** - Demonstrate PoseProvider consumption patterns

---

## Future Vision: Exercise Move Detection

While this plugin focuses on pose visualization, the architecture is designed to support future **exercise move detection** capabilities (jumping jacks, planks, squats, etc.). Key architectural decisions are made with this extensibility in mind.

### Planned Capabilities (Not Implemented Now)

- **Move Classification** - Detect discrete exercises from pose sequences
- **Rep Counting** - Track repetitions of detected movements
- **Form Feedback** - Provide real-time feedback on exercise form
- **Session Analytics** - Aggregate exercise data for session summaries

---

## Manifest

```javascript
{
  id: 'pose_demo',
  name: 'Pose Demo',
  version: '1.0.0',
  icon: '🦴',
  description: 'Real-time pose detection with BlazePose skeleton visualization',
  modes: { standalone: true, overlay: true, sidebar: true, mini: false },
  requires: { sessionActive: false, participants: false, heartRate: false, governance: false },
  pauseVideoOnLaunch: false
}
```

---

## Technical Architecture

### Dependencies

#### Required NPM Packages

```bash
# TensorFlow.js Core
npm install @tensorflow/tfjs-core @tensorflow/tfjs-converter

# Backend (choose one or both for fallback)
npm install @tensorflow/tfjs-backend-webgl    # GPU acceleration (primary)
npm install @tensorflow/tfjs-backend-wasm     # CPU fallback

# Pose Detection Model
npm install @tensorflow-models/pose-detection
```

#### Optional Performance Packages

```bash
# WebGPU backend (experimental, better performance on supported browsers)
npm install @tensorflow/tfjs-backend-webgpu
```

### Model Selection: BlazePose

BlazePose is selected over MoveNet and PoseNet for these reasons:

| Feature | BlazePose | MoveNet | PoseNet |
|---------|-----------|---------|---------|
| Keypoints | 33 | 17 | 17 |
| 3D Support | ✓ | ✗ | ✗ |
| Hand Tracking | ✓ | ✗ | ✗ |
| Segmentation | ✓ | ✗ | ✗ |
| Face Detail | ✓ | ✗ | ✗ |
| Speed | Medium | Fast | Medium |

**BlazePose Model Variants:**

- `lite` - Fastest, lower accuracy (recommended for real-time)
- `full` - Balanced speed/accuracy (default choice)
- `heavy` - Highest accuracy, slower inference

---

## BlazePose Keypoint Reference

BlazePose provides 33 keypoints with the following indices:

```
 0: nose               17: left_pinky
 1: left_eye_inner     18: right_pinky
 2: left_eye           19: left_index
 3: left_eye_outer     20: right_index
 4: right_eye_inner    21: left_thumb
 5: right_eye          22: right_thumb
 6: right_eye_outer    23: left_hip
 7: left_ear           24: right_hip
 8: right_ear          25: left_knee
 9: mouth_left         26: right_knee
10: mouth_right        27: left_ankle
11: left_shoulder      28: right_ankle
12: right_shoulder     29: left_heel
13: left_elbow         30: right_heel
14: right_elbow        31: left_foot_index
15: left_wrist         32: right_foot_index
16: right_wrist
```

### Skeleton Connection Map

```javascript
const BLAZEPOSE_CONNECTIONS = [
  // Face
  [0, 1], [1, 2], [2, 3], [3, 7],  // left eye to ear
  [0, 4], [4, 5], [5, 6], [6, 8],  // right eye to ear
  [9, 10],                          // mouth
  
  // Torso
  [11, 12],                         // shoulders
  [11, 23], [12, 24],               // shoulders to hips
  [23, 24],                         // hips
  
  // Left arm
  [11, 13], [13, 15],               // shoulder → elbow → wrist
  [15, 17], [15, 19], [15, 21],     // wrist to fingers
  [17, 19],                         // pinky to index
  
  // Right arm
  [12, 14], [14, 16],               // shoulder → elbow → wrist
  [16, 18], [16, 20], [16, 22],     // wrist to fingers
  [18, 20],                         // pinky to index
  
  // Left leg
  [23, 25], [25, 27],               // hip → knee → ankle
  [27, 29], [27, 31], [29, 31],     // ankle, heel, foot
  
  // Right leg
  [24, 26], [26, 28],               // hip → knee → ankle
  [28, 30], [28, 32], [30, 32],     // ankle, heel, foot
];
```

---

## Component Architecture

### File Structure

```
PoseDemo/
├── index.jsx              # Export barrel
├── manifest.js            # Plugin manifest
├── PoseDemo.jsx           # Main app component
├── PoseDemo.scss          # Styles
├── design.md              # This document
├── hooks/
│   └── usePoseRenderer.js     # Canvas rendering logic
├── components/
│   ├── SkeletonCanvas.jsx     # Canvas overlay component
│   ├── PoseControls.jsx       # UI controls panel
│   └── PerformanceStats.jsx   # FPS/latency display
└── lib/
    ├── poseConnections.js     # Keypoint connection definitions
    ├── poseColors.js          # Color schemes for skeleton
    └── poseUtils.js           # Utility functions
```

### Shared Pose Infrastructure (Module Level)

These components live at the Fitness module level for cross-plugin reuse:

```
frontend/src/modules/Fitness/
├── context/
│   └── PoseContext.jsx        # Shared pose data provider
├── hooks/
│   ├── usePoseDetector.js     # TensorFlow model lifecycle (shared)
│   └── usePoseProvider.js     # Consumer hook for PoseContext
├── domain/
│   └── pose/
│       ├── index.js           # Barrel exports
│       ├── PoseDetectorService.js    # Singleton detector management
│       ├── MoveDetectorBase.js       # Abstract base for move detectors
│       ├── MoveDetectorRegistry.js   # Registry for move detector plugins
│       └── moves/                    # Future: individual move detectors
│           ├── JumpingJackDetector.js
│           ├── PlankDetector.js
│           └── SquatDetector.js
└── lib/
    └── pose/
        ├── poseConnections.js    # Shared keypoint definitions
        ├── poseGeometry.js       # Angle/distance calculations
        └── poseSmoothing.js      # Temporal smoothing utilities
```

### Component Hierarchy

```
<PoseDemo>
├── <div className="pose-demo-app">
│   ├── <div className="camera-panel">
│   │   ├── <FitnessWebcam />
│   │   └── <SkeletonCanvas />     (absolute positioned overlay)
│   ├── <div className="skeleton-panel">  (side-by-side mode only)
│   │   └── <SkeletonCanvas />
│   ├── <PoseControls />
│   └── <PerformanceStats />
└── </div>
```

---

## Shared Pose Provider Architecture

### Design Philosophy

The pose detection system is designed as a **shared service** rather than a per-plugin implementation. This ensures:

1. **Single Detector Instance** - Only one TensorFlow model loaded in memory
2. **Consistent Frame Rate** - All consumers receive poses at the same cadence
3. **Centralized Resource Management** - GPU/memory managed in one place
4. **Plugin Independence** - Plugins consume poses without managing detection

### PoseContext Interface

```typescript
interface PoseContextValue {
  // === State ===
  poses: Pose[];                    // Current frame's detected poses
  isDetecting: boolean;             // Whether detection is active
  isLoading: boolean;               // Model loading state
  error: PoseError | null;          // Current error state
  
  // === Performance Metrics ===
  metrics: {
    fps: number;                    // Current inference FPS
    latencyMs: number;              // Last inference duration
    backend: string;                // Active TF backend ('webgl', 'wasm')
    modelType: ModelType;           // 'lite' | 'full' | 'heavy'
  };
  
  // === Controls ===
  startDetection: () => void;       // Begin pose detection
  stopDetection: () => void;        // Pause detection (keeps model loaded)
  setVideoSource: (video: HTMLVideoElement | null) => void;
  
  // === Configuration ===
  config: PoseDetectorConfig;
  updateConfig: (partial: Partial<PoseDetectorConfig>) => void;
  
  // === Move Detection (Future) ===
  activeMoveDetectors: string[];    // IDs of active move detectors
  moveEvents: MoveEvent[];          // Recent move detection events
  registerMoveDetector: (detector: MoveDetector) => void;
  unregisterMoveDetector: (id: string) => void;
}
```

### PoseProvider Component

```jsx
// frontend/src/modules/Fitness/context/PoseContext.jsx

import React, { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import { PoseDetectorService } from '../domain/pose/PoseDetectorService';

const PoseContext = createContext(null);

export const PoseProvider = ({ children, autoStart = false }) => {
  const [poses, setPoses] = useState([]);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [metrics, setMetrics] = useState({ fps: 0, latencyMs: 0, backend: null, modelType: 'full' });
  
  const detectorService = useRef(null);
  const videoSourceRef = useRef(null);
  const moveDetectorsRef = useRef(new Map());
  const [moveEvents, setMoveEvents] = useState([]);
  
  // Initialize detector service
  useEffect(() => {
    detectorService.current = new PoseDetectorService({
      onPoseUpdate: (newPoses, inferenceMetrics) => {
        setPoses(newPoses);
        setMetrics(prev => ({ ...prev, ...inferenceMetrics }));
        
        // Dispatch to move detectors
        moveDetectorsRef.current.forEach(detector => {
          const event = detector.processPoses(newPoses);
          if (event) {
            setMoveEvents(prev => [...prev.slice(-99), event]);
          }
        });
      },
      onError: setError,
      onLoadingChange: setIsLoading,
    });
    
    return () => {
      detectorService.current?.dispose();
    };
  }, []);
  
  const startDetection = useCallback(() => {
    if (videoSourceRef.current && detectorService.current) {
      detectorService.current.start(videoSourceRef.current);
      setIsDetecting(true);
    }
  }, []);
  
  const stopDetection = useCallback(() => {
    detectorService.current?.stop();
    setIsDetecting(false);
  }, []);
  
  const setVideoSource = useCallback((video) => {
    videoSourceRef.current = video;
    if (video && isDetecting) {
      detectorService.current?.setVideoSource(video);
    }
  }, [isDetecting]);
  
  const registerMoveDetector = useCallback((detector) => {
    moveDetectorsRef.current.set(detector.id, detector);
  }, []);
  
  const unregisterMoveDetector = useCallback((id) => {
    moveDetectorsRef.current.delete(id);
  }, []);
  
  const value = {
    poses,
    isDetecting,
    isLoading,
    error,
    metrics,
    startDetection,
    stopDetection,
    setVideoSource,
    moveEvents,
    activeMoveDetectors: Array.from(moveDetectorsRef.current.keys()),
    registerMoveDetector,
    unregisterMoveDetector,
  };
  
  return (
    <PoseContext.Provider value={value}>
      {children}
    </PoseContext.Provider>
  );
};

export const usePoseContext = () => {
  const ctx = useContext(PoseContext);
  if (!ctx) {
    throw new Error('usePoseContext must be used within PoseProvider');
  }
  return ctx;
};
```

### Consumer Hook: usePoseProvider

```javascript
// frontend/src/modules/Fitness/hooks/usePoseProvider.js

import { useEffect, useCallback } from 'react';
import { usePoseContext } from '../context/PoseContext';

/**
 * Hook for plugins to consume pose data
 * Handles automatic cleanup and provides simplified interface
 */
export const usePoseProvider = (options = {}) => {
  const {
    autoStart = true,
    onPoseUpdate,
    onMoveEvent,
  } = options;
  
  const ctx = usePoseContext();
  
  // Auto-start detection when video source is set
  useEffect(() => {
    if (autoStart && !ctx.isDetecting && !ctx.isLoading) {
      ctx.startDetection();
    }
  }, [autoStart, ctx.isLoading]);
  
  // Pose update callback
  useEffect(() => {
    if (onPoseUpdate && ctx.poses.length > 0) {
      onPoseUpdate(ctx.poses);
    }
  }, [ctx.poses, onPoseUpdate]);
  
  // Move event callback
  useEffect(() => {
    if (onMoveEvent && ctx.moveEvents.length > 0) {
      const latest = ctx.moveEvents[ctx.moveEvents.length - 1];
      onMoveEvent(latest);
    }
  }, [ctx.moveEvents, onMoveEvent]);
  
  return {
    // Current pose data
    poses: ctx.poses,
    hasPose: ctx.poses.length > 0,
    primaryPose: ctx.poses[0] || null,
    
    // State
    isReady: !ctx.isLoading && !ctx.error,
    isDetecting: ctx.isDetecting,
    isLoading: ctx.isLoading,
    error: ctx.error,
    
    // Performance
    fps: ctx.metrics.fps,
    latency: ctx.metrics.latencyMs,
    backend: ctx.metrics.backend,
    
    // Controls
    start: ctx.startDetection,
    stop: ctx.stopDetection,
    setVideoSource: ctx.setVideoSource,
    
    // Move detection
    moveEvents: ctx.moveEvents,
    registerMoveDetector: ctx.registerMoveDetector,
    unregisterMoveDetector: ctx.unregisterMoveDetector,
  };
};
```

### Integration with FitnessContext

The `PoseProvider` should be nested within the existing `FitnessProvider`:

```jsx
// In Fitness module root
<FitnessProvider>
  <PoseProvider autoStart={false}>
    {/* Fitness module content */}
  </PoseProvider>
</FitnessProvider>
```

---

## Move Detection Abstraction Layer

### Design Goals

1. **Pluggable Detectors** - Add new exercise detectors without modifying core
2. **Consistent Interface** - All detectors follow same pattern
3. **Temporal Awareness** - Detectors can track pose sequences over time
4. **Confidence Scoring** - Moves report confidence levels
5. **State Machine Pattern** - Complex moves modeled as state transitions

### MoveDetector Interface

```typescript
interface MoveDetector {
  // Identity
  id: string;                       // Unique detector ID (e.g., 'jumping_jack')
  name: string;                     // Display name
  description: string;              // What this detector identifies
  
  // Configuration
  config: MoveDetectorConfig;
  updateConfig: (partial: Partial<MoveDetectorConfig>) => void;
  
  // Core Detection
  processPoses: (poses: Pose[]) => MoveEvent | null;
  reset: () => void;                // Clear internal state
  
  // State
  currentState: MoveState;          // Current state machine state
  confidence: number;               // 0-1 confidence in current detection
  repCount: number;                 // For repetitive exercises
  
  // Lifecycle
  onActivate?: () => void;
  onDeactivate?: () => void;
  dispose: () => void;
}

interface MoveDetectorConfig {
  minConfidence: number;            // Threshold to trigger detection
  smoothingFrames: number;          // Temporal smoothing window
  cooldownMs: number;               // Minimum time between detections
  enableFeedback: boolean;          // Whether to generate form feedback
}

interface MoveEvent {
  type: 'move_detected' | 'rep_counted' | 'form_feedback' | 'state_change';
  detectorId: string;
  timestamp: number;
  data: {
    moveName?: string;
    repCount?: number;
    confidence?: number;
    feedback?: FormFeedback;
    fromState?: MoveState;
    toState?: MoveState;
  };
}

interface FormFeedback {
  quality: 'good' | 'fair' | 'poor';
  issues: string[];                 // e.g., ['arms_not_fully_extended', 'knees_bent']
  suggestions: string[];            // e.g., ['Extend arms fully overhead']
}

type MoveState = 'idle' | 'starting' | 'active' | 'completing' | string;
```

### MoveDetectorBase Abstract Class

```javascript
// frontend/src/modules/Fitness/domain/pose/MoveDetectorBase.js

export class MoveDetectorBase {
  constructor(id, name, options = {}) {
    this.id = id;
    this.name = name;
    this.description = options.description || '';
    
    this.config = {
      minConfidence: 0.7,
      smoothingFrames: 5,
      cooldownMs: 500,
      enableFeedback: true,
      ...options.config,
    };
    
    this.currentState = 'idle';
    this.confidence = 0;
    this.repCount = 0;
    
    this._poseHistory = [];
    this._lastEventTime = 0;
  }
  
  /**
   * Process incoming poses - override in subclass
   * @param {Pose[]} poses - Current frame poses
   * @returns {MoveEvent|null} - Event if detection occurred
   */
  processPoses(poses) {
    if (!poses.length) return null;
    
    // Add to history
    this._poseHistory.push({ poses, timestamp: Date.now() });
    if (this._poseHistory.length > this.config.smoothingFrames) {
      this._poseHistory.shift();
    }
    
    // Delegate to subclass
    return this._detectMove(poses, this._poseHistory);
  }
  
  /**
   * Override this in subclass to implement detection logic
   */
  _detectMove(currentPoses, poseHistory) {
    throw new Error('_detectMove must be implemented by subclass');
  }
  
  /**
   * Emit a move event (handles cooldown)
   */
  _emitEvent(type, data) {
    const now = Date.now();
    if (now - this._lastEventTime < this.config.cooldownMs) {
      return null;
    }
    this._lastEventTime = now;
    
    return {
      type,
      detectorId: this.id,
      timestamp: now,
      data,
    };
  }
  
  /**
   * Transition state machine
   */
  _transitionTo(newState) {
    const oldState = this.currentState;
    if (oldState === newState) return null;
    
    this.currentState = newState;
    return this._emitEvent('state_change', {
      fromState: oldState,
      toState: newState,
    });
  }
  
  reset() {
    this.currentState = 'idle';
    this.confidence = 0;
    this._poseHistory = [];
    this._lastEventTime = 0;
  }
  
  updateConfig(partial) {
    this.config = { ...this.config, ...partial };
  }
  
  dispose() {
    this.reset();
  }
}
```

### Example: JumpingJackDetector (Future Implementation Sketch)

```javascript
// frontend/src/modules/Fitness/domain/pose/moves/JumpingJackDetector.js

import { MoveDetectorBase } from '../MoveDetectorBase';
import { calculateAngle, getKeypointDistance } from '../../../lib/pose/poseGeometry';

/**
 * Detects jumping jack exercise
 * 
 * State Machine:
 * idle → arms_rising → arms_up → arms_falling → idle (1 rep)
 * 
 * Key Points Used:
 * - Shoulders (11, 12)
 * - Elbows (13, 14)
 * - Wrists (15, 16)
 * - Hips (23, 24)
 * - Ankles (27, 28)
 */
export class JumpingJackDetector extends MoveDetectorBase {
  constructor(options = {}) {
    super('jumping_jack', 'Jumping Jack', {
      description: 'Detects jumping jack repetitions',
      config: {
        armAngleThreshold: 150,       // Degrees for "arms up"
        legSpreadThreshold: 0.3,      // Hip-width ratio for "legs apart"
        ...options.config,
      },
    });
  }
  
  _detectMove(currentPoses, poseHistory) {
    const pose = currentPoses[0];
    if (!pose || pose.score < this.config.minConfidence) {
      return null;
    }
    
    const kp = pose.keypoints;
    
    // Calculate arm angle (shoulder-elbow-wrist)
    const leftArmAngle = calculateAngle(kp[11], kp[13], kp[15]);
    const rightArmAngle = calculateAngle(kp[12], kp[14], kp[16]);
    const avgArmAngle = (leftArmAngle + rightArmAngle) / 2;
    
    // Calculate leg spread
    const hipWidth = getKeypointDistance(kp[23], kp[24]);
    const ankleWidth = getKeypointDistance(kp[27], kp[28]);
    const legSpreadRatio = ankleWidth / hipWidth;
    
    const armsUp = avgArmAngle > this.config.armAngleThreshold;
    const legsApart = legSpreadRatio > (1 + this.config.legSpreadThreshold);
    
    // State machine transitions
    let event = null;
    
    switch (this.currentState) {
      case 'idle':
        if (armsUp && legsApart) {
          event = this._transitionTo('arms_up');
        }
        break;
        
      case 'arms_up':
        if (!armsUp && !legsApart) {
          this.repCount++;
          this._transitionTo('idle');
          event = this._emitEvent('rep_counted', {
            moveName: 'jumping_jack',
            repCount: this.repCount,
            confidence: this.confidence,
          });
        }
        break;
    }
    
    // Update confidence based on form
    this.confidence = this._calculateFormConfidence(avgArmAngle, legSpreadRatio);
    
    return event;
  }
  
  _calculateFormConfidence(armAngle, legSpread) {
    // Higher confidence for better form
    const armScore = Math.min(armAngle / 180, 1);
    const legScore = Math.min(legSpread / 1.5, 1);
    return (armScore + legScore) / 2;
  }
}
```

### MoveDetectorRegistry

```javascript
// frontend/src/modules/Fitness/domain/pose/MoveDetectorRegistry.js

class MoveDetectorRegistry {
  constructor() {
    this._detectors = new Map();
    this._factories = new Map();
  }
  
  /**
   * Register a detector factory
   */
  registerFactory(id, factory) {
    this._factories.set(id, factory);
  }
  
  /**
   * Get available detector IDs
   */
  getAvailableDetectors() {
    return Array.from(this._factories.keys());
  }
  
  /**
   * Create and activate a detector
   */
  createDetector(id, options = {}) {
    const factory = this._factories.get(id);
    if (!factory) {
      throw new Error(`Unknown detector: ${id}`);
    }
    
    const detector = factory(options);
    this._detectors.set(id, detector);
    detector.onActivate?.();
    return detector;
  }
  
  /**
   * Get active detector instance
   */
  getDetector(id) {
    return this._detectors.get(id);
  }
  
  /**
   * Deactivate and remove detector
   */
  removeDetector(id) {
    const detector = this._detectors.get(id);
    if (detector) {
      detector.onDeactivate?.();
      detector.dispose();
      this._detectors.delete(id);
    }
  }
  
  /**
   * Process poses through all active detectors
   */
  processAll(poses) {
    const events = [];
    this._detectors.forEach(detector => {
      const event = detector.processPoses(poses);
      if (event) events.push(event);
    });
    return events;
  }
  
  dispose() {
    this._detectors.forEach(d => d.dispose());
    this._detectors.clear();
  }
}

// Singleton instance
export const moveDetectorRegistry = new MoveDetectorRegistry();

// Auto-register built-in detectors
// import { JumpingJackDetector } from './moves/JumpingJackDetector';
// moveDetectorRegistry.registerFactory('jumping_jack', (opts) => new JumpingJackDetector(opts));
```

---

## Pose Geometry Utilities

Shared utilities for move detectors to calculate angles, distances, and body positions:

```javascript
// frontend/src/modules/Fitness/lib/pose/poseGeometry.js

/**
 * Calculate angle between three keypoints (in degrees)
 * @param {Keypoint} a - First point
 * @param {Keypoint} b - Middle point (vertex)
 * @param {Keypoint} c - Third point
 */
export const calculateAngle = (a, b, c) => {
  if (!a || !b || !c) return 0;
  
  const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
  let angle = Math.abs(radians * 180 / Math.PI);
  
  if (angle > 180) angle = 360 - angle;
  return angle;
};

/**
 * Calculate distance between two keypoints
 */
export const getKeypointDistance = (a, b) => {
  if (!a || !b) return 0;
  return Math.sqrt(Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2));
};

/**
 * Get midpoint between two keypoints
 */
export const getMidpoint = (a, b) => {
  if (!a || !b) return null;
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    score: Math.min(a.score, b.score),
  };
};

/**
 * Calculate body center of mass (simplified)
 */
export const getBodyCenter = (pose) => {
  const leftHip = pose.keypoints[23];
  const rightHip = pose.keypoints[24];
  const leftShoulder = pose.keypoints[11];
  const rightShoulder = pose.keypoints[12];
  
  const hipCenter = getMidpoint(leftHip, rightHip);
  const shoulderCenter = getMidpoint(leftShoulder, rightShoulder);
  
  return getMidpoint(hipCenter, shoulderCenter);
};

/**
 * Check if body is in roughly upright position
 */
export const isUpright = (pose, threshold = 30) => {
  const leftShoulder = pose.keypoints[11];
  const leftHip = pose.keypoints[23];
  
  if (!leftShoulder || !leftHip) return false;
  
  const angle = Math.abs(Math.atan2(
    leftShoulder.y - leftHip.y,
    leftShoulder.x - leftHip.x
  ) * 180 / Math.PI);
  
  return Math.abs(angle - 90) < threshold;
};

/**
 * Check if in plank position (body horizontal)
 */
export const isHorizontal = (pose, threshold = 30) => {
  const shoulder = pose.keypoints[11];
  const hip = pose.keypoints[23];
  const ankle = pose.keypoints[27];
  
  if (!shoulder || !hip || !ankle) return false;
  
  const bodyAngle = calculateAngle(shoulder, hip, ankle);
  return Math.abs(bodyAngle - 180) < threshold;
};
```

---

## PoseDemo as Provider Consumer

### Updated Component Architecture

PoseDemo becomes a **consumer** of PoseProvider rather than managing detection itself:

```jsx
// PoseDemo.jsx (Updated Architecture)

import React, { useEffect, useRef, useState } from 'react';
import { usePoseProvider } from '../../../hooks/usePoseProvider';
import { Webcam as FitnessWebcam } from '../../../components/FitnessWebcam.jsx';
import { SkeletonCanvas } from './components/SkeletonCanvas';
import { PoseControls } from './components/PoseControls';
import { PerformanceStats } from './components/PerformanceStats';
import './PoseDemo.scss';

const PoseDemo = ({ mode, onClose, config, onMount }) => {
  const webcamRef = useRef(null);
  const [displayMode, setDisplayMode] = useState('overlay');
  const [renderOptions, setRenderOptions] = useState({
    showKeypoints: true,
    showSkeleton: true,
    showLabels: false,
    colorScheme: 'rainbow',
  });
  
  // Consume shared pose provider
  const {
    poses,
    isReady,
    isDetecting,
    isLoading,
    error,
    fps,
    latency,
    backend,
    start,
    stop,
    setVideoSource,
  } = usePoseProvider({ autoStart: false });
  
  useEffect(() => {
    onMount?.();
  }, [onMount]);
  
  // Connect webcam to pose provider when stream is ready
  const handleStreamReady = (stream) => {
    const video = webcamRef.current?.getVideoElement?.();
    if (video) {
      setVideoSource(video);
      start();
    }
  };
  
  // Cleanup on unmount
  useEffect(() => {
    return () => stop();
  }, [stop]);
  
  return (
    <div className={`pose-demo-app mode-${mode} display-${displayMode}`}>
      {/* Camera Panel */}
      <div className="camera-panel">
        <FitnessWebcam
          ref={webcamRef}
          onStreamReady={handleStreamReady}
          className="pose-webcam"
        />
        {displayMode === 'overlay' && (
          <SkeletonCanvas
            poses={poses}
            options={renderOptions}
            className="skeleton-overlay"
          />
        )}
      </div>
      
      {/* Side Panel (for side-by-side mode) */}
      {displayMode === 'side-by-side' && (
        <div className="skeleton-panel">
          <SkeletonCanvas
            poses={poses}
            options={{ ...renderOptions, backgroundColor: '#000' }}
            className="skeleton-standalone"
          />
        </div>
      )}
      
      {/* Controls & Stats */}
      <div className="controls-bar">
        <PoseControls
          displayMode={displayMode}
          onDisplayModeChange={setDisplayMode}
          renderOptions={renderOptions}
          onRenderOptionsChange={setRenderOptions}
          isDetecting={isDetecting}
          onToggleDetection={() => isDetecting ? stop() : start()}
        />
        <PerformanceStats
          fps={fps}
          latency={latency}
          backend={backend}
          isLoading={isLoading}
          error={error}
        />
      </div>
    </div>
  );
};

export default PoseDemo;
```

---

## Plugin Communication Patterns

### Cross-Plugin Pose Data Access

Other plugins can access pose data via the same `usePoseProvider` hook:

```jsx
// Example: JumpingJackGame consuming poses
import { usePoseProvider } from '../../../hooks/usePoseProvider';
import { JumpingJackDetector } from '../../../domain/pose/moves/JumpingJackDetector';

const JumpingJackGame = () => {
  const { poses, registerMoveDetector, unregisterMoveDetector, moveEvents } = usePoseProvider({
    autoStart: true,
    onMoveEvent: (event) => {
      if (event.type === 'rep_counted' && event.detectorId === 'jumping_jack') {
        // Handle rep counted
        setScore(event.data.repCount);
      }
    },
  });
  
  useEffect(() => {
    const detector = new JumpingJackDetector();
    registerMoveDetector(detector);
    return () => unregisterMoveDetector(detector.id);
  }, []);
  
  // ...
};
```

### Event Bus Pattern (Alternative)

For looser coupling, consider an event bus:

```javascript
// PoseEventBus.js
class PoseEventBus {
  constructor() {
    this.listeners = new Map();
  }
  
  subscribe(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.listeners.get(event).delete(callback);
  }
  
  emit(event, data) {
    this.listeners.get(event)?.forEach(cb => cb(data));
  }
}

export const poseEventBus = new PoseEventBus();

// Events: 'pose:update', 'pose:start', 'pose:stop', 'move:detected', 'rep:counted'
```

---

## Core Hooks

### usePoseDetector

Manages TensorFlow.js model lifecycle and inference.

```javascript
const usePoseDetector = (options = {}) => {
  const {
    modelType = 'full',           // 'lite' | 'full' | 'heavy'
    runtime = 'tfjs',             // 'tfjs' | 'mediapipe'
    enableSmoothing = true,
    minPoseConfidence = 0.5,
    minKeypointConfidence = 0.3,
  } = options;

  const [detector, setDetector] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [backendInfo, setBackendInfo] = useState(null);
  
  // Returns:
  return {
    detector,           // PoseDetector instance
    loading,            // Boolean - model loading state
    error,              // Error object if initialization failed
    backendInfo,        // { name: 'webgl', features: [...] }
    estimatePoses,      // (video) => Promise<Pose[]>
    dispose,            // Cleanup function
  };
};
```

**Initialization Sequence:**

1. Set preferred backend (`webgl` → `wasm` → `cpu` fallback)
2. Wait for TensorFlow.js ready
3. Create detector with `poseDetection.createDetector()`
4. Warm up model with dummy inference
5. Set loading = false

### usePoseRenderer

Handles canvas drawing operations for skeleton visualization.

```javascript
const usePoseRenderer = (canvasRef, options = {}) => {
  const {
    keypointRadius = 6,
    lineWidth = 3,
    colorScheme = 'rainbow',      // 'rainbow' | 'solid' | 'heatmap'
    showKeypoints = true,
    showSkeleton = true,
    showLabels = false,
    confidenceThreshold = 0.3,
    mirrorHorizontal = true,      // Match webcam mirroring
  } = options;

  // Returns:
  return {
    drawPose,           // (pose, width, height) => void
    clearCanvas,        // () => void
    setColorScheme,     // (scheme) => void
  };
};
```

---

## Display Modes

### 1. Overlay Mode (Default)

Skeleton drawn directly on top of webcam feed via absolute-positioned canvas.

```
┌─────────────────────────────┐
│  ┌───────────────────────┐  │
│  │                       │  │
│  │   Webcam Video        │  │
│  │   + Skeleton Overlay  │  │
│  │                       │  │
│  └───────────────────────┘  │
│  [Controls] [FPS: 30]       │
└─────────────────────────────┘
```

**Pros:** Intuitive alignment, compact layout
**Cons:** Skeleton can obscure video details

### 2. Side-by-Side Mode

Webcam and skeleton canvas rendered in separate panels.

```
┌─────────────────────────────────────┐
│  ┌──────────────┐ ┌──────────────┐  │
│  │              │ │              │  │
│  │   Webcam     │ │   Skeleton   │  │
│  │   Feed       │ │   Only       │  │
│  │              │ │              │  │
│  └──────────────┘ └──────────────┘  │
│  [Controls]              [FPS: 30]  │
└─────────────────────────────────────┘
```

**Pros:** Clear skeleton visibility, no occlusion
**Cons:** Requires more screen space

### 3. Skeleton-Only Mode

Shows only the skeleton on black/transparent background.

```
┌─────────────────────────────┐
│  ┌───────────────────────┐  │
│  │                       │  │
│  │   Skeleton Only       │  │
│  │   (black background)  │  │
│  │                       │  │
│  └───────────────────────┘  │
│  [Controls] [FPS: 30]       │
└─────────────────────────────┘
```

---

## Performance Considerations

### Target Metrics

| Metric | Target | Acceptable |
|--------|--------|------------|
| FPS | 30+ | 15+ |
| Inference Latency | <50ms | <100ms |
| Memory Usage | <300MB | <500MB |
| CPU Usage | <50% | <80% |

### Optimization Strategies

#### 1. Frame Throttling

```javascript
const INFERENCE_INTERVAL_MS = 33; // ~30 FPS max

useEffect(() => {
  let frameId;
  let lastInferenceTime = 0;
  
  const processFrame = async (timestamp) => {
    if (timestamp - lastInferenceTime >= INFERENCE_INTERVAL_MS) {
      await runInference();
      lastInferenceTime = timestamp;
    }
    frameId = requestAnimationFrame(processFrame);
  };
  
  frameId = requestAnimationFrame(processFrame);
  return () => cancelAnimationFrame(frameId);
}, []);
```

#### 2. Resolution Scaling

Reduce inference resolution for better performance:

```javascript
const scaledConstraints = {
  width: { ideal: 640, max: 1280 },   // Lower than native
  height: { ideal: 480, max: 720 },
  frameRate: { ideal: 30, max: 30 },
};
```

#### 3. Backend Selection Priority

```javascript
const initBackend = async () => {
  // Try backends in performance order
  const backends = ['webgpu', 'webgl', 'wasm', 'cpu'];
  
  for (const backend of backends) {
    try {
      await tf.setBackend(backend);
      await tf.ready();
      console.log(`Using backend: ${backend}`);
      return backend;
    } catch (e) {
      console.warn(`Backend ${backend} not available`);
    }
  }
};
```

#### 4. Model Lite Variant for Low-End Devices

```javascript
const detectDeviceCapability = () => {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  
  if (!gl) return 'low';
  
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = debugInfo 
    ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) 
    : '';
  
  // Detect integrated vs discrete GPU
  if (/Intel|Mali|Adreno/i.test(renderer)) return 'medium';
  return 'high';
};

const modelType = {
  low: 'lite',
  medium: 'full',
  high: 'heavy',
}[detectDeviceCapability()];
```

#### 5. Inference Caching

Skip redundant inference when video is paused or no movement detected:

```javascript
const shouldRunInference = (videoElement, lastFrame) => {
  if (videoElement.paused || videoElement.ended) return false;
  if (document.hidden) return false;
  
  // Optional: motion detection to skip static frames
  return true;
};
```

---

## Memory Management

### Critical Cleanup Patterns

```javascript
// In usePoseDetector
useEffect(() => {
  return () => {
    // CRITICAL: Dispose detector to free GPU memory
    if (detectorRef.current) {
      detectorRef.current.dispose();
      detectorRef.current = null;
    }
    
    // Release TensorFlow tensors
    tf.disposeVariables();
  };
}, []);

// In component unmount
useEffect(() => {
  return () => {
    // Cancel any pending animation frames
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
  };
}, []);
```

### Memory Leak Prevention Checklist

- [ ] Dispose detector on unmount
- [ ] Cancel animation frames on unmount
- [ ] Clear canvas references
- [ ] Stop webcam stream when not needed
- [ ] Dispose individual pose tensors after use (if using raw tensor output)
- [ ] Clear inference queue on pause

---

## Error Handling

### Common Error States

```javascript
const ERROR_STATES = {
  WEBGL_NOT_SUPPORTED: {
    message: 'WebGL not supported',
    recovery: 'Falling back to WASM backend',
    fatal: false,
  },
  MODEL_LOAD_FAILED: {
    message: 'Failed to load pose model',
    recovery: 'Check network connection and retry',
    fatal: true,
  },
  CAMERA_DENIED: {
    message: 'Camera permission denied',
    recovery: 'Grant camera permission and reload',
    fatal: true,
  },
  INFERENCE_TIMEOUT: {
    message: 'Pose detection too slow',
    recovery: 'Switching to lite model',
    fatal: false,
  },
  OUT_OF_MEMORY: {
    message: 'GPU memory exhausted',
    recovery: 'Reducing resolution and restarting',
    fatal: false,
  },
};
```

### Graceful Degradation Flow

```
┌─────────────────────────────────────────────────────────┐
│                      START                              │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│              Try WebGL + Heavy Model                    │
└──────────────────────┬──────────────────────────────────┘
                       ▼
              ┌────────────────┐
              │   Success?     │───Yes──▶ [Running]
              └───────┬────────┘
                      │ No
                      ▼
┌─────────────────────────────────────────────────────────┐
│              Try WebGL + Full Model                     │
└──────────────────────┬──────────────────────────────────┘
                       ▼
              ┌────────────────┐
              │   Success?     │───Yes──▶ [Running]
              └───────┬────────┘
                      │ No
                      ▼
┌─────────────────────────────────────────────────────────┐
│              Try WASM + Lite Model                      │
└──────────────────────┬──────────────────────────────────┘
                       ▼
              ┌────────────────┐
              │   Success?     │───Yes──▶ [Running - Degraded]
              └───────┬────────┘
                      │ No
                      ▼
┌─────────────────────────────────────────────────────────┐
│              Show Error - Camera Only Mode              │
└─────────────────────────────────────────────────────────┘
```

---

## UI Controls

### Control Panel Elements

```javascript
const CONTROLS = {
  displayMode: {
    type: 'toggle-group',
    options: ['overlay', 'side-by-side', 'skeleton-only'],
    default: 'overlay',
  },
  showKeypoints: {
    type: 'toggle',
    default: true,
  },
  showSkeleton: {
    type: 'toggle',
    default: true,
  },
  showLabels: {
    type: 'toggle',
    default: false,
  },
  colorScheme: {
    type: 'select',
    options: ['rainbow', 'solid-green', 'solid-white', 'heatmap'],
    default: 'rainbow',
  },
  modelType: {
    type: 'select',
    options: ['lite', 'full', 'heavy'],
    default: 'full',
    requiresReload: true,
  },
  confidenceThreshold: {
    type: 'slider',
    min: 0.1,
    max: 0.9,
    step: 0.1,
    default: 0.3,
  },
};
```

---

## Integration with FitnessContext

### Session Screenshot Support

The plugin should register with the session screenshot system like `CameraViewApp`:

```javascript
useEffect(() => {
  if (!sessionId || typeof configureSessionScreenshotPlan !== 'function') return;
  
  configureSessionScreenshotPlan({
    intervalMs: captureIntervalMs,
    filenamePattern: `${sessionId}_pose_snapshot`
  });
}, [sessionId, captureIntervalMs, configureSessionScreenshotPlan]);
```

### Pose Data Export (Future)

Structure for exporting pose data to session timeline:

```javascript
const poseDataPayload = {
  timestamp: Date.now(),
  sessionId,
  poses: [{
    score: 0.95,
    keypoints: [...],      // 33 keypoints with x, y, score
    keypoints3D: [...],    // Optional 3D coordinates
  }],
  meta: {
    modelType: 'full',
    inferenceTimeMs: 45,
    frameIndex: captureIndex,
  }
};
```

---

## Accessibility Considerations

1. **Reduced Motion** - Respect `prefers-reduced-motion` media query
2. **High Contrast** - Provide high-contrast skeleton color scheme
3. **Screen Reader** - Announce pose detection status changes
4. **Keyboard Navigation** - All controls accessible via keyboard

---

## Testing Strategy

### Unit Tests

- `usePoseDetector` initialization states
- `usePoseRenderer` drawing functions
- Skeleton connection mapping
- Color scheme application

### Integration Tests

- Model loading in browser environment
- Webcam stream handling
- Canvas overlay synchronization
- Plugin lifecycle with FitnessContext

### Performance Tests

- FPS measurement under load
- Memory usage over extended sessions
- Backend fallback behavior
- Multiple pose detection performance

---

## Implementation Phases

### Phase 1: MVP (Core Functionality) ✅

- [x] Basic plugin structure (manifest, index, main component)
- [x] `PoseDetectorService` singleton with BlazePose full model
- [x] Simple skeleton overlay rendering (SkeletonCanvas)
- [x] Basic error handling and loading states
- [x] PoseDemo consuming detector directly (no provider yet)

### Phase 2: Shared Infrastructure ✅

- [x] `PoseContext` and `PoseProvider` implementation
- [x] `usePoseProvider` consumer hook
- [x] Integrate PoseProvider into FitnessContext hierarchy
- [x] Refactor PoseDemo to use PoseProvider
- [x] Performance metrics display

### Phase 3: Polish & Display Modes ✅

- [x] Display mode switching (overlay/side-by-side/skeleton-only)
- [x] Color scheme options
- [x] Controls panel UI
- [x] Backend fallback logic
- [x] Model variant switching
- [x] Frame throttling optimization

### Phase 4: Move Detection Foundation ✅

- [x] `MoveDetectorBase` abstract class
- [x] `MoveDetectorRegistry` singleton
- [x] Pose geometry utility library
- [x] Move event system in PoseProvider
- [x] PoseDemo showing move events (debug view)

### Phase 5: First Move Detectors (Future)

- [ ] `JumpingJackDetector` implementation
- [ ] `PlankDetector` implementation
- [ ] `SquatDetector` implementation
- [ ] Form feedback system
- [ ] Rep counting UI components

### Phase 6: Integration (Future)

- [ ] Session screenshot integration with pose overlay
- [ ] Pose data export to session timeline
- [ ] Activity-based inference throttling
- [ ] Plugin pause/resume handling
- [ ] Cross-plugin pose consumption examples

---

## Security Considerations

1. **No Data Transmission** - Pose inference runs entirely client-side
2. **Camera Permission** - Uses existing FitnessWebcam permission flow
3. **Model Files** - Consider self-hosting model files for offline support
4. **Worker Isolation** - Consider running inference in Web Worker for isolation

---

## Browser Compatibility

| Browser | WebGL | WASM | WebGPU | Support Level |
|---------|-------|------|--------|---------------|
| Chrome 90+ | ✓ | ✓ | ✓ | Full |
| Firefox 90+ | ✓ | ✓ | ✗ | Good |
| Safari 15+ | ✓ | ✓ | ✗ | Good |
| Edge 90+ | ✓ | ✓ | ✓ | Full |
| Mobile Chrome | ✓ | ✓ | ✗ | Good |
| Mobile Safari | ✓ | ✓ | ✗ | Limited* |

*iOS Safari may have performance limitations on older devices.

---

## References

- [TensorFlow.js Pose Detection](https://github.com/tensorflow/tfjs-models/tree/master/pose-detection)
- [BlazePose Paper](https://arxiv.org/abs/2006.10204)
- [MediaPipe BlazePose](https://google.github.io/mediapipe/solutions/pose.html)
- [TensorFlow.js Backend Guide](https://www.tensorflow.org/js/guide/platform_environment)
- [Web Workers with TensorFlow.js](https://www.tensorflow.org/js/guide/platform_environment#web_workers)

---

## Architecture Summary Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           FitnessProvider                                   │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                          PoseProvider                                 │  │
│  │                                                                       │  │
│  │  ┌─────────────────────┐    ┌─────────────────────────────────────┐  │  │
│  │  │ PoseDetectorService │───▶│          PoseContext                │  │  │
│  │  │   (TensorFlow.js)   │    │  • poses[]                          │  │  │
│  │  │   • BlazePose model │    │  • metrics (fps, latency)           │  │  │
│  │  │   • Video input     │    │  • start/stop controls              │  │  │
│  │  └─────────────────────┘    │  • moveEvents[]                     │  │  │
│  │                              └──────────────┬──────────────────────┘  │  │
│  │                                             │                         │  │
│  │  ┌──────────────────────────────────────────┼──────────────────────┐  │  │
│  │  │           MoveDetectorRegistry           │                      │  │  │
│  │  │  ┌────────────┐ ┌────────────┐ ┌────────┴─────┐               │  │  │
│  │  │  │ JumpingJack│ │   Plank    │ │    Squat     │  ...          │  │  │
│  │  │  │  Detector  │ │  Detector  │ │   Detector   │               │  │  │
│  │  │  └────────────┘ └────────────┘ └──────────────┘               │  │  │
│  │  └───────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                      │                                      │
│                    ┌─────────────────┼─────────────────┐                    │
│                    ▼                 ▼                 ▼                    │
│           ┌─────────────┐    ┌─────────────┐   ┌─────────────┐              │
│           │  PoseDemo   │    │ JumpingJack │   │   Future    │              │
│           │   Plugin    │    │    Game     │   │  Plugins    │              │
│           │             │    │             │   │             │              │
│           │ usePose     │    │ usePose     │   │ usePose     │              │
│           │  Provider() │    │  Provider() │   │  Provider() │              │
│           └─────────────┘    └─────────────┘   └─────────────┘              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
Camera → FitnessWebcam → Video Element
                              │
                              ▼
                    PoseDetectorService
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
              Raw Poses          Move Detectors
                    │                   │
                    ▼                   ▼
              PoseContext          MoveEvents
                    │                   │
                    └────────┬──────────┘
                             ▼
                      usePoseProvider()
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
         PoseDemo     JumpingJackGame   OtherPlugins
              │              │              │
              ▼              ▼              ▼
        Render Skeleton   Count Reps    Custom Logic
```

---

## Appendix: Full Connection Array

```javascript
// Complete BlazePose skeleton connections for copy-paste
export const BLAZEPOSE_SKELETON = {
  connections: [
    // Face
    [0, 1], [1, 2], [2, 3], [3, 7],
    [0, 4], [4, 5], [5, 6], [6, 8],
    [9, 10],
    // Torso
    [11, 12], [11, 23], [12, 24], [23, 24],
    // Left arm
    [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
    // Right arm
    [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
    // Left leg
    [23, 25], [25, 27], [27, 29], [27, 31], [29, 31],
    // Right leg
    [24, 26], [26, 28], [28, 30], [28, 32], [30, 32],
  ],
  keypointNames: [
    'nose', 'left_eye_inner', 'left_eye', 'left_eye_outer',
    'right_eye_inner', 'right_eye', 'right_eye_outer',
    'left_ear', 'right_ear', 'mouth_left', 'mouth_right',
    'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
    'left_wrist', 'right_wrist', 'left_pinky', 'right_pinky',
    'left_index', 'right_index', 'left_thumb', 'right_thumb',
    'left_hip', 'right_hip', 'left_knee', 'right_knee',
    'left_ankle', 'right_ankle', 'left_heel', 'right_heel',
    'left_foot_index', 'right_foot_index',
  ],
};
```
