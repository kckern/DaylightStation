import { describe, it, expect } from 'vitest';
import { DailyCoachingEntry } from '../../../../backend/src/2_domains/health/entities/DailyCoachingEntry.mjs';

// Synthetic schemas used across tests. Keys + field names are illustrative
// only; the entity is supposed to be generic over whatever the playbook
// declares. Tests parameterize on `dimensionsSchema` to prove the entity
// doesn't bake in any specific dimension names.

const BOOLEAN_DIM = {
  key: 'morning_meditation',
  type: 'boolean',
  label: 'Morning meditation',
  fields: {
    taken: { type: 'boolean', required: true },
    timestamp: { type: 'string', required: false },
    minutes: { type: 'integer', required: false, min: 0 },
  },
};

const NUMERIC_DIM = {
  key: 'mobility_drill',
  type: 'numeric',
  label: 'Mobility drill',
  fields: {
    movement: { type: 'string', required: true },
    reps: { type: 'integer', required: true, min: 0 },
  },
  average_field: 'reps',
};

const TEXT_DIM = {
  key: 'reflection',
  type: 'text',
  label: 'Reflection',
  fields: {
    value: { type: 'string', required: true, max_length: 200 },
  },
};

const FULL_SCHEMA = [BOOLEAN_DIM, NUMERIC_DIM, TEXT_DIM];

describe('DailyCoachingEntry', () => {
  describe('schema-driven validation', () => {
    it('parses object containing all three dimension types', () => {
      const entry = new DailyCoachingEntry({
        morning_meditation: { taken: true, timestamp: '07:15', minutes: 15 },
        mobility_drill: { movement: 'cossack_squat', reps: 12 },
        reflection: 'felt heavy',
      }, FULL_SCHEMA);
      expect(entry.get('morning_meditation')).toEqual({ taken: true, timestamp: '07:15', minutes: 15 });
      expect(entry.get('mobility_drill')).toEqual({ movement: 'cossack_squat', reps: 12 });
      expect(entry.get('reflection')).toBe('felt heavy');
    });

    it('boolean dim: only the required boolean field need be present (others optional)', () => {
      const entry = new DailyCoachingEntry({ morning_meditation: { taken: true } }, FULL_SCHEMA);
      expect(entry.get('morning_meditation')).toEqual({ taken: true });
      expect(entry.get('mobility_drill')).toBeNull();
      expect(entry.get('reflection')).toBeNull();
    });

    it('text dim: bare string accepted, trimmed', () => {
      const entry = new DailyCoachingEntry({ reflection: '   felt heavy   ' }, FULL_SCHEMA);
      expect(entry.get('reflection')).toBe('felt heavy');
    });

    it('text dim: empty/whitespace-only string collapses to null', () => {
      const entry = new DailyCoachingEntry({ reflection: '   ' }, FULL_SCHEMA);
      expect(entry.get('reflection')).toBeNull();
    });

    it('accepts an empty coaching object (all sections optional)', () => {
      const entry = new DailyCoachingEntry({}, FULL_SCHEMA);
      expect(entry.get('morning_meditation')).toBeNull();
      expect(entry.get('mobility_drill')).toBeNull();
      expect(entry.get('reflection')).toBeNull();
      expect(entry.serialize()).toEqual({});
    });

    it('rejects unknown top-level keys (defense against typos)', () => {
      expect(
        () => new DailyCoachingEntry({ morning_meditatoin: { taken: true } }, FULL_SCHEMA)
      ).toThrow(/unknown top-level key/);
      expect(
        () => new DailyCoachingEntry({ random_key: 'x' }, FULL_SCHEMA)
      ).toThrow(/unknown top-level key/);
    });

    it('rejects unknown sub-keys on a boolean dimension', () => {
      expect(
        () => new DailyCoachingEntry(
          { morning_meditation: { taken: true, oops: 1 } },
          FULL_SCHEMA,
        )
      ).toThrow(/unknown key/);
    });

    it('rejects unknown sub-keys on a numeric dimension', () => {
      expect(
        () => new DailyCoachingEntry(
          { mobility_drill: { movement: 'a', reps: 5, extra: 'x' } },
          FULL_SCHEMA,
        )
      ).toThrow(/unknown key/);
    });

    it('numeric dim: required integer field rejects negatives, non-integers, strings', () => {
      const make = (raw) => new DailyCoachingEntry({ mobility_drill: raw }, FULL_SCHEMA);
      expect(() => make({ movement: 'a', reps: -1 })).toThrow(/reps/);
      expect(() => make({ movement: 'a', reps: 1.5 })).toThrow(/reps/);
      expect(() => make({ movement: 'a', reps: 'three' })).toThrow(/reps/);
      // sanity: 0 is allowed (non-negative)
      const ok = make({ movement: 'a', reps: 0 });
      expect(ok.get('mobility_drill').reps).toBe(0);
    });

    it('boolean dim: strict (rejects string "true"/"false")', () => {
      expect(
        () => new DailyCoachingEntry(
          { morning_meditation: { taken: 'true' } },
          FULL_SCHEMA,
        )
      ).toThrow(/boolean/);
      expect(
        () => new DailyCoachingEntry(
          { morning_meditation: { taken: 'false' } },
          FULL_SCHEMA,
        )
      ).toThrow(/boolean/);
      expect(
        () => new DailyCoachingEntry({ morning_meditation: {} }, FULL_SCHEMA)
      ).toThrow(/required/);
      const ok = new DailyCoachingEntry({ morning_meditation: { taken: false } }, FULL_SCHEMA);
      expect(ok.get('morning_meditation')).toEqual({ taken: false });
    });

    it('text dim: rejects strings exceeding max_length', () => {
      const longString = 'x'.repeat(201);
      expect(
        () => new DailyCoachingEntry({ reflection: longString }, FULL_SCHEMA)
      ).toThrow(/200/);
    });

    it('numeric dim: required string field rejects empty string', () => {
      expect(
        () => new DailyCoachingEntry(
          { mobility_drill: { movement: '', reps: 5 } },
          FULL_SCHEMA,
        )
      ).toThrow(/movement/);
    });

    it('serialize() returns the shape ready for YAML write', () => {
      const entry = new DailyCoachingEntry({
        morning_meditation: { taken: true, timestamp: '07:15' },
        mobility_drill: { movement: 'cossack_squat', reps: 12 },
        reflection: 'felt heavy',
      }, FULL_SCHEMA);
      expect(entry.serialize()).toEqual({
        morning_meditation: { taken: true, timestamp: '07:15' },
        mobility_drill: { movement: 'cossack_squat', reps: 12 },
        reflection: 'felt heavy',
      });

      const partial = new DailyCoachingEntry({ reflection: 'only note' }, FULL_SCHEMA);
      expect(partial.serialize()).toEqual({ reflection: 'only note' });

      const empty = new DailyCoachingEntry({}, FULL_SCHEMA);
      expect(empty.serialize()).toEqual({});
    });

    it('arbitrary dimension keys are accepted (no hardcoded names)', () => {
      const customSchema = [
        {
          key: 'cold_exposure',
          type: 'numeric',
          fields: {
            duration_min: { type: 'integer', required: true, min: 0 },
          },
          average_field: 'duration_min',
        },
        {
          key: 'water_intake_oz',
          type: 'numeric',
          fields: {
            ounces: { type: 'integer', required: true, min: 0 },
          },
          average_field: 'ounces',
        },
      ];
      const entry = new DailyCoachingEntry({
        cold_exposure: { duration_min: 3 },
        water_intake_oz: { ounces: 80 },
      }, customSchema);
      expect(entry.get('cold_exposure')).toEqual({ duration_min: 3 });
      expect(entry.get('water_intake_oz')).toEqual({ ounces: 80 });
    });
  });

  describe('trust mode (no schema)', () => {
    it('accepts an arbitrary plain object when no schema is provided', () => {
      const entry = new DailyCoachingEntry({
        anything: { foo: 'bar' },
        another: 42,
      });
      expect(entry.serialize()).toEqual({ anything: { foo: 'bar' }, another: 42 });
    });

    it('accepts an arbitrary plain object when schema is empty array', () => {
      const entry = new DailyCoachingEntry({ x: 'y' }, []);
      expect(entry.serialize()).toEqual({ x: 'y' });
    });

    it('still rejects non-plain-object inputs', () => {
      expect(() => new DailyCoachingEntry([1, 2, 3])).toThrow(/object/);
    });

    it('emits a warn event when running in trust mode', () => {
      const warnCalls = [];
      const logger = {
        warn: (event, data) => warnCalls.push([event, data]),
      };
      const entry = new DailyCoachingEntry({ key: 'val' }, null, { logger });
      expect(entry.serialize()).toEqual({ key: 'val' });
      expect(warnCalls.length).toBe(1);
      expect(warnCalls[0][0]).toBe('daily_coaching_entry.trust_mode');
    });
  });
});
