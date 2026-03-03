/**
 * YamlMediaQueueDatastore Tests
 *
 * TDD tests for the YAML-based media queue persistence adapter.
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';
import yaml from 'js-yaml';
import { YamlMediaQueueDatastore } from '#adapters/persistence/yaml/YamlMediaQueueDatastore.mjs';
import { MediaQueue } from '#domains/media/entities/MediaQueue.mjs';

describe('YamlMediaQueueDatastore', () => {
  let store;
  let testDataRoot;
  let mockConfigService;

  beforeEach(() => {
    // Create temp directory for each test
    testDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'media-queue-test-'));

    mockConfigService = {
      getDefaultHouseholdId: () => 'default',
      getHouseholdPath: (relativePath, householdId) => {
        const hid = householdId || 'default';
        const folderName = hid === 'default' ? 'household' : `household-${hid}`;
        return relativePath
          ? path.join(testDataRoot, folderName, relativePath)
          : path.join(testDataRoot, folderName);
      },
    };

    store = new YamlMediaQueueDatastore({ configService: mockConfigService });
  });

  afterEach(() => {
    fs.rmSync(testDataRoot, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('throws if configService is missing', () => {
      expect(() => new YamlMediaQueueDatastore({})).toThrow('requires configService');
    });

    it('creates an instance when configService is provided', () => {
      expect(store).toBeInstanceOf(YamlMediaQueueDatastore);
    });
  });

  describe('load', () => {
    it('returns null when no queue file exists', async () => {
      const result = await store.load('default');
      expect(result).toBeNull();
    });

    it('returns a MediaQueue instance when file exists', async () => {
      // Pre-create the queue file on disk
      const queueDir = path.join(testDataRoot, 'household', 'apps', 'media');
      fs.mkdirSync(queueDir, { recursive: true });
      const queueData = {
        position: 2,
        shuffle: true,
        repeat: 'all',
        volume: 0.8,
        items: [
          { queueId: 'abc1', title: 'Song A' },
          { queueId: 'abc2', title: 'Song B' },
          { queueId: 'abc3', title: 'Song C' },
        ],
        shuffleOrder: [2, 0, 1],
      };
      fs.writeFileSync(
        path.join(queueDir, 'queue.yml'),
        yaml.dump(queueData),
      );

      const result = await store.load('default');

      expect(result).toBeInstanceOf(MediaQueue);
      expect(result.position).toBe(2);
      expect(result.shuffle).toBe(true);
      expect(result.repeat).toBe('all');
      expect(result.volume).toBe(0.8);
      expect(result.items).toHaveLength(3);
      expect(result.items[0].title).toBe('Song A');
      expect(result.shuffleOrder).toEqual([2, 0, 1]);
    });
  });

  describe('save', () => {
    it('persists a MediaQueue to disk as YAML', async () => {
      const queue = new MediaQueue({
        position: 1,
        shuffle: false,
        repeat: 'one',
        volume: 0.5,
        items: [
          { queueId: 'x1', title: 'Track 1' },
          { queueId: 'x2', title: 'Track 2' },
        ],
        shuffleOrder: [],
      });

      await store.save(queue, 'default');

      // Verify file exists and has correct content
      const filePath = path.join(testDataRoot, 'household', 'apps', 'media', 'queue.yml');
      expect(fs.existsSync(filePath)).toBe(true);

      const loaded = yaml.load(fs.readFileSync(filePath, 'utf8'));
      expect(loaded.position).toBe(1);
      expect(loaded.shuffle).toBe(false);
      expect(loaded.repeat).toBe('one');
      expect(loaded.volume).toBe(0.5);
      expect(loaded.items).toHaveLength(2);
      expect(loaded.items[0].title).toBe('Track 1');
    });

    it('creates the directory structure when it does not exist', async () => {
      const queue = MediaQueue.empty();
      await store.save(queue, 'new-household');

      const dirPath = path.join(testDataRoot, 'household-new-household', 'apps', 'media');
      expect(fs.existsSync(dirPath)).toBe(true);
    });
  });

  describe('save then load roundtrip', () => {
    it('roundtrips a queue through save and load', async () => {
      const original = new MediaQueue({
        position: 3,
        shuffle: true,
        repeat: 'all',
        volume: 0.75,
        items: [
          { queueId: 'r1', title: 'Alpha', source: 'plex', contentId: '100' },
          { queueId: 'r2', title: 'Beta', source: 'plex', contentId: '200' },
          { queueId: 'r3', title: 'Gamma', source: 'plex', contentId: '300' },
          { queueId: 'r4', title: 'Delta', source: 'plex', contentId: '400' },
        ],
        shuffleOrder: [3, 1, 0, 2],
      });

      await store.save(original, 'default');
      const loaded = await store.load('default');

      expect(loaded).toBeInstanceOf(MediaQueue);
      expect(loaded.position).toBe(original.position);
      expect(loaded.shuffle).toBe(original.shuffle);
      expect(loaded.repeat).toBe(original.repeat);
      expect(loaded.volume).toBe(original.volume);
      expect(loaded.items).toHaveLength(original.items.length);
      expect(loaded.items[0].title).toBe('Alpha');
      expect(loaded.items[3].contentId).toBe('400');
      expect(loaded.shuffleOrder).toEqual([3, 1, 0, 2]);
    });
  });

  describe('save overwrites previous queue', () => {
    it('overwrites an existing queue file on subsequent save', async () => {
      const first = new MediaQueue({
        position: 0,
        items: [{ queueId: 'old1', title: 'Old Track' }],
      });

      await store.save(first, 'default');

      const second = new MediaQueue({
        position: 0,
        items: [
          { queueId: 'new1', title: 'New Track A' },
          { queueId: 'new2', title: 'New Track B' },
        ],
      });

      await store.save(second, 'default');

      const loaded = await store.load('default');
      expect(loaded.items).toHaveLength(2);
      expect(loaded.items[0].title).toBe('New Track A');
      expect(loaded.items[1].title).toBe('New Track B');
    });
  });

  describe('household isolation', () => {
    it('stores queues separately per household', async () => {
      const queueA = new MediaQueue({
        position: 0,
        items: [{ queueId: 'a1', title: 'Household A Track' }],
      });
      const queueB = new MediaQueue({
        position: 0,
        items: [{ queueId: 'b1', title: 'Household B Track' }],
      });

      await store.save(queueA, 'default');
      await store.save(queueB, 'other');

      const loadedA = await store.load('default');
      const loadedB = await store.load('other');

      expect(loadedA.items[0].title).toBe('Household A Track');
      expect(loadedB.items[0].title).toBe('Household B Track');
    });
  });
});
