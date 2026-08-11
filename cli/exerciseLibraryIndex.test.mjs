import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildExerciseIndex } from './exerciseLibraryIndex.lib.mjs';

// Resolved from this file, not from cwd — vitest may be invoked from anywhere.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(REPO_ROOT, 'tests/_fixtures/exercise-library');
const DEFECTS = path.join(REPO_ROOT, 'tests/_fixtures/exercise-library-defects');
const ABSENT = path.join(REPO_ROOT, 'tests/_fixtures/exercise-library-does-not-exist');

const WARNING_KEYS = ['kind', 'subject', 'referrer', 'referencedBy', 'count'];

describe('buildExerciseIndex', () => {
  describe('records', () => {
    it('indexes every exercise by slug, in sorted order', () => {
      const index = buildExerciseIndex(FIXTURE);
      // Not sorted by the test: the builder guarantees deterministic key order.
      expect(Object.keys(index.exercises)).toEqual([
        'barbell-bench-press', 'push-up', 'sit-up-kneeling',
      ]);
      expect(index.exercises['push-up'].name).toBe('Push-Up');
      expect(index.exercises['push-up'].instructions).toHaveLength(3);
    });

    it('carries the muscle anatomy essay through for School', () => {
      const index = buildExerciseIndex(FIXTURE);
      expect(index.muscles.pectorals.fullDescription).toContain('anatomy essay');
    });

    it('defaults a missing equipment id to null, like every other record', () => {
      const index = buildExerciseIndex(FIXTURE);
      expect(index.equipment.barbell.id).toBe('barbell');
      expect(index.muscleGroups.chest.name).toBe('Chest');
    });

    it('is deterministic across rebuilds', () => {
      const a = buildExerciseIndex(FIXTURE, { builtAt: 'fixed' });
      const b = buildExerciseIndex(FIXTURE, { builtAt: 'fixed' });
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it('injects builtAt rather than reading a clock, and stamps a version', () => {
      const index = buildExerciseIndex(FIXTURE, { builtAt: '2026-01-01T00:00:00Z' });
      expect(index.builtAt).toBe('2026-01-01T00:00:00Z');
      expect(index.version).toBe(1);
      expect(buildExerciseIndex(FIXTURE).builtAt).toBeNull();
    });
  });

  describe('asset resolution', () => {
    it('resolves the demo image uuid to a real asset path', () => {
      const index = buildExerciseIndex(FIXTURE);
      expect(index.exercises['push-up'].image)
        .toBe('assets/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.gif');
      expect(index.exercises['push-up'].imageId)
        .toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    });

    it('resolves a muscle plate to its png', () => {
      const index = buildExerciseIndex(FIXTURE);
      expect(index.muscles.pectorals.image)
        .toBe('assets/cccccccc-cccc-cccc-cccc-cccccccccccc.png');
    });

    it('returns null — not a fabricated path — when an asset is absent', () => {
      const index = buildExerciseIndex(FIXTURE);
      // barbell-bench-press references bbbb…, which has no file in assets/.
      expect(index.exercises['barbell-bench-press'].image).toBeNull();
      expect(index.warnings).toContainEqual(expect.objectContaining({
        kind: 'missing-asset',
        subject: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        referencedBy: 'barbell-bench-press',
      }));
    });

    it('reports assetsResolved so the adapter knows if paths are authoritative', () => {
      expect(buildExerciseIndex(FIXTURE).assetsResolved).toBe(true);
      expect(buildExerciseIndex(DEFECTS).assetsResolved).toBe(false);
    });

    it('warns when the assets directory is missing entirely', () => {
      const index = buildExerciseIndex(DEFECTS);
      expect(index.warnings).toContainEqual(
        expect.objectContaining({ kind: 'missing-assets-directory' })
      );
    });
  });

  describe('group derivation', () => {
    it('derives group membership from muscle records, not exercise hints', () => {
      const index = buildExerciseIndex(FIXTURE);
      expect(index.byGroup.chest).toEqual(['barbell-bench-press', 'push-up']);
    });

    it('records unresolvable groups instead of throwing', () => {
      const index = buildExerciseIndex(FIXTURE);
      expect(index.warnings).toContainEqual(
        expect.objectContaining({ kind: 'unknown-group', subject: 'core' })
      );
      expect(index.byGroup.core).toBeUndefined();
    });

    it('leaves an exercise whose only muscle is orphaned in zero groups', () => {
      const index = buildExerciseIndex(FIXTURE);
      expect(index.byMuscle.abs).toEqual(['sit-up-kneeling']);
      expect(index.exercises['sit-up-kneeling'].groups).toEqual([]);
      for (const members of Object.values(index.byGroup)) {
        expect(members).not.toContain('sit-up-kneeling');
      }
    });

    it('indexes by muscle and by equipment', () => {
      const index = buildExerciseIndex(FIXTURE);
      expect(index.byMuscle.pectorals).toEqual(['barbell-bench-press', 'push-up']);
      expect(index.byEquipment.barbell).toEqual(['barbell-bench-press']);
    });
  });

  describe('media beyond the demo asset', () => {
    it('matches hevy videos to exercise slugs, normalizing parentheses', () => {
      const index = buildExerciseIndex(FIXTURE);
      expect(index.exercises['push-up'].video).toBe('hevy_videos/Push-Up_Chest.mp4');
      // `Sit-up-(kneeling)_Waist.mp4` -> slug `sit-up-kneeling`
      expect(index.exercises['sit-up-kneeling'].video)
        .toBe('hevy_videos/Sit-up-(kneeling)_Waist.mp4');
      expect(index.exercises['barbell-bench-press'].video).toBeNull();
    });

    it('warns about videos with no matching exercise', () => {
      const index = buildExerciseIndex(FIXTURE);
      expect(index.warnings).toContainEqual(expect.objectContaining({
        kind: 'unmatched-video',
        subject: 'Unknown-Movement_Waist.mp4',
      }));
    });

    it('indexes the per-exercise stills', () => {
      const index = buildExerciseIndex(FIXTURE);
      expect(index.exercises['push-up'].stills)
        .toEqual(['exercises/push-up_1.png', 'exercises/push-up_2.png']);
      expect(index.exercises['barbell-bench-press'].stills).toEqual([]);
    });
  });

  describe('hostile and defective corpora', () => {
    it('survives slugs that collide with Object.prototype members', () => {
      // Plain-object maps make `map['constructor']` truthy (inherited function)
      // and swallow `map['__proto__']` writes entirely.
      const index = buildExerciseIndex(DEFECTS);
      expect(index.byMuscle.constructor).toEqual(['hostile']);
      expect(index.byMuscle.__proto__).toEqual(['hostile']);
      expect(index.byEquipment.toString).toEqual(['hostile']);
      expect(index.byGroup.chest).toEqual(['hostile']);
      expect(index.muscles.constructor.name).toBe('Constructor');
    });

    it('keeps one record when two files collapse to the same slug', () => {
      const index = buildExerciseIndex(DEFECTS);
      expect(index.exercises.dup.name).toBe('Dup From Yaml');
      expect(index.warnings).toContainEqual(
        expect.objectContaining({ kind: 'duplicate-record', subject: 'dup' })
      );
    });

    it('rejects a non-scalar where a scalar belongs', () => {
      const index = buildExerciseIndex(DEFECTS);
      expect(index.exercises['bad-scalars'].imageId).toBeNull();
      expect(index.exercises['bad-scalars'].image).toBeNull();
      expect(index.warnings).toContainEqual(expect.objectContaining({
        kind: 'non-scalar-field', subject: 'image', referencedBy: 'bad-scalars',
      }));
    });

    it('warns when a sequence field coerces to empty', () => {
      const index = buildExerciseIndex(DEFECTS);
      expect(index.exercises['bad-scalars'].instructions).toEqual([]);
      expect(index.warnings).toContainEqual(expect.objectContaining({
        kind: 'empty-field', subject: 'instructions', referencedBy: 'bad-scalars',
      }));
    });

    it('warns about a document that is not a mapping', () => {
      const index = buildExerciseIndex(DEFECTS);
      expect(index.exercises.unreadable).toBeUndefined();
      expect(index.warnings).toContainEqual(
        expect.objectContaining({ kind: 'unreadable-record', subject: 'unreadable.yaml' })
      );
    });

    it('tolerates a corpus directory that does not exist', () => {
      const index = buildExerciseIndex(ABSENT);
      expect(index.exercises).toEqual({});
      expect(index.warnings).toContainEqual(
        expect.objectContaining({ kind: 'missing-directory', subject: 'exercises' })
      );
    });
  });

  describe('warning shape', () => {
    it('normalizes every warning to one skeleton', () => {
      const all = [
        ...buildExerciseIndex(FIXTURE).warnings,
        ...buildExerciseIndex(DEFECTS).warnings,
        ...buildExerciseIndex(ABSENT).warnings,
      ];
      expect(all.length).toBeGreaterThan(5);
      for (const warning of all) {
        expect(Object.keys(warning)).toEqual(WARNING_KEYS);
        expect(typeof warning.kind).toBe('string');
        expect(typeof warning.count).toBe('number');
        expect(warning.count).toBeGreaterThanOrEqual(1);
      }
    });

    it('counts distinct referencing records, not repeated references', () => {
      // `core` is referenced by muscle abs (group:) and by sit-up-kneeling's
      // target_groups hint — different referrers, so two entries of count 1.
      const index = buildExerciseIndex(FIXTURE);
      const core = index.warnings.filter(
        (w) => w.kind === 'unknown-group' && w.subject === 'core'
      );
      expect(core.map((w) => w.referrer).sort()).toEqual(['exercise', 'muscle']);
      for (const w of core) expect(w.count).toBe(1);
    });
  });
});
