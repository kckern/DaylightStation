# Karaoke Plex Show Ingest — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A setlist-driven CLI that ingests karaoke songs from YouTube via `yt-dlp` into a Plex "Karaoke" TV show, seasons = categories, episodes = songs.

**Architecture:** Pure, unit-tested cores (setlist parse/serialize, ranker, filename builder, query builder, seed converter, discovery filter) surrounded by thin I/O shells (`yt-dlp`/`ffmpeg`/Plex). A thin `cli/karaoke-ingest.cli.mjs` entrypoint parses args and dispatches subcommands. Curation (the setlist TSV) is the source of truth; the tool only processes rows and proposes candidates.

**Tech Stack:** Node ESM (`.mjs`), `yt-dlp` + `ffmpeg`/`ffprobe` (shelled out via argv arrays, never shell-interpolated), `js-yaml` (not needed here — TSV only), vitest. Follows the `cli/midi-ingest/` module pattern (co-located `*.test.mjs`).

## Global Constraints

- **Runtime:** Node ESM `.mjs` only. No TypeScript.
- **Module pattern:** `cli/karaoke-ingest.cli.mjs` (thin entrypoint) + `cli/karaoke-ingest/` module dir with co-located `<name>.test.mjs`, mirroring `cli/midi-ingest/`.
- **Test runner:** vitest. Run a single file with `npx vitest run <path>`. Tests must not hit the network or write to the media tree — inject fakes.
- **Security:** external input (URLs, titles, queries) is passed to `yt-dlp`/`ffmpeg` as discrete argv elements, NEVER interpolated into a shell string (mirror `backend/src/1_adapters/media/YtDlpAdapter.mjs` `buildProbeArgs` note). Use `execFile`, not `exec`.
- **Media root:** `/media/kckern/Media/Slow TV/Karaoke` (writable by this host user; confirmed).
- **Show name:** `Karaoke`. Flat file layout in the show root (Plex reads season from `SxxExx`).
- **Filename format:** `Karaoke - S{NN}E{NN} - {Song} ({Artist}).mp4` (2-digit zero-padded).
- **Plex codecs:** prefer H.264 video + AAC audio, ≤1080p, `.mp4` container, for direct play.
- **Idempotency:** a row with `status=downloaded` and an existing output file is skipped unless `--force`.
- **Style profile & season scheme:** as defined in the spec `docs/superpowers/specs/2026-07-10-karaoke-plex-show-ingest-design.md`.

## Data Shapes (used across tasks)

```
Row        = { season:number, episode:number|null, artist:string, song:string,
               searchHint:string, status:string, videoId:string }
Candidate  = { id:string, title:string, channel:string, viewCount:number, duration:number }
SeedRow    = { artist:string, song:string, category:string, feature:string }
CandidateRow = { channel:string, viewCount:number, song:string, artist:string, url:string, sourceVideo:string }
```

## File Structure

```
cli/karaoke-ingest.cli.mjs          Thin entrypoint: arg parse + subcommand dispatch (Task 10)
cli/karaoke-ingest/
  config.mjs        Constants + SEASONS table + seasonName()/resolveSeason() (Task 1)
  setlist.mjs       parseSetlist / serializeSetlist (Task 1)
  setlist.test.mjs
  filename.mjs      sanitizeSegment / buildEpisodeFilename / assignEpisodes (Task 2)
  filename.test.mjs
  query.mjs         buildSearchQuery / buildSearchArgv / pinnedUrl / extractVideoId (Task 3)
  query.test.mjs
  ranker.mjs        scoreCandidate / pickBest + text helpers (Task 4)
  ranker.test.mjs
  ytdlp.mjs         buildDownloadArgv / buildEmbedArgv + search()/download()/embed() shells (Task 5)
  ytdlp.test.mjs
  ingestRun.mjs     runIngest orchestrator (injected deps) (Task 6)
  ingestRun.test.mjs
  discovery.mjs     parseSiblingEntry / filterKaraokeSiblings / guessSongArtist (Task 7)
  discovery.test.mjs
  plex.mjs          buildScanUrl + refreshSection() shell (Task 8)
  plex.test.mjs
  convertSeed.mjs   parseSeedTsv / convertSeed (Task 9)
  convertSeed.test.mjs
  README.md         (Task 10)
```

---

### Task 1: config + setlist parse/serialize

**Files:**
- Create: `cli/karaoke-ingest/config.mjs`
- Create: `cli/karaoke-ingest/setlist.mjs`
- Test: `cli/karaoke-ingest/setlist.test.mjs`

**Interfaces:**
- Produces: `MEDIA_DIR`, `SHOW_NAME`, `SETLIST_PATH`, `CANDIDATES_PATH`, `SEASONS`, `CHANNEL_WEIGHTS`, `REJECT_TERMS`, `KARAOKE_TERMS`, `SEARCH_COUNT`, `MIN_DURATION_S`, `MAX_DURATION_S`, `SCORE_FLOOR`, `FORMAT_SORT`, `MERGE_FORMAT`, `seasonName(n)`, `resolveSeason(categoryStr)` from `config.mjs`.
- Produces: `parseSetlist(tsv) → Row[]`, `serializeSetlist(rows) → string` (with header) from `setlist.mjs`.

- [ ] **Step 1: Write `config.mjs`** (no test of its own — exercised via later tasks)

```javascript
// cli/karaoke-ingest/config.mjs
import path from 'node:path';

export const MEDIA_DIR = '/media/kckern/Media/Slow TV/Karaoke';
export const SHOW_NAME = 'Karaoke';
export const SETLIST_PATH = path.join(MEDIA_DIR, 'setlist.tsv');
export const CANDIDATES_PATH = path.join(MEDIA_DIR, 'candidates.tsv');

// Season table. `seedCategories` are case-insensitive substrings matched
// (in array order) against the freeform seed "Category / Vibe" column.
export const SEASONS = [
  { number: 1, name: 'Crooners & Standards',       seedCategories: ['theatrical crooner', 'sophisticated crooner', 'timeless romance'] },
  { number: 2, name: 'Piano Men',                   seedCategories: ['piano rock master'] },
  { number: 3, name: 'Stage & Screen',              seedCategories: ['musical theater epic', 'disney renaissance'] },
  { number: 4, name: 'Emotional Ballads',           seedCategories: ['deep emotional ballad'] },
  { number: 5, name: 'Arena Power Ballads',         seedCategories: ['arena rock power ballad'] },
  { number: 6, name: 'Epic Anthems',                seedCategories: ['theatrical rock epic', 'dynamic epic climax'] },
  { number: 7, name: 'Anthems of Hope',             seedCategories: ['resilience anthem'] },
  { number: 8, name: 'Sing-Along Crowd-Pleasers',   seedCategories: ['pub / tavern essential', 'pub'] },
  { number: 9, name: 'Pop Throwbacks',              seedCategories: [] },
];

export function seasonName(n) {
  const s = SEASONS.find((x) => x.number === Number(n));
  return s ? s.name : `Season ${n}`;
}

// Returns the season number whose seedCategories first substring-match the
// given freeform category, or null if none match.
export function resolveSeason(categoryStr) {
  const c = String(categoryStr || '').toLowerCase();
  for (const s of SEASONS) {
    if (s.seedCategories.some((cat) => c.includes(cat))) return s.number;
  }
  return null;
}

// Ranking / matching knobs.
export const KARAOKE_TERMS = ['karaoke', 'instrumental', 'sing along', 'sing-along', 'backing track'];
export const REJECT_TERMS = ['reaction', 'tutorial', 'how to', 'lesson', 'cover by', 'live at', 'live in', 'concert', 'behind the scenes'];
export const CHANNEL_WEIGHTS = {
  'sing king': 1.5,
  'karafun': 1.3,
  'stingray karaoke': 1.2,
  'zzang karaoke': 1.0,
  'the karaoke channel': 1.0,
};
export const SEARCH_COUNT = 12;
export const MIN_DURATION_S = 90;    // 1.5 min
export const MAX_DURATION_S = 480;   // 8 min
export const SCORE_FLOOR = 0;        // any candidate passing hard filters is acceptable

// yt-dlp format sort (prefer h264/aac mp4 ≤1080p) + merge container.
export const FORMAT_SORT = 'res:1080,vcodec:h264,acodec:aac,ext:mp4';
export const MERGE_FORMAT = 'mp4';
```

- [ ] **Step 2: Write the failing test for `setlist.mjs`**

```javascript
// cli/karaoke-ingest/setlist.test.mjs
import { describe, it, expect } from 'vitest';
import { parseSetlist, serializeSetlist } from './setlist.mjs';

const HEADER = 'season\tepisode\tartist\tsong\tsearch_hint\tstatus\tvideo_id';

describe('parseSetlist', () => {
  it('parses rows with typed season/episode and empties', () => {
    const tsv = `${HEADER}\n6\t3\tColdplay\tViva la Vida\t\tdownloaded\tabc123\n1\t\tFrank Sinatra\tMy Way\thq\tpending\t`;
    const rows = parseSetlist(tsv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ season: 6, episode: 3, artist: 'Coldplay', song: 'Viva la Vida', searchHint: '', status: 'downloaded', videoId: 'abc123' });
    expect(rows[1]).toEqual({ season: 1, episode: null, artist: 'Frank Sinatra', song: 'My Way', searchHint: 'hq', status: 'pending', videoId: '' });
  });

  it('ignores blank lines and tolerates a missing header', () => {
    const tsv = `2\t\tElton John\tYour Song\t\tpending\t\n\n`;
    const rows = parseSetlist(tsv);
    expect(rows).toHaveLength(1);
    expect(rows[0].artist).toBe('Elton John');
  });
});

describe('serializeSetlist', () => {
  it('round-trips through parse', () => {
    const rows = [
      { season: 6, episode: 3, artist: 'Coldplay', song: 'Viva la Vida', searchHint: '', status: 'downloaded', videoId: 'abc123' },
      { season: 1, episode: null, artist: 'Frank Sinatra', song: 'My Way', searchHint: 'hq', status: 'pending', videoId: '' },
    ];
    const out = serializeSetlist(rows);
    expect(out.startsWith(HEADER)).toBe(true);
    expect(parseSetlist(out)).toEqual(rows);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run cli/karaoke-ingest/setlist.test.mjs`
Expected: FAIL — `Failed to resolve import "./setlist.mjs"`.

- [ ] **Step 4: Implement `setlist.mjs`**

```javascript
// cli/karaoke-ingest/setlist.mjs
const HEADER = ['season', 'episode', 'artist', 'song', 'search_hint', 'status', 'video_id'];

function toIntOrNull(v) {
  const s = String(v ?? '').trim();
  if (s === '') return null;
  const n = Number.parseInt(s, 10);
  return Number.isNaN(n) ? null : n;
}

export function parseSetlist(tsv) {
  const lines = String(tsv || '').split('\n').map((l) => l.replace(/\r$/, ''));
  const rows = [];
  for (const line of lines) {
    if (line.trim() === '') continue;
    const cols = line.split('\t');
    if (cols[0] === 'season' && cols[2] === 'artist') continue; // header
    const [season, episode, artist, song, searchHint, status, videoId] = cols;
    rows.push({
      season: toIntOrNull(season) ?? 0,
      episode: toIntOrNull(episode),
      artist: (artist ?? '').trim(),
      song: (song ?? '').trim(),
      searchHint: (searchHint ?? '').trim(),
      status: (status ?? 'pending').trim() || 'pending',
      videoId: (videoId ?? '').trim(),
    });
  }
  return rows;
}

export function serializeSetlist(rows) {
  const body = rows.map((r) => [
    r.season,
    r.episode ?? '',
    r.artist,
    r.song,
    r.searchHint ?? '',
    r.status ?? 'pending',
    r.videoId ?? '',
  ].join('\t'));
  return [HEADER.join('\t'), ...body].join('\n');
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run cli/karaoke-ingest/setlist.test.mjs`
Expected: PASS (5 assertions across 4 tests).

- [ ] **Step 6: Commit**

```bash
git add cli/karaoke-ingest/config.mjs cli/karaoke-ingest/setlist.mjs cli/karaoke-ingest/setlist.test.mjs
git commit -m "feat(karaoke): config + setlist TSV parse/serialize"
```

---

### Task 2: filename builder + episode assignment

**Files:**
- Create: `cli/karaoke-ingest/filename.mjs`
- Test: `cli/karaoke-ingest/filename.test.mjs`

**Interfaces:**
- Consumes: `Row[]` (Task 1 shape).
- Produces: `sanitizeSegment(s) → string`, `buildEpisodeFilename({show,season,episode,song,artist}) → string`, `assignEpisodes(rows) → Row[]` (stable per-season numbering; existing `episode` preserved).

- [ ] **Step 1: Write the failing test**

```javascript
// cli/karaoke-ingest/filename.test.mjs
import { describe, it, expect } from 'vitest';
import { sanitizeSegment, buildEpisodeFilename, assignEpisodes } from './filename.mjs';

describe('sanitizeSegment', () => {
  it('strips filesystem-reserved characters and collapses whitespace', () => {
    expect(sanitizeSegment('AC/DC:  Back?')).toBe('ACDC Back');
  });
});

describe('buildEpisodeFilename', () => {
  it('produces the Plex SxxExx form with zero padding', () => {
    expect(buildEpisodeFilename({ show: 'Karaoke', season: 6, episode: 3, song: 'Viva la Vida', artist: 'Coldplay' }))
      .toBe('Karaoke - S06E03 - Viva la Vida (Coldplay).mp4');
  });
});

describe('assignEpisodes', () => {
  it('numbers sequentially within each season in list order, preserving existing numbers', () => {
    const rows = [
      { season: 1, episode: null, artist: 'A', song: 'a', searchHint: '', status: 'pending', videoId: '' },
      { season: 2, episode: null, artist: 'B', song: 'b', searchHint: '', status: 'pending', videoId: '' },
      { season: 1, episode: 5,    artist: 'C', song: 'c', searchHint: '', status: 'downloaded', videoId: 'x' },
      { season: 1, episode: null, artist: 'D', song: 'd', searchHint: '', status: 'pending', videoId: '' },
    ];
    const out = assignEpisodes(rows);
    expect(out.map((r) => [r.season, r.episode])).toEqual([[1, 1], [2, 1], [1, 5], [1, 6]]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run cli/karaoke-ingest/filename.test.mjs`
Expected: FAIL — cannot resolve `./filename.mjs`.

- [ ] **Step 3: Implement `filename.mjs`**

```javascript
// cli/karaoke-ingest/filename.mjs
export function sanitizeSegment(s) {
  return String(s)
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

export function buildEpisodeFilename({ show, season, episode, song, artist }) {
  const base = `${sanitizeSegment(show)} - S${pad2(season)}E${pad2(episode)} - ${sanitizeSegment(song)} (${sanitizeSegment(artist)})`;
  return `${base}.mp4`;
}

export function assignEpisodes(rows) {
  const maxBySeason = {};
  for (const r of rows) {
    if (r.episode) maxBySeason[r.season] = Math.max(maxBySeason[r.season] || 0, r.episode);
  }
  return rows.map((r) => {
    if (r.episode) return r;
    const next = (maxBySeason[r.season] || 0) + 1;
    maxBySeason[r.season] = next;
    return { ...r, episode: next };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run cli/karaoke-ingest/filename.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/karaoke-ingest/filename.mjs cli/karaoke-ingest/filename.test.mjs
git commit -m "feat(karaoke): Plex filename builder + stable episode numbering"
```

---

### Task 3: query + video-id helpers

**Files:**
- Create: `cli/karaoke-ingest/query.mjs`
- Test: `cli/karaoke-ingest/query.test.mjs`

**Interfaces:**
- Consumes: `Row` (Task 1).
- Produces: `buildSearchQuery(row) → string|null` (null when a URL is pinned), `pinnedUrl(row) → string|null`, `buildSearchArgv(query, {searchCount}) → string[]`, `extractVideoId(url) → string`.

- [ ] **Step 1: Write the failing test**

```javascript
// cli/karaoke-ingest/query.test.mjs
import { describe, it, expect } from 'vitest';
import { buildSearchQuery, pinnedUrl, buildSearchArgv, extractVideoId } from './query.mjs';

const row = (over) => ({ season: 1, episode: null, artist: 'Coldplay', song: 'Viva la Vida', searchHint: '', status: 'pending', videoId: '', ...over });

describe('buildSearchQuery', () => {
  it('builds "{song} {artist} karaoke" with an optional hint appended', () => {
    expect(buildSearchQuery(row())).toBe('Viva la Vida Coldplay karaoke');
    expect(buildSearchQuery(row({ searchHint: 'HD lyrics' }))).toBe('Viva la Vida Coldplay karaoke HD lyrics');
  });
  it('returns null when the hint is a pinned URL', () => {
    expect(buildSearchQuery(row({ searchHint: 'https://youtu.be/abc' }))).toBeNull();
  });
});

describe('pinnedUrl', () => {
  it('detects a pinned http(s) URL, else null', () => {
    expect(pinnedUrl(row({ searchHint: 'https://www.youtube.com/watch?v=abc' }))).toBe('https://www.youtube.com/watch?v=abc');
    expect(pinnedUrl(row({ searchHint: 'HD' }))).toBeNull();
  });
});

describe('buildSearchArgv', () => {
  it('produces a ytsearchN argv with the query as the final positional', () => {
    expect(buildSearchArgv('a b karaoke', { searchCount: 12 })).toEqual([
      '--js-runtimes', 'node', '-J', '--flat-playlist', '--no-warnings', 'ytsearch12:a b karaoke',
    ]);
  });
});

describe('extractVideoId', () => {
  it('pulls the id from watch?v= and youtu.be forms', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractVideoId('https://youtu.be/dQw4w9WgXcQ?t=5')).toBe('dQw4w9WgXcQ');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run cli/karaoke-ingest/query.test.mjs`
Expected: FAIL — cannot resolve `./query.mjs`.

- [ ] **Step 3: Implement `query.mjs`**

```javascript
// cli/karaoke-ingest/query.mjs
export function pinnedUrl(row) {
  const h = (row.searchHint || '').trim();
  return /^https?:\/\//i.test(h) ? h : null;
}

export function buildSearchQuery(row) {
  if (pinnedUrl(row)) return null;
  const hint = (row.searchHint || '').trim();
  const q = `${row.song} ${row.artist} karaoke${hint ? ` ${hint}` : ''}`;
  return q.replace(/\s+/g, ' ').trim();
}

export function buildSearchArgv(query, { searchCount }) {
  return ['--js-runtimes', 'node', '-J', '--flat-playlist', '--no-warnings', `ytsearch${searchCount}:${query}`];
}

export function extractVideoId(url) {
  const m1 = /[?&]v=([A-Za-z0-9_-]{11})/.exec(url);
  if (m1) return m1[1];
  const m2 = /youtu\.be\/([A-Za-z0-9_-]{11})/.exec(url);
  if (m2) return m2[1];
  return '';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run cli/karaoke-ingest/query.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/karaoke-ingest/query.mjs cli/karaoke-ingest/query.test.mjs
git commit -m "feat(karaoke): search-query + video-id helpers"
```

---

### Task 4: ranker (pure scoring / pick)

**Files:**
- Create: `cli/karaoke-ingest/ranker.mjs`
- Test: `cli/karaoke-ingest/ranker.test.mjs`

**Interfaces:**
- Consumes: `Candidate[]`, `{song, artist}`, and a config object `{ karaokeTerms, rejectTerms, channelWeights, minDurationS, maxDurationS, scoreFloor }`.
- Produces: `scoreCandidate(cand, {song,artist}, cfg) → number|null` (null = rejected), `pickBest(cands, {song,artist}, cfg) → Candidate|null`.

- [ ] **Step 1: Write the failing test**

```javascript
// cli/karaoke-ingest/ranker.test.mjs
import { describe, it, expect } from 'vitest';
import { pickBest } from './ranker.mjs';

const cfg = {
  karaokeTerms: ['karaoke', 'instrumental'],
  rejectTerms: ['reaction', 'cover by', 'live at'],
  channelWeights: { 'sing king': 1.5 },
  minDurationS: 90,
  maxDurationS: 480,
  scoreFloor: 0,
};
const meta = { song: 'Viva la Vida', artist: 'Coldplay' };
const cand = (over) => ({ id: 'x', title: 'Viva la Vida (Karaoke Version)', channel: 'Random', viewCount: 1000, duration: 240, ...over });

describe('pickBest', () => {
  it('drops non-karaoke, reject-term, wrong-duration, and song-mismatch candidates', () => {
    const cands = [
      cand({ id: 'no-karaoke', title: 'Viva la Vida (Official Video)' }),
      cand({ id: 'reaction', title: 'Viva la Vida Karaoke reaction' }),
      cand({ id: 'too-short', duration: 30 }),
      cand({ id: 'wrong-song', title: 'Clocks Karaoke Version' }),
    ];
    expect(pickBest(cands, meta, cfg)).toBeNull();
  });

  it('prefers higher view count among acceptable candidates', () => {
    const cands = [cand({ id: 'low', viewCount: 100 }), cand({ id: 'high', viewCount: 500000 })];
    expect(pickBest(cands, meta, cfg).id).toBe('high');
  });

  it('applies a channel bonus that can overcome a view deficit', () => {
    const cands = [
      cand({ id: 'popular', channel: 'Random', viewCount: 20000 }),
      cand({ id: 'singking', channel: 'Sing King', viewCount: 8000 }),
    ];
    // log10(20010)≈4.30 vs log10(8010)+1.5≈3.90+1.5=5.40 → Sing King wins
    expect(pickBest(cands, meta, cfg).id).toBe('singking');
  });

  it('returns null when there are no candidates', () => {
    expect(pickBest([], meta, cfg)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run cli/karaoke-ingest/ranker.test.mjs`
Expected: FAIL — cannot resolve `./ranker.mjs`.

- [ ] **Step 3: Implement `ranker.mjs`**

```javascript
// cli/karaoke-ingest/ranker.mjs
function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
function tokens(s) {
  return normalize(s).split(' ').filter(Boolean);
}
function titleContainsAll(title, phrase) {
  const t = normalize(title);
  return tokens(phrase).every((tok) => t.includes(tok));
}
function hasAny(title, terms) {
  const t = normalize(title);
  return terms.some((term) => t.includes(normalize(term)));
}
function channelBonus(channel, weights) {
  const c = normalize(channel);
  for (const [name, w] of Object.entries(weights || {})) {
    if (c.includes(normalize(name))) return w;
  }
  return 0;
}

export function scoreCandidate(cand, { song, artist }, cfg) {
  const title = cand.title || '';
  if (!hasAny(title, cfg.karaokeTerms)) return null;
  if (hasAny(title, cfg.rejectTerms)) return null;
  const dur = cand.duration || 0;
  if (dur < cfg.minDurationS || dur > cfg.maxDurationS) return null;
  if (!titleContainsAll(title, song)) return null;
  let score = Math.log10((cand.viewCount || 0) + 10);
  score += channelBonus(cand.channel, cfg.channelWeights);
  if (titleContainsAll(title, artist)) score += 0.5;
  return score;
}

export function pickBest(cands, meta, cfg) {
  let best = null;
  let bestScore = -Infinity;
  for (const c of cands || []) {
    const s = scoreCandidate(c, meta, cfg);
    if (s === null) continue;
    if (s > bestScore) { bestScore = s; best = c; }
  }
  if (!best || bestScore < cfg.scoreFloor) return null;
  return best;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run cli/karaoke-ingest/ranker.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/karaoke-ingest/ranker.mjs cli/karaoke-ingest/ranker.test.mjs
git commit -m "feat(karaoke): candidate ranker (hard filters + view/channel scoring)"
```

---

### Task 5: yt-dlp / ffmpeg argv builders + shells

**Files:**
- Create: `cli/karaoke-ingest/ytdlp.mjs`
- Test: `cli/karaoke-ingest/ytdlp.test.mjs`

**Interfaces:**
- Consumes: config constants (`FORMAT_SORT`, `MERGE_FORMAT`, `SEARCH_COUNT`), `buildSearchArgv` (Task 3).
- Produces: `buildDownloadArgv({url,outPath,formatSort,mergeFormat}) → string[]`, `buildEmbedArgv({inPath,outPath,title,comment}) → string[]`, and async shells `search(query, {searchCount, exec}) → Candidate[]`, `download({url,outPath,exec})`, `embed({inPath,outPath,title,comment,exec})`. `exec` defaults to a promisified `execFile`; injected in tests.

- [ ] **Step 1: Write the failing test** (argv builders + `search` mapping via injected exec)

```javascript
// cli/karaoke-ingest/ytdlp.test.mjs
import { describe, it, expect } from 'vitest';
import { buildDownloadArgv, buildEmbedArgv, search } from './ytdlp.mjs';

describe('buildDownloadArgv', () => {
  it('passes url as the final positional and never shell-interpolates', () => {
    const argv = buildDownloadArgv({ url: 'https://youtu.be/abc', outPath: '/m/out.mp4', formatSort: 'res:1080', mergeFormat: 'mp4' });
    expect(argv).toEqual([
      '--js-runtimes', 'node', '--no-warnings', '--no-playlist',
      '-S', 'res:1080', '--merge-output-format', 'mp4', '-o', '/m/out.mp4', 'https://youtu.be/abc',
    ]);
  });
});

describe('buildEmbedArgv', () => {
  it('remuxes with copy codecs and sets title/comment metadata', () => {
    const argv = buildEmbedArgv({ inPath: '/m/a.tmp.mp4', outPath: '/m/a.mp4', title: 'My Way (Sinatra)', comment: 'note' });
    expect(argv).toEqual([
      '-y', '-i', '/m/a.tmp.mp4', '-map', '0', '-c', 'copy',
      '-metadata', 'title=My Way (Sinatra)', '-metadata', 'comment=note',
      '-movflags', '+faststart', '/m/a.mp4',
    ]);
  });
});

describe('search', () => {
  it('maps yt-dlp flat-playlist JSON entries to Candidate objects', async () => {
    const fakeExec = async () => ({
      stdout: JSON.stringify({ entries: [
        { id: 'v1', title: 'A Karaoke', channel: 'Sing King', view_count: 10, duration: 200 },
        { id: 'v2', title: 'B Karaoke', uploader: 'KaraFun', view_count: 5, duration: 210 },
      ] }),
    });
    const out = await search('q', { searchCount: 12, exec: fakeExec });
    expect(out).toEqual([
      { id: 'v1', title: 'A Karaoke', channel: 'Sing King', viewCount: 10, duration: 200 },
      { id: 'v2', title: 'B Karaoke', channel: 'KaraFun', viewCount: 5, duration: 210 },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run cli/karaoke-ingest/ytdlp.test.mjs`
Expected: FAIL — cannot resolve `./ytdlp.mjs`.

- [ ] **Step 3: Implement `ytdlp.mjs`**

```javascript
// cli/karaoke-ingest/ytdlp.mjs
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildSearchArgv } from './query.mjs';

const defaultExec = promisify(execFile);
const YTDLP = 'yt-dlp';
const FFMPEG = 'ffmpeg';
const MAX_BUFFER = 64 * 1024 * 1024;

export function buildDownloadArgv({ url, outPath, formatSort, mergeFormat }) {
  return [
    '--js-runtimes', 'node', '--no-warnings', '--no-playlist',
    '-S', formatSort, '--merge-output-format', mergeFormat, '-o', outPath, url,
  ];
}

export function buildEmbedArgv({ inPath, outPath, title, comment }) {
  return [
    '-y', '-i', inPath, '-map', '0', '-c', 'copy',
    '-metadata', `title=${title}`, '-metadata', `comment=${comment}`,
    '-movflags', '+faststart', outPath,
  ];
}

function mapEntry(e) {
  return {
    id: e.id,
    title: e.title || '',
    channel: e.channel || e.uploader || '',
    viewCount: e.view_count || 0,
    duration: e.duration || 0,
  };
}

export async function search(query, { searchCount, exec = defaultExec } = {}) {
  const { stdout } = await exec(YTDLP, buildSearchArgv(query, { searchCount }), { maxBuffer: MAX_BUFFER });
  const info = JSON.parse(stdout);
  const entries = Array.isArray(info.entries) ? info.entries : [];
  return entries.filter((e) => e && e.id).map(mapEntry);
}

export async function download({ url, outPath, formatSort, mergeFormat, exec = defaultExec }) {
  await exec(YTDLP, buildDownloadArgv({ url, outPath, formatSort, mergeFormat }), { maxBuffer: MAX_BUFFER });
}

export async function embed({ inPath, outPath, title, comment, exec = defaultExec }) {
  await exec(FFMPEG, buildEmbedArgv({ inPath, outPath, title, comment }), { maxBuffer: MAX_BUFFER });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run cli/karaoke-ingest/ytdlp.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/karaoke-ingest/ytdlp.mjs cli/karaoke-ingest/ytdlp.test.mjs
git commit -m "feat(karaoke): yt-dlp/ffmpeg argv builders + search/download/embed shells"
```

---

### Task 6: ingest orchestrator

**Files:**
- Create: `cli/karaoke-ingest/ingestRun.mjs`
- Test: `cli/karaoke-ingest/ingestRun.test.mjs`

**Interfaces:**
- Consumes: `assignEpisodes`, `buildEpisodeFilename` (Task 2); `buildSearchQuery`, `pinnedUrl`, `extractVideoId` (Task 3); `pickBest` (Task 4); a config object with `{ mediaDir, showName, formatSort, mergeFormat, searchCount, seasonName, ...rankerCfg }`; and injected `deps = { search, download, embed, fileExists, saveRows, log }`.
- Produces: `runIngest({ rows, config, deps, options }) → { downloaded, skipped, failed, planned }`. `options = { dryRun?, force?, season?, limit? }`.

- [ ] **Step 1: Write the failing test**

```javascript
// cli/karaoke-ingest/ingestRun.test.mjs
import { describe, it, expect } from 'vitest';
import { runIngest } from './ingestRun.mjs';

const baseCfg = {
  mediaDir: '/m', showName: 'Karaoke', formatSort: 'res:1080', mergeFormat: 'mp4', searchCount: 12,
  karaokeTerms: ['karaoke'], rejectTerms: [], channelWeights: {}, minDurationS: 90, maxDurationS: 480, scoreFloor: 0,
  seasonName: (n) => `Season ${n}`,
};
const pendingRow = (over) => ({ season: 1, episode: null, artist: 'Coldplay', song: 'Viva la Vida', searchHint: '', status: 'pending', videoId: '', ...over });

function fakeDeps(over = {}) {
  const calls = { downloads: [], embeds: [], saved: null, logs: [] };
  return {
    calls,
    deps: {
      search: async () => [{ id: 'vid1', title: 'Viva la Vida Karaoke', channel: 'Sing King', viewCount: 100, duration: 240 }],
      download: async (a) => { calls.downloads.push(a); },
      embed: async (a) => { calls.embeds.push(a); },
      fileExists: async () => false,
      saveRows: async (rows) => { calls.saved = rows; },
      log: (m) => calls.logs.push(m),
      ...over,
    },
  };
}

describe('runIngest', () => {
  it('downloads a pending row: search → download tmp → embed final → record video id', async () => {
    const { deps, calls } = fakeDeps();
    const rows = [pendingRow()];
    const summary = await runIngest({ rows, config: baseCfg, deps, options: {} });
    expect(summary.downloaded).toBe(1);
    expect(calls.downloads[0].outPath).toBe('/m/Karaoke - S01E01 - Viva la Vida (Coldplay).mp4.tmp.mp4');
    expect(calls.embeds[0].outPath).toBe('/m/Karaoke - S01E01 - Viva la Vida (Coldplay).mp4');
    expect(calls.embeds[0].title).toBe('Viva la Vida (Coldplay)');
    expect(calls.saved[0].status).toBe('downloaded');
    expect(calls.saved[0].videoId).toBe('vid1');
  });

  it('skips already-downloaded rows and does not save on dry-run', async () => {
    const { deps, calls } = fakeDeps();
    const rows = [pendingRow({ status: 'downloaded', episode: 1, videoId: 'old' })];
    const summary = await runIngest({ rows, config: baseCfg, deps, options: {} });
    expect(summary.skipped).toBe(1);
    expect(calls.downloads).toHaveLength(0);
  });

  it('marks failed when no candidate is acceptable', async () => {
    const { deps } = fakeDeps({ search: async () => [{ id: 'x', title: 'Unrelated Official Video', channel: 'z', viewCount: 9, duration: 200 }] });
    const summary = await runIngest({ rows: [pendingRow()], config: baseCfg, deps, options: {} });
    expect(summary.failed).toBe(1);
  });

  it('dry-run plans without downloading or saving', async () => {
    const { deps, calls } = fakeDeps();
    const summary = await runIngest({ rows: [pendingRow()], config: baseCfg, deps, options: { dryRun: true } });
    expect(summary.planned).toHaveLength(1);
    expect(calls.downloads).toHaveLength(0);
    expect(calls.saved).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run cli/karaoke-ingest/ingestRun.test.mjs`
Expected: FAIL — cannot resolve `./ingestRun.mjs`.

- [ ] **Step 3: Implement `ingestRun.mjs`**

```javascript
// cli/karaoke-ingest/ingestRun.mjs
import path from 'node:path';
import { assignEpisodes, buildEpisodeFilename } from './filename.mjs';
import { buildSearchQuery, pinnedUrl, extractVideoId } from './query.mjs';
import { pickBest } from './ranker.mjs';

export async function runIngest({ rows, config, deps, options = {} }) {
  const { search, download, embed, fileExists, saveRows, log } = deps;
  const summary = { downloaded: 0, skipped: 0, failed: 0, planned: [] };
  let processed = 0;

  const withEps = assignEpisodes(rows);
  for (const row of withEps) {
    if (options.season && row.season !== options.season) { continue; }
    if (row.status === 'downloaded' && !options.force) { summary.skipped++; continue; }
    if (options.limit && processed >= options.limit) { break; }

    const filename = buildEpisodeFilename({
      show: config.showName, season: row.season, episode: row.episode, song: row.song, artist: row.artist,
    });
    const finalPath = path.join(config.mediaDir, filename);
    if (!options.force && (await fileExists(finalPath))) { row.status = 'downloaded'; summary.skipped++; continue; }

    // Choose the video.
    let videoId, videoUrl, chosenTitle, chosenChannel;
    const pin = pinnedUrl(row);
    if (pin) {
      videoUrl = pin; videoId = extractVideoId(pin); chosenTitle = '(pinned)'; chosenChannel = '(pinned)';
    } else {
      const query = buildSearchQuery(row);
      const cands = await search(query, { searchCount: config.searchCount });
      const best = pickBest(cands, { song: row.song, artist: row.artist }, config);
      if (!best) {
        row.status = 'failed'; summary.failed++;
        summary.planned.push({ row, action: 'no-match', query });
        log(`FAIL no match: ${row.song} — ${row.artist}`);
        continue;
      }
      videoId = best.id; videoUrl = `https://www.youtube.com/watch?v=${best.id}`;
      chosenTitle = best.title; chosenChannel = best.channel;
    }

    processed++;
    summary.planned.push({ row, filename, videoId, chosenTitle, chosenChannel });
    if (options.dryRun) { log(`PLAN ${filename}  <=  ${chosenTitle} [${chosenChannel}] (${videoId})`); continue; }

    try {
      const tmpPath = `${finalPath}.tmp.mp4`;
      await download({ url: videoUrl, outPath: tmpPath, formatSort: config.formatSort, mergeFormat: config.mergeFormat });
      const title = `${row.song} (${row.artist})`;
      const comment = `Karaoke • ${chosenChannel} • ${chosenTitle} • Category: ${config.seasonName(row.season)}`;
      await embed({ inPath: tmpPath, outPath: finalPath, title, comment });
      row.status = 'downloaded'; row.videoId = videoId; summary.downloaded++;
      log(`OK ${filename}`);
    } catch (e) {
      row.status = 'failed'; summary.failed++;
      log(`FAIL download ${row.song}: ${e.message}`);
    }
  }

  if (!options.dryRun && saveRows) await saveRows(withEps);
  return summary;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run cli/karaoke-ingest/ingestRun.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/karaoke-ingest/ingestRun.mjs cli/karaoke-ingest/ingestRun.test.mjs
git commit -m "feat(karaoke): ingest orchestrator (search→rank→download→embed→record)"
```

---

### Task 7: discovery (sibling harvest → candidates)

**Files:**
- Create: `cli/karaoke-ingest/discovery.mjs`
- Test: `cli/karaoke-ingest/discovery.test.mjs`

**Interfaces:**
- Consumes: config `{ karaokeTerms, rejectTerms }`.
- Produces: `parseSiblingEntry(entry) → {id,title,channel,viewCount,url}`, `guessSongArtist(title) → {song,artist}`, `filterKaraokeSiblings(entries, existingIds:Set, cfg) → {id,title,channel,viewCount,url}[]`, `toCandidateRows(items, sourceVideo) → CandidateRow[]`, `serializeCandidates(rows) → string`.

- [ ] **Step 1: Write the failing test**

```javascript
// cli/karaoke-ingest/discovery.test.mjs
import { describe, it, expect } from 'vitest';
import { guessSongArtist, filterKaraokeSiblings, toCandidateRows } from './discovery.mjs';

const cfg = { karaokeTerms: ['karaoke', 'instrumental'], rejectTerms: ['reaction'] };

describe('guessSongArtist', () => {
  it('splits "Artist - Song" and strips karaoke noise', () => {
    expect(guessSongArtist('Coldplay - Viva la Vida (Karaoke Version)')).toEqual({ artist: 'Coldplay', song: 'Viva la Vida' });
  });
  it('falls back to whole string as song when no separator', () => {
    expect(guessSongArtist('Viva la Vida Karaoke')).toEqual({ artist: '', song: 'Viva la Vida' });
  });
});

describe('filterKaraokeSiblings', () => {
  it('keeps karaoke-signal titles, drops known ids and reject terms', () => {
    const entries = [
      { id: 'keep', title: 'X - Y Karaoke', channel: 'Sing King', view_count: 3, url: 'u1' },
      { id: 'seen', title: 'Z Karaoke', channel: 'Sing King', view_count: 9 },
      { id: 'react', title: 'W Karaoke reaction', channel: 'Sing King', view_count: 1 },
      { id: 'nonkar', title: 'Q Official Video', channel: 'Sing King', view_count: 2 },
    ];
    const out = filterKaraokeSiblings(entries, new Set(['seen']), cfg);
    expect(out.map((e) => e.id)).toEqual(['keep']);
  });
});

describe('toCandidateRows', () => {
  it('projects siblings into CandidateRow with guessed song/artist and source', () => {
    const items = [{ id: 'k', title: 'Coldplay - Clocks Karaoke', channel: 'Sing King', viewCount: 4, url: 'https://youtu.be/k' }];
    expect(toCandidateRows(items, 'srcVid')).toEqual([
      { channel: 'Sing King', viewCount: 4, song: 'Clocks', artist: 'Coldplay', url: 'https://youtu.be/k', sourceVideo: 'srcVid' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run cli/karaoke-ingest/discovery.test.mjs`
Expected: FAIL — cannot resolve `./discovery.mjs`.

- [ ] **Step 3: Implement `discovery.mjs`**

```javascript
// cli/karaoke-ingest/discovery.mjs
const NOISE = /\b(karaoke|instrumental|version|lyrics|hd|official|backing track|sing along|sing-along)\b/gi;

function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
function hasAny(title, terms) {
  const t = normalize(title);
  return terms.some((term) => t.includes(normalize(term)));
}

export function parseSiblingEntry(e) {
  return {
    id: e.id,
    title: e.title || '',
    channel: e.channel || e.uploader || '',
    viewCount: e.view_count || 0,
    url: e.url || (e.id ? `https://www.youtube.com/watch?v=${e.id}` : ''),
  };
}

export function guessSongArtist(title) {
  let t = String(title || '').replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');
  t = t.replace(/\|.*$/, ' ');            // drop trailing "| channel ..." segments
  const parts = t.split(/\s+-\s+/);
  let artist = '';
  let song = t;
  if (parts.length >= 2) { artist = parts[0]; song = parts.slice(1).join(' - '); }
  song = song.replace(NOISE, ' ').replace(/\s+/g, ' ').trim();
  artist = artist.replace(NOISE, ' ').replace(/\s+/g, ' ').trim();
  return { artist, song };
}

export function filterKaraokeSiblings(entries, existingIds, cfg) {
  return (entries || [])
    .map(parseSiblingEntry)
    .filter((e) => e.id && !existingIds.has(e.id))
    .filter((e) => hasAny(e.title, cfg.karaokeTerms) && !hasAny(e.title, cfg.rejectTerms));
}

export function toCandidateRows(items, sourceVideo) {
  return items.map((e) => {
    const { song, artist } = guessSongArtist(e.title);
    return { channel: e.channel, viewCount: e.viewCount, song, artist, url: e.url, sourceVideo };
  });
}

const CAND_HEADER = ['channel', 'view_count', 'song', 'artist', 'url', 'source_video'];
export function serializeCandidates(rows) {
  const body = rows.map((r) => [r.channel, r.viewCount, r.song, r.artist, r.url, r.sourceVideo].join('\t'));
  return [CAND_HEADER.join('\t'), ...body].join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run cli/karaoke-ingest/discovery.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/karaoke-ingest/discovery.mjs cli/karaoke-ingest/discovery.test.mjs
git commit -m "feat(karaoke): channel-sibling discovery → candidate rows"
```

---

### Task 8: Plex scan trigger

**Files:**
- Create: `cli/karaoke-ingest/plex.mjs`
- Test: `cli/karaoke-ingest/plex.test.mjs`

**Interfaces:**
- Produces: `buildScanUrl({host, sectionId, token, forcePath?}) → string`, async `refreshSection({host, sectionId, token, forcePath?, fetchFn?})`.

- [ ] **Step 1: Write the failing test**

```javascript
// cli/karaoke-ingest/plex.test.mjs
import { describe, it, expect } from 'vitest';
import { buildScanUrl } from './plex.mjs';

describe('buildScanUrl', () => {
  it('builds the section refresh URL with the token', () => {
    const url = buildScanUrl({ host: 'http://localhost:32400', sectionId: '3', token: 'TKN' });
    expect(url).toBe('http://localhost:32400/library/sections/3/refresh?X-Plex-Token=TKN');
  });
  it('adds an encoded forcePath when provided', () => {
    const url = buildScanUrl({ host: 'http://localhost:32400', sectionId: '3', token: 'TKN', forcePath: '/media/Slow TV/Karaoke' });
    expect(url).toContain('path=%2Fmedia%2FSlow+TV%2FKaraoke');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run cli/karaoke-ingest/plex.test.mjs`
Expected: FAIL — cannot resolve `./plex.mjs`.

- [ ] **Step 3: Implement `plex.mjs`**

```javascript
// cli/karaoke-ingest/plex.mjs
export function buildScanUrl({ host, sectionId, token, forcePath }) {
  const base = `${host}/library/sections/${sectionId}/refresh`;
  const params = new URLSearchParams({ 'X-Plex-Token': token });
  if (forcePath) params.set('path', forcePath);
  return `${base}?${params.toString()}`;
}

export async function refreshSection({ host, sectionId, token, forcePath, fetchFn = fetch }) {
  const url = buildScanUrl({ host, sectionId, token, forcePath });
  const res = await fetchFn(url, { method: 'GET' });
  if (!res.ok) throw new Error(`Plex refresh failed: ${res.status}`);
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run cli/karaoke-ingest/plex.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/karaoke-ingest/plex.mjs cli/karaoke-ingest/plex.test.mjs
git commit -m "feat(karaoke): Plex section-refresh trigger"
```

---

### Task 9: seed converter

**Files:**
- Create: `cli/karaoke-ingest/convertSeed.mjs`
- Test: `cli/karaoke-ingest/convertSeed.test.mjs`

**Interfaces:**
- Consumes: `resolveSeason` (Task 1 config).
- Produces: `parseSeedTsv(tsv) → SeedRow[]`, `convertSeed(seedRows, resolveSeasonFn) → { rows: Row[], unmatched: SeedRow[] }`.

- [ ] **Step 1: Write the failing test**

```javascript
// cli/karaoke-ingest/convertSeed.test.mjs
import { describe, it, expect } from 'vitest';
import { parseSeedTsv, convertSeed } from './convertSeed.mjs';
import { resolveSeason } from './config.mjs';

const SEED = [
  'Artist / Source\tSong Title\tCategory / Vibe\tKey Feature',
  'Frank Sinatra\tMy Way\tTheatrical Crooner\tDramatic',
  'Elton John\tCircle of Life\tPiano Rock Master / Disney\tMajestic',
  'Nobody\tMystery\tUncharted Genre\tNope',
].join('\n');

describe('parseSeedTsv', () => {
  it('reads the four seed columns and skips the header', () => {
    const rows = parseSeedTsv(SEED);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ artist: 'Frank Sinatra', song: 'My Way', category: 'Theatrical Crooner', feature: 'Dramatic' });
  });
});

describe('convertSeed', () => {
  it('maps categories to season numbers and reports unmatched rows', () => {
    const { rows, unmatched } = convertSeed(parseSeedTsv(SEED), resolveSeason);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ season: 1, episode: null, artist: 'Frank Sinatra', song: 'My Way', searchHint: '', status: 'pending', videoId: '' });
    expect(rows[1].season).toBe(2); // "Piano Rock Master / Disney" → first match Piano Men
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0].category).toBe('Uncharted Genre');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run cli/karaoke-ingest/convertSeed.test.mjs`
Expected: FAIL — cannot resolve `./convertSeed.mjs`.

- [ ] **Step 3: Implement `convertSeed.mjs`**

```javascript
// cli/karaoke-ingest/convertSeed.mjs
export function parseSeedTsv(tsv) {
  const lines = String(tsv || '').split('\n').map((l) => l.replace(/\r$/, ''));
  const rows = [];
  for (const line of lines) {
    if (line.trim() === '') continue;
    const cols = line.split('\t');
    if (/artist\s*\/\s*source/i.test(cols[0] || '')) continue; // header
    const [artist, song, category, feature] = cols;
    rows.push({
      artist: (artist ?? '').trim(),
      song: (song ?? '').trim(),
      category: (category ?? '').trim(),
      feature: (feature ?? '').trim(),
    });
  }
  return rows;
}

export function convertSeed(seedRows, resolveSeasonFn) {
  const rows = [];
  const unmatched = [];
  for (const s of seedRows) {
    const season = resolveSeasonFn(s.category);
    if (season == null) { unmatched.push(s); continue; }
    rows.push({ season, episode: null, artist: s.artist, song: s.song, searchHint: '', status: 'pending', videoId: '' });
  }
  return { rows, unmatched };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run cli/karaoke-ingest/convertSeed.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/karaoke-ingest/convertSeed.mjs cli/karaoke-ingest/convertSeed.test.mjs
git commit -m "feat(karaoke): seed TSV → structured setlist converter"
```

---

### Task 10: CLI entrypoint + README + full suite

**Files:**
- Create: `cli/karaoke-ingest.cli.mjs`
- Create: `cli/karaoke-ingest/README.md`
- Test: (integration smoke via `--dry-run` against a temp setlist; no new vitest file required)

**Interfaces:**
- Consumes: every module above + `config.mjs` constants.
- Produces: an executable CLI with subcommands `ingest`, `discover`, `plan`, `refresh-plex`, `convert-seed`.

- [ ] **Step 1: Implement `cli/karaoke-ingest.cli.mjs`**

```javascript
#!/usr/bin/env node
// cli/karaoke-ingest.cli.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import * as cfg from './karaoke-ingest/config.mjs';
import { parseSetlist, serializeSetlist } from './karaoke-ingest/setlist.mjs';
import { runIngest } from './karaoke-ingest/ingestRun.mjs';
import { search, download, embed } from './karaoke-ingest/ytdlp.mjs';
import { filterKaraokeSiblings, toCandidateRows, serializeCandidates } from './karaoke-ingest/discovery.mjs';
import { refreshSection } from './karaoke-ingest/plex.mjs';
import { parseSeedTsv, convertSeed } from './karaoke-ingest/convertSeed.mjs';

const exec = promisify(execFile);

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) { args[key] = true; }
      else { args[key] = next; i++; }
    } else { args._.push(a); }
  }
  return args;
}

async function fileExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

function ingestConfig() {
  return {
    mediaDir: cfg.MEDIA_DIR, showName: cfg.SHOW_NAME, formatSort: cfg.FORMAT_SORT, mergeFormat: cfg.MERGE_FORMAT,
    searchCount: cfg.SEARCH_COUNT, karaokeTerms: cfg.KARAOKE_TERMS, rejectTerms: cfg.REJECT_TERMS,
    channelWeights: cfg.CHANNEL_WEIGHTS, minDurationS: cfg.MIN_DURATION_S, maxDurationS: cfg.MAX_DURATION_S,
    scoreFloor: cfg.SCORE_FLOOR, seasonName: cfg.seasonName,
  };
}

function ingestDeps() {
  return {
    search: (q, o) => search(q, o),
    download: (a) => download(a),
    embed: (a) => embed(a),
    fileExists,
    saveRows: async (rows) => { await fs.writeFile(cfg.SETLIST_PATH, serializeSetlist(rows)); },
    log: (m) => console.log(m),
  };
}

async function loadRows(setlistPath) {
  const tsv = await fs.readFile(setlistPath, 'utf8');
  return parseSetlist(tsv);
}

async function cmdIngest(args, { dryRun }) {
  const rows = await loadRows(args.setlist || cfg.SETLIST_PATH);
  const options = {
    dryRun,
    force: !!args.force,
    season: args.season ? Number(args.season) : undefined,
    limit: args.limit ? Number(args.limit) : undefined,
  };
  const summary = await runIngest({ rows, config: ingestConfig(), deps: ingestDeps(), options });
  console.log(`\n${dryRun ? 'PLAN' : 'DONE'}: downloaded=${summary.downloaded} skipped=${summary.skipped} failed=${summary.failed}`);
}

async function cmdDiscover(args) {
  const rows = await loadRows(args.setlist || cfg.SETLIST_PATH);
  const existingIds = new Set(rows.map((r) => r.videoId).filter(Boolean));
  const seedIds = rows.filter((r) => r.videoId).map((r) => r.videoId);
  const limit = args.limit ? Number(args.limit) : seedIds.length;
  const collected = [];
  for (const id of seedIds.slice(0, limit)) {
    const channelUrl = `https://www.youtube.com/watch?v=${id}`;
    // Pull the uploader's recent uploads flat-list.
    const { stdout } = await exec('yt-dlp', [
      '--js-runtimes', 'node', '-J', '--flat-playlist', '--no-warnings',
      '--playlist-end', '40', `https://www.youtube.com/watch?v=${id}`,
    ], { maxBuffer: 64 * 1024 * 1024 }).catch(() => ({ stdout: '{}' }));
    let info = {};
    try { info = JSON.parse(stdout); } catch { info = {}; }
    const entries = Array.isArray(info.entries) ? info.entries : [info].filter((e) => e && e.id);
    const kept = filterKaraokeSiblings(entries, existingIds, { karaokeTerms: cfg.KARAOKE_TERMS, rejectTerms: cfg.REJECT_TERMS });
    collected.push(...toCandidateRows(kept, id));
    kept.forEach((k) => existingIds.add(k.id));
  }
  await fs.writeFile(cfg.CANDIDATES_PATH, serializeCandidates(collected));
  console.log(`Wrote ${collected.length} candidates → ${cfg.CANDIDATES_PATH}`);
}

async function cmdConvertSeed(args) {
  const src = args.seed || path.join(cfg.MEDIA_DIR, 'ultimate_theatrical_karaoke_setlist.tsv');
  const seed = parseSeedTsv(await fs.readFile(src, 'utf8'));
  const { rows, unmatched } = convertSeed(seed, cfg.resolveSeason);
  if (args['dry-run']) {
    console.log(serializeSetlist(rows));
    if (unmatched.length) console.error(`\n# ${unmatched.length} unmatched: ${unmatched.map((u) => `${u.song} [${u.category}]`).join(', ')}`);
    return;
  }
  await fs.writeFile(cfg.SETLIST_PATH, serializeSetlist(rows));
  console.log(`Wrote ${rows.length} rows → ${cfg.SETLIST_PATH}`);
  if (unmatched.length) console.error(`${unmatched.length} unmatched (assign a season manually): ${unmatched.map((u) => u.category).join(', ')}`);
}

async function cmdRefreshPlex(args) {
  const host = args.host || process.env.PLEX_HOST || 'http://localhost:32400';
  const token = args.token || process.env.PLEX_TOKEN;
  const sectionId = args.section || process.env.PLEX_SLOWTV_SECTION;
  if (!token || !sectionId) { console.error('Need --token and --section (or PLEX_TOKEN / PLEX_SLOWTV_SECTION).'); process.exit(1); }
  await refreshSection({ host, sectionId, token });
  console.log('Triggered Plex section refresh.');
}

const HELP = `karaoke-ingest — build the Karaoke Plex show from a setlist

Usage:
  karaoke-ingest ingest        [--season N] [--limit N] [--force] [--setlist path]
  karaoke-ingest plan          [--season N] [--limit N]        # dry-run of ingest
  karaoke-ingest discover      [--limit N] [--setlist path]     # harvest channel siblings → candidates.tsv
  karaoke-ingest convert-seed  [--seed path] [--dry-run]        # seed TSV → setlist.tsv
  karaoke-ingest refresh-plex  [--host url] [--section id] [--token tkn]
`;

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const cmd = args._[0];
  switch (cmd) {
    case 'ingest': return cmdIngest(args, { dryRun: false });
    case 'plan': return cmdIngest(args, { dryRun: true });
    case 'discover': return cmdDiscover(args);
    case 'convert-seed': return cmdConvertSeed(args);
    case 'refresh-plex': return cmdRefreshPlex(args);
    default: process.stdout.write(HELP); if (!cmd) process.exit(0); process.exit(1);
  }
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
```

- [ ] **Step 2: Write `cli/karaoke-ingest/README.md`**

```markdown
# karaoke-ingest

Builds the **Karaoke** Plex show (`Slow TV/Karaoke/`) from a curated setlist.
Seasons = categories, episodes = songs. See the design spec:
`docs/superpowers/specs/2026-07-10-karaoke-plex-show-ingest-design.md`.

## Setlist

`setlist.tsv` (on the media mount) is the source of truth:

    season  episode  artist  song  search_hint  status  video_id

- `episode` / `video_id` are tool-managed. `status`: `pending` → `downloaded` / `failed`.
- `search_hint`: extra query terms, or a full `youtube.com/watch?v=…` URL to pin a video.
- Season names come from `config.mjs` `SEASONS`.

## Commands

    node cli/karaoke-ingest.cli.mjs convert-seed --dry-run   # preview seed → setlist
    node cli/karaoke-ingest.cli.mjs plan                     # dry-run: what would download
    node cli/karaoke-ingest.cli.mjs ingest --limit 5         # download 5 pending
    node cli/karaoke-ingest.cli.mjs discover --limit 3       # harvest siblings → candidates.tsv
    node cli/karaoke-ingest.cli.mjs refresh-plex --section <id> --token <tkn>

Re-runs skip `downloaded` rows with an existing file; `--force` re-does them.
Curate `candidates.tsv` by hand into `setlist.tsv` using the style profile in the spec.
```

- [ ] **Step 3: Run the full module test suite**

Run: `npx vitest run cli/karaoke-ingest/`
Expected: PASS — all files (setlist, filename, query, ranker, ytdlp, ingestRun, discovery, plex, convertSeed).

- [ ] **Step 4: Smoke-test the CLI dry-run paths (no network, no writes to media)**

```bash
# convert-seed dry-run prints a valid setlist to stdout
node cli/karaoke-ingest.cli.mjs convert-seed \
  --seed "/media/kckern/Media/Slow TV/Karaoke/ultimate_theatrical_karaoke_setlist.tsv" --dry-run | head -12
# help text
node cli/karaoke-ingest.cli.mjs
```
Expected: a tab-separated setlist with `season`/`episode`/… header and Sinatra as `S1` (Crooners & Standards); help text lists all five subcommands.

- [ ] **Step 5: Commit**

```bash
git add cli/karaoke-ingest.cli.mjs cli/karaoke-ingest/README.md
git commit -m "feat(karaoke): CLI entrypoint (ingest/plan/discover/convert-seed/refresh-plex) + README"
```

---

## Post-Plan: first real run (manual, after review)

Not a code task — the operator runs these on `kckern-server` once the suite is green:

1. `node cli/karaoke-ingest.cli.mjs convert-seed` — writes `setlist.tsv` from the seed.
2. `node cli/karaoke-ingest.cli.mjs plan` — eyeball the chosen videos.
3. `node cli/karaoke-ingest.cli.mjs ingest --limit 3` — download a few, verify they land as
   `Karaoke - S0xE0x - … .mp4` and direct-play in Plex.
4. Discover the Slow TV section id, then `refresh-plex`.
5. `node cli/karaoke-ingest.cli.mjs discover --limit 3` — review `candidates.tsv`, promote
   good rows into `setlist.tsv`, repeat `ingest`.

## Self-Review Notes

- **Spec coverage:** setlist source-of-truth (T1), ranking w/ channel bonus + view tiebreak + hard filters (T4), HQ/no-single-channel via soft `CHANNEL_WEIGHTS` (T1/T4), mp4/H.264/AAC + embedded title/description (T5/T6), SxxExx naming + flat layout (T2/T6), idempotency + `--force` (T6), discovery→candidates (T7), Plex refresh (T8), seed conversion + refined seasons (T1/T9), CLI subcommands + dry-run (T10). Posters + auto re-pick are explicitly out of scope (spec §"Out of scope").
- **Security:** all external strings pass as argv elements to `execFile` (T5), never a shell string.
- **Type consistency:** `Row`/`Candidate`/`CandidateRow` shapes are consistent across T1–T10; `pickBest`, `runIngest`, `buildEpisodeFilename`, `assignEpisodes`, `search` signatures match their consumers.
```
