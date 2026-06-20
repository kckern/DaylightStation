import { ValidationError } from '#domains/core/errors/index.mjs';

/**
 * Immutable per-frame specification for a session time-lapse.
 *
 * Describes everything the renderer needs to draw one composite frame:
 * which camera capture is nearest, which player content + offset to extract,
 * and the participant/zone/rpm stats at this instant.
 */
export class FrameDescriptor {
  constructor({
    frameIndex,
    wallClockMs,
    elapsedRealMs,
    cameraTimestamp = null,
    playerTimestamp = null,
    playerContentId = null,
    title = null,
    showTitle = null,
    participants = [],
    zone = null,
    rpm = null,
    coins = null,
    chart = null,
    cadence = null,
    timezone = null
  }) {
    if (!Number.isFinite(frameIndex) || frameIndex < 0) {
      throw new ValidationError('frameIndex must be a non-negative number', { code: 'INVALID_FRAME_INDEX', field: 'frameIndex', value: frameIndex });
    }
    this.frameIndex = frameIndex;
    this.wallClockMs = wallClockMs;
    this.elapsedRealMs = elapsedRealMs;
    this.cameraTimestamp = cameraTimestamp;
    this.playerTimestamp = playerTimestamp;
    this.playerContentId = playerContentId;
    this.title = title;
    this.showTitle = showTitle;
    this.participants = Object.freeze(participants.map(p => Object.freeze({ ...p })));
    this.zone = zone;
    this.rpm = rpm;
    this.coins = coins;
    this.chart = chart;
    this.cadence = cadence;
    this.timezone = timezone;
    Object.freeze(this);
  }
}
