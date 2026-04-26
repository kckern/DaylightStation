import { describe, it, expect, beforeEach } from 'vitest';
import { SessionLockService } from '#apps/fitness/services/SessionLockService.mjs';

describe('SessionLockService', () => {
  let svc;

  beforeEach(() => {
    svc = new SessionLockService({ ttlMs: 120000 });
  });

  describe('acquire', () => {
    it('grants lock to first client', () => {
      const result = svc.acquire('session-1', 'client-A');
      expect(result).toEqual({ granted: true, leader: 'client-A' });
    });

    it('returns granted=false for second client on same session', () => {
      svc.acquire('session-1', 'client-A');
      const result = svc.acquire('session-1', 'client-B');
      expect(result).toEqual({ granted: false, leader: 'client-A' });
    });

    it('renews lock for same client (idempotent)', () => {
      svc.acquire('session-1', 'client-A');
      const result = svc.acquire('session-1', 'client-A');
      expect(result).toEqual({ granted: true, leader: 'client-A' });
    });

    it('grants lock after previous lock expires', () => {
      svc.acquire('session-1', 'client-A');

      // Backdate the lock to simulate expiry
      const lock = svc._locks.get('session-1');
      lock.acquiredAt = Date.now() - 200000; // well past 120s TTL

      const result = svc.acquire('session-1', 'client-B');
      expect(result).toEqual({ granted: true, leader: 'client-B' });
    });

    it('allows independent sessions to be locked by different clients', () => {
      const r1 = svc.acquire('session-1', 'client-A');
      const r2 = svc.acquire('session-2', 'client-B');
      expect(r1).toEqual({ granted: true, leader: 'client-A' });
      expect(r2).toEqual({ granted: true, leader: 'client-B' });
    });
  });

  describe('release', () => {
    it('releases lock held by requesting client', () => {
      svc.acquire('session-1', 'client-A');
      const released = svc.release('session-1', 'client-A');
      expect(released).toBe(true);

      // Verify the lock is gone — another client can now acquire
      const result = svc.acquire('session-1', 'client-B');
      expect(result).toEqual({ granted: true, leader: 'client-B' });
    });

    it('refuses to release lock held by different client', () => {
      svc.acquire('session-1', 'client-A');
      const released = svc.release('session-1', 'client-B');
      expect(released).toBe(false);

      // Lock is still held by client-A
      const info = svc.check('session-1');
      expect(info.leader).toBe('client-A');
    });

    it('returns false for non-existent lock', () => {
      const released = svc.release('no-such-session', 'client-A');
      expect(released).toBe(false);
    });
  });

  describe('check', () => {
    it('returns null for unlocked session', () => {
      const info = svc.check('session-1');
      expect(info).toBeNull();
    });

    it('returns leader info for locked session', () => {
      svc.acquire('session-1', 'client-A');
      const info = svc.check('session-1');
      expect(info).not.toBeNull();
      expect(info.leader).toBe('client-A');
      expect(typeof info.acquiredAt).toBe('number');
    });

    it('returns null for expired lock (auto-cleans)', () => {
      svc.acquire('session-1', 'client-A');

      // Backdate the lock to simulate expiry
      const lock = svc._locks.get('session-1');
      lock.acquiredAt = Date.now() - 200000;

      const info = svc.check('session-1');
      expect(info).toBeNull();

      // Verify the stale entry was cleaned up
      expect(svc._locks.has('session-1')).toBe(false);
    });
  });
});
