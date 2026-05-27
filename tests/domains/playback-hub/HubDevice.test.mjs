import { describe, it, expect } from 'vitest';
import { HubDevice } from '../../../backend/src/2_domains/playback-hub/entities/HubDevice.mjs';
import { SlotPosition } from '../../../backend/src/2_domains/playback-hub/value-objects/SlotPosition.mjs';
import { SlotColor } from '../../../backend/src/2_domains/playback-hub/value-objects/SlotColor.mjs';
import { SlotClass } from '../../../backend/src/2_domains/playback-hub/value-objects/SlotClass.mjs';
import { VolumeBounds } from '../../../backend/src/2_domains/playback-hub/value-objects/VolumeBounds.mjs';
import { ContinuousSchedule } from '../../../backend/src/2_domains/playback-hub/value-objects/ContinuousSchedule.mjs';
import { QueueRef } from '../../../backend/src/2_domains/playback-hub/value-objects/QueueRef.mjs';
import { ValidationError } from '../../../backend/src/2_domains/core/errors/ValidationError.mjs';
import { DomainInvariantError } from '../../../backend/src/2_domains/core/errors/DomainInvariantError.mjs';

const validArgs = (overrides = {}) => ({
  position: new SlotPosition(1),
  color: new SlotColor('red'),
  mac: '41:42:3A:E5:43:07',
  class: new SlotClass('private'),
  haEntityId: null,
  haTurnOffOnStop: false,
  volumeBounds: new VolumeBounds({}),
  continuousSchedules: [],
  ...overrides
});

describe('HubDevice', () => {
  describe('construction', () => {
    it('accepts a valid private device with no HA entity', () => {
      const d = new HubDevice(validArgs());
      expect(d.position).toBeInstanceOf(SlotPosition);
      expect(d.color).toBeInstanceOf(SlotColor);
      expect(d.mac).toBe('41:42:3A:E5:43:07');
      expect(d.class).toBeInstanceOf(SlotClass);
      expect(d.haEntityId).toBeNull();
      expect(d.haTurnOffOnStop).toBe(false);
      expect(d.volumeBounds).toBeInstanceOf(VolumeBounds);
      expect(d.continuousSchedules).toEqual([]);
    });

    it('accepts a valid public device WITH ha_entity_id', () => {
      const d = new HubDevice(validArgs({
        color: new SlotColor('white'),
        class: new SlotClass('public'),
        haEntityId: 'media_player.living_room'
      }));
      expect(d.class.isPublic).toBe(true);
      expect(d.haEntityId).toBe('media_player.living_room');
    });

    it('invariant: public class REQUIRES haEntityId (DomainInvariantError)', () => {
      expect(() => new HubDevice(validArgs({
        color: new SlotColor('white'),
        class: new SlotClass('public'),
        haEntityId: null
      }))).toThrow(DomainInvariantError);
    });

    it('rejects non-VO position', () => {
      expect(() => new HubDevice(validArgs({ position: 1 }))).toThrow(ValidationError);
    });
    it('rejects non-VO color', () => {
      expect(() => new HubDevice(validArgs({ color: 'red' }))).toThrow(ValidationError);
    });
    it('rejects non-VO class', () => {
      expect(() => new HubDevice(validArgs({ class: 'private' }))).toThrow(ValidationError);
    });
    it('rejects non-VO volumeBounds', () => {
      expect(() => new HubDevice(validArgs({ volumeBounds: { default: 60, min: 0, max: 100 } }))).toThrow(ValidationError);
    });
    it('rejects empty mac', () => {
      expect(() => new HubDevice(validArgs({ mac: '' }))).toThrow(ValidationError);
    });
    it('rejects non-string mac', () => {
      expect(() => new HubDevice(validArgs({ mac: null }))).toThrow(ValidationError);
      expect(() => new HubDevice(validArgs({ mac: 42 }))).toThrow(ValidationError);
    });
    it('rejects non-boolean haTurnOffOnStop', () => {
      expect(() => new HubDevice(validArgs({ haTurnOffOnStop: 'yes' }))).toThrow(ValidationError);
    });
    it('rejects non-array continuousSchedules', () => {
      expect(() => new HubDevice(validArgs({ continuousSchedules: null }))).toThrow(ValidationError);
      expect(() => new HubDevice(validArgs({ continuousSchedules: 'morning' }))).toThrow(ValidationError);
    });
    it('rejects continuousSchedules entries that are not ContinuousSchedule', () => {
      expect(() => new HubDevice(validArgs({
        continuousSchedules: [{ start: '07:00' }]
      }))).toThrow(ValidationError);
    });
    it('accepts a continuousSchedules array of VO entries', () => {
      const schedule = new ContinuousSchedule({
        start: '07:00',
        end: '21:00',
        queue: new QueueRef({ source: 'plex', id: '670208' })
      });
      const d = new HubDevice(validArgs({ continuousSchedules: [schedule] }));
      expect(d.continuousSchedules).toHaveLength(1);
      expect(d.continuousSchedules[0]).toBe(schedule);
    });
  });

  describe('update(patch) returns NEW HubDevice', () => {
    it('returns a new instance (immutability)', () => {
      const d = new HubDevice(validArgs());
      const d2 = d.update({ haTurnOffOnStop: true });
      expect(d2).not.toBe(d);
      expect(d2.haTurnOffOnStop).toBe(true);
      expect(d.haTurnOffOnStop).toBe(false);
    });

    it('merges fields from the patch', () => {
      const d = new HubDevice(validArgs());
      const d2 = d.update({ volumeBounds: new VolumeBounds({ max: 70 }) });
      expect(d2.volumeBounds.max).toBe(70);
      expect(d.volumeBounds.max).toBe(100);
    });

    it('re-validates invariant: cannot remove haEntityId from public device', () => {
      const d = new HubDevice(validArgs({
        color: new SlotColor('white'),
        class: new SlotClass('public'),
        haEntityId: 'media_player.lr'
      }));
      expect(() => d.update({ haEntityId: null })).toThrow(DomainInvariantError);
    });

    it('cannot flip private→public without supplying ha_entity_id', () => {
      const d = new HubDevice(validArgs()); // private, no HA
      expect(() => d.update({ class: new SlotClass('public') })).toThrow(DomainInvariantError);
    });

    it('allows class flip private→public when haEntityId also patched in', () => {
      const d = new HubDevice(validArgs());
      const d2 = d.update({ class: new SlotClass('public'), haEntityId: 'media_player.x' });
      expect(d2.class.isPublic).toBe(true);
      expect(d2.haEntityId).toBe('media_player.x');
    });
  });

  describe('toYaml sparse-preserving', () => {
    it('minimal device → minimal YAML (no volume block, no schedules)', () => {
      const d = new HubDevice(validArgs());
      expect(d.toYaml()).toEqual({
        slot: 1,
        color: 'red',
        mac: '41:42:3A:E5:43:07',
        class: 'private'
      });
    });

    it('public device emits ha_entity_id', () => {
      const d = new HubDevice(validArgs({
        color: new SlotColor('white'),
        class: new SlotClass('public'),
        haEntityId: 'media_player.living_room'
      }));
      const y = d.toYaml();
      expect(y.class).toBe('public');
      expect(y.ha_entity_id).toBe('media_player.living_room');
    });

    it('ha_turn_off_on_stop only emitted when true', () => {
      const d1 = new HubDevice(validArgs({ haTurnOffOnStop: false }));
      expect(d1.toYaml().ha_turn_off_on_stop).toBeUndefined();
      const d2 = new HubDevice(validArgs({ haTurnOffOnStop: true }));
      expect(d2.toYaml().ha_turn_off_on_stop).toBe(true);
    });

    it('volume block emitted only when user-supplied bounds present (sparse-preserving)', () => {
      // empty bounds → no volume in YAML
      const d1 = new HubDevice(validArgs({ volumeBounds: new VolumeBounds({}) }));
      expect(d1.toYaml().volume).toBeUndefined();

      // partial bounds → sparse volume
      const d2 = new HubDevice(validArgs({ volumeBounds: new VolumeBounds({ default: 40, max: 70 }) }));
      expect(d2.toYaml().volume).toEqual({ default: 40, max: 70 });
    });
  });

  it('is frozen', () => {
    expect(Object.isFrozen(new HubDevice(validArgs()))).toBe(true);
  });

  it('continuousSchedules array is immutable externally', () => {
    const d = new HubDevice(validArgs());
    expect(() => d.continuousSchedules.push({})).toThrow();
  });
});
