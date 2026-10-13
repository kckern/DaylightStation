// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../tests/_lib/memory-http/plex-cli-fixture.mjs');
const SECTIONS = {
  MediaContainer: {
    Directory: [
      { key: '6', title: 'Movies', type: 'movie', Location: [{ id: 1, path: '/data/media/video/movies' }] },
      { key: '12', title: 'Documentaries', type: 'movie', Location: [{ id: 2, path: '/data/media/video/documentaries' }] }
    ]
  }
};

let hits;
let extra = [];
const base = 'http://plex.fixture.invalid';

beforeEach(() => { hits = []; extra = []; });

function cli(...args) {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'plex-refresh-fixture-'));
  const hitFile = path.join(fixtureRoot, 'hits.json');
  return new Promise((resolve) => {
    execFile('node', [CLI, ...args], { env: { ...process.env, PLEX_TOKEN: 't', PLEX_HOST: base,
      PLEX_FIXTURE_DIRECTORIES: JSON.stringify([...SECTIONS.MediaContainer.Directory, ...extra]),
      PLEX_FIXTURE_HITS: hitFile } },
      (err, stdout, stderr) => {
        try { hits.push(...JSON.parse(readFileSync(hitFile, 'utf8'))); }
        finally { rmSync(fixtureRoot, { recursive: true, force: true }); }
        resolve({ code: err ? err.code : 0, stdout, stderr });
      });
  });
}
const refreshHits = () => hits.filter((u) => u.includes('/refresh'));

describe('plex.cli refresh', () => {
  it('--path finds the section whose Location is the longest prefix', async () => {
    const r = await cli('refresh', '--path', '/data/media/video/movies/Forrest Gump (1994)');
    expect(r.code).toBe(0);
    expect(refreshHits()).toEqual([
      `/library/sections/6/refresh?path=${encodeURIComponent('/data/media/video/movies/Forrest Gump (1994)')}&X-Plex-Token=t`
    ]);
    expect(r.stdout).toContain('section 6');
  });

  it('--section refreshes the whole section and --json reports it', async () => {
    const r = await cli('refresh', '--section', '12', '--json');
    expect(r.code).toBe(0);
    expect(refreshHits()).toEqual(['/library/sections/12/refresh?X-Plex-Token=t']);
    expect(JSON.parse(r.stdout)).toEqual({ refreshed: [{ section: '12', title: 'Documentaries', path: null }], dryRun: false });
  });

  it('--all refreshes every section', async () => {
    const r = await cli('refresh', '--all');
    expect(r.code).toBe(0);
    expect(refreshHits().map((u) => u.split('/')[3])).toEqual(['6', '12']);
  });

  it('--dry-run reports but does not call Plex refresh', async () => {
    const r = await cli('refresh', '--section', '6', '--dry-run');
    expect(r.code).toBe(0);
    expect(refreshHits()).toEqual([]);
    expect(r.stdout).toContain('[dry-run] would refresh');
  });

  it('--dry-run --json reports dryRun true and makes no refresh request', async () => {
    const r = await cli('refresh', '--path', '/data/media/video/movies/X (2000)', '--dry-run', '--json');
    expect(r.code).toBe(0);
    expect(refreshHits()).toEqual([]);
    expect(JSON.parse(r.stdout)).toEqual({
      refreshed: [{ section: '6', title: 'Movies', path: '/data/media/video/movies/X (2000)' }], dryRun: true
    });
  });

  it('combining targets is an error and refreshes nothing', async () => {
    for (const combo of [['--section', '6', '--all'], ['--path', '/data/media/video/movies/X', '--section', '6'], ['--path', '/data/media/video/movies/X', '--all']]) {
      const r = await cli('refresh', ...combo);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain('exactly one');
    }
    expect(refreshHits()).toEqual([]);
  });

  it('requires a target', async () => {
    const r = await cli('refresh');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('refresh needs --section');
    expect(refreshHits()).toEqual([]);
  });

  it('a path outside every library is an error', async () => {
    const r = await cli('refresh', '--path', '/elsewhere/film');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('no library contains path');
  });

  it('an unknown section is reported, not silently ignored', async () => {
    const r = await cli('refresh', '--section', '99');
    expect(r.code).toBe(1);
  });

  it('nested libraries: longest prefix wins, and a sibling with a shared name prefix does not match', async () => {
    extra = [{ key: '20', title: 'Kids', type: 'movie', Location: [{ id: 3, path: '/data/media/video/movies/Kids/' }] }];
    let r = await cli('refresh', '--path', '/data/media/video/movies/Kids/Coco (2017)');
    expect(r.code).toBe(0);
    expect(refreshHits().map((u) => u.split('/')[3])).toEqual(['20']);
    hits = [];
    r = await cli('refresh', '--path', '/data/media/video/movies/KidsOther/X (2000)');
    expect(refreshHits().map((u) => u.split('/')[3])).toEqual(['6']);
  });
});
