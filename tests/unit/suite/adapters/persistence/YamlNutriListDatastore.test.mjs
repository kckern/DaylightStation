// tests/unit/suite/adapters/persistence/YamlNutriListDatastore.test.mjs
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { YamlNutriListDatastore } from '#adapters/persistence/yaml/YamlNutriListDatastore.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('YamlNutriListDatastore', () => {
  let datastore;
  let tempDir;
  let mockDataService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nutrilist-test-'));

    mockDataService = {
      user: {
        resolveDir: jest.fn().mockImplementation((subpath, userId) => {
          return path.join(tempDir, 'users', userId, subpath);
        }),
      },
    };

    datastore = new YamlNutriListDatastore({
      dataService: mockDataService,
      logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('throws if dataService is not provided', () => {
      expect(() => new YamlNutriListDatastore({}))
        .toThrow(InfrastructureError);
    });
  });

  describe('saveMany', () => {
    it('saves items to correct user directory', async () => {
      const items = [{
        userId: 'testuser',
        label: 'Test Food',
        calories: 200,
        date: '2026-01-31',
      }];

      await datastore.saveMany(items);

      expect(mockDataService.user.resolveDir).toHaveBeenCalledWith(
        'lifelog/nutrition/nutrilist',
        'testuser'
      );
    });

    it('uses userId over chatId when both provided', async () => {
      const items = [{
        userId: 'correctuser',
        chatId: 'telegram:wrongpath',
        label: 'Test Food',
        calories: 200,
        date: '2026-01-31',
      }];

      await datastore.saveMany(items);

      expect(mockDataService.user.resolveDir).toHaveBeenCalledWith(
        expect.any(String),
        'correctuser'
      );
    });
  });

  describe('userId validation', () => {
    it('throws InfrastructureError when userId contains colon', async () => {
      const items = [{
        userId: 'telegram:b6898194425_c575596036',
        label: 'Test Food',
        calories: 200,
        date: '2026-01-31',
      }];

      await expect(datastore.saveMany(items))
        .rejects.toThrow(InfrastructureError);
    });

    it('throws InfrastructureError when userId contains slash', async () => {
      const items = [{
        userId: 'path/traversal',
        label: 'Test Food',
        calories: 200,
        date: '2026-01-31',
      }];

      await expect(datastore.saveMany(items))
        .rejects.toThrow(InfrastructureError);
    });

    it('throws InfrastructureError when falling back to invalid chatId', async () => {
      const items = [{
        chatId: 'telegram:invalid',  // No userId, falls back to chatId
        label: 'Test Food',
        calories: 200,
        date: '2026-01-31',
      }];

      await expect(datastore.saveMany(items))
        .rejects.toThrow(InfrastructureError);
    });

    it('allows valid userId without special characters', async () => {
      const items = [{
        userId: 'user_1',
        label: 'Test Food',
        calories: 200,
        date: '2026-01-31',
      }];

      await expect(datastore.saveMany(items)).resolves.not.toThrow();
    });
  });
});
