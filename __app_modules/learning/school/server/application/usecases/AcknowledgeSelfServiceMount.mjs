/** Settlement changes code-use accounting only, never program completion or credit. */
export class AcknowledgeSelfServiceMount {
  #tokens; #issuer; #clock; #logger;
  constructor({ tokens, mountReceiptIssuer, clock = () => new Date(), logger = {} }) {
    this.#tokens = tokens; this.#issuer = mountReceiptIssuer; this.#clock = clock; this.#logger = logger;
  }
  async execute({ receipt, mounted, deviceId, authorizeLearner } = {}) {
    const invalid = { ok: false, committed: false, replayed: false };
    if (typeof mounted !== 'boolean') return invalid;
    const verified = this.#issuer?.verify(receipt, { deviceId });
    if (!verified?.ok) return invalid;
    const { token, useId, learnerId, action } = verified.payload;
    // Authenticated identity and the learner in the signed receipt are reauthorized now.
    if (authorizeLearner) await authorizeLearner(learnerId);
    const result = await this.#tokens.settleMountUse(token, { useId, learnerId, deviceId, action, mounted, at: this.#clock().toISOString() });
    if (!result.ok) return invalid;
    if (result.committed && !result.replayed) this.#logger.info?.('school.selfservice.program.mount-confirmed', {
      learnerId, deviceId, action, mountProtocol: 1, at: this.#clock().toISOString(),
    });
    return { ok: true, committed: result.committed, replayed: result.replayed };
  }
}
