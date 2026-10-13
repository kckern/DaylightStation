/**
 * ISessionControl port — type-guard, assertion, and no-op factory.
 */
import { describe, it, expect } from 'vitest';
import {
  isSessionControl,
  assertSessionControl,
  createNoOpSessionControl,
} from '#apps/devices/ports/ISessionControl.mjs';

describe('ISessionControl port', () => {
  describe('isSessionControl', () => {
    it('returns true when all required methods are functions', () => {
      const impl = {
        sendCommand: async () => ({ ok: true }),
        getSnapshot: () => null,
        waitForStateChange: () => Promise.resolve({}),
      };
      expect(isSessionControl(impl)).toBe(true);
    });

    it('returns false when sendCommand is missing', () => {
      const impl = {
        getSnapshot: () => null,
        waitForStateChange: () => Promise.resolve({}),
      };
      expect(isSessionControl(impl)).toBe(false);
    });

    it('returns false when getSnapshot is missing', () => {
      const impl = {
        sendCommand: async () => ({ ok: true }),
        waitForStateChange: () => Promise.resolve({}),
      };
      expect(isSessionControl(impl)).toBe(false);
    });

    it('returns false when waitForStateChange is missing', () => {
      const impl = {
        sendCommand: async () => ({ ok: true }),
        getSnapshot: () => null,
      };
      expect(isSessionControl(impl)).toBe(false);
    });

    it('returns false when a required member is not a function', () => {
      expect(isSessionControl({
        sendCommand: 'not-a-function',
        getSnapshot: () => null,
        waitForStateChange: () => Promise.resolve({}),
      })).toBe(false);
    });

    it('returns false for null / non-object values', () => {
      expect(isSessionControl(null)).toBe(false);
      expect(isSessionControl(undefined)).toBe(false);
      expect(isSessionControl(42)).toBe(false);
      expect(isSessionControl('oops')).toBe(false);
    });
  });

  describe('assertSessionControl', () => {
    it('does not throw for a valid implementation', () => {
      const impl = createNoOpSessionControl();
      expect(() => assertSessionControl(impl, 'Unit')).not.toThrow();
    });

    it('throws with the provided context when invalid', () => {
      expect(() => assertSessionControl({}, 'MyComponent')).toThrow(
        /MyComponent must implement ISessionControl/,
      );
    });

    it('uses the default context when none provided', () => {
      expect(() => assertSessionControl({})).toThrow(
        /SessionControl must implement ISessionControl/,
      );
    });
  });

  describe('createNoOpSessionControl', () => {
    it('returns an object with all required methods', () => {
      const noop = createNoOpSessionControl();
      expect(isSessionControl(noop)).toBe(true);
    });

    it('sendCommand resolves { ok: false, error: "SessionControl not configured" }', async () => {
      const noop = createNoOpSessionControl();
      const result = await noop.sendCommand({ commandId: 'x', command: 'transport', params: { action: 'play' } });
      expect(result).toEqual({ ok: false, error: 'SessionControl not configured' });
    });

    it('getSnapshot returns null', () => {
      const noop = createNoOpSessionControl();
      expect(noop.getSnapshot('tv-1')).toBeNull();
    });

    it('waitForStateChange rejects with "not configured"', async () => {
      const noop = createNoOpSessionControl();
      await expect(noop.waitForStateChange('tv-1', () => true, 100)).rejects.toThrow(
        /not configured/,
      );
    });
  });
});
