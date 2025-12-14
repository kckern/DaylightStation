/**
 * Tests for InMemoryRepository
 * @group Phase2
 */

import { InMemoryRepository } from '../../infrastructure/persistence/InMemoryRepository.mjs';
import { isRepository } from '../../application/ports/IRepository.mjs';
import { NotFoundError } from '../../_lib/errors/index.mjs';

describe('Phase2: InMemoryRepository', () => {
  let repository;

  beforeEach(() => {
    repository = new InMemoryRepository({ idField: 'id' });
  });

  describe('interface compliance', () => {
    it('should implement IRepository', () => {
      expect(isRepository(repository)).toBe(true);
    });
  });

  describe('save', () => {
    it('should save entity', async () => {
      const entity = { id: '1', name: 'Test' };
      const result = await repository.save(entity, 'chat1');
      
      expect(result).toEqual(entity);
    });

    it('should overwrite existing entity', async () => {
      await repository.save({ id: '1', name: 'Original' }, 'chat1');
      await repository.save({ id: '1', name: 'Updated' }, 'chat1');
      
      const found = await repository.findById('1', 'chat1');
      expect(found.name).toBe('Updated');
    });

    it('should throw if entity missing id field', async () => {
      await expect(repository.save({ name: 'No ID' }, 'chat1'))
        .rejects.toThrow(/missing required ID field/);
    });
  });

  describe('findById', () => {
    it('should find existing entity', async () => {
      await repository.save({ id: '1', name: 'Test' }, 'chat1');
      
      const found = await repository.findById('1', 'chat1');
      expect(found.name).toBe('Test');
    });

    it('should return null for non-existent entity', async () => {
      const found = await repository.findById('nonexistent', 'chat1');
      expect(found).toBeNull();
    });

    it('should return copy, not reference', async () => {
      await repository.save({ id: '1', data: [1, 2, 3] }, 'chat1');
      
      const found1 = await repository.findById('1', 'chat1');
      found1.data.push(4);
      
      const found2 = await repository.findById('1', 'chat1');
      expect(found2.data).toEqual([1, 2, 3]);
    });
  });

  describe('findAll', () => {
    beforeEach(async () => {
      await repository.save({ id: '1', type: 'a', value: 10 }, 'chat1');
      await repository.save({ id: '2', type: 'b', value: 20 }, 'chat1');
      await repository.save({ id: '3', type: 'a', value: 30 }, 'chat1');
    });

    it('should return all entities', async () => {
      const all = await repository.findAll({}, 'chat1');
      expect(all).toHaveLength(3);
    });

    it('should filter by partial match', async () => {
      const filtered = await repository.findAll({ filter: { type: 'a' } }, 'chat1');
      expect(filtered).toHaveLength(2);
    });

    it('should sort by field ascending', async () => {
      const sorted = await repository.findAll({ 
        sortBy: 'value', 
        sortOrder: 'asc' 
      }, 'chat1');
      
      expect(sorted.map(e => e.value)).toEqual([10, 20, 30]);
    });

    it('should sort by field descending', async () => {
      const sorted = await repository.findAll({ 
        sortBy: 'value', 
        sortOrder: 'desc' 
      }, 'chat1');
      
      expect(sorted.map(e => e.value)).toEqual([30, 20, 10]);
    });

    it('should limit results', async () => {
      const limited = await repository.findAll({ limit: 2 }, 'chat1');
      expect(limited).toHaveLength(2);
    });

    it('should offset results', async () => {
      const offset = await repository.findAll({ offset: 1 }, 'chat1');
      expect(offset).toHaveLength(2);
    });

    it('should combine filter, sort, limit, offset', async () => {
      const result = await repository.findAll({
        filter: { type: 'a' },
        sortBy: 'value',
        sortOrder: 'desc',
        limit: 1,
        offset: 0,
      }, 'chat1');
      
      expect(result).toHaveLength(1);
      expect(result[0].value).toBe(30);
    });
  });

  describe('update', () => {
    it('should update existing entity', async () => {
      await repository.save({ id: '1', name: 'Original', extra: 'keep' }, 'chat1');
      
      const updated = await repository.update('1', { name: 'Updated' }, 'chat1');
      
      expect(updated.name).toBe('Updated');
      expect(updated.extra).toBe('keep');
    });

    it('should throw NotFoundError for non-existent entity', async () => {
      await expect(repository.update('nonexistent', { name: 'test' }, 'chat1'))
        .rejects.toThrow(NotFoundError);
    });
  });

  describe('delete', () => {
    it('should delete existing entity', async () => {
      await repository.save({ id: '1', name: 'Test' }, 'chat1');
      await repository.delete('1', 'chat1');
      
      const found = await repository.findById('1', 'chat1');
      expect(found).toBeNull();
    });

    it('should not throw for non-existent entity', async () => {
      await expect(repository.delete('nonexistent', 'chat1'))
        .resolves.not.toThrow();
    });
  });

  describe('exists', () => {
    it('should return true for existing entity', async () => {
      await repository.save({ id: '1', name: 'Test' }, 'chat1');
      
      const exists = await repository.exists('1', 'chat1');
      expect(exists).toBe(true);
    });

    it('should return false for non-existent entity', async () => {
      const exists = await repository.exists('nonexistent', 'chat1');
      expect(exists).toBe(false);
    });
  });

  describe('per-chat isolation', () => {
    it('should isolate data between chats', async () => {
      await repository.save({ id: '1', name: 'Chat1 Data' }, 'chat1');
      await repository.save({ id: '1', name: 'Chat2 Data' }, 'chat2');
      
      const chat1Data = await repository.findById('1', 'chat1');
      const chat2Data = await repository.findById('1', 'chat2');
      
      expect(chat1Data.name).toBe('Chat1 Data');
      expect(chat2Data.name).toBe('Chat2 Data');
    });
  });

  describe('non-perChat mode', () => {
    it('should share data across all calls', async () => {
      const globalRepo = new InMemoryRepository({ idField: 'id', perChat: false });
      
      await globalRepo.save({ id: '1', name: 'Global' });
      
      const found = await globalRepo.findById('1');
      expect(found.name).toBe('Global');
    });
  });

  describe('testing helpers', () => {
    it('seed should populate data', () => {
      repository.seed([
        { id: '1', name: 'A' },
        { id: '2', name: 'B' },
      ], 'chat1');
      
      expect(repository.count('chat1')).toBe(2);
    });

    it('getAll should return all entities', async () => {
      await repository.save({ id: '1', name: 'A' }, 'chat1');
      await repository.save({ id: '2', name: 'B' }, 'chat2');
      
      expect(repository.getAll()).toHaveLength(2);
      expect(repository.getAll('chat1')).toHaveLength(1);
    });

    it('snapshot should return all data', async () => {
      await repository.save({ id: '1', name: 'A' }, 'chat1');
      
      const snapshot = repository.snapshot();
      expect(snapshot.chat1).toBeDefined();
      expect(snapshot.chat1['1'].name).toBe('A');
    });

    it('reset should clear all data', async () => {
      await repository.save({ id: '1', name: 'A' }, 'chat1');
      repository.reset();
      
      expect(repository.count()).toBe(0);
    });

    it('count should return counts', async () => {
      await repository.save({ id: '1' }, 'chat1');
      await repository.save({ id: '2' }, 'chat1');
      await repository.save({ id: '3' }, 'chat2');
      
      expect(repository.count()).toBe(3);
      expect(repository.count('chat1')).toBe(2);
    });
  });
});
