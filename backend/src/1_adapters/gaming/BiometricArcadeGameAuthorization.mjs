import { IArcadeGameAuthorizationGateway } from '#apps/gaming/ports/IArcadeGameAuthorizationGateway.mjs';

/**
 * Confirms identity through the household's biometric reader.
 *
 * The reader belongs to the fitness rig and speaks its own request/result
 * vocabulary. This is the anti-corruption layer: it takes the concrete gateway
 * as an injected dependency rather than importing it, so the gaming slice never
 * depends on a peer adapter and never learns that the house's only reader
 * happens to live in the garage.
 *
 * A timeout is NOT a refusal. Nobody arriving at the reader means we could not
 * ask — reporting that as a denial would tell a child they were rejected when in
 * fact they simply have not walked over yet.
 */
export class BiometricArcadeGameAuthorization extends IArcadeGameAuthorizationGateway {
  #gateway; #lockName; #timeoutMs; #logger;

  constructor({ biometricGateway, lockName = 'arcade', timeoutMs = 60_000, logger = console }) {
    super();
    if (!biometricGateway?.requestUnlock) {
      throw new Error('BiometricArcadeGameAuthorization requires a biometric gateway with requestUnlock');
    }
    this.#gateway = biometricGateway;
    this.#lockName = lockName;
    this.#timeoutMs = timeoutMs;
    this.#logger = logger;
  }

  async confirmIdentity({ candidates = [], timeoutMs } = {}) {
    try {
      const result = await this.#gateway.requestUnlock(this.#lockName, candidates, {
        timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : this.#timeoutMs,
      });
      if (result?.matched && result.userId) {
        this.#logger.info?.('arcade.authorize.confirmed', { userId: result.userId });
        return { userId: result.userId, confirmed: true, reason: null };
      }
      // `reason: 'timeout'` means nobody presented a finger — a different fact
      // from a finger that did not match, and it must not read as a refusal.
      const reason = result?.reason === 'timeout' ? 'no_response' : 'not_recognised';
      this.#logger.info?.('arcade.authorize.declined', { reason });
      return { userId: null, confirmed: false, reason };
    } catch (error) {
      this.#logger.warn?.('arcade.authorize.failed', { error: error.message });
      return { userId: null, confirmed: false, reason: 'unavailable' };
    }
  }
}

export default BiometricArcadeGameAuthorization;
