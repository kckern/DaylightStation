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
        { id: 'user_4', name: 'User_4', hrDeviceIds: new Set(['20991']), cadenceDeviceId: null }
      ]);
      const owner = index.getOwner('20991');
      expect(owner).not.toBeNull();
      expect(owner.id).toBe('user_4');
      expect(owner.name).toBe('User_4');
    });

    it('maps multiple HR devices to the same owner', () => {
      index.rebuild([
        { id: 'user_4', name: 'User_4', hrDeviceIds: new Set(['20991', '10366', '28676']), cadenceDeviceId: null }
      ]);
      expect(index.getOwner('20991').id).toBe('user_4');
      expect(index.getOwner('10366').id).toBe('user_4');
      expect(index.getOwner('28676').id).toBe('user_4');
    });

    it('maps cadence devices', () => {
      index.rebuild([
        { id: 'user1', name: 'User', hrDeviceIds: new Set(), cadenceDeviceId: '49904' }
      ]);
      expect(index.getOwner('49904').id).toBe('user1');
    });

    it('returns null for unknown device', () => {
      index.rebuild([
        { id: 'user_4', name: 'User_4', hrDeviceIds: new Set(['20991']), cadenceDeviceId: null }
      ]);
      expect(index.getOwner('99999')).toBeNull();
    });

    it('coerces numeric device IDs to strings', () => {
      index.rebuild([
        { id: 'user_4', name: 'User_4', hrDeviceIds: new Set(['20991']), cadenceDeviceId: null }
      ]);
      expect(index.getOwner(20991).id).toBe('user_4');
    });

    it('replaces previous index on rebuild', () => {
      index.rebuild([
        { id: 'user_4', name: 'User_4', hrDeviceIds: new Set(['20991']), cadenceDeviceId: null }
      ]);
      index.rebuild([
        { id: 'user_2', name: 'User_2', hrDeviceIds: new Set(['20991']), cadenceDeviceId: null }
      ]);
      expect(index.getOwner('20991').id).toBe('user_2');
    });
  });

  describe('getDeviceIdsForUser', () => {
    it('returns all device IDs for a user', () => {
      index.rebuild([
        { id: 'user_4', name: 'User_4', hrDeviceIds: new Set(['20991', '10366']), cadenceDeviceId: '7183' }
      ]);
      const ids = index.getDeviceIdsForUser('user_4');
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
        { id: 'user_4', name: 'User_4', hrDeviceIds: new Set(['20991', '10366']), cadenceDeviceId: null }
      ]);
      expect(index.ownsDevice('user_4', '20991')).toBe(true);
      expect(index.ownsDevice('user_4', '10366')).toBe(true);
    });

    it('returns false when a different user owns the device', () => {
      index.rebuild([
        { id: 'user_4', name: 'User_4', hrDeviceIds: new Set(['20991']), cadenceDeviceId: null },
        { id: 'user_2', name: 'User_2', hrDeviceIds: new Set(['90003']), cadenceDeviceId: null }
      ]);
      expect(index.ownsDevice('user_4', '90003')).toBe(false);
    });

    it('returns false for unknown device', () => {
      index.rebuild([
        { id: 'user_4', name: 'User_4', hrDeviceIds: new Set(['20991']), cadenceDeviceId: null }
      ]);
      expect(index.ownsDevice('user_4', '99999')).toBe(false);
    });
  });
});
