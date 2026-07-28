/**
 * A miniature four-unit course, in the RAW shapes the catalog serves — one unit
 * per delivery mode, so a lifecycle test can exercise media, paper, bubbles and
 * gating without a filesystem.
 *
 * These mirror `tests/_fixtures/school/curriculum/` in structure but are trimmed
 * to what a use-case test asserts on. Anything a test wants to vary is an
 * override argument rather than a second fixture.
 */

export const MEDIA_UNIT = 'math-fractions.01';
export const WORKSHEET_UNIT = 'math-fractions.02';
export const OMR_UNIT = 'math-fractions.03';
export const MIXED_UNIT = 'math-fractions.04';

const provenance = { source: 'hand-authored', reviewState: 'approved' };

export const rawUnits = (over = {}) => [
  {
    unitId: MEDIA_UNIT, title: 'Equivalent Fractions', subject: 'math',
    courseId: 'math-fractions', sequence: 1,
    objectives: ['Name equivalent fractions'],
    media: 'fractions-intro-video', bank: 'fractions-01-quiz',
    passing: { percent: 80 }, provenance, ...(over[MEDIA_UNIT] ?? {}),
  },
  {
    unitId: WORKSHEET_UNIT, title: 'Unlike Denominators', subject: 'math',
    courseId: 'math-fractions', sequence: 2,
    objectives: ['Add unlike denominators', 'Simplify the result'],
    document: 'fractions-02-worksheet',
    passing: { percent: 80 }, retry: { variants: 3 }, reward: { amount: 5 },
    review: { rubric: 'Mark each of the two problems.' },
    provenance, ...(over[WORKSHEET_UNIT] ?? {}),
  },
  {
    unitId: OMR_UNIT, title: 'Fractions Checkpoint', subject: 'math',
    courseId: 'math-fractions', sequence: 3,
    objectives: ['Choose the correct sum'],
    document: 'fractions-03-omr', bank: 'fractions-03-bank',
    passing: { percent: 80 }, reward: { amount: 15, requiresSignoff: true },
    provenance, ...(over[OMR_UNIT] ?? {}),
  },
  {
    unitId: MIXED_UNIT, title: 'Word Problems', subject: 'math',
    courseId: 'math-fractions', sequence: 4,
    objectives: ['Pick the operation'],
    media: 'fractions-audio', document: 'fractions-04-worksheet',
    passing: { percent: 80 }, review: { rubric: 'Mark each problem.' },
    provenance, ...(over[MIXED_UNIT] ?? {}),
  },
];

export const rawDocuments = () => [
  {
    id: 'fractions-02-worksheet', seed: 1102, variant: 0, target: ['letter'],
    blocks: [
      { type: 'rich_text', md: 'Add each pair of fractions.' },
      { type: 'question', itemId: 'q1', number: 1, blocks: [{ type: 'math', tex: '\\frac{2}{3}+\\frac{1}{4}' }, { type: 'answer_space', minPt: 40, maxPt: 90 }] },
      { type: 'question', itemId: 'q2', number: 2, blocks: [{ type: 'math', tex: '\\frac{5}{6}-\\frac{1}{4}' }, { type: 'answer_space', minPt: 40, maxPt: 90 }] },
      { type: 'scan_action', action: 'recovery', label: 'Need another copy?' },
    ],
  },
  {
    id: 'fractions-03-omr', seed: 1103, variant: 0, target: ['letter'],
    blocks: [
      { type: 'rich_text', md: 'Fill in one bubble per question.' },
      { type: 'question', itemId: 'q1', number: 1, blocks: [{ type: 'math', tex: '\\frac{1}{2}+\\frac{1}{4}' }, { type: 'omr_response', itemId: 'q1', choices: 4 }] },
      { type: 'question', itemId: 'q2', number: 2, blocks: [{ type: 'math', tex: '\\frac{2}{3}-\\frac{1}{6}' }, { type: 'omr_response', itemId: 'q2', choices: 4 }] },
    ],
  },
  {
    id: 'fractions-04-worksheet', seed: 1104, variant: 0, target: ['letter'],
    blocks: [
      { type: 'rich_text', md: 'Write each answer in simplest form.' },
      { type: 'question', itemId: 'q1', number: 1, blocks: [{ type: 'rich_text', md: 'Two thirds of a cup, twice.' }, { type: 'answer_space', minPt: 40, maxPt: 90 }] },
    ],
  },
];

export const rawManifests = () => [
  {
    id: 'fractions-intro-video', locator: 'plex:481203',
    title: 'Equivalent Fractions', series: 'Daylight Math Lessons',
    durationSec: 600, provenance: { source: 'household-recording' },
  },
  {
    id: 'fractions-audio', locator: 'plex:492117',
    title: 'Word Problems Read Aloud', aliases: ['Fractions Read Aloud'],
    durationSec: 420, provenance: { source: 'household-recording' },
  },
];

export const BANK_IDS = ['fractions-01-quiz', 'fractions-03-bank'];

/** A four-choice bubble form for the OMR unit, in the renderer's artifact shape. */
export const omrFormMap = (over = {}) => ({
  formVersion: 'v1',
  documentId: 'fractions-03-omr',
  seed: 1103,
  variant: 0,
  marks: ['q1', 'q2'].flatMap((itemId, row) => ['A', 'B', 'C', 'D'].map((choice, col) => ({
    itemId, choice, xPt: 100 + col * 20, yPt: 200 + row * 40, rPt: 5, page: 1,
  }))),
  ...over,
});

/** The question bank the OMR sheet is graded against. */
export const omrBank = () => ({
  id: 'fractions-03-bank',
  items: [
    { id: 'q1', type: 'multiple_choice', answer: 'C' },
    { id: 'q2', type: 'multiple_choice', answer: 'B' },
  ],
});
