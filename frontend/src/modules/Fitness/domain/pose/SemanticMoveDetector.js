/**
 * SemanticMoveDetector — Bridge from semantic pose pipeline to MoveDetectorBase.
 *
 * Thin adapter that wires createSemanticExtractor (layer 1: keypoints → SemanticPosition)
 * and createActionDetector / createCustomActionDetector (layer 2: SemanticPosition → actions)
 * into PoseContext's existing dispatch system via MoveDetectorBase.
 */

import { MoveDetectorBase } from './MoveDetectorBase.js';
import { createSemanticExtractor } from '../../lib/pose/poseSemantics.js';
import { createActionDetector, createCustomActionDetector } from '../../lib/pose/poseActions.js';

export class SemanticMoveDetector extends MoveDetectorBase {
  /**
   * @param {object} pattern - Action pattern definition (cyclic, sustain, or custom).
   *   Must have `id` and `name`. Shape determines detector type:
   *   - `phases` array → cyclic (rep-counted)
   *   - `sustain` object → sustained (hold)
   *   - `detect` function → custom
   * @param {object} [options] - MoveDetectorBase options + extractorConfig.
   */
  constructor(pattern, options = {}) {
    super(pattern.id, pattern.name || pattern.id, options);
    this._pattern = pattern;
    this._extractorConfig = options.extractorConfig || {};
    this._extractor = null;
    this._actionDetector = null;
  }

  onActivate() {
    super.onActivate();
    this._extractor = createSemanticExtractor(this._extractorConfig);
    this._actionDetector = typeof this._pattern.detect === 'function'
      ? createCustomActionDetector(this._pattern)
      : createActionDetector(this._pattern);
  }

  /**
   * Core detection: extract semantic position from the first pose,
   * feed it to the action detector, and emit events on state changes or reps.
   */
  _detectMove(poses) {
    const pose = poses[0];
    if (!pose?.keypoints) return null;
    if (!this._extractor || !this._actionDetector) return null;

    const now = Date.now();
    const semantic = this._extractor(pose.keypoints, now);
    if (!semantic) return null;

    const result = this._actionDetector.update(semantic, now);
    if (!result) return null;

    this.confidence = result.active ? 0.8 : 0.2;

    // Check for rep counted (cyclic detector)
    if (result.repCount !== undefined && result.repCount > this.repCount) {
      this.repCount = result.repCount;
      return this._emitEvent('rep_counted', { repCount: this.repCount, phase: result.currentPhase });
    }

    // Check for phase/state transitions
    const phaseName = result.currentPhase || (result.holding ? 'holding' : 'idle');
    if (phaseName !== this.currentState) {
      return this._transitionTo(phaseName);
    }

    return null;
  }

  reset() {
    super.reset();
    this.repCount = 0;
    if (this._actionDetector) this._actionDetector.reset();
    this._extractor = createSemanticExtractor(this._extractorConfig);
  }
}

export default SemanticMoveDetector;
