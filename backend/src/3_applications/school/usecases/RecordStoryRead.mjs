/**
 * RecordStoryRead — one finished story becomes durable evidence.
 *
 * A read is recorded when the story FINISHES, never when it starts: the
 * obligation is "you read it", and a book abandoned two minutes in is not a
 * book read.
 *
 * THE EVIDENCE IS THE POINT; THE ACKNOWLEDGEMENT IS A COURTESY. The append
 * happens first and the ceremony broadcast is wrapped, so a dead bus costs a
 * child an animation, never a book they actually finished.
 *
 * THE SHARD KEY IS HANDED IN, NOT COMPUTED HERE. `studyDay()` is the launcher's
 * own — the single place the household's 4am boundary is applied. Taking a
 * `timezone` instead would put a second, independently-injected source of the
 * key in the system: composition wires the launcher with the household zone,
 * and a caller that omitted the timezone here would default to UTC. A 10pm PT
 * finish would then file under tomorrow while the launcher read today, the
 * count would never rise, and nothing would error. Required, not defaulted, so
 * that mistake cannot be made quietly.
 */
import { ValidationError } from '#domains/core/errors/index.mjs';

export const STORY_READ_TOPIC = 'school';

export class RecordStoryRead {
  #readingLog; #eventBus; #studyDay; #clock; #logger;

  /**
   * @param {object} config
   * @param {object} config.readingLog - IReadingLogStore
   * @param {() => string} config.studyDay - the household's current study-day
   *   key; pass the story-time launcher's own `studyDay()` (required).
   */
  constructor({ readingLog, studyDay, eventBus = null, clock = () => new Date(), logger = console } = {}) {
    if (!readingLog) throw new Error('RecordStoryRead requires a readingLog');
    if (typeof studyDay !== 'function') throw new Error('RecordStoryRead requires a studyDay() source');
    this.#readingLog = readingLog;
    this.#eventBus = eventBus;
    this.#studyDay = studyDay;
    this.#clock = clock;
    this.#logger = logger;
  }

  /**
   * `pickId` is the caller's own idempotency key for ONE finish — a client
   * mints it when playback starts and sends it back when the story ends, so a
   * retried POST or a remounted player cannot be counted twice. It has to
   * survive to the store, because `doneToday` is `rows.length >= target`:
   * a duplicate row IS a duplicate book.
   *
   * @param {{learnerId: string, title?: string|null, contentId?: string|null,
   *          tagUid?: string|null, location?: string|null,
   *          pickId?: string|null, studyDay?: string|null}} input
   * @returns {Promise<object>} the stored row
   */
  async execute({
    learnerId, title = null, contentId = null, tagUid = null, location = null, pickId = null, studyDay: requestedStudyDay = null,
  } = {}) {
    if (typeof learnerId !== 'string' || !learnerId.trim()) {
      throw new ValidationError('learnerId is required to record a story read');
    }
    const at = this.#clock().toISOString();
    // A read belongs to the study day on which it was picked, not whichever
    // day happens to begin while a long audiobook is ending.
    const studyDay = typeof requestedStudyDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(requestedStudyDay)
      ? requestedStudyDay
      : this.#studyDay();
    const stored = await this.#readingLog.append({
      learnerId: learnerId.trim(), studyDay, at, contentId, title, tagUid, location, pickId,
    });
    this.#logger.info?.('school.story-time.read-recorded', { learnerId, studyDay, contentId, title });

    // The `school` topic the self-service ceremony already listens on — same
    // transport `piano-lesson-complete` arrives by, so no new plumbing.
    try {
      this.#eventBus?.broadcast?.(STORY_READ_TOPIC, {
        event: 'story-read', learnerId, title, contentId, at, studyDay, pickId,
      });
    } catch (err) {
      this.#logger.warn?.('school.story-time.broadcast-failed', { learnerId, error: err.message });
    }
    return stored;
  }
}

export default RecordStoryRead;
