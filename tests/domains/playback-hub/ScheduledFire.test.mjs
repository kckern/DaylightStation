import { describe, it, expect } from 'vitest';
import { ScheduledFire } from '../../../backend/src/2_domains/playback-hub/entities/ScheduledFire.mjs';
import { DayPattern } from '../../../backend/src/2_domains/playback-hub/value-objects/DayPattern.mjs';
import { QueueRef } from '../../../backend/src/2_domains/playback-hub/value-objects/QueueRef.mjs';
import { VolumeBounds } from '../../../backend/src/2_domains/playback-hub/value-objects/VolumeBounds.mjs';
import { ValidationError } from '../../../backend/src/2_domains/core/errors/ValidationError.mjs';
import { DomainInvariantError } from '../../../backend/src/2_domains/core/errors/DomainInvariantError.mjs';
import { EntityNotFoundError } from '../../../backend/src/2_domains/core/errors/EntityNotFoundError.mjs';

const validArgs = (overrides = {}) => ({
  id: 'morning-wakeup',
  time: '07:00',
  days: new DayPattern('weekdays'),
  target: 'red',
  queue: new QueueRef({ source: 'plex', id: '670208' }),
  durationMin: null,
  volumeOverride: null,
  ...overrides
});

describe('ScheduledFire', () => {
  describe('constructor', () => {
    it('constructs with valid inputs', () => {
      const f = new ScheduledFire(validArgs());
      expect(f.id).toBe('morning-wakeup');
      expect(f.time).toBe('07:00');
      expect(f.days).toBeInstanceOf(DayPattern);
      expect(f.target).toBe('red');
      expect(f.queue).toBeInstanceOf(QueueRef);
      expect(f.durationMin).toBeNull();
      expect(f.volumeOverride).toBeNull();
    });

    it('rejects empty id', () => {
      expect(() => new ScheduledFire(validArgs({ id: '' }))).toThrow(ValidationError);
    });
    it('rejects non-string id', () => {
      expect(() => new ScheduledFire(validArgs({ id: 42 }))).toThrow(ValidationError);
      expect(() => new ScheduledFire(validArgs({ id: null }))).toThrow(ValidationError);
    });

    it('rejects bad time format', () => {
      expect(() => new ScheduledFire(validArgs({ time: '25:00' }))).toThrow(ValidationError);
      expect(() => new ScheduledFire(validArgs({ time: '7:00' }))).toThrow(ValidationError);
      expect(() => new ScheduledFire(validArgs({ time: '07:5' }))).toThrow(ValidationError);
      expect(() => new ScheduledFire(validArgs({ time: null }))).toThrow(ValidationError);
    });

    it('rejects non-DayPattern days', () => {
      expect(() => new ScheduledFire(validArgs({ days: 'weekdays' }))).toThrow(ValidationError);
      expect(() => new ScheduledFire(validArgs({ days: ['mon', 'wed'] }))).toThrow(ValidationError);
    });

    it('rejects empty/non-string target', () => {
      expect(() => new ScheduledFire(validArgs({ target: '' }))).toThrow(ValidationError);
      expect(() => new ScheduledFire(validArgs({ target: 42 }))).toThrow(ValidationError);
      expect(() => new ScheduledFire(validArgs({ target: null }))).toThrow(ValidationError);
    });

    it('rejects non-QueueRef queue', () => {
      expect(() => new ScheduledFire(validArgs({ queue: 'plex:1' }))).toThrow(ValidationError);
      expect(() => new ScheduledFire(validArgs({ queue: null }))).toThrow(ValidationError);
    });

    describe('durationMin', () => {
      it('accepts null', () => {
        expect(new ScheduledFire(validArgs({ durationMin: null })).durationMin).toBeNull();
      });
      it('accepts positive integer', () => {
        expect(new ScheduledFire(validArgs({ durationMin: 30 })).durationMin).toBe(30);
      });
      it('rejects 0', () => {
        expect(() => new ScheduledFire(validArgs({ durationMin: 0 }))).toThrow(ValidationError);
      });
      it('rejects negative / floats / strings', () => {
        expect(() => new ScheduledFire(validArgs({ durationMin: -1 }))).toThrow(ValidationError);
        expect(() => new ScheduledFire(validArgs({ durationMin: 1.5 }))).toThrow(ValidationError);
        expect(() => new ScheduledFire(validArgs({ durationMin: '30' }))).toThrow(ValidationError);
      });
    });

    describe('volumeOverride', () => {
      it('accepts null', () => {
        expect(new ScheduledFire(validArgs({ volumeOverride: null })).volumeOverride).toBeNull();
      });
      it('accepts 0 and 100 (edges)', () => {
        expect(new ScheduledFire(validArgs({ volumeOverride: 0 })).volumeOverride).toBe(0);
        expect(new ScheduledFire(validArgs({ volumeOverride: 100 })).volumeOverride).toBe(100);
      });
      it('rejects out of range', () => {
        expect(() => new ScheduledFire(validArgs({ volumeOverride: -1 }))).toThrow(ValidationError);
        expect(() => new ScheduledFire(validArgs({ volumeOverride: 101 }))).toThrow(ValidationError);
      });
      it('rejects non-number', () => {
        expect(() => new ScheduledFire(validArgs({ volumeOverride: '50' }))).toThrow(ValidationError);
      });
    });
  });

  describe('validate(slotsByColor)', () => {
    const makeDevice = ({ color = 'red', volumeMax = 100 } = {}) => ({
      color,
      volumeBounds: new VolumeBounds({ max: volumeMax })
    });

    it('passes when target exists and no volume override', () => {
      const fire = new ScheduledFire(validArgs({ target: 'red' }));
      const slots = new Map([['red', makeDevice({ color: 'red', volumeMax: 100 })]]);
      expect(() => fire.validate(slots)).not.toThrow();
    });

    it('throws EntityNotFoundError if target color not in map', () => {
      const fire = new ScheduledFire(validArgs({ target: 'orange' }));
      const slots = new Map([['red', makeDevice({ color: 'red' })]]);
      expect(() => fire.validate(slots)).toThrow(EntityNotFoundError);
    });

    it('throws DomainInvariantError if volumeOverride > target.volumeBounds.max', () => {
      const fire = new ScheduledFire(validArgs({ target: 'red', volumeOverride: 90 }));
      const slots = new Map([['red', makeDevice({ color: 'red', volumeMax: 70 })]]);
      expect(() => fire.validate(slots)).toThrow(DomainInvariantError);
    });

    it('passes when volumeOverride equals target max (boundary)', () => {
      const fire = new ScheduledFire(validArgs({ target: 'red', volumeOverride: 70 }));
      const slots = new Map([['red', makeDevice({ color: 'red', volumeMax: 70 })]]);
      expect(() => fire.validate(slots)).not.toThrow();
    });

    it('passes when volumeOverride is null even if max is low', () => {
      const fire = new ScheduledFire(validArgs({ target: 'red', volumeOverride: null }));
      // Use raw object to bypass VolumeBounds invariant — we just need a device with a max number.
      const slots = new Map([['red', { color: 'red', volumeBounds: { max: 10 } }]]);
      expect(() => fire.validate(slots)).not.toThrow();
    });
  });

  it('is frozen', () => {
    expect(Object.isFrozen(new ScheduledFire(validArgs()))).toBe(true);
  });
});
