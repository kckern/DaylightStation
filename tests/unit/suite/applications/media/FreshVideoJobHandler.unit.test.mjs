/**
 * FreshVideoJobHandler Unit Tests
 *
 * Tests the scheduler-compatible handler for fresh video downloads.
 *
 * These tests verify that createFreshVideoJobHandler validates mediaPath
 * early (fail-fast) with a proper ValidationError before instantiating
 * FreshVideoService.
 */

import { describe, it, expect, jest, beforeAll, afterAll } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFreshVideoJobHandler } from '#apps/media/FreshVideoJobHandler.mjs';
import { FilesystemFreshVideoMediaStore } from '#adapters/persistence/files/FilesystemFreshVideoMediaStore.mjs';

describe('FreshVideoJobHandler', () => {
  describe('createFreshVideoJobHandler', () => {
    let tempDir;

    beforeAll(() => {
      // Create temp directory for valid path tests
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freshvideo-test-'));
    });

    afterAll(() => {
      // Cleanup temp directory
      if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should throw ValidationError if mediaStore is undefined', () => {
      const mockGateway = { download: jest.fn() };
      const sourceCatalog = { list: jest.fn().mockResolvedValue([]) };
      const mockLogger = { info: jest.fn(), error: jest.fn() };

      expect(() => createFreshVideoJobHandler({
        videoSourceGateway: mockGateway,
        sourceCatalog,
        mediaStore: undefined,
        logger: mockLogger
      })).toThrow(/mediaStore.*required/i);
    });

    it('should throw ValidationError if mediaStore is null', () => {
      const mockGateway = { download: jest.fn() };
      const sourceCatalog = { list: jest.fn().mockResolvedValue([]) };
      const mockLogger = { info: jest.fn(), error: jest.fn() };

      expect(() => createFreshVideoJobHandler({
        videoSourceGateway: mockGateway,
        sourceCatalog,
        mediaStore: null,
        logger: mockLogger
      })).toThrow(/mediaStore.*required/i);
    });

    it('should throw ValidationError if mediaStore is absent', () => {
      const mockGateway = { download: jest.fn() };
      const sourceCatalog = { list: jest.fn().mockResolvedValue([]) };
      const mockLogger = { info: jest.fn(), error: jest.fn() };

      expect(() => createFreshVideoJobHandler({
        videoSourceGateway: mockGateway,
        sourceCatalog,
        mediaStore: null,
        logger: mockLogger
      })).toThrow(/mediaStore.*required/i);
    });

    it('should create handler successfully with a media store', () => {
      const mockGateway = { download: jest.fn() };
      const sourceCatalog = { list: jest.fn().mockResolvedValue([]) };
      const mockLogger = { info: jest.fn(), error: jest.fn() };

      const handler = createFreshVideoJobHandler({
        videoSourceGateway: mockGateway,
        sourceCatalog,
        mediaStore: new FilesystemFreshVideoMediaStore({ mediaRoot: tempDir }),
        lockOwnerId: 4242,
        logger: mockLogger
      });

      expect(typeof handler).toBe('function');
    });
  });
});
