/**
 * The interface every School program plugs into so the parent app can build an
 * aggregate view without knowing what any individual program does.
 *
 * A reporter answers, for one learner: who has been studying, how far along
 * they are, how they are doing, and what is next. The shapes it may use are a
 * closed set (`#domains/school/reporting.mjs`), so the parent renders by kind
 * and never branches on which program it is looking at.
 *
 * A program implements as much of the contract as it truthfully can. A
 * language course has a streak; a writing assignment has a word count; neither
 * is obliged to pretend it has the other. `metrics: []` is a valid report.
 *
 * Reports are DERIVED on every read, never stored — the same rule the attempt
 * log holds to. A stored rollup would drift from its own evidence and would
 * not move when a parent reassigns work.
 *
 * @interface IProgramReporter
 */
export class IProgramReporter {
  /** Stable id, e.g. 'language'. Used as the report key. */
  get id() {
    throw new Error('IProgramReporter.id must be implemented');
  }

  /** Human label for the program as a whole, e.g. 'Language study'. */
  get label() {
    throw new Error('IProgramReporter.label must be implemented');
  }

  /**
   * Reports for one learner.
   *
   * Returns an ARRAY because one program may run several courses for the same
   * learner — two languages, three Plex courses — and each is its own row on
   * the board. A program the learner has never touched returns [].
   *
   * Must not throw: the aggregate view calls every reporter, and one failing
   * program must not blank the board for the rest.
   *
   * @param {{userId: string}} args
   * @returns {Promise<Array<object>>|Array<object>}
   */
  // eslint-disable-next-line no-unused-vars
  summarize({ userId }) {
    throw new Error('IProgramReporter.summarize must be implemented');
  }
}

export function isProgramReporter(obj) {
  return Boolean(obj) && typeof obj.summarize === 'function' && typeof obj.id === 'string';
}

export default IProgramReporter;
