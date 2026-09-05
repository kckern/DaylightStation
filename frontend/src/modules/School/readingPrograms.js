/**
 * The two English reading experiences are deliberately one choice.
 *
 * `subject: english` only says where an agenda tile belongs. It does not say
 * whether the learner watches a grown-up-led story on the shared screen or
 * independently logs physical books. Keeping that distinction explicit in
 * the enrollment editor prevents the taxonomy from impersonating pedagogy.
 */
export const READING_PROGRAM_IDS = Object.freeze(['story-time', 'book-log']);

export const READING_PROGRAM_OPTIONS = Object.freeze([
  Object.freeze({
    id: 'story-time',
    label: 'Preschool story time',
    audience: 'Pre-readers with a grown-up',
    description: 'Open a story on the shared screen and count completed stories.',
  }),
  Object.freeze({
    id: 'book-log',
    label: 'Independent reading — book log',
    audience: 'Grade-school readers',
    description: 'Type a book’s ISBN, track reading, and mark the book finished.',
  }),
]);

const READING_IDS = new Set(READING_PROGRAM_IDS);

/** Every reading enrollment found, including an invalid legacy double-enrollment. */
export function readingEnrollments(programs) {
  return (Array.isArray(programs) ? programs : [])
    .filter((entry) => entry && READING_IDS.has(entry.programId));
}

/**
 * Replace only the reading-program family. Other program objects are returned
 * byte-for-byte by identity, so editing Reading cannot flatten language,
 * flashcard, piano, or future enrollment policy.
 */
export function chooseReadingProgram(programs, programId) {
  const source = Array.isArray(programs) ? programs : [];
  const otherPrograms = source.filter((entry) => !READING_IDS.has(entry?.programId));
  if (programId == null || programId === '') return otherPrograms;
  if (!READING_IDS.has(programId)) throw new Error(`unknown reading program: ${programId}`);

  const existing = source.find((entry) => entry?.programId === programId);
  return [...otherPrograms, existing ?? defaultReadingEnrollment(programId)];
}

export function defaultReadingEnrollment(programId) {
  if (programId === 'story-time') {
    return {
      programId: 'story-time',
      subject: 'english',
      title: 'Story time',
      target: 2,
      schedule: { daysOfWeek: [1, 2, 3, 4, 5] },
    };
  }
  if (programId === 'book-log') {
    return {
      programId: 'book-log',
      subject: 'english',
      title: 'Reading',
      obligation: { metric: 'checkins', quantity: 1, per: 'day' },
      schedule: { daysOfWeek: [1, 2, 3, 4, 5] },
    };
  }
  throw new Error(`unknown reading program: ${programId}`);
}

/** Short honest summary for the adult review state. */
export function describeReadingEnrollment(enrollment) {
  if (!enrollment) return 'No reading experience assigned.';
  if (enrollment.programId === 'story-time') {
    const target = Number.isInteger(enrollment.target) ? enrollment.target : 2;
    return `${target} ${target === 1 ? 'story' : 'stories'} on each scheduled day`;
  }
  if (enrollment.programId === 'book-log') {
    const obligation = enrollment.obligation;
    if (!obligation) return 'Book shelf with no required target';
    const metric = {
      checkins: 'reading check-in',
      pages: 'page',
      minutes: 'minute',
      books: 'book',
    }[obligation.metric] ?? String(obligation.metric ?? 'item');
    return `${obligation.quantity} ${metric}${obligation.quantity === 1 ? '' : 's'} per ${obligation.per}`;
  }
  return enrollment.programId;
}
