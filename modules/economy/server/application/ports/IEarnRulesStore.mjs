/**
 * Where the household's earn rules live, with their history.
 *
 * One current document (`{revision, revisedAt, revisedBy, currency, rules,
 * users}`) plus every superseded revision, append-only, so a rate edit can
 * always be explained later ("what did we pay per day in week 38?").
 *
 * @interface IEarnRulesStore
 */
export class IEarnRulesStore {
  /** @returns {Promise<object|null>} the current document, or null when none was ever written */
  async read() { throw new Error('IEarnRulesStore.read must be implemented'); }

  /**
   * Replace the current document. When `previous` is given and was ever
   * written (revision > 0), it is archived under its revision first.
   * @param {object} doc
   * @param {{previous?: object|null}} [opts]
   */
  // eslint-disable-next-line no-unused-vars
  async write(doc, opts) { throw new Error('IEarnRulesStore.write must be implemented'); }

  /** @returns {Promise<object[]>} superseded revisions, newest first */
  async history() { throw new Error('IEarnRulesStore.history must be implemented'); }
}

export default IEarnRulesStore;
