import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { bootstrapLifeplan } from '#composition/modules/lifeplan.mjs';

const createdDirs = [];

afterAll(() => {
  for (const dir of createdDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmpUserDir() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeplan-boot-'));
  createdDirs.push(base);
  fs.mkdirSync(path.join(base, 'test-user'), { recursive: true });
  fs.writeFileSync(
    path.join(base, 'test-user', 'lifeplan.yml'),
    `values:\n  - id: health\n    name: Health\n    rank: 1\n  - id: family\n    name: Family\n    rank: 2\ngoals: []\nbeliefs: []\n`
  );
  return base;
}

describe('bootstrapLifeplan composition', () => {
  it('driftService.computeAndSave does not throw on missing deps (A-3.2a)', async () => {
    const dataPath = tmpUserDir();
    const aggregator = { aggregateRange: async () => ({ days: {} }) };
    const { services } = bootstrapLifeplan({ dataPath, aggregator, logger: null });
    // Composition must inject cadenceService (and clock passthrough) into
    // DriftService; without it this rejects with a TypeError at
    // this.#cadenceService.resolve(...). With empty lifelog days the
    // calculator still returns a snapshot object.
    await expect(services.driftService.computeAndSave('test-user')).resolves.toBeDefined();
  });

  it('alignmentService reports ceremony adherence when records exist (A-3.3)', () => {
    const dataPath = tmpUserDir();
    fs.writeFileSync(
      path.join(dataPath, 'test-user', 'ceremony-records.yml'),
      `- type: unit_intention\n  periodId: X\n  completedAt: '2026-07-01T00:00:00Z'\n`
    );
    const aggregator = { aggregateRange: async () => ({ days: {} }) };
    const { services } = bootstrapLifeplan({ dataPath, aggregator, logger: null });
    const result = services.alignmentService.computeAlignment('test-user');
    // AlignmentService#getCeremonyAdherence returns null only when the
    // ceremonyRecordStore dep is missing; with the store injected it
    // returns { total } (here 1, from the fixture record).
    expect(result.dashboard.ceremonyAdherence).not.toBeNull();
    expect(result.dashboard.ceremonyAdherence.total).toBe(1);
  });
});
