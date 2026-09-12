import { PlayIntent } from '#domains/gaming/value-objects/PlayIntent.mjs';

/**
 * Turns "someone proved who they are" into a scoped, expiring permission to
 * play one thing on one device.
 *
 * This is the issuing half of authorise-here, redeem-there. The household's only
 * reader is in a different room from the screen, so a child proves themselves in
 * one place and plays in another minutes later. Three properties keep that walk
 * from becoming a blank cheque:
 *
 *  - The permission NAMES what it covers — this device, this title. It cannot be
 *    carried to a different screen or spent on a different game.
 *  - It EXPIRES. Without that, a trip to the reader becomes a way to bank
 *    authorisations and redeem them whenever.
 *  - It is RECORDED on the session it opens, so the audit trail survives the
 *    physical separation between proving and playing.
 *
 * A refusal and a silence are different outcomes. Nobody presenting a finger
 * means we could not ask, and telling a child they were rejected when they
 * simply have not walked over yet would be both wrong and unkind.
 */
export class AuthorizePlay {
  #authorization; #intents; #credentials; #defaultTtlMs; #now; #logger;

  constructor({
    authorization, intents, credentialsFor = null,
    defaultTtlMs = 10 * 60 * 1000, now = () => new Date().toISOString(), logger = console,
  }) {
    if (!authorization?.confirmIdentity) throw new Error('AuthorizePlay requires an authorization gateway');
    if (!intents?.record) throw new Error('AuthorizePlay requires an intents repository');
    this.#authorization = authorization;
    this.#intents = intents;
    this.#credentials = credentialsFor;
    this.#defaultTtlMs = defaultTtlMs;
    this.#now = now;
    this.#logger = logger;
  }

  /**
   * @param {Object} input
   * @param {string} input.deviceId  Where play will happen.
   * @param {Object} input.content   { contentId, title } — what is being authorised.
   * @param {string} input.surface
   * @param {string[]} [input.candidates] Enrolled credential ids to match against.
   * @param {number} [input.ttlMs]   How long the walk back may take.
   * @returns {Promise<{authorized: boolean, userId: string|null, reason: string|null, intent: PlayIntent|null}>}
   */
  async execute({ deviceId, content, surface, candidates = null, ttlMs = null, grantRef = null }) {
    if (!deviceId || !content?.contentId || !surface) {
      throw new Error('AuthorizePlay requires deviceId, surface and content.contentId');
    }

    const enrolled = candidates ?? (this.#credentials ? await this.#credentials() : []);
    const result = await this.#authorization.confirmIdentity({ candidates: enrolled });

    if (!result?.confirmed || !result.userId) {
      this.#logger.info?.('play.authorize.refused', {
        deviceId, contentId: content.contentId, reason: result?.reason ?? 'not_recognised',
      });
      return { authorized: false, userId: null, reason: result?.reason ?? 'not_recognised', intent: null };
    }

    const requestedAt = this.#now();
    const intent = new PlayIntent({
      deviceId,
      surface,
      userId: result.userId,
      content,
      grantRef,
      requestedAt,
      expiresAt: new Date(Date.parse(requestedAt) + (ttlMs ?? this.#defaultTtlMs)).toISOString(),
    });

    await this.#intents.record(intent);
    this.#logger.info?.('play.authorize.issued', {
      deviceId, userId: result.userId, contentId: content.contentId, expiresAt: intent.expiresAt,
    });
    return { authorized: true, userId: result.userId, reason: null, intent };
  }
}

export default AuthorizePlay;
