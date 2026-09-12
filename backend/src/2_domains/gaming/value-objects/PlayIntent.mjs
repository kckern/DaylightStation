import { ValidationError } from '#domains/core/errors/index.mjs';

/**
 * A recorded intention to play: "this content, for this person, on this device,
 * against this grant".
 *
 * It exists because the surface cannot be asked what it is running. A console
 * emulator watched from outside can confirm that *a* game is playing but never
 * *which* — so identity comes from the launch we issued and is carried forward
 * to meet the observation. The intent is the carrier.
 *
 * It is also the redemption half of an authorisation that happened somewhere
 * else. A grant may be approved at a fingerprint reader in another room minutes
 * before play begins, so an intent is scoped (to content and device) and
 * expires. An unscoped or immortal intent would turn a walk to the reader into
 * a blank cheque.
 *
 * Immutable: a new launch supersedes an intent, it never edits one.
 */
export class PlayIntent {
  #deviceId; #surface; #userId; #content; #grantRef; #requestedAt; #expiresAt;

  constructor({ deviceId, surface, userId = null, content, grantRef = null, requestedAt, expiresAt }) {
    if (!deviceId) throw new ValidationError('deviceId is required', { code: 'MISSING_FIELD', field: 'deviceId' });
    if (!surface) throw new ValidationError('surface is required', { code: 'MISSING_FIELD', field: 'surface' });
    if (!content?.contentId) {
      throw new ValidationError('content.contentId is required — an intent must name what it authorises', {
        code: 'MISSING_FIELD', field: 'content.contentId',
      });
    }
    const requested = Date.parse(requestedAt);
    const expires = Date.parse(expiresAt);
    if (!Number.isFinite(requested)) throw new ValidationError('requestedAt must be a valid timestamp', { code: 'INVALID_TIMESTAMP', field: 'requestedAt' });
    if (!Number.isFinite(expires)) throw new ValidationError('expiresAt must be a valid timestamp', { code: 'INVALID_TIMESTAMP', field: 'expiresAt' });
    if (expires <= requested) {
      throw new ValidationError('expiresAt must be after requestedAt', { code: 'INVALID_EXPIRY', field: 'expiresAt' });
    }
    this.#deviceId = deviceId;
    this.#surface = surface;
    this.#userId = userId;
    this.#content = content;
    this.#grantRef = grantRef;
    this.#requestedAt = new Date(requested).toISOString();
    this.#expiresAt = new Date(expires).toISOString();
    Object.freeze(this);
  }

  get deviceId() { return this.#deviceId; }
  get surface() { return this.#surface; }
  get userId() { return this.#userId; }
  get content() { return this.#content; }
  get grantRef() { return this.#grantRef; }
  get requestedAt() { return this.#requestedAt; }
  get expiresAt() { return this.#expiresAt; }

  /** Has the window to redeem this intent closed? */
  isExpired(now) {
    return Date.parse(now) >= Date.parse(this.#expiresAt);
  }

  /** Does an observed session on this device correspond to this intent? */
  authorizes({ deviceId, contentId }) {
    if (deviceId !== this.#deviceId) return false;
    return contentId == null || contentId === this.#content.contentId;
  }

  toSnapshot() {
    return {
      deviceId: this.#deviceId, surface: this.#surface, userId: this.#userId,
      content: this.#content, grantRef: this.#grantRef,
      requestedAt: this.#requestedAt, expiresAt: this.#expiresAt,
    };
  }

  static fromSnapshot(snapshot) { return new PlayIntent(snapshot); }
}

export default PlayIntent;
