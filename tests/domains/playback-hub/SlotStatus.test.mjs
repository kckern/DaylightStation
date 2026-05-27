import { describe, it, expect } from 'vitest';
import { SlotStatus } from '../../../backend/src/2_domains/playback-hub/value-objects/SlotStatus.mjs';
import { ValidationError } from '../../../backend/src/2_domains/core/errors/ValidationError.mjs';

const baseFields = {
  position: 1,
  color: 'red',
  bt_connected: true,
  paused: false,
  now_playing: null,
  volume: 45,
  playlist_pos: 0,
  playlist_count: 0,
  armed_source: null
};

describe('SlotStatus', () => {
  describe('constructor', () => {
    it('accepts a full valid snapshot', () => {
      const s = new SlotStatus(baseFields);
      expect(s.position).toBe(1);
      expect(s.color).toBe('red');
      expect(s.bt_connected).toBe(true);
      expect(s.paused).toBe(false);
      expect(s.now_playing).toBeNull();
      expect(s.volume).toBe(45);
      expect(s.playlist_pos).toBe(0);
      expect(s.playlist_count).toBe(0);
      expect(s.armed_source).toBeNull();
    });

    it('accepts now_playing object with queue { source, id }', () => {
      const s = new SlotStatus({
        ...baseFields,
        now_playing: { queue: { source: 'plex', id: '670208' } }
      });
      expect(s.now_playing).toEqual({ queue: { source: 'plex', id: '670208' } });
    });

    it('accepts now_playing with optional title for UI', () => {
      const s = new SlotStatus({
        ...baseFields,
        now_playing: { queue: { source: 'plex', id: '670208' }, title: 'Test Track' }
      });
      expect(s.now_playing.title).toBe('Test Track');
    });

    it('accepts armed_source string', () => {
      const s = new SlotStatus({ ...baseFields, armed_source: 'scheduled' });
      expect(s.armed_source).toBe('scheduled');
    });

    it('rejects missing position', () => {
      const { position, ...rest } = baseFields;
      expect(() => new SlotStatus(rest)).toThrow(ValidationError);
    });

    it('rejects non-integer position', () => {
      expect(() => new SlotStatus({ ...baseFields, position: 1.5 })).toThrow(ValidationError);
      expect(() => new SlotStatus({ ...baseFields, position: '1' })).toThrow(ValidationError);
    });

    it('rejects empty color', () => {
      expect(() => new SlotStatus({ ...baseFields, color: '' })).toThrow(ValidationError);
    });

    it('rejects non-boolean bt_connected', () => {
      expect(() => new SlotStatus({ ...baseFields, bt_connected: 'yes' })).toThrow(ValidationError);
      expect(() => new SlotStatus({ ...baseFields, bt_connected: 1 })).toThrow(ValidationError);
    });

    it('rejects non-boolean paused', () => {
      expect(() => new SlotStatus({ ...baseFields, paused: 'no' })).toThrow(ValidationError);
    });

    it('rejects non-numeric volume', () => {
      expect(() => new SlotStatus({ ...baseFields, volume: '45' })).toThrow(ValidationError);
      expect(() => new SlotStatus({ ...baseFields, volume: null })).toThrow(ValidationError);
    });

    it('rejects malformed now_playing (no queue field)', () => {
      expect(() => new SlotStatus({ ...baseFields, now_playing: {} })).toThrow(ValidationError);
      expect(() => new SlotStatus({ ...baseFields, now_playing: { title: 'x' } })).toThrow(ValidationError);
    });

    it('rejects malformed now_playing.queue (missing source or id)', () => {
      expect(() => new SlotStatus({ ...baseFields, now_playing: { queue: { source: 'plex' } } })).toThrow(ValidationError);
      expect(() => new SlotStatus({ ...baseFields, now_playing: { queue: { id: '1' } } })).toThrow(ValidationError);
    });

    it('rejects null entire-input', () => {
      expect(() => new SlotStatus(null)).toThrow(ValidationError);
    });
  });

  describe('fromHubJson (static factory)', () => {
    it('maps the snapshot wire format', () => {
      const wire = {
        position: 1,
        color: 'red',
        bt_connected: true,
        paused: false,
        now_playing: { queue: { source: 'plex', id: '670208' } },
        volume: 45,
        playlist_pos: 12,
        playlist_count: 30,
        armed_source: null
      };
      const s = SlotStatus.fromHubJson(wire);
      expect(s.position).toBe(1);
      expect(s.color).toBe('red');
      expect(s.now_playing.queue.id).toBe('670208');
    });

    it('null now_playing passes through', () => {
      const wire = { ...baseFields };
      const s = SlotStatus.fromHubJson(wire);
      expect(s.now_playing).toBeNull();
    });

    it('rejects malformed wire JSON', () => {
      expect(() => SlotStatus.fromHubJson(null)).toThrow(ValidationError);
      expect(() => SlotStatus.fromHubJson('not-an-object')).toThrow(ValidationError);
    });
  });

  it('is frozen', () => {
    expect(Object.isFrozen(new SlotStatus(baseFields))).toBe(true);
  });

  it('now_playing object is frozen if present', () => {
    const s = new SlotStatus({
      ...baseFields,
      now_playing: { queue: { source: 'plex', id: '670208' } }
    });
    expect(Object.isFrozen(s.now_playing)).toBe(true);
    expect(Object.isFrozen(s.now_playing.queue)).toBe(true);
  });
});
