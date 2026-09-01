import { describe, expect, it, vi } from 'vitest';
import { BuildAgenda } from './BuildAgenda.mjs';

const NOW = '2026-09-01T16:00:00.000Z';
const MATH_ROWS = [
  { label: 'Elementary Math', completed: 1, total: 2, inProgress: 1 },
  { label: 'Number Sense', completed: 1, total: 2, inProgress: 1 },
];
const PIANO_ROWS = [
  { label: 'Hoffman Academy', completed: 2, total: 18, inProgress: 1 },
  { label: 'Chords & the Grand Staff', completed: 20, total: 23, inProgress: 1 },
];

function fixture() {
  const mathEntry = {
    unitId: 'number-forms', courseId: 'math-course', module: 'number-sense',
    subject: 'math', title: 'Number Forms', status: 'in_progress', sessionId: 'ses-math',
  };
  const pianoEntry = {
    unitId: 'piano-lesson', courseId: 'piano-course', module: 'unit-2',
    subject: 'arts', title: 'Improvisation in D Minor', status: 'available',
    program: 'piano-course', programInstance: 'hoffman',
    programContext: {
      course: { id: 'piano-course', title: 'Hoffman Academy' },
      unit: { id: 'unit-2', title: 'Chords & the Grand Staff' },
      lesson: { id: 'piano-lesson', title: 'Improvisation in D Minor' },
    },
  };
  const plan = { entries: [
    { unitId: 'foundations-1', courseId: 'math-course', module: 'foundations', status: 'completed' },
    { unitId: 'place-value', courseId: 'math-course', module: 'number-sense', status: 'completed' },
    mathEntry,
    pianoEntry,
  ], errors: [] };
  const assignment = { courses: [{
    courseId: 'math-course',
    enrollment: {
      moduleOrder: ['foundations', 'number-sense'], optionalModules: [],
      lessonOrder: { foundations: ['foundations-1'], 'number-sense': ['place-value', 'number-forms'] },
    },
  }] };
  const works = [{
    work: 'math-course', title: 'Elementary Mathematics', short_title: 'Elementary Math',
    modules: [
      { module: 'foundations', title: 'Foundations', number: 1 },
      { module: 'number-sense', title: 'Number Sense and Place Value', short_title: 'Number Sense', number: 2 },
    ],
  }];
  const units = [{
    unitId: 'number-forms', courseId: 'math-course', module: 'number-sense',
    subject: 'math', title: 'Number Forms', bank: 'math/number-forms', delivery: 'paper',
  }];
  const sections = [
    { subject: 'math', servedToday: false, next: mathEntry, progressRows: [] },
    { subject: 'arts', servedToday: false, next: pianoEntry, progressRows: PIANO_ROWS },
  ];
  const planProjection = { project: vi.fn(async () => ({
    plan, sections, activeExceptions: [],
    projection: { assignment, units, sessions: [], works, nowIso: NOW },
  })) };
  const sessions = {
    readEvents: vi.fn(async () => [{
      type: 'created', at: NOW, sessionId: 'ses-math', seq: 1,
      learnerId: 'user_4', unitId: 'number-forms', studyDay: '2026-09-01',
    }]),
    appendEvent: vi.fn(),
  };
  const useCase = new BuildAgenda({
    curriculum: {}, assignments: {}, sessions, tokens: {}, planProjection,
    launchers: new Map([['piano-course', { locationHint: 'on the piano' }]]),
    previewOnly: true, clock: () => new Date(NOW), timezone: 'America/Los_Angeles',
  });
  return { useCase, planProjection, sessions };
}

describe('BuildAgenda curriculum progress', () => {
  it('adds canonical-plan rows to curriculum cards and preserves program-owned rows', async () => {
    const { useCase } = fixture();
    const result = await useCase.execute({ learnerId: 'user_4', learnerName: 'User_4' });

    expect(result.sections.find((section) => section.subject === 'math').progressRows).toEqual(MATH_ROWS);
    expect(result.sections.find((section) => section.subject === 'arts').progressRows).toBe(PIANO_ROWS);

    const lessonCards = result.document.blocks.filter((block) => block.type === 'scan_action'
      && block.presentation === 'lesson');
    expect(lessonCards.find((block) => block.icon === 'math').progress).toEqual(MATH_ROWS);
    expect(lessonCards.find((block) => block.icon === 'arts').progress).toBe(PIANO_ROWS);
  });
});
