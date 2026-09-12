/**
 * A source that can answer "what is this device playing right now?".
 *
 * Deliberately vendor-neutral. One implementation infers play by watching a
 * third-party emulator from outside; another is a surface that reports its own
 * lifecycle. The application must not be able to tell which it holds — that is
 * what keeps every consumer honest about treating both the same way.
 *
 * An implementation that cannot reach its device MUST return
 * `state: 'unknown'`. It must never guess, and must never throw to mean "I
 * don't know" — silence and uncertainty are different facts, and only one of
 * them is reportable.
 */
export class IPlayObservationSource {
  /**
   * @param {string} _deviceId
   * @returns {Promise<{
   *   state: 'playing'|'paused'|'unknown',
   *   observedAt: string,
   *   confidenceMs: number,
   *   content?: {contentId: string, title?: string}|null,
   *   channel?: string
   * }>}
   */
  async observe(_deviceId) {
    throw new Error('IPlayObservationSource.observe must be implemented');
  }

  /** Accuracy bound this source can promise, in ms. 0 means exact. */
  get confidenceMs() {
    throw new Error('IPlayObservationSource.confidenceMs must be implemented');
  }
}

export function isPlayObservationSource(obj) {
  return !!obj && typeof obj.observe === 'function';
}
