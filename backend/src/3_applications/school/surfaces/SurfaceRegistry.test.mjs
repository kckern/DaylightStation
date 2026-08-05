import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { YamlSurfaceProfileRepository } from '#adapters/school/catalog/YamlSurfaceProfileRepository.mjs';
import { ti86CodecBaselineProfile } from '#adapters/schoolcalc/ti86/Ti86SurfaceCertification.mjs';
import { SurfaceRegistry } from './SurfaceRegistry.mjs';

const paperProfile = {
  schema: 'school.surface-profile/v1', title: 'Letter paper (mono)',
  surfaceId: 'paper-letter-mono', family: 'paper', liveness: 'static',
  capabilities: [
    'reader@1', 'examples@1', 'quiz@1', 'problems@1', 'flashcards@1',
    'image@1', 'math@1', 'table-layout@1', 'scan-action@1',
    'response.choice@1', 'response.asset-choice@1', 'return.scan@1',
  ],
  limits: { omrChannels: 12, maxItemsPerSheet: 25, maxPagesPerDocument: 20 },
};

const screenProfile = {
  schema: 'school.surface-profile/v1', title: 'Office screen',
  surfaceId: 'screen-office', family: 'screen', liveness: 'static',
  capabilities: [
    'reader@1', 'examples@1', 'problems@1', 'flashcards@1', 'quiz@1', 'learning-probe@1',
    'activity.matching@1', 'calculator@1', 'graph@1',
    'image@1', 'math@1', 'table-layout@1', 'scan-action@1',
    'response.choice@1', 'response.text@1', 'response.matching@1',
    'response.region@1', 'response.asset-choice@1',
    'return.session@1',
  ],
  limits: {},
};

/** Uses a capability that only exists once injected via `customCapabilities`. */
const customCapabilityProfile = {
  schema: 'school.surface-profile/v1', title: 'Custom widget screen',
  surfaceId: 'screen-custom', family: 'screen', liveness: 'static',
  capabilities: ['reader@1', 'custom.widget@1'],
  limits: {},
};

const invalidProfile = { family: 'dispatch' };

describe('YamlSurfaceProfileRepository + SurfaceRegistry', () => {
  let directory;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'surfaces-'));
    fs.writeFileSync(path.join(directory, 'paper-letter-mono.yml'), yaml.dump(paperProfile));
    fs.writeFileSync(path.join(directory, 'screen-office.yml'), yaml.dump(screenProfile));
    fs.writeFileSync(path.join(directory, 'bad.yml'), yaml.dump(invalidProfile));
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('lists every profile file, carrying invalid ones with errors', async () => {
    const repository = new YamlSurfaceProfileRepository({ directory });
    const entries = await repository.listProfiles();

    expect(entries).toHaveLength(3);
    const valid = entries.filter((entry) => entry.profile);
    const invalid = entries.filter((entry) => !entry.profile);
    expect(valid).toHaveLength(2);
    expect(invalid).toHaveLength(1);
    expect(invalid[0].errors.length).toBeGreaterThan(0);
    expect(invalid[0].file).toBe('bad');
  });

  it('validates an injected custom capability', async () => {
    fs.writeFileSync(path.join(directory, 'screen-custom.yml'), yaml.dump(customCapabilityProfile));
    const repository = new YamlSurfaceProfileRepository({ directory, customCapabilities: ['custom.widget@1'] });
    const entries = await repository.listProfiles();
    const custom = entries.find((entry) => entry.file === 'screen-custom');
    expect(custom.profile).toBeTruthy();
    expect(custom.errors).toEqual([]);
  });

  it('errors the later file when two files share a surfaceId, keeping the first valid', async () => {
    // A copy-pasted profile that forgot to bump surfaceId — sorts after
    // 'paper-letter-mono' so it is the one flagged as the duplicate.
    const duplicateProfile = { ...paperProfile, title: 'Draft copy' };
    fs.writeFileSync(path.join(directory, 'paper-letter-mono-duplicate.yml'), yaml.dump(duplicateProfile));

    const repository = new YamlSurfaceProfileRepository({ directory });
    const entries = await repository.listProfiles();

    const first = entries.find((entry) => entry.file === 'paper-letter-mono');
    const duplicate = entries.find((entry) => entry.file === 'paper-letter-mono-duplicate');

    expect(first.profile).toBeTruthy();
    expect(first.errors).toEqual([]);

    expect(duplicate.profile).toBeUndefined();
    expect(duplicate.errors.length).toBeGreaterThan(0);
    expect(duplicate.errors[0]).toContain('paper-letter-mono');
    expect(duplicate.errors[0]).toContain('paper-letter-mono-duplicate');

    const registry = new SurfaceRegistry({
      profiles: entries,
      ports: {
        schoolcalc: { certify: () => {} },
        paper: { certify: () => {} },
        screen: { certify: () => {} },
      },
    });
    expect(registry.list().filter((p) => p.surfaceId === 'paper-letter-mono')).toHaveLength(1);
  });

  describe('SurfaceRegistry', () => {
    let entries; let ports; let baselines; let registry;

    beforeEach(async () => {
      const repository = new YamlSurfaceProfileRepository({ directory });
      entries = await repository.listProfiles();
      ports = {
        schoolcalc: { certify: () => {}, family: 'schoolcalc' },
        paper: { certify: () => {}, family: 'paper' },
        screen: { certify: () => {}, family: 'screen' },
      };
      baselines = [{ profile: ti86CodecBaselineProfile(), baseline: 'codec' }];
      registry = new SurfaceRegistry({ profiles: entries, ports, baselines });
    });

    it('exposes only the valid profiles', () => {
      const list = registry.list();
      expect(list).toHaveLength(2);
      expect(list.map((p) => p.surfaceId).sort()).toEqual(['paper-letter-mono', 'screen-office']);
    });

    it('gets a profile by surfaceId', () => {
      expect(registry.get('paper-letter-mono')).toMatchObject({ surfaceId: 'paper-letter-mono', family: 'paper' });
    });

    it('resolves the port for a profile family', () => {
      expect(registry.portFor({ family: 'paper' })).toBe(ports.paper);
      expect(registry.portFor({ family: 'screen' })).toBe(ports.screen);
      expect(registry.portFor({ family: 'schoolcalc' })).toBe(ports.schoolcalc);
    });

    it('throws portFor on an unknown family', () => {
      expect(() => registry.portFor({ family: 'dispatch' })).toThrow();
      expect(() => registry.portFor({})).toThrow();
    });

    it('exposes the codec baseline for CLI certification without a device', () => {
      const result = registry.codecBaselines();
      expect(result[0].profile.surfaceId).toBe('ti86-codec-baseline');
      expect(result[0].baseline).toBe('codec');
    });
  });
});
