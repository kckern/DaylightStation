import { describe, it, expect } from '@jest/globals';
import { UserIdentityService } from '#domains/messaging/services/UserIdentityService.mjs';

const mappings = {
  telegram: {
    '575596036': 'kckern',
    '123456789': 'kirk',
  },
  discord: {
    '987654321': 'kckern',
  },
};

describe('UserIdentityService', () => {
  describe('resolveUsername', () => {
    it('resolves telegram user to system username', () => {
      const service = new UserIdentityService(mappings);
      expect(service.resolveUsername('telegram', '575596036')).toBe('kckern');
      expect(service.resolveUsername('telegram', '123456789')).toBe('kirk');
    });

    it('resolves discord user to system username', () => {
      const service = new UserIdentityService(mappings);
      expect(service.resolveUsername('discord', '987654321')).toBe('kckern');
    });

    it('returns null for unknown platform user', () => {
      const service = new UserIdentityService(mappings);
      expect(service.resolveUsername('telegram', '999999999')).toBeNull();
    });

    it('returns null for unknown platform', () => {
      const service = new UserIdentityService(mappings);
      expect(service.resolveUsername('slack', '575596036')).toBeNull();
    });

    it('returns null for null/undefined inputs', () => {
      const service = new UserIdentityService(mappings);
      expect(service.resolveUsername(null, '575596036')).toBeNull();
      expect(service.resolveUsername('telegram', null)).toBeNull();
    });

    it('coerces numeric platformId to string', () => {
      const service = new UserIdentityService(mappings);
      expect(service.resolveUsername('telegram', 575596036)).toBe('kckern');
    });
  });

  describe('resolvePlatformId', () => {
    it('resolves system username to telegram user ID', () => {
      const service = new UserIdentityService(mappings);
      expect(service.resolvePlatformId('telegram', 'kckern')).toBe('575596036');
    });

    it('returns null for unknown username', () => {
      const service = new UserIdentityService(mappings);
      expect(service.resolvePlatformId('telegram', 'nobody')).toBeNull();
    });

    it('returns null for null inputs', () => {
      const service = new UserIdentityService(mappings);
      expect(service.resolvePlatformId(null, 'kckern')).toBeNull();
      expect(service.resolvePlatformId('telegram', null)).toBeNull();
    });
  });

  describe('isKnownUser', () => {
    it('returns true for known users', () => {
      const service = new UserIdentityService(mappings);
      expect(service.isKnownUser('telegram', '575596036')).toBe(true);
    });

    it('returns false for unknown users', () => {
      const service = new UserIdentityService(mappings);
      expect(service.isKnownUser('telegram', '999999999')).toBe(false);
    });
  });
});
