/**
 * CLI Image Handler Tests
 * @module cli/__tests__/CLIImageHandler.test
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';
import { CLIImageHandler } from '../media/CLIImageHandler.mjs';

describe('CLIImageHandler', () => {
  let imageHandler;
  const testTmpDir = '/tmp/chatbot-cli-test/images';

  beforeEach(async () => {
    imageHandler = new CLIImageHandler({ tmpDir: testTmpDir });
    
    // Clean up test directory
    try {
      await fs.rm(testTmpDir, { recursive: true });
    } catch {
      // Directory may not exist
    }
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testTmpDir, { recursive: true });
    } catch {
      // Ignore
    }
  });

  describe('initialize', () => {
    it('should create tmp directory', async () => {
      await imageHandler.initialize();
      
      const stat = await fs.stat(testTmpDir);
      expect(stat.isDirectory()).toBe(true);
    });

    it('should not fail if directory exists', async () => {
      await fs.mkdir(testTmpDir, { recursive: true });
      
      // Should not throw
      await imageHandler.initialize();
    });
  });

  describe('getTmpDir', () => {
    it('should return configured tmp directory', () => {
      expect(imageHandler.getTmpDir()).toBe(testTmpDir);
    });

    it('should use default directory if not specified', () => {
      const defaultHandler = new CLIImageHandler();
      expect(defaultHandler.getTmpDir()).toBe('/tmp/chatbot-cli/images');
    });
  });

  describe('saveBuffer', () => {
    it('should save buffer to file', async () => {
      const buffer = Buffer.from('fake image data');
      
      const savedPath = await imageHandler.saveBuffer(buffer, 'test.png');
      
      expect(savedPath).toContain('test.png');
      
      const content = await fs.readFile(savedPath);
      expect(content.toString()).toBe('fake image data');
    });

    it('should generate filename if not provided', async () => {
      const buffer = Buffer.from('fake image data');
      
      const savedPath = await imageHandler.saveBuffer(buffer);
      
      expect(savedPath).toMatch(/image-\d+-\d+\.png$/);
    });

    it('should create unique filenames', async () => {
      const buffer = Buffer.from('fake image data');
      
      const path1 = await imageHandler.saveBuffer(buffer);
      const path2 = await imageHandler.saveBuffer(buffer);
      
      expect(path1).not.toBe(path2);
    });
  });

  describe('saveBase64', () => {
    it('should save base64 encoded image', async () => {
      const base64 = Buffer.from('test image').toString('base64');
      
      const savedPath = await imageHandler.saveBase64(base64, 'image/png');
      
      expect(savedPath).toMatch(/\.png$/);
      
      const content = await fs.readFile(savedPath);
      expect(content.toString()).toBe('test image');
    });

    it('should use correct extension for mime type', async () => {
      const base64 = Buffer.from('test').toString('base64');
      
      const jpgPath = await imageHandler.saveBase64(base64, 'image/jpeg');
      expect(jpgPath).toMatch(/\.jpg$/);
      
      const gifPath = await imageHandler.saveBase64(base64, 'image/gif');
      expect(gifPath).toMatch(/\.gif$/);
    });
  });

  describe('copyFile', () => {
    it('should copy local file to tmp directory', async () => {
      // Create a source file
      const sourceDir = '/tmp/chatbot-cli-test/source';
      await fs.mkdir(sourceDir, { recursive: true });
      const sourcePath = path.join(sourceDir, 'original.png');
      await fs.writeFile(sourcePath, 'original content');
      
      const copiedPath = await imageHandler.copyFile(sourcePath);
      
      expect(copiedPath).toContain(testTmpDir);
      
      const content = await fs.readFile(copiedPath);
      expect(content.toString()).toBe('original content');
      
      // Clean up source
      await fs.rm(sourceDir, { recursive: true });
    });
  });

  describe('cleanup', () => {
    it('should delete old files', async () => {
      await imageHandler.initialize();
      
      // Create a file
      const filePath = path.join(testTmpDir, 'old-file.png');
      await fs.writeFile(filePath, 'old content');
      
      // Set file modification time to 2 hours ago
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      await fs.utimes(filePath, twoHoursAgo, twoHoursAgo);
      
      // Cleanup files older than 1 hour
      const deleted = await imageHandler.cleanup(60 * 60 * 1000);
      
      expect(deleted).toBe(1);
      
      // Verify file is deleted
      await expect(fs.access(filePath)).rejects.toThrow();
    });

    it('should keep recent files', async () => {
      await imageHandler.initialize();
      
      // Create a recent file
      const filePath = path.join(testTmpDir, 'recent-file.png');
      await fs.writeFile(filePath, 'recent content');
      
      // Cleanup files older than 1 hour
      const deleted = await imageHandler.cleanup(60 * 60 * 1000);
      
      expect(deleted).toBe(0);
      
      // Verify file still exists
      await fs.access(filePath);
    });
  });
});
