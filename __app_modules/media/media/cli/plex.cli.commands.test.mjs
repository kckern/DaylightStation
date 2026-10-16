// @vitest-environment node
// Library listing (seasons/albums/movies) and cover-art (audit/rematch/select-thumbs)
// commands, driven through the real CLI over an in-memory Plex fixture.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../../tests/_lib/memory-http/plex-cli-fixture.mjs');
const base = 'http://plex.fixture.invalid';

const meta = (...items) => ({ body: { MediaContainer: { Metadata: items } } });
const posters = (...items) => ({ body: { MediaContainer: { Metadata: items } } });
const thumb = (id) => `/photo/:/transcode?width=40&height=60&minSize=1&url=${encodeURIComponent(`/library/metadata/${id}/thumb`)}`;

function cli(routes, ...args) {
  const root = mkdtempSync(path.join(tmpdir(), 'plex-commands-fixture-'));
  const callFile = path.join(root, 'calls.json');
  return new Promise((resolve) => {
    execFile('node', [CLI, ...args], { env: { ...process.env, PLEX_TOKEN: 't', PLEX_HOST: base,
      PLEX_FIXTURE_ROUTES: JSON.stringify(routes),
      PLEX_FIXTURE_HITS: path.join(root, 'hits.json'),
      PLEX_FIXTURE_CALLS: callFile } },
      (err, stdout, stderr) => {
        let calls = [];
        try { calls = JSON.parse(readFileSync(callFile, 'utf8')); }
        finally { rmSync(root, { recursive: true, force: true }); }
        resolve({ code: err ? err.code : 0, stdout, stderr, calls,
          writes: calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.url}`) });
      });
  });
}

describe('plex.cli listing commands', () => {
  it('seasons lists every season under each show in the section', async () => {
    const r = await cli({
      '/library/sections/4/all': meta(
        { ratingKey: '10', type: 'show', title: 'Show A' },
        { ratingKey: '20', type: 'show', title: 'Show B' },
        { ratingKey: '30', type: 'movie', title: 'Stray Movie' }),
      '/library/metadata/10/children': meta(
        { ratingKey: '11', type: 'season', index: 1, title: 'Season 1' },
        { ratingKey: '12', type: 'season', index: 2, title: 'Season 2' }),
      '/library/metadata/20/children': meta(
        { ratingKey: '21', type: 'season', title: 'Specials' },
        { ratingKey: '22', type: 'episode', title: 'Not a season' })
    }, 'seasons', '--section', '4', '--json');
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual([
      { id: '11', index: '1', title: 'Season 1', show_id: '10', show_title: 'Show A', section: '4' },
      { id: '12', index: '2', title: 'Season 2', show_id: '10', show_title: 'Show A', section: '4' },
      { id: '21', index: null, title: 'Specials', show_id: '20', show_title: 'Show B', section: '4' }
    ]);
    expect(r.calls.some((c) => c.url.startsWith('/library/metadata/30'))).toBe(false);
  });

  it('albums asks for album-type items and prints tab-separated rows', async () => {
    const r = await cli({
      '/library/sections/5/all': meta(
        { ratingKey: '40', type: 'album', title: 'Album A', titleSort: 'Album A, The', parentTitle: 'Artist A' },
        { ratingKey: '41', type: 'album', title: 'Album B' })
    }, 'albums', '--section', '5');
    expect(r.code).toBe(0);
    expect(r.calls.find((c) => c.url.startsWith('/library/sections/5/all')).url).toContain('type=9');
    expect(r.stdout.trim().split('\n')).toEqual(['40\tAlbum A, The\tArtist A\tAlbum A', '41\t\t\tAlbum B']);
    expect(r.stderr).toContain('2 album(s) in section 5');
  });

  it('movies asks for movie-type items and reports year + studio', async () => {
    const r = await cli({
      '/library/sections/6/all': meta(
        { ratingKey: '50', type: 'movie', title: 'Movie A', year: 2001, studio: 'Studio A' },
        { ratingKey: '51', type: 'collection', title: 'Not a movie' })
    }, 'movies', '--section', '6', '--json');
    expect(r.code).toBe(0);
    expect(r.calls[0].url).toContain('type=1');
    expect(JSON.parse(r.stdout)).toEqual([{ id: '50', title: 'Movie A', year: 2001, studio: 'Studio A', section: '6' }]);
  });

  it('listing commands require --section', async () => {
    for (const cmd of ['seasons', 'albums', 'movies']) {
      const r = await cli({}, cmd);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain(`Usage: plex ${cmd} --section`);
      expect(r.calls).toEqual([]);
    }
  });

  it('every request carries the 30s timeout', async () => {
    const r = await cli({ '/library/sections/6/all': meta() }, 'movies', '--section', '6');
    expect(r.code).toBe(0);
    expect(r.calls.length).toBeGreaterThan(0);
    for (const c of r.calls) expect(c.timeout).toBe(30000);
  });
});

describe('plex.cli audit', () => {
  // Show 100 with four children: no candidates, a stale selected thumb, healthy, and a failing check.
  const routes = {
    '/library/metadata/100': meta({ ratingKey: '100', type: 'show', title: 'Show A' }),
    '/library/metadata/100/children': meta(
      { ratingKey: '101', type: 'season', title: 'No Art', parentTitle: 'Show A' },
      { ratingKey: '102', type: 'season', title: 'Stale Thumb' },
      { ratingKey: '103', type: 'season', title: 'Healthy' },
      { ratingKey: '104', type: 'season', title: 'Check Fails' }),
    '/library/metadata/100/posters': posters({ ratingKey: 'p100', selected: true }),
    [thumb(100)]: { body: {} },
    '/library/metadata/101/posters': posters(),
    '/library/metadata/102/posters': posters({ ratingKey: 'p102', selected: true }),
    [thumb(102)]: { status: 404 },
    '/library/metadata/103/posters': posters({ ratingKey: 'p103', selected: true }),
    [thumb(103)]: { body: {} },
    '/library/metadata/104/posters': { status: 400 }
  };

  it('reports blank covers, isolating a failed check as "has cover"', async () => {
    const r = await cli(routes, 'audit', 'item', '100', '--depth', '1', '--ids-only');
    expect(r.code).toBe(0);
    expect(r.stdout.trim().split('\n').sort()).toEqual(['101', '102']);
    expect(r.writes).toEqual([]);
  });

  it('--json --all-items includes healthy items', async () => {
    const r = await cli(routes, 'audit', 'item', '100', '--depth', '1', '--json', '--all-items');
    expect(r.code).toBe(0);
    const byId = Object.fromEntries(JSON.parse(r.stdout).map((c) => [c.id, c.hasCover]));
    expect(byId).toEqual({ 100: true, 101: false, 102: false, 103: true, 104: true });
  });

  it('depth 0 checks only the root', async () => {
    const r = await cli(routes, 'audit', 'item', '100', '--json');
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual([]);
    expect(r.calls.some((c) => c.url.includes('/children'))).toBe(false);
  });

  it('rejects an unknown scope and a missing id', async () => {
    let r = await cli(routes, 'audit', 'bogus', '1');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('Unknown scope');
    r = await cli(routes, 'audit', 'section');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('Usage: plex audit');
  });
});

describe('plex.cli rematch', () => {
  const routes = {
    '/playlists/7/items': meta(
      { ratingKey: '201', type: 'movie', title: 'Has Art' },
      { ratingKey: '202', type: 'movie', title: 'Good Match' },
      { ratingKey: '203', type: 'movie', title: 'Weak Match' },
      { ratingKey: '204', type: 'movie', title: 'Match Lookup Fails' },
      { ratingKey: '205', type: 'movie', title: 'Apply Fails' }),
    '/library/metadata/201/posters': posters({ ratingKey: 'p201' }),
    '/library/metadata/202/posters': posters(),
    '/library/metadata/202/matches': { body: { MediaContainer: { SearchResult: [
      { guid: 'agent://low', name: 'Lower', score: 70 }, { guid: 'agent://best', name: 'Best', score: 95 }] } } },
    '/library/metadata/203/posters': posters(),
    '/library/metadata/203/matches': { body: { MediaContainer: { SearchResult: [{ guid: 'agent://weak', name: 'Weak', score: 50 }] } } },
    '/library/metadata/204/posters': posters(),
    '/library/metadata/204/matches': { status: 400 },
    '/library/metadata/205/posters': posters(),
    '/library/metadata/205/matches': { body: { MediaContainer: { SearchResult: [{ guid: 'agent://x', name: 'X', score: 99 }] } } },
    'PUT /library/metadata/202/match': { body: {} },
    'PUT /library/metadata/205/match': { status: 400 }
  };

  it('applies the best match above --min-score and keeps going past failures', async () => {
    const r = await cli(routes, 'rematch', 'playlist', '7');
    expect(r.code).toBe(1); // one item errored
    expect(r.writes.sort()).toEqual([
      'PUT /library/metadata/202/match?guid=agent%3A%2F%2Fbest&name=Best',
      'PUT /library/metadata/205/match?guid=agent%3A%2F%2Fx&name=X'
    ]);
    expect(r.stdout).toContain('matched 1 | low-score skipped 1 | no match 1 | already had art 1 | errors 1');
    expect(r.stdout).toContain('"Weak Match" → best "Weak" (score 50)');
  });

  it('--dry-run applies nothing', async () => {
    const r = await cli(routes, 'rematch', 'playlist', '7', '--dry-run');
    expect(r.code).toBe(0);
    expect(r.writes).toEqual([]);
    expect(r.stdout).toContain('[dry-run] matched 2');
  });

  it('--min-score lowers the bar', async () => {
    const r = await cli(routes, 'rematch', 'playlist', '7', '--dry-run', '--min-score', '40');
    expect(r.stdout).toContain('[dry-run] matched 3 | low-score skipped 0');
  });
});

describe('plex.cli select-thumbs', () => {
  const routes = {
    '/library/collections/8/children': meta(
      { ratingKey: '301', type: 'episode', title: 'Already Selected' },
      { ratingKey: '302', type: 'episode', title: 'Needs Selection' },
      { ratingKey: '303', type: 'episode', title: 'No Candidates' },
      { ratingKey: '304', type: 'episode', title: 'Select Fails' },
      { ratingKey: '305', type: 'movie', title: 'Other Type' }),
    '/library/metadata/301/posters': posters({ ratingKey: 'a/thumb1', selected: true }, { ratingKey: 'a/thumb2' }),
    '/library/metadata/302/posters': posters(
      { ratingKey: 'b/thumb1' }, { ratingKey: 'b/local', provider: 'local' }, { ratingKey: 'b/thumb3' }),
    '/library/metadata/303/posters': posters(),
    '/library/metadata/304/posters': posters({ ratingKey: 'd/thumb1' }),
    '/library/metadata/305/posters': posters({ ratingKey: 'e/thumb1' }),
    'PUT /library/metadata/302/poster': { body: {} },
    'PUT /library/metadata/304/poster': { status: 400 },
    'PUT /library/metadata/305/poster': { body: {} },
    'PUT /library/metadata/301/poster': { body: {} }
  };
  const selectWrite = (id, key) => `PUT /library/metadata/${id}/poster?url=${encodeURIComponent(key)}`;

  it('prefers local art, skips selected items, and isolates a failed select', async () => {
    const r = await cli(routes, 'select-thumbs', 'collection', '8', '--type', 'episode');
    expect(r.code).toBe(1);
    expect(r.writes.sort()).toEqual([selectWrite(302, 'b/local'), selectWrite(304, 'd/thumb1')].sort());
    expect(r.stdout).toContain('Selected 1 | already had that selection 1 | no candidates 1 | errors 1');
  });

  it('--dry-run selects nothing', async () => {
    const r = await cli(routes, 'select-thumbs', 'collection', '8', '--dry-run');
    expect(r.code).toBe(0);
    expect(r.writes).toEqual([]);
    expect(r.stdout).toContain('[dry-run] Selected 3');
    expect(r.stdout).toContain('Needs Selection → local');
  });

  it('--slot --force picks that candidate and leaves items with too few alone', async () => {
    const r = await cli(routes, 'select-thumbs', 'collection', '8', '--type', 'episode', '--slot', '1', '--force');
    expect(r.writes.sort()).toEqual([selectWrite(301, 'a/thumb2'), selectWrite(302, 'b/local')].sort());
    expect(r.stdout).toContain('too few candidates 1');
  });

  it('rejects a bad --slot before touching Plex', async () => {
    const r = await cli(routes, 'select-thumbs', 'collection', '8', '--slot', '-1');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('--slot must be a non-negative integer');
    expect(r.calls).toEqual([]);
  });
});
