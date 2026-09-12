/**
 * Confirms who is asking to play.
 *
 * Deliberately vendor- and hardware-neutral. Today the household's only reader
 * is a fingerprint sensor in another room; tomorrow it might be one beside the
 * screen, or a card, or a PIN. None of that belongs in the gaming slice, which
 * only ever asks "is this really them?" and gets back a user or a reason.
 *
 * The reader is also a fitness-namespaced adapter, and gaming may not import a
 * peer adapter — so the concrete one is injected at composition and this port is
 * all the application layer ever sees.
 *
 * Answers are three-valued on purpose: a confirmed user, a definite refusal, or
 * "could not ask". The last must never be treated as either of the others.
 */
export class IPlayAuthorizationGateway {
  /**
   * @param {Object} _request
   * @param {string[]} [_request.candidates] Enrolled credential ids to match against.
   * @param {number} [_request.timeoutMs]
   * @returns {Promise<{userId: string|null, confirmed: boolean, reason: string|null}>}
   */
  async confirmIdentity(_request) {
    throw new Error('IPlayAuthorizationGateway.confirmIdentity must be implemented');
  }
}
