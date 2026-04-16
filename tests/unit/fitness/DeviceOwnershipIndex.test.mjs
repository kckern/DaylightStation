// tests/unit/fitness/DeviceOwnershipIndex.test.mjs
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn()
  }),
  getLogger: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn()
  })
}));

const { DeviceOwnershipIndex } = await import('#frontend/hooks/fitness/DeviceOwnershipIndex.js');

describe('DeviceOwnershipIndex', () => {
  let index;

  beforeEach(() => {
    index = new DeviceOwnershipIndex();
  });

  describe('rebuild', () => {
    it('maps a single HR device to its owner', () => {
      index.rebuild([
        { id: 'alan', name: 'Alan', hrDeviceIds: new Set(['20991']), cadenceDeviceId: null }
      ]);
      const owner = index.getOwner('20991');
      expect(owner).not.toBeNull();
      expect(owner.id).toBe('alan');
      expect(owner.name).toBe('Alan');
    });

    it('maps multiple HR devices to the same owner', () => {
      index.rebuild([
        { id: 'alan', name: 'Alan', hrDeviceIds: new Set(['20991', '10366', '28676']), cadenceDeviceId: null }
      ]);
      expect(index.getOwner('20991').id).toBe('alan');
      expect(index.getOwner('10366').id).toBe('alan');
      expect(index.getOwner('28676').id).toBe('alan');
    });

    it('maps cadence devices', () => {
      index.rebuild([
        { id: 'user1', name: 'User', hrDeviceIds: new Set(), cadenceDeviceId: '49904' }
      ]);
      expect(index.getOwner('49904').id).toBe('user1');
    });

    it('returns null for unknown device', () => {
      index.rebuild([
        { id: 'alan', name: 'Alan', hrDeviceIds: new Set(['20991']), cadenceDeviceId: null }
      ]);
      expect(index.getOwner('99999')).toBeNull();
    });

    it('coerces numeric device IDs to strings', () => {
      index.rebuild([
        { id: 'alan', name: 'Alan', hrDeviceIds: new Set(['20991']), cadenceDeviceId: null }
      ]);
      expect(index.getOwner(20991).id).toBe('alan');
    });

    it('replaces previous index on rebuild', () => {
      index.rebuild([
        { id: 'alan', name: 'Alan', hrDeviceIds: new Set(['20991']), cadenceDeviceId: null }
      ]);
      index.rebuild([
        { id: 'felix', name: 'Felix', hrDeviceIds: new Set(['20991']), cadenceDeviceId: null }
      ]);
      expect(index.getOwner('20991').id).toBe('felix');
    });
  });

  describe('getDeviceIdsForUser', () => {
    it('returns all device IDs for a user', () => {
      index.rebuild([
        { id: 'alan', name: 'Alan', hrDeviceIds: new Set(['20991', '10366']), cadenceDeviceId: '7183' }
      ]);
      const ids = index.getDeviceIdsForUser('alan');
      expect(ids).toContain('20991');
      expect(ids).toContain('10366');
      expect(ids).toContain('7183');
    });

    it('returns empty array for unknown user', () => {
      index.rebuild([]);
      expect(index.getDeviceIdsForUser('nobody')).toEqual([]);
    });
  });

  describe('ownsDevice', () => {
    it('returns true when user owns the device', () => {
      index.rebuild([
        { id: 'alan', name: 'Alan', hrDeviceIds: new Set(['20991', '10366']), cadenceDeviceId: null }
      ]);
      expect(index.ownsDevice('alan', '20991')).toBe(true);
      expect(index.ownsDevice('alan', '10366')).toBe(true);
    });

    it('returns false when a different user owns the device', () => {
      index.rebuild([
        { id: 'alan', name: 'Alan', hrDeviceIds: new Set(['20991']), cadenceDeviceId: null },
        { id: 'felix', name: 'Felix', hrDeviceIds: new Set(['28812']), cadenceDeviceId: null }
      ]);
      expect(index.ownsDevice('alan', '28812')).toBe(false);
    });

    it('returns false for unknown device', () => {
      index.rebuild([
        { id: 'alan', name: 'Alan', hrDeviceIds: new Set(['20991']), cadenceDeviceId: null }
      ]);
      expect(index.ownsDevice('alan', '99999')).toBe(false);
    });
  });
});
