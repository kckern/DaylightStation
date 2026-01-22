// tests/unit/infrastructure/routing/ConfigLoader.test.mjs
import { loadRoutingConfig } from '#backend/src/0_infrastructure/routing/ConfigLoader.mjs';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('ConfigLoader', () => {
  let tempDir;
  let configPath;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'routing-test-'));
    configPath = path.join(tempDir, 'routing.yml');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true });
  });

  describe('loadRoutingConfig', () => {
    it('loads valid config with simple path mappings', () => {
      fs.writeFileSync(configPath, `
default: legacy
routing:
  /api/finance: new
  /api/content: legacy
`);
      const availableShims = {};

      const config = loadRoutingConfig(configPath, availableShims);

      expect(config.default).toBe('legacy');
      expect(config.routing['/api/finance']).toBe('new');
      expect(config.routing['/api/content']).toBe('legacy');
    });

    it('loads config with shim references', () => {
      fs.writeFileSync(configPath, `
default: legacy
routing:
  /api/finance:
    target: new
    shim: finance-data-v1
`);
      const availableShims = { 'finance-data-v1': { transform: () => {} } };

      const config = loadRoutingConfig(configPath, availableShims);

      expect(config.routing['/api/finance'].target).toBe('new');
      expect(config.routing['/api/finance'].shim).toBe('finance-data-v1');
    });

    it('throws error for unknown shim reference', () => {
      fs.writeFileSync(configPath, `
default: legacy
routing:
  /api/finance:
    target: new
    shim: nonexistent-shim
`);
      const availableShims = {};

      expect(() => loadRoutingConfig(configPath, availableShims))
        .toThrow('references unknown shim "nonexistent-shim"');
    });

    it('throws error for invalid target', () => {
      fs.writeFileSync(configPath, `
default: legacy
routing:
  /api/finance: invalid
`);
      const availableShims = {};

      expect(() => loadRoutingConfig(configPath, availableShims))
        .toThrow('has invalid target "invalid"');
    });

    it('throws error for missing config file', () => {
      expect(() => loadRoutingConfig('/nonexistent/path.yml', {}))
        .toThrow();
    });

    it('throws error for invalid default target', () => {
      fs.writeFileSync(configPath, `
default: invalid
routing:
  /api/finance: new
`);
      const availableShims = {};

      expect(() => loadRoutingConfig(configPath, availableShims))
        .toThrow('Invalid default target "invalid"');
    });
  });
});
