// tests/assembly/bootstrap-yaml.assembly.test.mjs
import { describe, it, expect, beforeAll } from '@jest/globals';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('bootstrap-yaml.mjs', () => {
  let bootstrapReadYaml;

  beforeAll(async () => {
    const mod = await import('@backend/_legacy/lib/bootstrap-yaml.mjs');
    bootstrapReadYaml = mod.bootstrapReadYaml;
  });

  it('exports bootstrapReadYaml function', () => {
    expect(typeof bootstrapReadYaml).toBe('function');
  });

  it('returns {} for non-existent file', () => {
    const result = bootstrapReadYaml('/nonexistent/path.yml');
    expect(result).toEqual({});
  });

  it('returns {} for empty file', () => {
    const tmpFile = path.join(os.tmpdir(), `test-empty-${Date.now()}.yml`);
    fs.writeFileSync(tmpFile, '', 'utf8');
    try {
      const result = bootstrapReadYaml(tmpFile);
      expect(result).toEqual({});
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('parses valid YAML file', () => {
    const tmpFile = path.join(os.tmpdir(), `test-valid-${Date.now()}.yml`);
    fs.writeFileSync(tmpFile, 'key: value\nnested:\n  foo: bar', 'utf8');
    try {
      const result = bootstrapReadYaml(tmpFile);
      expect(result).toEqual({ key: 'value', nested: { foo: 'bar' } });
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('returns {} for invalid YAML (does not throw)', () => {
    const tmpFile = path.join(os.tmpdir(), `test-invalid-${Date.now()}.yml`);
    fs.writeFileSync(tmpFile, ':\n  - invalid: yaml: content:', 'utf8');
    try {
      const result = bootstrapReadYaml(tmpFile);
      expect(result).toEqual({});
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});
