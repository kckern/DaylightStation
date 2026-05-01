/**
 * YamlHealthScanDatastore tests (F-006 persistence)
 *
 * Real-disk integration via os.tmpdir() + mkdtemp. Each test uses an isolated
 * temp dir as `dataDir` and cleans up in afterEach.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { YamlHealthScanDatastore }
  from '#adapters/persistence/yaml/YamlHealthScanDatastore.mjs';
import { IHealthScanDatastore }
  from '#apps/health/ports/IHealthScanDatastore.mjs';
import { HealthScan } from '#domains/health/entities/HealthScan.mjs';

const USER_ID = 'test-user';

const buildScanRaw = (overrides = {}) => ({
  date: '2024-01-15',
  source: 'bodyspec_dexa',
  device_type: 'DEXA',
  weight_lbs: 175.0,
  body_fat_percent: 22.0,
  lean_tissue_lbs: 130.0,
  fat_tissue_lbs: 38.5,
  ...overrides,
});

const buildScansDir = (dataDir, userId = USER_ID) =>
  path.join(dataDir, 'users', userId, 'lifelog', 'archives', 'scans');

describe('YamlHealthScanDatastore', () => {
  let dataDir;
  let logger;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'yaml-health-scan-'));
    logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  });

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('extends IHealthScanDatastore port', () => {
    const store = new YamlHealthScanDatastore({ dataDir, logger });
    expect(store).toBeInstanceOf(IHealthScanDatastore);
  });

  it('throws when dataDir is missing', () => {
    expect(() => new YamlHealthScanDatastore({ logger })).toThrow(/dataDir/);
  });

  it('listScans returns empty array when scans dir does not exist', async () => {
    const store = new YamlHealthScanDatastore({ dataDir, logger });
    const scans = await store.listScans(USER_ID);
    expect(scans).toEqual([]);
  });

  it('listScans returns all scans sorted by date ascending', async () => {
    const store = new YamlHealthScanDatastore({ dataDir, logger });
    await store.saveScan(USER_ID, new HealthScan(buildScanRaw({ date: '2024-03-10' })));
    await store.saveScan(USER_ID, new HealthScan(buildScanRaw({ date: '2024-01-15' })));
    await store.saveScan(USER_ID, new HealthScan(buildScanRaw({ date: '2024-02-20' })));

    const scans = await store.listScans(USER_ID);
    expect(scans.map(s => s.date)).toEqual(['2024-01-15', '2024-02-20', '2024-03-10']);
    for (const scan of scans) {
      expect(scan).toBeInstanceOf(HealthScan);
    }
  });

  it('getLatestScan returns the most recent scan by date', async () => {
    const store = new YamlHealthScanDatastore({ dataDir, logger });
    await store.saveScan(USER_ID, new HealthScan(buildScanRaw({ date: '2024-03-10' })));
    await store.saveScan(USER_ID, new HealthScan(buildScanRaw({ date: '2024-01-15' })));
    await store.saveScan(USER_ID, new HealthScan(buildScanRaw({ date: '2024-02-20' })));

    const latest = await store.getLatestScan(USER_ID);
    expect(latest).toBeInstanceOf(HealthScan);
    expect(latest.date).toBe('2024-03-10');
  });

  it('getLatestScan returns null when no scans exist', async () => {
    const store = new YamlHealthScanDatastore({ dataDir, logger });
    const latest = await store.getLatestScan(USER_ID);
    expect(latest).toBeNull();
  });

  it('saveScan writes ${date}-${source}.yml using HealthScan instance', async () => {
    const store = new YamlHealthScanDatastore({ dataDir, logger });
    const scan = new HealthScan(buildScanRaw({ date: '2024-01-15', source: 'bodyspec_dexa' }));
    await store.saveScan(USER_ID, scan);

    const expectedPath = path.join(buildScansDir(dataDir), '2024-01-15-bodyspec_dexa.yml');
    const stat = await fs.stat(expectedPath);
    expect(stat.isFile()).toBe(true);
  });

  it('saveScan rejects non-HealthScan input', async () => {
    const store = new YamlHealthScanDatastore({ dataDir, logger });
    await expect(store.saveScan(USER_ID, buildScanRaw())).rejects.toThrow(/HealthScan/);
  });

  it('saveScan creates the scans directory if missing', async () => {
    const store = new YamlHealthScanDatastore({ dataDir, logger });
    const scansDir = buildScansDir(dataDir);

    // Pre-condition: scans dir does not exist yet
    await expect(fs.stat(scansDir)).rejects.toThrow();

    await store.saveScan(USER_ID, new HealthScan(buildScanRaw()));

    const stat = await fs.stat(scansDir);
    expect(stat.isDirectory()).toBe(true);
  });

  it('saveScan + listScans round-trip preserves all fields including optional ones', async () => {
    const store = new YamlHealthScanDatastore({ dataDir, logger });
    const fullRaw = buildScanRaw({
      bone_mineral_content_lbs: 6.5,
      bmr_kcal: 1700,
      bmr_method: 'katch_mcardle',
      visceral_fat_lbs: 0.7,
      bone_density_z_score: 1.1,
      asymmetry: { left_arm_lean_lbs: 7.2, right_arm_lean_lbs: 7.4 },
      regional: { trunk_fat_percent: 21.0, legs_fat_percent: 19.0 },
      raw_pdf_path: '/placeholder/2024-01-15-dexa.pdf',
      raw_image_path: '/placeholder/2024-01-15-dexa.jpg',
      notes: 'A multi-line note\nwith details.',
    });
    const original = new HealthScan(fullRaw);
    await store.saveScan(USER_ID, original);

    const [loaded] = await store.listScans(USER_ID);
    expect(loaded.date).toBe(original.date);
    expect(loaded.source).toBe(original.source);
    expect(loaded.deviceType).toBe(original.deviceType);
    expect(loaded.weightLbs).toBe(original.weightLbs);
    expect(loaded.bodyFatPercent).toBe(original.bodyFatPercent);
    expect(loaded.leanTissueLbs).toBe(original.leanTissueLbs);
    expect(loaded.fatTissueLbs).toBe(original.fatTissueLbs);
    expect(loaded.boneMineralContentLbs).toBe(6.5);
    expect(loaded.bmrKcal).toBe(1700);
    expect(loaded.bmrMethod).toBe('katch_mcardle');
    expect(loaded.visceralFatLbs).toBe(0.7);
    expect(loaded.boneDensityZScore).toBe(1.1);
    expect(loaded.asymmetry).toEqual({ left_arm_lean_lbs: 7.2, right_arm_lean_lbs: 7.4 });
    expect(loaded.regional).toEqual({ trunk_fat_percent: 21.0, legs_fat_percent: 19.0 });
    expect(loaded.rawPdfPath).toBe('/placeholder/2024-01-15-dexa.pdf');
    expect(loaded.rawImagePath).toBe('/placeholder/2024-01-15-dexa.jpg');
    expect(loaded.notes).toBe('A multi-line note\nwith details.');
  });

  it('listScans handles js-yaml Date coercion — date stored as string, not JS Date', async () => {
    // Simulate a YAML file written without quotes — js-yaml's default schema
    // will coerce `date: 2024-01-15` into a JS Date. We write the file by hand
    // (no quotes around date) and confirm the adapter still produces a string.
    const store = new YamlHealthScanDatastore({ dataDir, logger });
    const scansDir = buildScansDir(dataDir);
    await fs.mkdir(scansDir, { recursive: true });

    // Note: date written WITHOUT quotes — default js-yaml schema would coerce.
    const yamlContent = [
      'date: 2024-01-15',
      'source: bodyspec_dexa',
      'device_type: DEXA',
      'weight_lbs: 175.0',
      'body_fat_percent: 22.0',
      'lean_tissue_lbs: 130.0',
      'fat_tissue_lbs: 38.5',
      '',
    ].join('\n');
    await fs.writeFile(
      path.join(scansDir, '2024-01-15-bodyspec_dexa.yml'),
      yamlContent,
      'utf8',
    );

    const scans = await store.listScans(USER_ID);
    expect(scans).toHaveLength(1);
    expect(typeof scans[0].date).toBe('string');
    expect(scans[0].date).toBe('2024-01-15');
  });

  it('deleteScan removes file by date (matches ${date}-* pattern)', async () => {
    const store = new YamlHealthScanDatastore({ dataDir, logger });
    await store.saveScan(USER_ID, new HealthScan(buildScanRaw({ date: '2024-01-15', source: 'bodyspec_dexa' })));
    await store.saveScan(USER_ID, new HealthScan(buildScanRaw({ date: '2024-02-20', source: 'bodyspec_dexa' })));

    await store.deleteScan(USER_ID, '2024-01-15');

    const scans = await store.listScans(USER_ID);
    expect(scans).toHaveLength(1);
    expect(scans[0].date).toBe('2024-02-20');

    const deletedPath = path.join(buildScansDir(dataDir), '2024-01-15-bodyspec_dexa.yml');
    await expect(fs.stat(deletedPath)).rejects.toThrow();
  });

  it('deleteScan removes ALL scans for a date when multiple sources exist', async () => {
    const store = new YamlHealthScanDatastore({ dataDir, logger });
    await store.saveScan(
      USER_ID,
      new HealthScan(buildScanRaw({ date: '2024-01-15', source: 'bodyspec_dexa', device_type: 'DEXA' })),
    );
    await store.saveScan(
      USER_ID,
      new HealthScan(buildScanRaw({ date: '2024-01-15', source: 'inbody', device_type: 'clinical_BIA' })),
    );

    await store.deleteScan(USER_ID, '2024-01-15');

    const scans = await store.listScans(USER_ID);
    expect(scans).toEqual([]);
  });

  it('deleteScan is idempotent (no error if file missing)', async () => {
    const store = new YamlHealthScanDatastore({ dataDir, logger });
    await expect(store.deleteScan(USER_ID, '2099-12-31')).resolves.toBeUndefined();
  });

  it('listScans handles malformed YAML files gracefully (skips with warn log, does not crash)', async () => {
    const store = new YamlHealthScanDatastore({ dataDir, logger });
    const scansDir = buildScansDir(dataDir);
    await fs.mkdir(scansDir, { recursive: true });

    // Valid scan
    await store.saveScan(USER_ID, new HealthScan(buildScanRaw({ date: '2024-01-15' })));

    // Malformed YAML
    await fs.writeFile(
      path.join(scansDir, '2024-02-20-broken.yml'),
      'this: is: not: valid: yaml:::',
      'utf8',
    );

    // Schema-invalid YAML (parses fine but fails HealthScan validation)
    await fs.writeFile(
      path.join(scansDir, '2024-03-10-incomplete.yml'),
      'date: "2024-03-10"\nsource: invalid_source\n',
      'utf8',
    );

    const scans = await store.listScans(USER_ID);
    expect(scans).toHaveLength(1);
    expect(scans[0].date).toBe('2024-01-15');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('rejects path-traversal in userId before any I/O (../etc, ., absolute paths)', async () => {
    const store = new YamlHealthScanDatastore({ dataDir, logger });

    await expect(store.listScans('../etc')).rejects.toThrow();
    await expect(store.listScans('foo/bar')).rejects.toThrow();
    await expect(store.listScans('')).rejects.toThrow();
    await expect(store.listScans('.')).rejects.toThrow();
    await expect(store.getLatestScan('../etc')).rejects.toThrow();
    await expect(store.deleteScan('../etc', '2024-01-15')).rejects.toThrow();
    await expect(
      store.saveScan('../etc', new HealthScan(buildScanRaw())),
    ).rejects.toThrow();
  });
});
