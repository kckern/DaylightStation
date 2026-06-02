/**
 * YamlSessionDatastore — voice memo retroactive persistence tests
 *
 * Reproduces the bug where a `fs_`-prefixed sessionId was forwarded
 * un-sanitized into appendVoiceMemo. deriveSessionDate() then sliced the
 * prefixed string (e.g. "fs_20260601192802" → "fs_2-02-60") yielding a bogus
 * date, so the storage path pointed at a non-existent directory, the load
 * returned null, and the memo was silently dropped.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { YamlSessionDatastore } from '#adapters/persistence/yaml/YamlSessionDatastore.mjs';
import { saveYaml, loadYamlSafe } from '#system/utils/FileIO.mjs';

describe('YamlSessionDatastore — appendVoiceMemo with prefixed sessionId', () => {
  let store;
  let tmpDir;
  const DATE = '2026-06-01';
  const BARE_ID = '20260601192802';
  const PREFIXED_ID = 'fs_20260601192802';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-vm-test-'));
    const configService = {
      getHouseholdPath: (subPath) => path.join(tmpDir, subPath),
    };
    store = new YamlSessionDatastore({ configService });

    // Seed a persisted (ended) session at the canonical dated path.
    const sessionsDir = path.join(tmpDir, 'history/fitness', DATE);
    fs.mkdirSync(sessionsDir, { recursive: true });
    saveYaml(path.join(sessionsDir, BARE_ID), {
      sessionId: BARE_ID,
      startTime: 1748800000000,
      endTime: 1748803600000,
      durationMs: 3600000,
      timezone: 'UTC',
      participants: {},
      summary: {},
      timeline: { series: {}, events: [] },
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('persists the memo when given a bare (sanitized) sessionId', async () => {
    const result = await store.appendVoiceMemo(BARE_ID, undefined, {
      transcriptClean: 'sanity check memo',
      durationSeconds: 5,
    });
    expect(result).not.toBeNull();
    const data = loadYamlSafe(path.join(tmpDir, 'history/fitness', DATE, BARE_ID));
    expect(data.summary.voiceMemos).toHaveLength(1);
    expect(data.summary.voiceMemos[0].transcript).toBe('sanity check memo');
  });

  it('derives the canonical dated path from a prefixed sessionId (deriveSessionDate regression)', () => {
    const barePaths = store.getStoragePaths(BARE_ID, undefined);
    const prefixedPaths = store.getStoragePaths(PREFIXED_ID, undefined);
    expect(prefixedPaths).not.toBeNull();
    expect(prefixedPaths.sessionDate).toBe(DATE);
    // Prefixed and bare ids must resolve to the SAME file/dirs.
    expect(prefixedPaths.sessionFilePath).toBe(barePaths.sessionFilePath);
    expect(prefixedPaths.screenshotsDir).toBe(barePaths.screenshotsDir);
    expect(prefixedPaths.screenshotsRelativeBase).toBe(barePaths.screenshotsRelativeBase);
  });

  it('persists the memo when given a fs_-prefixed sessionId (regression)', async () => {
    const result = await store.appendVoiceMemo(PREFIXED_ID, undefined, {
      transcriptClean: 'retroactive prefixed memo',
      durationSeconds: 7,
    });

    // Must NOT silently drop the memo.
    expect(result).not.toBeNull();

    // It must land in the correct dated session record (derived from the
    // sanitized digits, not the bogus "fs_2-02-60" date).
    const data = loadYamlSafe(path.join(tmpDir, 'history/fitness', DATE, BARE_ID));
    expect(data).not.toBeNull();
    expect(data.summary.voiceMemos).toHaveLength(1);
    expect(data.summary.voiceMemos[0].transcript).toBe('retroactive prefixed memo');
    expect(data.timeline.events.some(e => e.type === 'voice_memo')).toBe(true);
  });
});
