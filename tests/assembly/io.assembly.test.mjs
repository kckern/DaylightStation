import { describe, it, expect, beforeAll } from '@jest/globals';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('io.mjs assembly', () => {
  let io;

  beforeAll(async () => {
    // Set test data path before importing io
    process.env.path = process.env.path || {};
    process.env.path.data = path.join(__dirname, '../_fixtures/data');

    io = await import('../../backend/lib/io.mjs');
  });

  describe('module imports', () => {
    it('exports loadFile function', () => {
      expect(typeof io.loadFile).toBe('function');
    });

    it('exports saveFile function', () => {
      expect(typeof io.saveFile).toBe('function');
    });

    it('exports userLoadFile function', () => {
      expect(typeof io.userLoadFile).toBe('function');
    });

    it('exports householdLoadFile function', () => {
      expect(typeof io.householdLoadFile).toBe('function');
    });
  });

  describe('loadFile with test fixtures', () => {
    it('loads _test household config', () => {
      const household = io.householdLoadFile('_test', 'household');
      expect(household).toBeDefined();
      expect(household.id).toBe('_test');
      expect(household.head).toBe('_alice');
    });

    it('returns null for non-existent file', () => {
      const result = io.loadFile('nonexistent/path');
      expect(result).toBeNull();
    });
  });
});
