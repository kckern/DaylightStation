import { describe, it, expect } from 'vitest';
import path from 'path';
import { buildExerciseIndex } from './exerciseLibraryIndex.lib.mjs';

const FIXTURE = path.resolve('tests/_fixtures/exercise-library');

describe('buildExerciseIndex', () => {
  it('indexes every exercise by slug', () => {
    const index = buildExerciseIndex(FIXTURE);
    expect(Object.keys(index.exercises).sort()).toEqual(['barbell-bench-press', 'push-up']);
    expect(index.exercises['push-up'].name).toBe('Push-Up');
    expect(index.exercises['push-up'].instructions).toHaveLength(3);
  });

  it('resolves the demo image uuid to an asset path', () => {
    const index = buildExerciseIndex(FIXTURE);
    expect(index.exercises['push-up'].gif).toBe('assets/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.gif');
  });

  it('derives group membership from muscle records, not exercise hints', () => {
    const index = buildExerciseIndex(FIXTURE);
    expect(index.byGroup.chest.sort()).toEqual(['barbell-bench-press', 'push-up']);
  });

  it('records unresolvable groups instead of throwing', () => {
    const index = buildExerciseIndex(FIXTURE);
    expect(index.warnings).toContainEqual(
      expect.objectContaining({ kind: 'unknown-group', group: 'core' })
    );
    expect(index.byGroup.core).toBeUndefined();
  });

  it('indexes by muscle and by equipment', () => {
    const index = buildExerciseIndex(FIXTURE);
    expect(index.byMuscle.pectorals.sort()).toEqual(['barbell-bench-press', 'push-up']);
    expect(index.byEquipment.barbell).toEqual(['barbell-bench-press']);
  });

  it('carries the muscle anatomy essay through for School', () => {
    const index = buildExerciseIndex(FIXTURE);
    expect(index.muscles.pectorals.fullDescription).toContain('anatomy essay');
  });
});
