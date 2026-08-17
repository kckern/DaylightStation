/**
 * task-13 review, Important 5: backfillPrimaryMedia hardcoded
 * household/config/fitness.yml, which the task-13 data move relocated to
 * household/fitness/config.yml. The try/catch around loading it silently
 * fell back to DEFAULT selection rules (no deprioritized_labels), so a
 * migrated environment would backfill --apply the WRONG primary onto every
 * session with a KidsFun-labeled candidate, contradicting the tool's own
 * "same source the runtime read path uses" claim.
 *
 * These tests prove: (1) the colocated config is found and its
 * deprioritized_labels actually change the derived primary, (2) the legacy
 * path still works as a fallback for an un-migrated data dir, and (3) a data
 * dir with NEITHER location logs a loud warning rather than failing silently.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';

import { run } from './backfillPrimaryMedia.mjs';

let dataDir;
let tmpRoot;

/** A session with a stale `primary` on the KidsFun item. */
const sessionDoc = () => ({
  version: 3,
  sessionId: '20260801100000',
  summary: {
    media: [
      { contentId: 'kids', title: 'Kids Game Cycling', mediaType: 'video', durationMs: 600000, labels: ['kidsfun'], primary: true },
      { contentId: 'real', title: 'Real Workout', mediaType: 'video', durationMs: 400000, labels: [] },
    ],
  },
});

async function makeCtx({ configAt } = {}) {
  tmpRoot = await mkdtemp(path.join(tmpdir(), 'backfill-primary-'));
  dataDir = path.join(tmpRoot, 'data');
  const historyDir = path.join(dataDir, 'household', 'fitness', 'log');
  const dateDir = path.join(historyDir, '2026-08-01');
  await mkdir(dateDir, { recursive: true });
  await writeFile(path.join(dateDir, 'session1.yml'), yaml.dump(sessionDoc()), 'utf8');

  if (configAt) {
    const configPath = path.join(dataDir, ...configAt);
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, yaml.dump({ plex: { deprioritized_labels: ['KidsFun'] } }), 'utf8');
  }

  return { dataDir, fitnessHistoryDir: historyDir };
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
});

describe('backfillPrimaryMedia — config path resolution (task-13)', () => {
  it('finds the COLOCATED config (household/fitness/config.yml) and applies its deprioritized_labels', async () => {
    const ctx = await makeCtx({ configAt: ['household', 'fitness', 'config.yml'] });
    const result = await run([], ctx);
    expect(result.scanned).toBe(1);
    expect(result.changed).toBe(1);
    expect(result.changes[0].to).toContain('Real Workout');
  });

  it('falls back to the LEGACY config (household/config/fitness.yml) for an un-migrated data dir', async () => {
    const ctx = await makeCtx({ configAt: ['household', 'config', 'fitness.yml'] });
    const result = await run([], ctx);
    expect(result.scanned).toBe(1);
    expect(result.changed).toBe(1);
    expect(result.changes[0].to).toContain('Real Workout');
  });

  it('warns loudly (does not fail silently) when neither location has the config, and falls back to DEFAULT rules', async () => {
    const ctx = await makeCtx({}); // no config anywhere
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await run([], ctx);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/could not load fitness config/i);
    // DEFAULT rules have no deprioritized_labels, so the KidsFun item (the
    // longer of the two, no other tiebreak applies) stays correctly primary
    // — no change, proving this really is "default rules", not a crash.
    expect(result.scanned).toBe(1);
    expect(result.changed).toBe(0);
    warn.mockRestore();
  });

  it('prefers the colocated config over a legacy shadow when both exist', async () => {
    const ctx = await makeCtx({ configAt: ['household', 'fitness', 'config.yml'] });
    // Plant a legacy file with DIFFERENT (empty) rules — if the tool ever
    // regressed to preferring legacy, this would silently produce changed:0.
    const legacyPath = path.join(dataDir, 'household', 'config', 'fitness.yml');
    await mkdir(path.dirname(legacyPath), { recursive: true });
    await writeFile(legacyPath, yaml.dump({ plex: { deprioritized_labels: [] } }), 'utf8');

    const result = await run([], ctx);
    expect(result.changed).toBe(1);
    expect(result.changes[0].to).toContain('Real Workout');
  });
});
