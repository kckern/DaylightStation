import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';
import { fileURLToPath } from 'url';
import { PersonalContextLoader } from '#apps/health/PersonalContextLoader.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../../..');
const FIXTURE_PLAYBOOK_PATH = path.join(
  PROJECT_ROOT,
  'tests/_fixtures/health-archive/external/playbook/playbook.yml',
);

/**
 * Build a fake archive root that mimics the per-user data layout:
 *   <root>/<userId>/lifelog/archives/playbook/playbook.yml
 *
 * We don't touch the real filesystem — instead we inject a mock dataService
 * that returns the parsed fixture YAML when the expected absolute path is read.
 */
function buildFixtureDataService({ userId, archiveRoot, playbookContent }) {
  const expectedAbsPath = path.join(
    archiveRoot,
    userId,
    'lifelog/archives/playbook/playbook.yml',
  );

  return {
    expectedAbsPath,
    readYaml: vi.fn(async (absPath) => {
      if (absPath === expectedAbsPath) return playbookContent;
      return null;
    }),
  };
}

describe('PersonalContextLoader', () => {
  let parsedFixture;

  beforeEach(() => {
    const raw = fs.readFileSync(FIXTURE_PLAYBOOK_PATH, 'utf8');
    parsedFixture = yaml.load(raw);
  });

  it('loads playbook.yml from per-user path', async () => {
    const userId = 'test-user';
    const archiveRoot = '/fake/data/users';
    const dataService = buildFixtureDataService({
      userId,
      archiveRoot,
      playbookContent: parsedFixture,
    });

    const loader = new PersonalContextLoader({ dataService, archiveRoot });
    const bundle = await loader.load(userId);

    expect(dataService.readYaml).toHaveBeenCalledOnce();
    expect(dataService.readYaml).toHaveBeenCalledWith(dataService.expectedAbsPath);
    expect(typeof bundle).toBe('string');
    expect(bundle.length).toBeGreaterThan(0);
  });

  it('produces a string with profile, calibration, named periods, and patterns sections', async () => {
    const userId = 'test-user';
    const archiveRoot = '/fake/data/users';
    const dataService = buildFixtureDataService({
      userId,
      archiveRoot,
      playbookContent: parsedFixture,
    });

    const loader = new PersonalContextLoader({ dataService, archiveRoot });
    const bundle = await loader.load(userId);

    // Header
    expect(bundle).toMatch(/^## Personal Context/);

    // Section headings
    expect(bundle).toContain('### Profile');
    expect(bundle).toContain('### Calibration');
    expect(bundle).toContain('### Named Periods');
    expect(bundle).toContain('### Patterns');

    // Profile content
    expect(bundle).toContain('Maintain lean mass');
    expect(bundle).toContain('Responds to structure, not willpower.');

    // Calibration constants
    expect(bundle).toMatch(/Last DEXA:/);
    expect(bundle).toMatch(/Consumer-BIA lean offset.*-4/);
    expect(bundle).toMatch(/Consumer-BIA body-fat offset.*4/);

    // Named periods (one-line each)
    expect(bundle).toContain('fixture-cut-2024');
    expect(bundle).toContain('fixture-rebound-2024');

    // Patterns grouped by mode, severity-sorted (high before medium before low)
    expect(bundle).toContain('Failure modes:');
    expect(bundle).toContain('Success modes:');
    expect(bundle).toContain('if-trap-risk');
    expect(bundle).toContain('maintenance-drift');
    expect(bundle).toContain('same-jog-rut');
    expect(bundle).toContain('tracked-cut-formula');

    // Severity sort within failure_mode: both high entries appear before the medium one
    const idxIfTrap = bundle.indexOf('if-trap-risk');
    const idxMaintenance = bundle.indexOf('maintenance-drift');
    const idxJogRut = bundle.indexOf('same-jog-rut');
    expect(idxIfTrap).toBeGreaterThan(0);
    expect(idxMaintenance).toBeGreaterThan(0);
    expect(idxJogRut).toBeGreaterThan(0);
    expect(Math.max(idxIfTrap, idxMaintenance)).toBeLessThan(idxJogRut);
  });

  it('respects token budget — output stays within char-count proxy of 12000', async () => {
    const userId = 'test-user';
    const archiveRoot = '/fake/data/users';

    // Build an inflated playbook to force truncation: lots of low-severity patterns
    // and many named periods.
    const inflated = JSON.parse(JSON.stringify(parsedFixture));
    const filler = 'lorem ipsum '.repeat(80); // ~960 chars per description
    for (let i = 0; i < 50; i++) {
      inflated.patterns.push({
        name: `low-pattern-${i}`,
        type: 'failure_mode',
        detection: {},
        description: filler,
        recommended_response: filler,
        severity: 'low',
      });
    }
    for (let i = 0; i < 50; i++) {
      inflated.named_periods[`extra-period-${i}`] = {
        from: '2023-01-01',
        to: '2023-12-31',
        description: filler,
      };
    }

    const dataService = buildFixtureDataService({
      userId,
      archiveRoot,
      playbookContent: inflated,
    });

    const loader = new PersonalContextLoader({
      dataService,
      archiveRoot,
      tokenBudget: 3000,
    });
    const bundle = await loader.load(userId);

    expect(bundle.length).toBeLessThanOrEqual(12000);
    // High-severity failure-mode patterns should always survive truncation
    expect(bundle).toContain('if-trap-risk');
    expect(bundle).toContain('maintenance-drift');
    // Header should always survive
    expect(bundle).toMatch(/^## Personal Context/);
  });

  it('returns an empty bundle gracefully when playbook is missing', async () => {
    const userId = 'test-user';
    const archiveRoot = '/fake/data/users';
    const dataService = {
      readYaml: vi.fn(async () => null),
    };

    const loader = new PersonalContextLoader({ dataService, archiveRoot });
    const bundle = await loader.load(userId);

    expect(bundle).toBe('');
    expect(dataService.readYaml).toHaveBeenCalledOnce();
  });

  it('blocks path traversal — userId with "../" is rejected before any I/O', async () => {
    const dataService = { readYaml: vi.fn() };
    const loader = new PersonalContextLoader({
      dataService,
      archiveRoot: '/fake/data/users',
    });

    await expect(loader.load('../etc')).rejects.toThrow(/userId/i);
    await expect(loader.load('foo/bar')).rejects.toThrow(/userId/i);
    await expect(loader.load('')).rejects.toThrow(/userId/i);
    await expect(loader.load('..')).rejects.toThrow(/userId/i);

    expect(dataService.readYaml).not.toHaveBeenCalled();
  });
});
