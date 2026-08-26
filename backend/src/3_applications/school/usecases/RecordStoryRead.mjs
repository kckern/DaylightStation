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
 * The study day is stamped HERE, at the moment of the read, from the same
 * `studyDayForInstant` the launcher asks with — so the row lands in the shard
 * the agenda will look in, with no reconciliation later.
 */
import { studyDayForInstant } from '#domains/school/studyDay.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';

export const STORY_READ_TOPIC = 'school';

export class RecordStoryRead {
  #readingLog; #eventBus; #timezone; #clock; #logger;

  constructor({ readingLog, eventBus = null, timezone = null, clock = () => new Date(), logger = console } = {}) {
    if (!readingLog) throw new Error('RecordStoryRead requires a readingLog');
    this.#readingLog = readingLog;
    this.#eventBus = eventBus;
    this.#timezone = timezone;
    this.#clock = clock;
    this.#logger = logger;
  }

  /**
   * @param {{learnerId: string, title?: string|null, contentId?: string|null,
   *          tagUid?: string|null, location?: string|null}} input
   * @returns {Promise<object>} the stored row
   */
  async execute({ learnerId, title = null, contentId = null, tagUid = null, location = null } = {}) {
    if (typeof learnerId !== 'string' || !learnerId.trim()) {
      throw new ValidationError('learnerId is required to record a story read');
    }
    const now = this.#clock();
    const at = now.toISOString();
    const studyDay = studyDayForInstant(now.getTime(), { timezone: this.#timezone });
    const stored = await this.#readingLog.append({
      learnerId: learnerId.trim(), studyDay, at, contentId, title, tagUid, location,
    });
    this.#logger.info?.('school.story-time.read-recorded', { learnerId, studyDay, contentId, title });

    // The `school` topic the self-service ceremony already listens on — same
    // transport `piano-lesson-complete` arrives by, so no new plumbing.
    try {
      this.#eventBus?.broadcast?.(STORY_READ_TOPIC, {
        event: 'story-read', learnerId, title, contentId, at, studyDay,
      });
    } catch (err) {
      this.#logger.warn?.('school.story-time.broadcast-failed', { learnerId, error: err.message });
    }
    return stored;
  }
}

export default RecordStoryRead;
