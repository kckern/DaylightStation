/**
 * PoseDetectorService - Singleton service for TensorFlow.js pose detection
 * 
 * Manages the BlazePose model lifecycle, backend initialization, and inference loop.
 * Designed to be shared across multiple consumers via PoseProvider.
 */

// Note: These imports assume @tensorflow/tfjs and @tensorflow-models/pose-detection are installed
// Run: npm install @tensorflow/tfjs-core @tensorflow/tfjs-converter @tensorflow/tfjs-backend-webgl @tensorflow-models/pose-detection

const MODEL_TYPES = {
  lite: 'lite',
  full: 'full',
  heavy: 'heavy',
};

const BACKENDS = ['webgl', 'wasm', 'cpu'];

const DEFAULT_CONFIG = {
  modelType: MODEL_TYPES.full,
  backend: 'wasm',
  enableSmoothing: true,
  minPoseConfidence: 0.5,
  minKeypointConfidence: 0.2,
  maxPoses: 1,
  scoreThreshold: 0.3,
  // Temporal smoothing (EMA)
  temporalSmoothing: true,
  smoothingFactor: 0.3, // 0 = no smoothing, 1 = max smoothing (0.5-0.8 recommended)
  velocityDamping: 0.3, // Limit sudden jumps
  maxVelocity: 300, // Max pixels/frame a keypoint can move
};

class PoseDetectorService {
  constructor(options = {}) {
    this.config = { ...DEFAULT_CONFIG, ...options };
    this.detector = null;
    this.videoSource = null;
    this.isRunning = false;
    this.isInitialized = false;
    this.backend = null;
    this.animationFrameId = null;
    this.lastInferenceTime = 0;
    this.inferenceIntervalMs = 33; // ~30 FPS max
    
    // Callbacks
    this.onPoseUpdate = options.onPoseUpdate || (() => {});
    this.onError = options.onError || console.error;
    this.onLoadingChange = options.onLoadingChange || (() => {});
    this.onMetricsUpdate = options.onMetricsUpdate || (() => {});
    
    // Metrics
    this.metrics = {
      fps: 0,
      latencyMs: 0,
      frameCount: 0,
      lastFpsUpdate: 0,
    };
    
    // TensorFlow modules (lazy loaded)
    this.tf = null;
    this.poseDetection = null;
    
    // Temporal smoothing state
    this.smoothedPoses = null;
    this.lastPoseTimestamp = 0;
  }
  
  /**
   * Initialize TensorFlow.js and load the pose detection model
   */
  async initialize() {
    if (this.isInitialized) return;
    
    this.onLoadingChange(true);
    
    try {
      // Dynamic import TensorFlow.js modules
      const [tfCore, tfBackendWebgl, tfBackendWasm, tfBackendCpu, poseDetection] = await Promise.all([
        import('@tensorflow/tfjs-core'),
        import('@tensorflow/tfjs-backend-webgl'),
        import('@tensorflow/tfjs-backend-wasm'),
        import('@tensorflow/tfjs-backend-cpu'),
        import('@tensorflow-models/pose-detection'),
      ]);
      
      this.tf = tfCore;
      this.poseDetection = poseDetection;
      
      // Initialize backend with fallback
      this.backend = await this._initializeBackend();
      console.log(`[PoseDetectorService] Using backend: ${this.backend}`);
      
      // Create detector
      await this._createDetector();
      
      this.isInitialized = true;
      this.onLoadingChange(false);
      
      console.log('[PoseDetectorService] Initialized successfully');
    } catch (error) {
      console.error('[PoseDetectorService] Initialization failed:', error);
      this.onError(error);
      this.onLoadingChange(false);
      throw error;
    }
  }
  
  /**
   * Initialize TensorFlow backend with fallback chain
   */
  async _initializeBackend() {
    // Try configured backend first
    const preferredBackend = this.config.backend;
    if (preferredBackend && BACKENDS.includes(preferredBackend)) {
      try {
        await this.tf.setBackend(preferredBackend);
        await this.tf.ready();
        return preferredBackend;
      } catch (e) {
        console.warn(`[PoseDetectorService] Preferred backend ${preferredBackend} failed:`, e.message);
      }
    }

    // Fallback chain
    for (const backend of BACKENDS) {
      if (backend === preferredBackend) continue; // Skip if already tried
      try {
        await this.tf.setBackend(backend);
        await this.tf.ready();
        return backend;
      } catch (e) {
        console.warn(`[PoseDetectorService] Backend ${backend} not available:`, e.message);
      }
    }
    throw new Error('No suitable TensorFlow backend available');
  }
  
  /**
   * Create the BlazePose detector
   */
  async _createDetector() {
    const model = this.poseDetection.SupportedModels.BlazePose;
    
    const detectorConfig = {
      runtime: 'tfjs',
      enableSmoothing: this.config.enableSmoothing,
      modelType: this.config.modelType,
    };
    
    this.detector = await this.poseDetection.createDetector(model, detectorConfig);
    
    // Warm up with a dummy inference
    await this._warmup();
  }
  
  /**
   * Warm up the model with a dummy canvas
   */
  async _warmup() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 256, 256);
    
    try {
      await this.detector.estimatePoses(canvas, {
        maxPoses: 1,
        flipHorizontal: false,
      });
      console.log('[PoseDetectorService] Model warmed up');
    } catch (e) {
      console.warn('[PoseDetectorService] Warmup failed:', e);
    }
  }
  
  /**
   * Set the video source for pose detection
   */
  setVideoSource(videoElement) {
    this.videoSource = videoElement;
  }
  
  /**
   * Start the detection loop
   */
  async start(videoElement) {
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    if (videoElement) {
      this.videoSource = videoElement;
    }
    
    if (!this.videoSource) {
      throw new Error('No video source provided');
    }
    
    if (this.isRunning) return;
    
    this.isRunning = true;
    this.metrics.lastFpsUpdate = performance.now();
    this.metrics.frameCount = 0;
    
    this._runDetectionLoop();
  }
  
  /**
   * Stop the detection loop
   */
  stop() {
    this.isRunning = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }
  
  /**
   * Main detection loop using requestAnimationFrame
   */
  _runDetectionLoop() {
    if (!this.isRunning) return;
    
    const processFrame = async (timestamp) => {
      if (!this.isRunning) return;
      
      // Throttle to target FPS
      if (timestamp - this.lastInferenceTime >= this.inferenceIntervalMs) {
        await this._runInference();
        this.lastInferenceTime = timestamp;
        
        // Update FPS metrics
        this.metrics.frameCount++;
        const elapsed = timestamp - this.metrics.lastFpsUpdate;
        if (elapsed >= 1000) {
          this.metrics.fps = Math.round((this.metrics.frameCount * 1000) / elapsed);
          this.metrics.frameCount = 0;
          this.metrics.lastFpsUpdate = timestamp;
          this.onMetricsUpdate({ ...this.metrics, backend: this.backend, modelType: this.config.modelType });
        }
      }
      
      this.animationFrameId = requestAnimationFrame(processFrame);
    };
    
    this.animationFrameId = requestAnimationFrame(processFrame);
  }
  
  /**
   * Switch backend dynamically
   */
  async _switchBackend(newBackend) {
    if (this.backend === newBackend) return;
    
    console.log(`[PoseDetectorService] Switching backend to ${newBackend}`);
    // Don't fully stop, just pause loop
    const wasRunning = this.isRunning;
    this.isRunning = false;
    
    try {
      await this.tf.setBackend(newBackend);
      await this.tf.ready();
      this.backend = newBackend;
      
      // Re-create detector
      if (this.detector) {
        this.detector.dispose();
        this.detector = null;
      }
      await this._createDetector();
      
      if (wasRunning) {
        this.isRunning = true;
        this._runDetectionLoop();
      }
    } catch (e) {
      console.error(`[PoseDetectorService] Failed to switch to ${newBackend}:`, e);
      // Try to resume anyway
      if (wasRunning) {
        this.isRunning = true;
        this._runDetectionLoop();
      }
    }
  }

  /**
   * Run a single inference pass
   */
  async _runInference() {
    if (!this.detector || !this.videoSource) return;
    
    // Skip if video not ready
    if (this.videoSource.readyState < 2) {
      // Throttle warning
      if (this.metrics.frameCount % 100 === 0) {
        console.warn('[PoseDetectorService] Video not ready:', this.videoSource.readyState);
      }
      return;
    }
    if (document.hidden) return;
    

    // Fix video dimensions if missing (TFJS sometimes needs these)
    if (this.videoSource.videoWidth > 0 && (this.videoSource.width === 0 || this.videoSource.height === 0)) {
      this.videoSource.width = this.videoSource.videoWidth;
      this.videoSource.height = this.videoSource.videoHeight;
    }
    
    const startTime = performance.now();
    
    try {
      const poses = await this.detector.estimatePoses(this.videoSource, {
        maxPoses: this.config.maxPoses,
        flipHorizontal: false, // We handle mirroring in rendering
        scoreThreshold: this.config.scoreThreshold,
      });
      
      // Debug raw poses if NaN detected
      if (poses && poses.length > 0) {
        const firstKp = poses[0].keypoints[0];
        if (isNaN(firstKp.x) || isNaN(firstKp.y)) {
          // Auto-switch to WASM if WebGL is failing
          this.metrics.nanCount = (this.metrics.nanCount || 0) + 1;
          
          // Log only on first occurrence and then every 60 frames
          if (this.metrics.nanCount === 1 || this.metrics.nanCount % 60 === 0) {
             console.error('[PoseDetectorService] NaN detected in pose output:', JSON.stringify(poses[0].keypoints.slice(0, 5)));
          }

          if (this.metrics.nanCount > 10 && this.backend === 'webgl') {
             console.warn('[PoseDetectorService] Too many NaN frames, switching to WASM');
             this.metrics.nanCount = 0;
             this._switchBackend('wasm');
             return;
          }
        } else {
          this.metrics.nanCount = 0;
        }
      }
      
      const latencyMs = performance.now() - startTime;
      this.metrics.latencyMs = Math.round(latencyMs);
      
      // Apply temporal smoothing
      const smoothedPoses = this.config.temporalSmoothing 
        ? this._applySmoothingFilter(poses) 
        : poses;
      
      this.onPoseUpdate(smoothedPoses, {
        fps: this.metrics.fps,
        latencyMs: this.metrics.latencyMs,
        backend: this.backend,
        modelType: this.config.modelType,
      });
    } catch (error) {
      console.error('[PoseDetectorService] Inference error:', error);
      this.onError(error);
    }
  }
  
  /**
   * Update configuration (some changes require detector recreation)
   */
  async updateConfig(newConfig) {
    const needsRecreate = newConfig.modelType && newConfig.modelType !== this.config.modelType;
    const needsBackendSwitch = newConfig.backend && newConfig.backend !== this.backend;
    
    this.config = { ...this.config, ...newConfig };
    
    if (needsBackendSwitch && this.isInitialized) {
      await this._switchBackend(newConfig.backend);
    }

    if (needsRecreate && this.isInitialized) {
      const wasRunning = this.isRunning;
      this.stop();
      await this._createDetector();
      if (wasRunning) {
        this.start();
      }
    }
  }
  
  /**
   * Set target inference FPS
   */
  setTargetFps(fps) {
    this.inferenceIntervalMs = Math.max(16, Math.round(1000 / fps));
  }
  
  /**
   * Apply temporal smoothing filter (Exponential Moving Average)
   * Reduces jitter while maintaining responsiveness
   * Hides keypoints that are jumping erratically
   */
  _applySmoothingFilter(rawPoses) {
    if (!rawPoses || rawPoses.length === 0) {
      return rawPoses;
    }
    
    const alpha = 1 - this.config.smoothingFactor; // Convert to EMA alpha (lower = more smoothing)
    const maxVel = this.config.maxVelocity;
    
    // Initialize smoothed poses if first frame
    if (!this.smoothedPoses || this.smoothedPoses.length !== rawPoses.length) {
      this.smoothedPoses = rawPoses.map(pose => ({
        ...pose,
        keypoints: pose.keypoints.map(kp => ({ ...kp })),
      }));
      return this.smoothedPoses;
    }
    
    // Apply EMA to each keypoint
    const smoothed = rawPoses.map((pose, poseIdx) => {
      const prevPose = this.smoothedPoses[poseIdx];
      if (!prevPose) return pose;
      
      const smoothedKeypoints = pose.keypoints.map((kp, kpIdx) => {
        const prevKp = prevPose.keypoints[kpIdx];
        
        // Skip if raw keypoint is low confidence
        if (kp.score < this.config.minKeypointConfidence) {
          // Keep previous position but fade out score
          if (prevKp) {
            return {
              ...prevKp,
              score: prevKp.score * 0.8, // Fade out
            };
          }
          return kp;
        }
        
        if (!prevKp) {
          return kp;
        }
        
        // Calculate velocity
        const dx = kp.x - prevKp.x;
        const dy = kp.y - prevKp.y;
        const velocity = Math.sqrt(dx * dx + dy * dy);
        
        // If jumping too much, hide the keypoint by zeroing score
        if (velocity > maxVel * 2) {
          // Extreme jump - likely bad detection, hide it
          return {
            ...prevKp,
            score: 0,
          };
        }
        
        // If jumping moderately, reduce confidence proportionally
        let confidencePenalty = 1;
        if (velocity > maxVel) {
          confidencePenalty = maxVel / velocity;
        }
        
        // Clamp velocity to prevent sudden jumps
        let clampedX = kp.x;
        let clampedY = kp.y;
        if (velocity > maxVel) {
          const scale = maxVel / velocity;
          clampedX = prevKp.x + dx * scale;
          clampedY = prevKp.y + dy * scale;
        }
        
        // Apply EMA
        return {
          ...kp,
          x: prevKp.x + alpha * (clampedX - prevKp.x),
          y: prevKp.y + alpha * (clampedY - prevKp.y),
          z: kp.z !== undefined ? (prevKp.z || 0) + alpha * ((kp.z || 0) - (prevKp.z || 0)) : undefined,
          score: kp.score * confidencePenalty, // Reduce score if jumping
        };
      });
      
      return {
        ...pose,
        keypoints: smoothedKeypoints,
      };
    });
    
    // Store for next frame
    this.smoothedPoses = smoothed;
    return smoothed;
  }
  
  /**
   * Clean up resources
   */
  dispose() {
    this.stop();
    
    if (this.detector) {
      this.detector.dispose();
      this.detector = null;
    }
    
    // Dispose TensorFlow variables
    if (this.tf) {
      this.tf.disposeVariables();
    }
    
    this.isInitialized = false;
    this.videoSource = null;
    
    console.log('[PoseDetectorService] Disposed');
  }
  
  /**
   * Get current state
   */
  getState() {
    return {
      isInitialized: this.isInitialized,
      isRunning: this.isRunning,
      backend: this.backend,
      modelType: this.config.modelType,
      metrics: { ...this.metrics },
    };
  }
}

// Singleton instance
let instance = null;

export const getPoseDetectorService = (options = {}) => {
  if (!instance) {
    instance = new PoseDetectorService(options);
  }
  return instance;
};

export const disposePoseDetectorService = () => {
  if (instance) {
    instance.dispose();
    instance = null;
  }
};

export { PoseDetectorService, MODEL_TYPES, BACKENDS, DEFAULT_CONFIG };
export default PoseDetectorService;
