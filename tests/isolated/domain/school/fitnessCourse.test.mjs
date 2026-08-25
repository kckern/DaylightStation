import { describe, expect, it } from 'vitest';
import {
  compileFitnessCourse,
  defaultFitnessSuccessPolicy,
  validateFitnessCourse,
} from '#domains/school/fitnessCourse.mjs';

const minimal = (over = {}) => ({
  schema: 'school.fitness-course/v1',
  work: 'bike-basics',
  title: 'Bike Basics',
  subject: 'skills',
  source: { adapter: 'plex', showId: '700' },
  grades: ['upper'],
  ...over,
});

const source = {
  items: [
    { id: '101', title: 'Getting Started', duration: 600, metadata: { parentId: '1', parentTitle: 'Foundations', parentIndex: 1, index: 1 } },
    { id: '102', title: 'Cadence', duration: 720, metadata: { parentId: '1', parentTitle: 'Foundations', parentIndex: 1, index: 2 } },
    { id: '201', title: 'Intervals', duration: 900, metadata: { parentId: '2', parentTitle: 'Build', parentIndex: 2, index: 1 } },
  ],
};

describe('school.fitness-course/v1', () => {
  it('turns a Plex show into an ordinary School work and sequential activity units', () => {
    const { errors, projection } = compileFitnessCourse(minimal(), source, { subject: 'skills', work: 'bike-basics' });
    expect(errors).toEqual([]);
    expect(projection.work).toMatchObject({
      work: 'bike-basics', subject: 'skills', category: 'course', medium: 'app',
      structure: { shape: 'modules', items: { from: 'units', order: 'sequence' } },
    });
    expect(projection.work.modules).toEqual([
      { module: 'foundations', title: 'Foundations' },
      { module: 'build', title: 'Build' },
    ]);
    expect(projection.units).toHaveLength(3);
    expect(projection.units[0]).toMatchObject({
      unitId: 'bike-basics.101', courseId: 'bike-basics', sequence: 1, module: 'foundations',
      activity: {
        provider: 'fitness', source: { adapter: 'plex', showId: '700' },
        segments: [{ kind: 'plex-video', sourceId: '101', durationSeconds: 600 }],
        successPolicy: defaultFitnessSuccessPolicy(),
      },
    });
  });

  it('uses the same schema for custom grouping, warmup/cooldown segments, and cycling gates', () => {
    const policy = {
      all: [
        { metric: 'media.completion_ratio', op: 'gte', value: 0.8 },
        { metric: 'cadence.average_rpm', op: 'gte', value: 70 },
        { metric: 'heart_rate.seconds_in_zone', zone: 'vigorous', op: 'gte', value: 300 },
      ],
    };
    const config = minimal({
      modules: [{ module: 'block-a', title: 'Block A' }],
      mapping: { include: ['102'], groups: [{ module: 'block-a', sourceIds: ['102'] }] },
      defaults: {
        prepend: [{ id: 'warmup', role: 'warmup', kind: 'sensor-block', durationSeconds: 180 }],
        append: [{ id: 'reflect', role: 'reflection', kind: 'voice-reflection' }],
        success: policy,
      },
      units: [{ id: 'cadence-day', sourceId: '102', segments: [{ kind: 'plex-video' }] }],
    });
    const { errors, projection } = compileFitnessCourse(config, source);
    expect(errors).toEqual([]);
    expect(projection.units[0]).toMatchObject({
      unitId: 'bike-basics.cadence-day', module: 'block-a',
      activity: {
        segments: [
          { id: 'warmup', role: 'warmup', kind: 'sensor-block' },
          { kind: 'plex-video', sourceId: '102', durationSeconds: 720 },
          { id: 'reflect', role: 'reflection', kind: 'voice-reflection' },
        ],
        successPolicy: policy,
      },
    });
  });

  it('produces stable course and policy revisions for the same source/config', () => {
    const first = compileFitnessCourse(minimal(), source).projection;
    const second = compileFitnessCourse(minimal(), structuredClone(source)).projection;
    expect(second.courseRevision).toBe(first.courseRevision);
    expect(second.units[0].activity.policyRevision).toBe(first.units[0].activity.policyRevision);
  });

  it('uses School dated-module grammar when the course configuration schedules blocks', () => {
    const result = compileFitnessCourse(minimal({
      progression: { module_order: 'fixed', lesson_order: 'fixed', mode: 'dated_modules' },
      modules: [
        { module: 'week-one', title: 'Week One', opensOn: '2026-09-01', closesOn: '2026-09-07' },
        { module: 'week-two', title: 'Week Two', opensOn: '2026-09-08', closesOn: '2026-09-14' },
      ],
      mapping: { groups: [
        { module: 'week-one', sourceIds: ['101', '102'] },
        { module: 'week-two', sourceIds: ['201'] },
      ] },
    }), source);
    expect(result.errors).toEqual([]);
    expect(result.projection.work).toMatchObject({
      progression: { mode: 'dated_modules' },
      modules: [
        { module: 'week-one', opensOn: '2026-09-01', closesOn: '2026-09-07' },
        { module: 'week-two', opensOn: '2026-09-08', closesOn: '2026-09-14' },
      ],
    });
  });

  it('rejects invalid criteria and a shelf/directory vocabulary mismatch', () => {
    const raw = minimal({ defaults: { success: { metric: 'effort.vibes', op: 'gte', value: 1 } } });
    const result = validateFitnessCourse(raw, { subject: 'arts', work: 'another-course' });
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('directory'),
      expect.stringContaining('shelf'),
      expect.stringContaining('metric is unsupported'),
    ]));
  });

  it('rejects mappings to undeclared modules and unselected provider items', () => {
    const result = compileFitnessCourse(minimal({
      modules: [{ module: 'only', title: 'Only' }],
      mapping: { include: ['101'], groups: [{ module: 'ghost', sourceIds: ['201'] }] },
    }), source);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('is not declared'),
      expect.stringContaining('is not selected'),
    ]));
  });
});
