/**
 * MeasureRegistry — the seam every weekly measure enters through.
 *
 * A measure answers ONE question:
 *
 *     total({ learnerId, from, to }) -> number
 *
 * That is the whole interface, deliberately. v1 registers exactly one provider
 * (`fitness.rings`), and this file exists so the SECOND measure is a new file
 * rather than a refactor of the first — not because a registry is needed to
 * hold one thing.
 *
 * "Measure", not "points": points implies they sum together. They will not
 * share a unit, and a board that added rings to whatever comes next would be
 * lying.
 *
 * Everything measure-specific lives inside its provider. This class knows only
 * ids, labels and units — if it ever learns how rings are derived from heart
 * rate zones, the seam has failed.
 */
export class MeasureRegistry {
  #providers = new Map();

  /**
   * @param {object} provider
   * @param {string} provider.id      stable id, e.g. `fitness.rings`
   * @param {string} provider.label   human label for a board, e.g. `Rings`
   * @param {string} provider.unit    plural unit noun, e.g. `rings`
   * @param {(args: {learnerId: string, from: string, to: string}) => Promise<number>} provider.total
   */
  register(provider) {
    if (!provider?.id) throw new Error('MeasureRegistry: a provider needs an id');
    if (typeof provider.total !== 'function') {
      throw new Error(`MeasureRegistry: provider '${provider.id}' needs total()`);
    }
    if (this.#providers.has(provider.id)) {
      throw new Error(`MeasureRegistry: '${provider.id}' is already registered`);
    }
    this.#providers.set(provider.id, provider);
    return this;
  }

  ids() { return [...this.#providers.keys()]; }

  /**
   * Every registered measure for one learner over one window.
   *
   * A provider that throws yields `value: null` with the id still present,
   * rather than dropping the row or failing the whole board. A missing number
   * and a zero are different facts and the caller must be able to tell them
   * apart — "you did no exercise" is not the same statement as "we could not
   * find out".
   */
  async totalsFor({ learnerId, from, to, logger = null }) {
    const out = [];
    for (const p of this.#providers.values()) {
      let value = null;
      try {
        const n = await p.total({ learnerId, from, to });
        value = Number.isFinite(n) ? n : null;
      } catch (error) {
        logger?.warn?.('measures.provider_failed', {
          measureId: p.id, learnerId, error: String(error?.message ?? error),
        });
      }
      out.push({ id: p.id, label: p.label ?? p.id, unit: p.unit ?? null, value });
    }
    return out;
  }
}

export default MeasureRegistry;
