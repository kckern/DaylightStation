import { describe, expect, it } from 'vitest';
import {
  buildContextualLaunchCard,
  CONTEXTUAL_LAUNCH_CARD_SCHEMA,
} from '#domains/school/selfService/contextualLaunchCard.mjs';

const base = (resolution) => buildContextualLaunchCard({
  resolution,
  learner: { id: 'kid1', displayName: 'Alpha' },
  subjectId: 'math',
  course: { id: 'fractions', title: 'Fractions' },
  module: { id: 'foundations', title: 'Foundations', position: 1 },
  lesson: { id: 'fractions.03', title: 'Equivalent fractions' },
  progress: [
    { scope: 'course', label: 'Course', completed: 2, total: 6, inProgress: 1 },
    { scope: 'module', label: 'Unit 1', completed: 3, total: 8 },
  ],
  options: { bankPrintable: true },
});

describe('contextual launch card', () => {
  it('assembles identity, curriculum trail, artwork and progress without I/O-shaped URLs', () => {
    const card = base({
      kind: 'move',
      state: { state: 'created' },
      unit: { unitId: 'fractions.03', subject: 'math', bank: 'fractions-bank' },
    });

    expect(card).toMatchObject({
      schema: CONTEXTUAL_LAUNCH_CARD_SCHEMA,
      context: {
        learner: { id: 'kid1', displayName: 'Alpha', avatar: { kind: 'learner', id: 'kid1' } },
        taxonomy: {
          subject: { id: 'math', label: 'Math & Money' },
          course: { id: 'fractions', title: 'Fractions', artwork: { kind: 'course-poster', courseId: 'fractions' } },
          module: { id: 'foundations', title: 'Foundations', position: 1 },
          lesson: { id: 'fractions.03', title: 'Equivalent fractions' },
        },
        progress: [
          { scope: 'course', completed: 2, total: 6, inProgress: 1 },
          { scope: 'module', completed: 3, total: 8 },
        ],
      },
      presentation: { status: 'ready', message: null },
      actions: [
        { kind: 'print', role: 'primary', operation: 'print', followUp: 'confirm-print' },
        { kind: 'exit', role: 'secondary', operation: 'exit', followUp: 'close' },
      ],
    });
    expect(card.context.trail.map((item) => item.label)).toEqual([
      'Math & Money', 'Fractions', 'Foundations', 'Equivalent fractions',
    ]);
  });

  it.each([
    [{ kind: 'served' }, 'complete'],
    [{ kind: 'locked', remedy: 'Finish the earlier work.' }, 'blocked'],
    [{ kind: 'empty' }, 'unavailable'],
    [{ kind: 'move', state: { state: 'media_dispatched' }, unit: { media: 'video' } }, 'waiting'],
  ])('classifies a non-action card as %s', (resolution, status) => {
    expect(base(resolution).presentation.status).toBe(status);
  });

  it('describes remediation by its actual fresh operation, not by the stable retry identity', () => {
    const card = base({
      kind: 'move',
      state: { state: 'outcome_recorded', outcome: { result: 'needs_remediation' } },
      unit: { media: 'video' },
    });
    expect(card.actions[0]).toMatchObject({
      kind: 'retry', label: 'Play the video', operation: 'play', followUp: 'message',
    });
  });

  /**
   * A Plex-backed course reaches this builder wearing whatever prefix the
   * program that owns it happened to stack on: the piano launcher's
   * `compoundId` is `plex:` prepended to an id that already said `plex:`, and
   * the plan's synthetic unit id scopes the same course under `piano-course:`.
   * The panel has ONE rule for finding a cover (`plex:<ratingKey>` goes to the
   * image proxy, anything else to the curriculum package), so the canonical
   * form is settled here rather than by teaching the client every prefix a
   * program might invent.
   */
  it.each([
    ['plex:675689'],
    ['plex:plex:675689'],
    ['piano-course:plex:675689'],
  ])('names a plex-backed course canonically, however %s reached it', (courseId) => {
    const card = buildContextualLaunchCard({
      resolution: { kind: 'program', programId: 'piano-course', unit: { unitId: courseId } },
      learner: { id: 'kid1' },
      subjectId: 'arts',
      course: { id: courseId, title: 'Hoffman Academy' },
    });

    expect(card.context.taxonomy.course).toEqual({
      id: 'plex:675689',
      title: 'Hoffman Academy',
      artwork: { kind: 'course-poster', courseId: 'plex:675689' },
    });
    expect(card.context.trail.find((item) => item.kind === 'course').id).toBe('plex:675689');
  });

  it('leaves a curriculum course id exactly as the package authored it', () => {
    const card = buildContextualLaunchCard({
      resolution: { kind: 'program', programId: 'atlas', unit: { unitId: 'x' } },
      learner: { id: 'kid1' },
      subjectId: 'civilization',
      course: { id: 'young-peoples-atlas-us', title: "Young People's Atlas" },
    });

    expect(card.context.taxonomy.course.id).toBe('young-peoples-atlas-us');
    expect(card.context.taxonomy.course.artwork.courseId).toBe('young-peoples-atlas-us');
  });

  it('omits absent course and progress instead of inventing zero completion', () => {
    const card = buildContextualLaunchCard({
      resolution: { kind: 'program', programId: 'typing', unit: { unitId: 'typing', title: 'Typing' } },
      learner: { id: 'kid1' },
      subjectId: 'writing',
      lesson: { id: 'typing', title: 'Typing' },
    });
    expect(card.context.taxonomy.course).toBeNull();
    expect(card.context.progress).toEqual([]);
    expect(card.context.learner.displayName).toBeNull();
  });
});

/**
 * A lesson's own still and blurb. Plex has them; worksheets, quizzes and banks
 * do not, and most courses in the house are not Plex-backed at all — so the
 * absent case is the common one and has to stay clean.
 */
describe('contextual launch card lesson media', () => {
  const cardWith = (lesson) => buildContextualLaunchCard({
    resolution: { kind: 'move', state: { state: 'ready' } },
    learner: { id: 'learner3', displayName: 'Learner3' },
    subjectId: 'arts',
    lesson,
  }).context.taxonomy.lesson;

  it('carries the still as an artwork descriptor, like the course poster', () => {
    // One convention for images on this card: a node under `artwork` naming its
    // kind, never a bare string the panel has to sniff.
    expect(cardWith({
      id: 'plex:676040',
      title: 'Rhythm Improvisation with Chords',
      thumbnail: '/api/v1/proxy/plex/library/metadata/676052/thumb/1783605320',
    }).artwork).toEqual({
      kind: 'lesson-thumbnail',
      path: '/api/v1/proxy/plex/library/metadata/676052/thumb/1783605320',
    });
  });

  it('omits both outright for a lesson that has neither', () => {
    const node = cardWith({ id: 'unit-14', title: 'Fractions worksheet' });
    expect(node).toEqual({ id: 'unit-14', title: 'Fractions worksheet' });
    expect('artwork' in node).toBe(false);
    expect('description' in node).toBe(false);
  });

  it('omits an empty or blank description rather than shipping ""', () => {
    // An empty string is a picture the panel reserves room for and never draws.
    const node = cardWith({ id: 'u1', title: 'Lesson', description: '   \r\n  ', thumbnail: '' });
    expect('description' in node).toBe(false);
    expect('artwork' in node).toBe(false);
  });

  it('drops a thumbnail that is not a path this origin can serve', () => {
    // A direct Plex URL carries no credentials a kiosk holds; a broken image is
    // worse than no image.
    expect('artwork' in cardWith({
      id: 'u1', title: 'Lesson', thumbnail: 'http://10.0.0.5:32400/library/metadata/1/thumb',
    })).toBe(false);
  });

  it('normalises CRLF so no browser is handed raw Windows line endings', () => {
    expect(cardWith({
      id: 'plex:1',
      title: 'Lesson 1',
      description: 'How to find high and low notes\r\nPattern of 2 and 3 black keys\r\nYour first song',
    }).description).toBe('How to find high and low notes\nPattern of 2 and 3 black keys\nYour first song');
  });

  it('collapses a run of blank lines instead of padding the card with air', () => {
    expect(cardWith({ id: 'plex:1', title: 'L', description: 'One\r\n\r\n\r\n\r\nTwo' }).description)
      .toBe('One\n\nTwo');
  });

  it('caps a long summary at a word boundary and says it was cut', () => {
    const long = `${'word '.repeat(200)}end`;
    const description = cardWith({ id: 'plex:1', title: 'L', description: long }).description;
    expect(description.length).toBeLessThanOrEqual(401);
    expect(description.endsWith('…')).toBe(true);
    expect(description).not.toMatch(/ …$/);
  });

  it('leaves a summary that already fits completely untouched', () => {
    const short = 'How to find high and low notes on your piano';
    expect(cardWith({ id: 'plex:1', title: 'L', description: short }).description).toBe(short);
  });
});
