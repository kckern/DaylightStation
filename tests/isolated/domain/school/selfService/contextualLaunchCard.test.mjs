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
