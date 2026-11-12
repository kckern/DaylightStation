/**
 * PoseDetectorService - Singleton service for TensorFlow.js pose detection
 * 
 * Manages the BlazePose model lifecycle, backend initialization, and inference loop.
 * Designed to be shared across multiple consumers via PoseProvider.
 */

// Note: These imports assume @tensorflow/tfjs and @tensorflow-models/pose-detection are installed
// Run: npm install @tensorflow/tfjs-core @tensorflow/tfjs-converter @tensorflow/tfjs-backend-webgl @tensorflow-models/pose-detection
import getLogger from '@/lib/logging/Logger.js';

const MODEL_TYPES = {
  lite: 'lite',
  full: 'full',
  heavy: 'heavy',
};

const BACKENDS = ['webgl', 'wasm', 'cpu'];

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'PoseDetectorService' });
  return _logger;
}

/**
 * Detect optimal default backend based on browser engine.
 * Firefox's WebGL implementation has higher per-frame overhead for TF.js
 * inference compared to Chromium, but Firefox's SpiderMonkey WASM engine
 * is competitive. Prefer WASM on Firefox for smoother pose detection.
 */
const getDefaultBackend = () => {
  if (typeof navigator !== 'undefined' && /Firefox/i.test(navigator.userAgent)) {
    return 'wasm';
  }
  return 'webgl';
};

const DEFAULT_CONFIG = {
  modelType: MODEL_TYPES.full,
  backend: getDefaultBackend(),
  targetResolution: 240,
  enableSmoothing: true,
  minPoseConfidence: 0.5,
  minKeypointConfidence: 0.2,
  maxPoses: 1,
  scoreThreshold: 0.3,
  // Temporal smoothing (EMA)
  temporalSmoothing: true,
  smoothingFactor: 0.5, // 0 = no smoothing, 1 = max smoothing (0.5-0.8 recommended)
  velocityDamping: 0.3, // Limit sudden jumps
  maxVelocity: 300, // Max pixels/frame a keypoint can move
  // WASM thread pool size. 'auto' = half the logical cores, capped at
  // MAX_AUTO_WASM_THREADS; a positive integer pins it. Only honoured when the
  // page is cross-origin isolated — without SharedArrayBuffer TF.js loads its
  // single-threaded binary whatever this says.
  wasmThreads: 'auto',
};

// TF.js's own default is one thread per logical core (16 on the garage box).
// The 2026-11-11 measurement that justified isolation was taken at 8.
const MAX_AUTO_WASM_THREADS = 8;

/**
 * How many WASM threads to ask TF.js for.
 *
 * @returns {number} 1 when the page is not cross-origin isolated (threads are
 *   unavailable), otherwise the requested count clamped to the core count, or
 *   for 'auto' half the cores capped at MAX_AUTO_WASM_THREADS.
 */
export function resolveWasmThreadCount({ requested = 'auto', crossOriginIsolated = false, hardwareConcurrency } = {}) {
  if (!crossOriginIsolated) return 1;
  const cores = Number.isFinite(hardwareConcurrency) && hardwareConcurrency >= 1
    ? Math.floor(hardwareConcurrency)
    : 1;
  if (Number.isInteger(requested) && requested >= 1) return Math.min(requested, cores);
  return Math.max(1, Math.min(MAX_AUTO_WASM_THREADS, Math.floor(cores / 2)));
}

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

    // The model the LIVE detector was built with. `config.modelType` is only
    // what was asked for; the two differ while a model loads, and differed
    // permanently before 2026-11 when a switch raced the first load.
    this.detectorModelType = null;
    // Detector builds/disposals run one at a time through this chain.
    this._detectorOp = null;
    // True while the detector is being torn down or built: the loop keeps
    // ticking but skips inference.
    this._rebuilding = false;
    // The inference currently awaiting the detector, so a rebuild can let it
    // finish before disposing the model under it.
    this._inflight = null;
    // Bumped by dispose(): a build that finishes after it must not install.
    this._generation = 0;
    this._initPromise = null;
    this.tfWasm = null;
    this.threadInfo = { crossOriginIsolated: false, requestedThreads: 1, threads: null };
  }
  
  /**
   * Initialize TensorFlow.js and load the pose detection model.
   *
   * Concurrent callers share one load: PoseProvider calls initialize() and
   * start() back to back, and start() calls initialize() again while the first
   * is still awaiting the model. Two loads built two detectors and leaked one.
   */
  initialize() {
    if (this.isInitialized) return Promise.resolve();
    if (!this._initPromise) {
      this._initPromise = this._initialize().finally(() => { this._initPromise = null; });
    }
    return this._initPromise;
  }

  async _initialize() {
    this.onLoadingChange(true);
    const generation = this._generation;

    try {
      // Dynamic import TensorFlow.js modules
      // Positional: the webgl and cpu imports register backends as a side effect,
      // so their slots are holes — dropping them shifts every later binding.
      const [tfCore, , tfBackendWasm, , poseDetection] = await Promise.all([
        import('@tensorflow/tfjs-core'),
        import('@tensorflow/tfjs-backend-webgl'),
        import('@tensorflow/tfjs-backend-wasm'),
        import('@tensorflow/tfjs-backend-cpu'),
        import('@tensorflow-models/pose-detection'),
      ]);

      this.tf = tfCore;
      this.tfWasm = tfBackendWasm;
      this.poseDetection = poseDetection;

      // Tell TFJS where to find .wasm files. They are copied from the npm
      // package into frontend/public by the `prebuild` hook
      // (frontend/scripts/prepare-public-assets.mjs) and served same-origin at
      // the site root. The pthread worker script is NOT a file: tfjs 4.x
      // inlines it and starts workers from a blob: URL.
      if (tfBackendWasm.setWasmPaths) {
        tfBackendWasm.setWasmPaths('/');
      }

      // Thread pool size must be set before the wasm backend initializes.
      this._configureWasmThreads();

      // Initialize backend with fallback
      this.backend = await this._initializeBackend();
      this._logBackendSelected('init');

      // Create detector
      await this._createDetector(generation);
      // The model may have been switched while this one was loading.
      await this._syncDetector({ reason: 'changed_during_load' });

      this.isInitialized = true;
      this.onLoadingChange(false);

      logger().info('pose_detector.initialized', { modelType: this.detectorModelType, backend: this.backend });
    } catch (error) {
      logger().error('pose_detector.init_failed', { error: error.message || error });
      this.onError(error);
      this.onLoadingChange(false);
      throw error;
    }
  }

  /**
   * Decide the WASM thread count and hand it to TF.js.
   *
   * Threads need SharedArrayBuffer, which needs a cross-origin isolated page:
   * the backend serves /fitness with COOP same-origin + COEP credentialless
   * (see __docs/reference/fitness/pose-detector-runtime.md). When the page is not
   * isolated nothing is set and TF.js loads its single-threaded SIMD binary.
   */
  _configureWasmThreads() {
    const crossOriginIsolated = typeof globalThis !== 'undefined' && globalThis.crossOriginIsolated === true;
    const hardwareConcurrency = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined;
    const requestedThreads = resolveWasmThreadCount({
      requested: this.config.wasmThreads,
      crossOriginIsolated,
      hardwareConcurrency,
    });
    this.threadInfo = { crossOriginIsolated, requestedThreads, threads: null, hardwareConcurrency: hardwareConcurrency ?? null };

    if (crossOriginIsolated && typeof this.tfWasm?.setThreadsCount === 'function') {
      this.tfWasm.setThreadsCount(requestedThreads);
    }
  }

  /**
   * Log which backend won and how many threads it actually has.
   *
   * `threads` is what XNNPACK reports after init, not what was asked for; it
   * is null for webgl/cpu. A wasm backend on a page that is not isolated is
   * worth a warning of its own: it works, at a third of the speed.
   */
  _logBackendSelected(reason) {
    let threads = null;
    if (this.backend === 'wasm' && typeof this.tfWasm?.getThreadsCount === 'function') {
      try {
        threads = this.tfWasm.getThreadsCount();
      } catch (e) {
        threads = null;
      }
    }
    this.threadInfo = { ...this.threadInfo, threads };
    const { crossOriginIsolated, requestedThreads, hardwareConcurrency } = this.threadInfo;

    logger().info('pose_detector.backend_selected', {
      backend: this.backend,
      reason,
      crossOriginIsolated,
      threads,
      requestedThreads,
      hardwareConcurrency: hardwareConcurrency ?? null,
      isSecureContext: typeof globalThis !== 'undefined' ? globalThis.isSecureContext === true : false,
      modelType: this.config.modelType,
    });

    if (this.backend === 'wasm' && !crossOriginIsolated) {
      logger().warn('pose_detector.wasm_single_threaded', {
        reason: 'page is not cross-origin isolated',
        isSecureContext: typeof globalThis !== 'undefined' ? globalThis.isSecureContext === true : false,
        hint: 'needs COOP same-origin + COEP credentialless on the document, over https; see fitness cross_origin_isolation config',
      });
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
        getLogger().warn('pose_detector.backend_preference_failed', { backend: preferredBackend, error: e.message });
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
        getLogger().warn('pose_detector.backend_not_available', { backend, error: e.message });
      }
    }
    throw new Error('No suitable TensorFlow backend available');
  }
  
  /**
   * Create the BlazePose detector for the currently configured model.
   *
   * Records the model the detector was ACTUALLY built with. Callers must have
   * disposed any previous detector first (see _disposeDetector).
   */
  async _createDetector(generation = this._generation) {
    const model = this.poseDetection.SupportedModels.BlazePose;
    // Snapshot: config can change while the model downloads.
    const modelType = this.config.modelType;

    const detectorConfig = {
      runtime: 'tfjs',
      enableSmoothing: this.config.enableSmoothing,
      modelType,
    };

    const detector = await this.poseDetection.createDetector(model, detectorConfig);

    if (generation !== this._generation) {
      // The service was disposed while the model loaded. Installing it now
      // would leave a detector nothing will ever dispose.
      try { detector.dispose(); } catch (e) { /* already gone */ }
      throw new Error('PoseDetectorService disposed during detector load');
    }

    this.detector = detector;
    this.detectorModelType = modelType;

    // Warm up with a dummy inference
    await this._warmup();
  }

  /**
   * Dispose the live detector, if any. Never throws.
   */
  _disposeDetector() {
    const detector = this.detector;
    this.detector = null;
    this.detectorModelType = null;
    if (!detector) return false;
    try {
      detector.dispose();
    } catch (e) {
      logger().warn('pose_detector.detector_dispose_failed', { error: e.message || e });
    }
    return true;
  }

  /**
   * Make the live detector match `config.modelType`, disposing the old one.
   *
   * Serialized: calls queue behind any build already running, and each run
   * loops until the detector matches whatever the config says by then — so a
   * burst of switches (full → lite → full) ends on the last one asked for and
   * never leaves two detectors alive.
   *
   * The detection loop is not stopped. `_rebuilding` makes it skip inference
   * while the detector is swapped, and an inference already awaiting the old
   * detector is allowed to finish before that detector is disposed.
   *
   * If the new model cannot be built, the previous model is restored so
   * detection keeps working, and the error is reported.
   */
  _syncDetector({ force = false, reason = 'config' } = {}) {
    const run = async () => {
      let forced = force;
      while (forced || !this.detector || this.detectorModelType !== this.config.modelType) {
        forced = false;
        const from = this.detectorModelType;
        const to = this.config.modelType;
        const generation = this._generation;
        const startedAt = performance.now();
        this._rebuilding = true;
        try {
          if (this._inflight) {
            try { await this._inflight; } catch (e) { /* reported by the loop */ }
          }
          const disposedPrevious = this._disposeDetector();
          await this._createDetector(generation);
          this.smoothedPoses = null;
          logger().info('pose_detector.model_switched', {
            from,
            to: this.detectorModelType,
            reason,
            backend: this.backend,
            disposedPrevious,
            durationMs: Math.round(performance.now() - startedAt),
          });
        } catch (error) {
          logger().error('pose_detector.model_switch_failed', { from, to, reason, error: error.message || error });
          if (generation !== this._generation) throw error;
          if (from && from !== to && !this.detector) {
            this.config = { ...this.config, modelType: from };
            try {
              await this._createDetector(generation);
              logger().warn('pose_detector.model_switch_reverted', { to: from, attempted: to });
            } catch (revertError) {
              logger().error('pose_detector.model_switch_revert_failed', { to: from, error: revertError.message || revertError });
            }
          }
          this.onError(error);
          throw error;
        } finally {
          this._rebuilding = false;
        }
      }
    };
    const op = (this._detectorOp || Promise.resolve()).catch(() => {}).then(run);
    this._detectorOp = op;
    return op;
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
      logger().debug('pose_detector.warmup_complete');
    } catch (e) {
      getLogger().warn('pose_detector.warmup_failed', { error: e.message || e });
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
          this.onMetricsUpdate({ ...this.metrics, backend: this.backend, modelType: this.detectorModelType || this.config.modelType, threads: this.threadInfo.threads });
        }
      }
      
      this.animationFrameId = requestAnimationFrame(processFrame);
    };
    
    this.animationFrameId = requestAnimationFrame(processFrame);
  }
  
  /**
   * Switch backend dynamically. Queues behind any detector build in progress;
   * the detector is disposed before the backend changes (its tensors belong to
   * the old backend) and rebuilt after.
   */
  _switchBackend(newBackend) {
    if (this.backend === newBackend) return Promise.resolve();

    const run = async () => {
      if (this.backend === newBackend) return;
      logger().info('pose_detector.backend_switching', { from: this.backend, to: newBackend });
      const generation = this._generation;
      this._rebuilding = true;
      try {
        if (this._inflight) {
          try { await this._inflight; } catch (e) { /* reported by the loop */ }
        }
        this._disposeDetector();
        await this.tf.setBackend(newBackend);
        await this.tf.ready();
        this.backend = newBackend;
        this._logBackendSelected('switch');
        await this._createDetector(generation);
        this.smoothedPoses = null;
      } catch (e) {
        logger().error('pose_detector.backend_switch_failed', { backend: newBackend, error: e.message || e });
        // Try to keep detecting on whatever backend is active.
        if (!this.detector && generation === this._generation) {
          try {
            await this._createDetector(generation);
          } catch (recreateError) {
            logger().error('pose_detector.detector_recreate_failed', { error: recreateError.message || recreateError });
          }
        }
      } finally {
        this._rebuilding = false;
      }
    };
    const op = (this._detectorOp || Promise.resolve()).catch(() => {}).then(run);
    this._detectorOp = op;
    return op;
  }

  /**
   * Run a single inference pass, tracked so a detector rebuild can wait for it.
   */
  async _runInference() {
    if (!this.detector || !this.videoSource || this._rebuilding) return;
    const pass = this._infer();
    this._inflight = pass;
    try {
      await pass;
    } finally {
      if (this._inflight === pass) this._inflight = null;
    }
  }

  async _infer() {
    // Hold the detector for the whole pass: `this.detector` can be replaced
    // by a model switch while this awaits.
    const detector = this.detector;
    if (!detector || !this.videoSource) return;
    
    // Skip if video not ready
    if (this.videoSource.readyState < 2) {
      // Throttle warning
      if (this.metrics.frameCount % 100 === 0) {
        getLogger().warn('pose_detector.video_not_ready', { readyState: this.videoSource.readyState });
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
      const poses = await detector.estimatePoses(this.videoSource, {
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
             logger().sampled('pose_detector.nan_detected', { keypoints: poses[0].keypoints.slice(0, 3).map(k => ({ x: k.x, y: k.y })) }, { maxPerMinute: 5 });
          }

          if (this.metrics.nanCount > 10 && this.backend === 'webgl') {
             getLogger().warn('pose_detector.nan_frames_switching_backend', { count: this.metrics.nanCount, targetBackend: 'wasm' });
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
        modelType: this.detectorModelType || this.config.modelType,
      });
    } catch (error) {
      logger().error('pose_detector.inference_error', { error: error.message || error });
      this.onError(error);
    }
  }
  
  /**
   * Update configuration. A `modelType` change disposes the live detector and
   * builds a new one (see _syncDetector); a `backend` change switches backend.
   *
   * Safe to call before or during initialize(): the change is recorded and
   * applied as soon as the first model has loaded.
   */
  async updateConfig(newConfig = {}) {
    const next = { ...newConfig };
    if (next.modelType !== undefined && !Object.values(MODEL_TYPES).includes(next.modelType)) {
      logger().warn('pose_detector.unknown_model_type', { modelType: next.modelType, keeping: this.config.modelType });
      delete next.modelType;
    }

    const needsBackendSwitch = next.backend && next.backend !== this.backend;
    this.config = { ...this.config, ...next };

    if (!this.isInitialized) {
      if (next.modelType) {
        logger().info('pose_detector.model_switch_deferred', {
          to: next.modelType,
          loading: this._initPromise !== null,
        });
      }
      return;
    }

    if (needsBackendSwitch) {
      await this._switchBackend(next.backend);
    }

    if (this.detectorModelType !== this.config.modelType) {
      logger().info('pose_detector.model_switching', { from: this.detectorModelType, to: this.config.modelType });
      await this._syncDetector({ reason: 'config' });
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
    // Any model still loading must not install itself after this.
    this._generation += 1;

    this._disposeDetector();
    
    // Dispose TensorFlow variables
    if (this.tf) {
      this.tf.disposeVariables();
    }
    
    this.isInitialized = false;
    this.videoSource = null;
    
    logger().info('pose_detector.disposed');
  }
  
  /**
   * Get current state
   */
  getState() {
    return {
      isInitialized: this.isInitialized,
      isRunning: this.isRunning,
      backend: this.backend,
      // The model actually loaded; `requestedModelType` is what config asks for.
      modelType: this.detectorModelType || this.config.modelType,
      requestedModelType: this.config.modelType,
      crossOriginIsolated: this.threadInfo.crossOriginIsolated,
      threads: this.threadInfo.threads,
      metrics: { ...this.metrics },
    };
  }
}

// Singleton instance
let instance = null;

const CALLBACK_KEYS = ['onPoseUpdate', 'onError', 'onLoadingChange', 'onMetricsUpdate'];

/**
 * Get the shared service, creating it on first use.
 *
 * When the instance already exists the options are still applied: callbacks
 * are rebound to the new consumer and config keys go through updateConfig().
 * They used to be dropped, so a second consumer asking for `modelType: 'lite'`
 * was handed the existing `full` detector with no sign anything was ignored.
 */
export const getPoseDetectorService = (options = {}) => {
  if (!instance) {
    instance = new PoseDetectorService(options);
    return instance;
  }

  const configPatch = {};
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined) continue;
    if (CALLBACK_KEYS.includes(key)) {
      if (typeof value === 'function') instance[key] = value;
    } else if (instance.config[key] !== value) {
      configPatch[key] = value;
    }
  }
  if (Object.keys(configPatch).length > 0) {
    instance.updateConfig(configPatch).catch((error) => {
      logger().error('pose_detector.shared_config_update_failed', { error: error.message || error });
    });
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
