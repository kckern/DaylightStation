import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const warn = vi.hoisted(() => vi.fn());
vi.mock('#system/logging/logger.mjs', () => ({
  createLogger: () => ({ warn, info: vi.fn(), error: vi.fn(), debug: vi.fn(), child() { return this; } }),
}));

const { getCurriculumIndex, configureCurriculumDir, curriculumDirFor } = await import(
  '../../../../__app_modules/learning/piano/server/adapters/plex-curriculum/CurriculumIndex.mjs');

describe('curriculum index lives in the data volume', () => {
  beforeEach(() => { warn.mockClear(); configureCurriculumDir(null); });

  it('curriculumDirFor puts it under <data>/content/piano/curriculum', () => {
    expect(curriculumDirFor('/data')).toBe('/data/content/piano/curriculum');
  });
  it('loads <dir>/<show>.json from the configured dir', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cur-data-'));
    const dir = curriculumDirFor(dataDir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '55.json'), JSON.stringify({ show: 55, seasons: {}, episodes: {} }));
    configureCurriculumDir(dir);
    expect(getCurriculumIndex(55).show).toBe(55);
    expect(warn).not.toHaveBeenCalled();
  });
  it('a missing file returns null and warns exactly once per show', () => {
    configureCurriculumDir(fs.mkdtempSync(path.join(os.tmpdir(), 'cur-empty-')));
    expect(getCurriculumIndex(56)).toBeNull();
    expect(getCurriculumIndex(56)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe('piano.curriculum.unavailable');
    expect(warn.mock.calls[0][1]).toMatchObject({ show: '56', reason: 'file-missing' });
  });
  it('an unconfigured dir returns null and warns', () => {
    expect(getCurriculumIndex(57)).toBeNull();
    expect(warn.mock.calls[0][1]).toMatchObject({ reason: 'curriculum-dir-not-configured' });
  });
});
