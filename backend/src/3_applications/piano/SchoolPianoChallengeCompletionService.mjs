/**
 * Durable evidence for a School-assigned PianoChallenge.
 *
 * This deliberately does not touch video progress. A musical challenge can
 * satisfy an assigned piano lesson, but it did not make a child watch a video;
 * storing it as video playback would make both records dishonest. The School
 * launcher consumes this narrow record as alternate evidence for the matching
 * configured descriptor.
 */
import { studyDayForInstant } from '#domains/school/studyDay.mjs';
import {
  InvalidInputError,
  MissingResourceError,
  StateConflictError,
} from '#apps/common/errors/SemanticErrors.mjs';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function text(value, max = 200) {
  if (typeof value !== 'string') return null;
  const result = value.trim();
  return result && result.length <= max ? result : null;
}

export class SchoolPianoChallengeCompletionService {
  #datastore; #config; #timezone; #clock;

  constructor({ datastore, config = () => ({}), timezone = null, clock = () => new Date() } = {}) {
    if (!datastore || typeof datastore.getPreferences !== 'function' || typeof datastore.savePreferences !== 'function') {
      throw new Error('SchoolPianoChallengeCompletionService requires a piano preferences datastore');
    }
    if (typeof config !== 'function') throw new Error('SchoolPianoChallengeCompletionService requires a config accessor');
    this.#datastore = datastore; this.#config = config; this.#timezone = timezone; this.#clock = clock;
  }

  /** Return the one configured ask which replaces this exact owed course lesson. */
  descriptorFor({ courseId, lessonId } = {}) {
    const course = text(courseId);
    const lesson = text(lessonId);
    if (!course || !lesson) return null;
    const rows = this.#config()?.schoolChallenges;
    const row = Array.isArray(rows) ? rows.find((item) => item?.courseId === course && item?.lessonId === lesson) : null;
    return this.#descriptor(row);
  }

  studyDay() {
    return studyDayForInstant(this.#clock().getTime(), { timezone: this.#timezone, boundaryHour: 4 });
  }

  completed({ learnerId, descriptorId, studyDay = this.studyDay() } = {}) {
    const descriptor = text(descriptorId);
    if (!descriptor || !DAY.test(studyDay)) return false;
    const preferences = this.#datastore.getPreferences(learnerId);
    if (preferences === null) return false;
    return preferences?.pianoChallenge?.schoolCompletions?.[studyDay]?.[descriptor]?.status === 'completed';
  }

  recordPassed({ learnerId, descriptorId, assessmentId, score, studyDay = this.studyDay() } = {}) {
    const descriptor = text(descriptorId);
    const assessment = text(assessmentId);
    if (!descriptor || !assessment || !DAY.test(studyDay) || typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1) {
      throw new InvalidInputError('Invalid School PianoChallenge completion', { code: null });
    }
    // Never let an HTTP caller mint an opaque completion record.  The course
    // launcher exposes descriptors only for its current owed lesson; this
    // guard additionally makes a removed or misspelled config id ineligible
    // even when an old kiosk tab retries its request.
    if (!this.#descriptorById(descriptor)) {
      throw new MissingResourceError('Unknown School PianoChallenge descriptor', { code: null });
    }
    const current = this.#datastore.getPreferences(learnerId);
    if (current === null) throw new InvalidInputError('Invalid user', { code: null });
    const root = current.pianoChallenge?.schoolCompletions ?? {};
    const existing = root?.[studyDay]?.[descriptor] ?? null;
    if (existing?.assessmentId === assessment && existing?.status === 'completed') {
      return { studyDay, descriptorId: descriptor, duplicate: true, completedAt: existing.completedAt };
    }
    if (existing?.status === 'completed') {
      throw new StateConflictError('School PianoChallenge already completed by another assessment', { code: null });
    }
    const completedAt = this.#clock().toISOString();
    const next = {
      ...current,
      pianoChallenge: {
        ...(current.pianoChallenge || {}),
        schoolCompletions: {
          ...root,
          [studyDay]: {
            ...(root[studyDay] || {}),
            [descriptor]: { status: 'completed', assessmentId: assessment, score, completedAt },
          },
        },
      },
    };
    if (this.#datastore.savePreferences(learnerId, next) === false) throw new Error('School PianoChallenge completion could not be saved');
    return { studyDay, descriptorId: descriptor, duplicate: false, completedAt };
  }

  #descriptor(row) {
    const id = text(row?.id);
    if (!id || !row?.ask || !row?.materialSpec) return null;
    return {
      id, ask: row.ask, materialSpec: row.materialSpec,
      framing: text(row.framing, 300) ?? 'Complete today’s PianoChallenge.',
    };
  }

  #descriptorById(descriptorId) {
    const rows = this.#config()?.schoolChallenges;
    if (!Array.isArray(rows)) return null;
    // Ambiguous ids are invalid configuration rather than a chance to record
    // against an arbitrary first row.
    const matches = rows.filter((row) => text(row?.id) === descriptorId).map((row) => this.#descriptor(row)).filter(Boolean);
    return matches.length === 1 ? matches[0] : null;
  }
}

export default SchoolPianoChallengeCompletionService;
