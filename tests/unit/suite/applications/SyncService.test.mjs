import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { SyncService } from '#apps/content/services/SyncService.mjs';
import { EntityNotFoundError, ValidationError } from '#domains/core/errors/index.mjs';

describe('SyncService', () => {
  let service;
  let mockSyncSource;

  beforeEach(() => {
    mockSyncSource = {
      sync: jest.fn().mockResolvedValue({ synced: 30, errors: 0 }),
      getStatus: jest.fn().mockResolvedValue({ lastSynced: '2026-02-23T10:00:00Z', itemCount: 30 })
    };

    service = new SyncService({
      logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() }
    });
  });

  describe('registerSyncSource', () => {
    it('registers a valid sync source', () => {
      expect(() => service.registerSyncSource('retroarch', mockSyncSource)).not.toThrow();
    });

    it('rejects non-ISyncSource objects', () => {
      expect(() => service.registerSyncSource('bad', {})).toThrow(ValidationError);
      expect(() => service.registerSyncSource('bad', { sync: 'notfn' })).toThrow(ValidationError);
    });
  });

  describe('sync', () => {
    it('delegates to registered sync source', async () => {
      service.registerSyncSource('retroarch', mockSyncSource);
      const result = await service.sync('retroarch');
      expect(mockSyncSource.sync).toHaveBeenCalled();
      expect(result).toEqual({ synced: 30, errors: 0 });
    });

    it('throws EntityNotFoundError for unregistered source', async () => {
      await expect(service.sync('unknown')).rejects.toThrow(EntityNotFoundError);
    });
  });

  describe('getStatus', () => {
    it('delegates to registered sync source', async () => {
      service.registerSyncSource('retroarch', mockSyncSource);
      const result = await service.getStatus('retroarch');
      expect(result).toEqual({ lastSynced: '2026-02-23T10:00:00Z', itemCount: 30 });
    });

    it('throws EntityNotFoundError for unregistered source', async () => {
      await expect(service.getStatus('unknown')).rejects.toThrow(EntityNotFoundError);
    });
  });
});
