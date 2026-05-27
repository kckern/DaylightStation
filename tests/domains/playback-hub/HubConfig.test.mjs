import { describe, it, expect } from 'vitest';
import { HubConfig } from '../../../backend/src/2_domains/playback-hub/entities/HubConfig.mjs';
import { HubDevice } from '../../../backend/src/2_domains/playback-hub/entities/HubDevice.mjs';
import { ScheduledFire } from '../../../backend/src/2_domains/playback-hub/entities/ScheduledFire.mjs';
import { SlotPosition } from '../../../backend/src/2_domains/playback-hub/value-objects/SlotPosition.mjs';
import { SlotColor } from '../../../backend/src/2_domains/playback-hub/value-objects/SlotColor.mjs';
import { SlotClass } from '../../../backend/src/2_domains/playback-hub/value-objects/SlotClass.mjs';
import { VolumeBounds } from '../../../backend/src/2_domains/playback-hub/value-objects/VolumeBounds.mjs';
import { DayPattern } from '../../../backend/src/2_domains/playback-hub/value-objects/DayPattern.mjs';
import { QueueRef } from '../../../backend/src/2_domains/playback-hub/value-objects/QueueRef.mjs';
import { ValidationError } from '../../../backend/src/2_domains/core/errors/ValidationError.mjs';
import { DomainInvariantError } from '../../../backend/src/2_domains/core/errors/DomainInvariantError.mjs';
import { EntityNotFoundError } from '../../../backend/src/2_domains/core/errors/EntityNotFoundError.mjs';

const makeDevice = ({
  position = 1,
  color = 'red',
  mac = '41:42:3A:E5:43:07',
  cls = 'private',
  haEntityId = null,
  volumeBounds = new VolumeBounds({})
} = {}) => new HubDevice({
  position: new SlotPosition(position),
  color: new SlotColor(color),
  mac,
  class: new SlotClass(cls),
  haEntityId,
  volumeBounds
});

const makeFire = ({
  id = 'morning',
  target = 'red',
  time = '07:00',
  days = new DayPattern('weekdays'),
  queue = new QueueRef({ source: 'plex', id: '670208' })
} = {}) => new ScheduledFire({ id, time, days, target, queue });

describe('HubConfig', () => {
  describe('constructor', () => {
    it('accepts a valid devices list and empty scheduled fires', () => {
      const cfg = new HubConfig({ devices: [makeDevice()], scheduledFires: [] });
      expect(cfg.devices).toHaveLength(1);
      expect(cfg.scheduledFires).toEqual([]);
      expect(cfg.daylightStation).toBeNull();
    });

    it('accepts a valid devices list and matching scheduled fires', () => {
      const devices = [makeDevice({ color: 'red' })];
      const fires = [makeFire({ target: 'red' })];
      const cfg = new HubConfig({ devices, scheduledFires: fires });
      expect(cfg.devices).toHaveLength(1);
      expect(cfg.scheduledFires).toHaveLength(1);
    });

    it('accepts a daylightStation block', () => {
      const cfg = new HubConfig({
        devices: [makeDevice()],
        scheduledFires: [],
        daylightStation: { base_url: 'http://localhost' }
      });
      expect(cfg.daylightStation).toEqual({ base_url: 'http://localhost' });
    });

    it('rejects non-array devices', () => {
      expect(() => new HubConfig({ devices: null })).toThrow(ValidationError);
      expect(() => new HubConfig({ devices: 'red' })).toThrow(ValidationError);
    });

    it('rejects devices with non-HubDevice entries', () => {
      expect(() => new HubConfig({ devices: [{ color: 'red' }] })).toThrow(ValidationError);
    });

    it('rejects scheduledFires with non-ScheduledFire entries', () => {
      expect(() => new HubConfig({
        devices: [makeDevice()],
        scheduledFires: [{ id: 'x' }]
      })).toThrow(ValidationError);
    });

    it('enforces device color uniqueness (DomainInvariantError)', () => {
      expect(() => new HubConfig({
        devices: [
          makeDevice({ position: 1, color: 'red', mac: '41:42:3A:E5:43:07' }),
          makeDevice({ position: 2, color: 'red', mac: '99:99:99:99:99:99' })
        ]
      })).toThrow(DomainInvariantError);
    });

    it('enforces device MAC uniqueness (DomainInvariantError)', () => {
      expect(() => new HubConfig({
        devices: [
          makeDevice({ position: 1, color: 'red', mac: '41:42:3A:E5:43:07' }),
          makeDevice({ position: 2, color: 'blue', mac: '41:42:3A:E5:43:07' })
        ]
      })).toThrow(DomainInvariantError);
    });

    it('enforces scheduledFire.target references a known device color (DomainInvariantError)', () => {
      expect(() => new HubConfig({
        devices: [makeDevice({ color: 'red' })],
        scheduledFires: [makeFire({ target: 'orange' })]
      })).toThrow(DomainInvariantError);
    });

    it('enforces scheduledFire id uniqueness', () => {
      expect(() => new HubConfig({
        devices: [makeDevice({ color: 'red' })],
        scheduledFires: [makeFire({ id: 'a', target: 'red' }), makeFire({ id: 'a', target: 'red' })]
      })).toThrow(DomainInvariantError);
    });
  });

  describe('findDevice', () => {
    it('returns the matching device', () => {
      const cfg = new HubConfig({ devices: [makeDevice({ color: 'red' }), makeDevice({ position: 2, color: 'blue', mac: '99:99:99:99:99:99' })] });
      expect(cfg.findDevice('red').color.value).toBe('red');
      expect(cfg.findDevice('blue').color.value).toBe('blue');
    });
    it('throws EntityNotFoundError if not found', () => {
      const cfg = new HubConfig({ devices: [makeDevice({ color: 'red' })] });
      expect(() => cfg.findDevice('orange')).toThrow(EntityNotFoundError);
    });
  });

  describe('findScheduledFire', () => {
    it('returns the matching fire', () => {
      const cfg = new HubConfig({
        devices: [makeDevice({ color: 'red' })],
        scheduledFires: [makeFire({ id: 'morning', target: 'red' })]
      });
      expect(cfg.findScheduledFire('morning').id).toBe('morning');
    });
    it('throws EntityNotFoundError if id missing', () => {
      const cfg = new HubConfig({ devices: [makeDevice()] });
      expect(() => cfg.findScheduledFire('foo')).toThrow(EntityNotFoundError);
    });
  });

  describe('patchDevice (immutable)', () => {
    it('returns a new HubConfig with the updated device', () => {
      const original = new HubConfig({ devices: [makeDevice({ color: 'red' })] });
      // max=70 stays >= default 60, so VolumeBounds invariant holds
      const updated = original.patchDevice('red', { volumeBounds: new VolumeBounds({ max: 70 }) });
      expect(updated).not.toBe(original);
      expect(updated.findDevice('red').volumeBounds.max).toBe(70);
      expect(original.findDevice('red').volumeBounds.max).toBe(100);
    });
    it('throws EntityNotFoundError on unknown color', () => {
      const cfg = new HubConfig({ devices: [makeDevice({ color: 'red' })] });
      expect(() => cfg.patchDevice('orange', { haTurnOffOnStop: true })).toThrow(EntityNotFoundError);
    });
    it('does not mutate original config', () => {
      const original = new HubConfig({ devices: [makeDevice({ color: 'red' })] });
      original.patchDevice('red', { haTurnOffOnStop: true });
      expect(original.findDevice('red').haTurnOffOnStop).toBe(false);
    });
  });

  describe('upsertScheduledFire (immutable)', () => {
    it('adds a new fire when id is new', () => {
      const original = new HubConfig({ devices: [makeDevice({ color: 'red' })], scheduledFires: [] });
      const updated = original.upsertScheduledFire(makeFire({ id: 'new', target: 'red' }));
      expect(updated.scheduledFires).toHaveLength(1);
      expect(original.scheduledFires).toHaveLength(0);
    });

    it('replaces an existing fire by id', () => {
      const original = new HubConfig({
        devices: [makeDevice({ color: 'red' })],
        scheduledFires: [makeFire({ id: 'morning', time: '07:00', target: 'red' })]
      });
      const updated = original.upsertScheduledFire(makeFire({ id: 'morning', time: '08:00', target: 'red' }));
      expect(updated.scheduledFires).toHaveLength(1);
      expect(updated.findScheduledFire('morning').time).toBe('08:00');
      expect(original.findScheduledFire('morning').time).toBe('07:00');
    });

    it('throws DomainInvariantError if fire target is unknown', () => {
      const cfg = new HubConfig({ devices: [makeDevice({ color: 'red' })] });
      expect(() => cfg.upsertScheduledFire(makeFire({ target: 'orange' }))).toThrow(DomainInvariantError);
    });

    it('throws ValidationError if fire is not a ScheduledFire instance', () => {
      const cfg = new HubConfig({ devices: [makeDevice({ color: 'red' })] });
      expect(() => cfg.upsertScheduledFire({ id: 'x' })).toThrow(ValidationError);
    });
  });

  describe('removeScheduledFire (immutable)', () => {
    it('removes a fire by id', () => {
      const original = new HubConfig({
        devices: [makeDevice({ color: 'red' })],
        scheduledFires: [makeFire({ id: 'a', target: 'red' }), makeFire({ id: 'b', target: 'red' })]
      });
      const updated = original.removeScheduledFire('a');
      expect(updated.scheduledFires).toHaveLength(1);
      expect(updated.scheduledFires[0].id).toBe('b');
      expect(original.scheduledFires).toHaveLength(2);
    });
    it('throws EntityNotFoundError if id absent', () => {
      const cfg = new HubConfig({ devices: [makeDevice({ color: 'red' })] });
      expect(() => cfg.removeScheduledFire('nope')).toThrow(EntityNotFoundError);
    });
  });

  describe('toYaml', () => {
    it('produces a minimal devices-only YAML object', () => {
      const cfg = new HubConfig({ devices: [makeDevice({ color: 'red' })] });
      const y = cfg.toYaml();
      expect(y.devices).toEqual([{
        slot: 1,
        color: 'red',
        mac: '41:42:3A:E5:43:07',
        class: 'private'
      }]);
      expect(y.scheduled).toBeUndefined();
      expect(y.daylight_station).toBeUndefined();
    });

    it('includes scheduled when present', () => {
      const cfg = new HubConfig({
        devices: [makeDevice({ color: 'red' })],
        scheduledFires: [makeFire({ id: 'morning', target: 'red', time: '07:00', days: new DayPattern('weekdays') })]
      });
      const y = cfg.toYaml();
      expect(Array.isArray(y.scheduled)).toBe(true);
      expect(y.scheduled[0]).toMatchObject({
        id: 'morning',
        time: '07:00',
        target: 'red',
        queue: 'plex:670208',
        days: 'weekdays'
      });
    });

    it('includes daylight_station block when set', () => {
      const cfg = new HubConfig({
        devices: [makeDevice()],
        daylightStation: { base_url: 'http://localhost' }
      });
      expect(cfg.toYaml().daylight_station).toEqual({ base_url: 'http://localhost' });
    });
  });

  describe('immutability', () => {
    it('devices array cannot be mutated externally', () => {
      const cfg = new HubConfig({ devices: [makeDevice()] });
      expect(() => cfg.devices.push(makeDevice({ position: 2, color: 'blue', mac: '99:99:99:99:99:99' }))).toThrow();
    });
    it('scheduledFires array cannot be mutated externally', () => {
      const cfg = new HubConfig({ devices: [makeDevice({ color: 'red' })], scheduledFires: [makeFire({ target: 'red' })] });
      expect(() => cfg.scheduledFires.push(makeFire({ id: 'x', target: 'red' }))).toThrow();
    });
    it('aggregate root is frozen', () => {
      expect(Object.isFrozen(new HubConfig({ devices: [makeDevice()] }))).toBe(true);
    });
  });
});
