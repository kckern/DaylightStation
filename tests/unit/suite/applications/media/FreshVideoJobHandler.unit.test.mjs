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
import { createFreshVideoJobHandler } from '#apps/media/YouTubeJobHandler.mjs';

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

    it('should throw ValidationError if mediaPath is undefined', () => {
      const mockGateway = { download: jest.fn() };
      const mockLoadFile = jest.fn().mockResolvedValue({ sources: [] });
      const mockLogger = { info: jest.fn(), error: jest.fn() };

      expect(() => createFreshVideoJobHandler({
        videoSourceGateway: mockGateway,
        loadFile: mockLoadFile,
        mediaPath: undefined,
        logger: mockLogger
      })).toThrow(/mediaPath.*required/i);
    });

    it('should throw ValidationError if mediaPath is null', () => {
      const mockGateway = { download: jest.fn() };
      const mockLoadFile = jest.fn().mockResolvedValue({ sources: [] });
      const mockLogger = { info: jest.fn(), error: jest.fn() };

      expect(() => createFreshVideoJobHandler({
        videoSourceGateway: mockGateway,
        loadFile: mockLoadFile,
        mediaPath: null,
        logger: mockLogger
      })).toThrow(/mediaPath.*required/i);
    });

    it('should throw ValidationError if mediaPath is empty string', () => {
      const mockGateway = { download: jest.fn() };
      const mockLoadFile = jest.fn().mockResolvedValue({ sources: [] });
      const mockLogger = { info: jest.fn(), error: jest.fn() };

      expect(() => createFreshVideoJobHandler({
        videoSourceGateway: mockGateway,
        loadFile: mockLoadFile,
        mediaPath: '',
        logger: mockLogger
      })).toThrow(/mediaPath.*required/i);
    });

    it('should create handler successfully with valid mediaPath', () => {
      const mockGateway = { download: jest.fn() };
      const mockLoadFile = jest.fn().mockResolvedValue({ sources: [] });
      const mockLogger = { info: jest.fn(), error: jest.fn() };

      const handler = createFreshVideoJobHandler({
        videoSourceGateway: mockGateway,
        loadFile: mockLoadFile,
        mediaPath: tempDir,
        logger: mockLogger
      });

      expect(typeof handler).toBe('function');
    });
  });
});
