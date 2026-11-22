/**
 * DescribePlayStart — where a direct play of a title would start, and whether
 * a resume there still opens with the provenance scene (a long absence: last
 * played more than the household's `scene.resume_after_hours` ago).
 *
 * The playback side answers the start without side effects (its read-only
 * peek); this only decides what that means for the scene.
 *
 * Reference: __docs/reference/media/provenance.md
 */
import { isLongAbsence } from '../../domain/provenance/provenance.mjs';

export class DescribePlayStart {
  #peek; #resumeAfterHours; #clock; #logger;

  /**
   * @param {object} deps
   * @param {((compoundId:string) => Promise<{ startSec:number|null, lastPlayedAt:string|null }>)|null} deps.peekPlaybackStart
   * @param {() => number} deps.resumeAfterHours
   */
  constructor({ peekPlaybackStart = null, resumeAfterHours = () => 6, clock = () => new Date(), logger = console } = {}) {
    this.#peek = typeof peekPlaybackStart === 'function' ? peekPlaybackStart : null;
    this.#resumeAfterHours = resumeAfterHours;
    this.#clock = clock;
    this.#logger = logger;
  }

  /** @returns {Promise<{ startSec:number|null, resumeShowsScene:boolean }>} unknown when the read fails */
  async execute({ ratingKey }) {
    const unknown = { startSec: null, resumeShowsScene: false };
    if (!this.#peek) return unknown;
    try {
      const { startSec, lastPlayedAt } = (await this.#peek(`plex:${ratingKey}`)) || {};
      return {
        startSec: Number.isFinite(startSec) ? startSec : null,
        resumeShowsScene: isLongAbsence(lastPlayedAt, this.#clock(), this.#resumeAfterHours()),
      };
    } catch (error) {
      this.#logger.warn?.('provenance.start.read-failed', { ratingKey, error: error?.message });
      return unknown;
    }
  }
}
