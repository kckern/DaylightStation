// One realistic day for one learner: two graded lessons (one with a receipt),
// one awaiting review, one unplanned extra, one planned-but-unstarted offer,
// and one deferred subject. Mirrors the GET /teacher/day v2 digest shape,
// including the artifact refs GetTeacherToday now derives from session state.
export const STUDY_DAY = '2026-08-25';

const worksheet = (id) => ({
  artifactId: id,
  originalPdfUrl: '/worksheet.pdf',
  thumbnailUrl: '/worksheet-thumb.png',
});

export const SESSIONS = [
  {
    sessionId: 'ses_1', unitId: 'u-illinois', lessonTitle: 'Illinois', subject: 'civilization',
    courseTitle: 'United States Regions and States', moduleTitle: 'Midwest', posterUrl: '/poster.png',
    studyDay: STUDY_DAY, state: 'graded', reviewStatus: 'complete',
    effectiveScore: { correctCount: 5, totalCount: 7, percent: 71.43 },
    artifacts: { worksheet: worksheet('w1'), receipt: { artifactId: 'r1', originalUrl: '/receipt.png' } },
  },
  {
    sessionId: 'ses_2', unitId: 'u-fractions', lessonTitle: 'Fractions on a Number Line', subject: 'math',
    courseTitle: 'Math 4', moduleTitle: 'Fractions', posterUrl: '/poster.png',
    studyDay: STUDY_DAY, state: 'graded', reviewStatus: 'complete',
    effectiveScore: { correctCount: 10, totalCount: 10, percent: 100 },
    artifacts: { worksheet: worksheet('w2'), receipt: { artifactId: 'r2', originalUrl: '/receipt.png' } },
  },
  {
    sessionId: 'ses_3', unitId: 'u-cells', lessonTitle: 'Plant Cells', subject: 'science',
    courseTitle: 'Life Science', moduleTitle: 'Cells', posterUrl: '/poster.png',
    studyDay: STUDY_DAY, state: 'submitted', reviewStatus: 'pending',
    effectiveScore: null,
    artifacts: { worksheet: worksheet('w3'), receipt: null },
  },
  {
    sessionId: 'ses_4', unitId: null, lessonTitle: 'Hymn Practice', subject: 'piano',
    courseTitle: 'Piano', moduleTitle: null, posterUrl: null,
    studyDay: STUDY_DAY, state: 'completed', reviewStatus: 'complete',
    effectiveScore: null,
    artifacts: { worksheet: null, receipt: null },
  },
];

export const AGENDA_SECTIONS = [
  { subject: 'civilization', next: { unitId: 'u-illinois', title: 'Illinois' } },
  { subject: 'math', next: { unitId: 'u-fractions', title: 'Fractions on a Number Line' } },
  { subject: 'science', next: { unitId: 'u-cells', title: 'Plant Cells' } },
  { subject: 'reading', next: { unitId: 'u-charlotte', title: 'Charlotte’s Web ch. 5' } },
  { subject: 'writing', next: { unitId: 'u-paragraph', title: 'Paragraph practice' }, suppressed: { bySubject: 'reading' } },
];

export const ROW = {
  learnerId: 'felix',
  learnerName: 'Felix',
  sessions: SESSIONS,
  processedToday: [],
  effectiveScoreTotals: { correct: 15, total: 17, percent: 88.24 },
  pendingReview: 1,
  reflectionsToday: [],
  attemptsToday: 17,
  correctToday: 15,
};

export const KIDS = [{ id: 'felix', name: 'Felix' }];
