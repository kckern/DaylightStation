// tests/unit/domains/fitness/entities/Participant.test.mjs
import { Participant } from '#domains/fitness/entities/Participant.mjs';

describe('Participant', () => {
  let participant;

  beforeEach(() => {
    participant = new Participant({
      name: 'John',
      hrDeviceId: 'device123',
      isGuest: false,
      isPrimary: true
    });
  });

  describe('constructor', () => {
    test('creates participant with required fields', () => {
      expect(participant.name).toBe('John');
      expect(participant.hrDeviceId).toBe('device123');
    });

    test('defaults optional fields', () => {
      const p = new Participant({ name: 'Jane' });
      expect(p.hrDeviceId).toBeNull();
      expect(p.isGuest).toBe(false);
      expect(p.isPrimary).toBe(false);
    });
  });

  describe('hasHrDevice', () => {
    test('returns true when device assigned', () => {
      expect(participant.hasHrDevice()).toBe(true);
    });

    test('returns false when no device', () => {
      participant.hrDeviceId = null;
      expect(participant.hasHrDevice()).toBe(false);
    });
  });

  describe('setAsPrimary', () => {
    test('sets isPrimary to true', () => {
      const p = new Participant({ name: 'Test' });
      p.setAsPrimary();
      expect(p.isPrimary).toBe(true);
    });
  });

  describe('setAsGuest', () => {
    test('sets isGuest to true', () => {
      participant.setAsGuest();
      expect(participant.isGuest).toBe(true);
    });

    test('accepts false parameter', () => {
      participant.isGuest = true;
      participant.setAsGuest(false);
      expect(participant.isGuest).toBe(false);
    });
  });

  describe('assignHrDevice', () => {
    test('assigns device ID', () => {
      const p = new Participant({ name: 'Test' });
      p.assignHrDevice('newDevice');
      expect(p.hrDeviceId).toBe('newDevice');
    });
  });

  describe('removeHrDevice', () => {
    test('removes device ID', () => {
      participant.removeHrDevice();
      expect(participant.hrDeviceId).toBeNull();
    });
  });

  describe('toJSON/fromJSON', () => {
    test('round-trips participant data', () => {
      participant.metadata = { avatar: 'url' };

      const json = participant.toJSON();
      const restored = Participant.fromJSON(json);

      expect(restored.name).toBe(participant.name);
      expect(restored.hrDeviceId).toBe(participant.hrDeviceId);
      expect(restored.isPrimary).toBe(participant.isPrimary);
      expect(restored.metadata).toEqual(participant.metadata);
    });
  });
});
