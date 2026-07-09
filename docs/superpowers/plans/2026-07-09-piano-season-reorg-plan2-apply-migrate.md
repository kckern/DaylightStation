# Piano Season Reorg — Plan 2: Apply, Reconcile, Migrate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the reviewed normalization plan against the real NAS — rewrite/rename/renumber every episode into the 9-season tree — then reconcile Plex, migrate per-user watch progress by ratingKey, regenerate the committed index, and verify nothing was lost.

**Architecture:** Pure, tested transforms (`renderNfo`, ratingKey-map composition, progress remap) live in `cli/curriculum/`; thin I/O drivers wrap them. The destructive filesystem apply is backup-first, idempotent, `--confirm`-gated, and reversible via a generated undo script. The two live unknowns — whether a Plex rescan re-keys moved episodes, and how long it takes — are settled empirically by a **single-season rehearsal (Task 6)** before the full 2,434-file run (Task 7). All progress is keyed `plex:{ratingKey}`; the migration map is composed old ratingKey → old (season,episode) → [plan] → new (season,episode) → new ratingKey.

**Tech Stack:** Node ESM (`.mjs`), vitest. `js-yaml` (already a dep) for progress files. Plex HTTP API. No new dependencies.

## Global Constraints

- Consumes Plan 1's committed pure module `cli/curriculum/normalizePlan.mjs` (`buildNormalizationPlan`) and the dry-run `.json` it emits. Do NOT re-derive the plan differently.
- NFO root: `/media/kckern/Media/Lectures/Piano With Jonny`. NAS files are writable by the `claude` user directly (no docker exec needed for `/media/kckern/Media`).
- Plex: host `http://plex:32400` (reachable from inside the `daylight-station` container only — run Plex HTTP calls via `sudo docker exec daylight-station sh -c '…'`), token from `data/household/auth/plex.yml` (`token:` field), show ratingKey `676490`, library section `17` (Lectures). `allLeaves` = `GET /library/metadata/676490/allLeaves?X-Plex-Token=<t>` → `<Video ratingKey parentIndex index>` per episode (parentIndex=season, index=episode). Rescan = `GET /library/sections/17/refresh?X-Plex-Token=<t>`.
- Progress stores (all keyed `plex:{ratingKey}`): per-user `data/users/{id}/apps/piano/video-progress.yml`; household `data/household/history/media_memory/plex/17_lectures.yml`. These live in the Docker data volume — the `claude` user can READ them via the host mount `/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data/...` but must WRITE them via `sudo docker exec daylight-station sh -c '…'` (writes there run as root; `chown -R node:node` any files created).
- The normalizer NEVER moves an episode to a different old→new *pairing* than Plan 1 computed. `SxxExx` in filenames is authoritative for Plex identity.
- MANDATORY before any destructive step: a fresh backup tar of all NFOs + a filename manifest, and a generated undo script. Apply is idempotent and refuses to run twice on already-normalized input.
- Do NOT run Task 6 or Task 7 (the live NAS/Plex operations) without explicit human go, AND only when the garage/Player deploy gates are clear (no active fitness session, no playing Player) per CLAUDE.local.md — a rescan + progress rewrite must not race a live session.
- Episode count is conserved at every stage: 2,434 in, 2,434 out. Every verification asserts this.

---

### Task 1: `renderNfo` + full-capture parse

**Files:**
- Create: `cli/curriculum/nfoRender.mjs`
- Test: `cli/curriculum/nfoRender.test.mjs`

**Interfaces:**
- Produces:
  - `parseNfoFull(xml: string) => Fields` — captures ALL preserved fields: `{ showtitle, plot, genres: string[], skill, focus: string[], type, credits, studio, wistia, wistiaDefault: boolean }` (season/episode/title/course are supplied by the plan, not preserved).
  - `renderNfo(fields: RenderFields) => string` — emits canonical `<episodedetails>` NFO. `RenderFields = { title, showtitle, season, episode, plot, genres, course, part, lane, group, song, treatment, skillChallenge, skill, focus, type, credits, studio, wistia, wistiaDefault }`. Omits any tag whose value is null/empty. Escapes `& < > ' "`.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { parseNfoFull, renderNfo } from './nfoRender.mjs';

const ORIG = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<episodedetails>
  <title>Silent Night – Rhumba 1 – Rhumba Groove Exercise</title>
  <showtitle>Piano With Jonny</showtitle>
  <season>10</season>
  <episode>607</episode>
  <plot>Groove. From "Silent Night – Rhumba 1" by Piano With Jonny.</plot>
  <genre>Music</genre>
  <genre>Educational</genre>
  <tag>Course: Silent Night – Rhumba 1</tag>
  <genre>Latin</genre>
  <tag>Skill Level: Intermediate</tag>
  <tag>Focus: Songs</tag>
  <tag>Type: Course</tag>
  <credits>John Proulx</credits>
  <studio>John Proulx</studio>
  <uniqueid type="wistia" default="true">po6f0g0bmc</uniqueid>
</episodedetails>`;

describe('parseNfoFull', () => {
  it('captures preserved fields incl. wistia', () => {
    const f = parseNfoFull(ORIG);
    expect(f).toMatchObject({
      showtitle: 'Piano With Jonny',
      genres: ['Music', 'Educational', 'Latin'],
      skill: 'Intermediate',
      focus: ['Songs'],
      type: 'Course',
      credits: 'John Proulx',
      studio: 'John Proulx',
      wistia: 'po6f0g0bmc',
      wistiaDefault: true,
    });
    expect(f.plot).toContain('Groove.');
  });
});

describe('renderNfo', () => {
  it('renders new season/episode/title + injected tags, preserving the rest', () => {
    const out = renderNfo({
      title: 'Rhumba Groove Exercise', showtitle: 'Piano With Jonny',
      season: 8, episode: 42, plot: 'Groove.', genres: ['Music', 'Educational', 'Latin'],
      course: 'Silent Night – Rhumba', part: 1, lane: 'repertoire', group: null,
      song: 'Silent Night', treatment: 'tutorial', skillChallenge: false,
      skill: 'Intermediate', focus: ['Songs'], type: 'Course',
      credits: 'John Proulx', studio: 'John Proulx', wistia: 'po6f0g0bmc', wistiaDefault: true,
    });
    expect(out).toContain('<season>8</season>');
    expect(out).toContain('<episode>42</episode>');
    expect(out).toContain('<title>Rhumba Groove Exercise</title>');
    expect(out).toContain('<tag>Course: Silent Night – Rhumba</tag>');
    expect(out).toContain('<tag>Part: 1</tag>');
    expect(out).toContain('<tag>Lane: repertoire</tag>');
    expect(out).toContain('<tag>Song: Silent Night</tag>');
    expect(out).toContain('<tag>Treatment: tutorial</tag>');
    expect(out).toContain('<uniqueid type="wistia" default="true">po6f0g0bmc</uniqueid>');
    expect(out).not.toContain('<tag>Group:');          // group null → omitted
    expect(out).not.toContain('SkillChallenge');        // false → omitted
    expect(out).not.toContain('<tag>Part: 1</tag>\n  <tag>Part:'); // single part tag
  });
  it('escapes entities and round-trips preserved fields', () => {
    const f = parseNfoFull(ORIG);
    const out = renderNfo({ title: 'A & B', showtitle: f.showtitle, season: 1, episode: 1,
      plot: f.plot, genres: f.genres, course: 'X', part: null, lane: 'lessons', group: 'G',
      song: null, treatment: null, skillChallenge: false, skill: f.skill, focus: f.focus,
      type: f.type, credits: f.credits, studio: f.studio, wistia: f.wistia, wistiaDefault: f.wistiaDefault });
    expect(out).toContain('<title>A &amp; B</title>');
    expect(parseNfoFull(out)).toMatchObject({ genres: ['Music', 'Educational', 'Latin'], wistia: 'po6f0g0bmc' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run cli/curriculum/nfoRender.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
// cli/curriculum/nfoRender.mjs — pure NFO full-parse + canonical render (no I/O).
const unesc = (s) => (s == null ? s : s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#39;/g, "'").replace(/&quot;/g, '"'));
const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/'/g, '&#39;').replace(/"/g, '&quot;');
const one = (xml, el) => { const m = xml.match(new RegExp(`<${el}>([\\s\\S]*?)</${el}>`)); return m ? unesc(m[1].trim()) : null; };
const tagVals = (xml, key) => { const re = new RegExp(`<tag>${key}:\\s*([^<]+)</tag>`, 'g'); const out = []; let m; while ((m = re.exec(xml))) out.push(unesc(m[1].trim())); return out; };

export function parseNfoFull(xml) {
  const genres = [...xml.matchAll(/<genre>([^<]+)<\/genre>/g)].map((m) => unesc(m[1].trim()));
  const wm = xml.match(/<uniqueid[^>]*type="wistia"[^>]*>([^<]+)<\/uniqueid>/);
  return {
    showtitle: one(xml, 'showtitle'), plot: one(xml, 'plot'), genres,
    skill: tagVals(xml, 'Skill Level')[0] || null,
    focus: tagVals(xml, 'Focus'),
    type: tagVals(xml, 'Type')[0] || null,
    credits: one(xml, 'credits'), studio: one(xml, 'studio'),
    wistia: wm ? wm[1].trim() : null,
    wistiaDefault: wm ? /default="true"/.test(wm[0]) : false,
  };
}

export function renderNfo(f) {
  const L = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>', '<episodedetails>'];
  const line = (el, v) => { if (v != null && v !== '') L.push(`  <${el}>${esc(v)}</${el}>`); };
  const tag = (k, v) => { if (v != null && v !== '') L.push(`  <tag>${esc(k)}: ${esc(v)}</tag>`); };
  line('title', f.title);
  line('showtitle', f.showtitle);
  L.push(`  <season>${Number(f.season)}</season>`);
  L.push(`  <episode>${Number(f.episode)}</episode>`);
  line('plot', f.plot);
  for (const g of f.genres || []) line('genre', g);
  tag('Course', f.course);
  if (f.part != null) tag('Part', f.part);
  tag('Lane', f.lane);
  tag('Group', f.group);
  tag('Song', f.song);
  tag('Treatment', f.treatment);
  if (f.skillChallenge) L.push('  <tag>SkillChallenge: true</tag>');
  tag('Skill Level', f.skill);
  for (const x of f.focus || []) tag('Focus', x);
  tag('Type', f.type);
  line('credits', f.credits);
  line('studio', f.studio);
  if (f.wistia) L.push(`  <uniqueid type="wistia"${f.wistiaDefault ? ' default="true"' : ''}>${esc(f.wistia)}</uniqueid>`);
  L.push('</episodedetails>');
  return L.join('\n') + '\n';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run cli/curriculum/nfoRender.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/curriculum/nfoRender.mjs cli/curriculum/nfoRender.test.mjs
git commit -m "feat(piano-reorg): renderNfo + full-capture NFO parse"
```

---

### Task 2: Extend index parse + build-index for the 9-season/lane model

**Files:**
- Modify: `cli/curriculum/nfoIndex.mjs` (extend `parseEpisodeNfo`)
- Modify: `cli/curriculum/build-index.mjs` (`SEASON_META` → 9 seasons + lane + groups)
- Test: `cli/curriculum/nfoIndex.test.mjs` (extend)

**Interfaces:**
- Consumes: normalized NFOs carrying `<tag>Part:</tag>`, `<tag>Lane:</tag>`, `<tag>Group:</tag>`, `<tag>Song:</tag>`, `<tag>Treatment:</tag>`, `<tag>SkillChallenge: true</tag>`.
- Produces: `parseEpisodeNfo` return gains `part`, `lane`, `group`, `song`, `treatment`, `skillChallenge` (each omitted when absent). `SEASON_META` in build-index maps new seasons 0–8 with `{ title, lane, groups? }` (lane replaces the old `category`).

- [ ] **Step 1: Write the failing test**

Add to `cli/curriculum/nfoIndex.test.mjs`:

```js
const EP_NEW = `<?xml version="1.0"?><episodedetails>
  <title>Rhumba Groove Exercise</title><season>8</season><episode>42</episode>
  <plot>Groove.</plot><genre>Music</genre><genre>Educational</genre><genre>Latin</genre>
  <tag>Course: Silent Night – Rhumba</tag><tag>Part: 1</tag><tag>Lane: repertoire</tag>
  <tag>Song: Silent Night</tag><tag>Treatment: tutorial</tag>
  <tag>Skill Level: Intermediate</tag><tag>Focus: Songs</tag><tag>Type: Course</tag><credits>John Proulx</credits>
</episodedetails>`;

describe('parseEpisodeNfo — normalized tags', () => {
  it('captures part/lane/song/treatment', () => {
    const ep = parseEpisodeNfo(EP_NEW);
    expect(ep).toMatchObject({
      season: 8, episode: 42, course: 'Silent Night – Rhumba',
      part: 1, lane: 'repertoire', song: 'Silent Night', treatment: 'tutorial',
      styles: ['Latin'],
    });
    expect(ep.skillChallenge).toBeUndefined();  // omitted when absent
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run cli/curriculum/nfoIndex.test.mjs -t "normalized tags"`
Expected: FAIL — `part`/`lane`/`song`/`treatment` undefined.

- [ ] **Step 3: Implement**

In `cli/curriculum/nfoIndex.mjs`, inside `parseEpisodeNfo`, after the existing `ep` object is built (before the empty-field cleanup loop), add these fields to the `ep` object literal:

```js
    part: tagValues(xml, 'Part')[0] ? Number(tagValues(xml, 'Part')[0]) : null,
    lane: tagValues(xml, 'Lane')[0] || null,
    group: tagValues(xml, 'Group')[0] || null,
    song: tagValues(xml, 'Song')[0] || null,
    treatment: tagValues(xml, 'Treatment')[0] || null,
    skillChallenge: /<tag>SkillChallenge:\s*true<\/tag>/i.test(xml) ? true : null,
```

(The existing cleanup loop already deletes null/empty fields, so absent tags vanish from the record.)

Replace `SEASON_META` in `cli/curriculum/build-index.mjs` with the 9-season model:

```js
const SEASON_META = {
  0: { title: 'Practice', lane: 'practice', groups: ['How to Practice', 'Scales', 'Chord & Voicing Exercises', 'Rhythm Exercises', 'Two-Hand Coordination'] },
  1: { title: 'Soloing', lane: 'lessons', sequential: true, groups: ['Pop Soloing', '2-5-1 Soloing'] },
  2: { title: 'Improvisation', lane: 'lessons', sequential: true },
  3: { title: 'Chord Voicings', lane: 'lessons', sequential: true, groups: ['Rootless Voicings', 'Drop 2 Voicings', 'Quartal Voicings', 'Block Chords'] },
  4: { title: 'Chord Theory & Color', lane: 'lessons', sequential: true },
  5: { title: 'Lead Sheet Application', lane: 'lessons', sequential: true },
  6: { title: 'Comping & Rhythm', lane: 'lessons', sequential: true, groups: ['Comping', 'Rhythm Essentials'] },
  7: { title: 'Intros, Endings & Fills', lane: 'lessons', sequential: true },
  8: { title: 'Song Library', lane: 'repertoire', facets: ['difficulty', 'instructor', 'style'] },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run cli/curriculum/nfoIndex.test.mjs`
Expected: PASS (existing tests + the new block).

- [ ] **Step 5: Commit**

```bash
git add cli/curriculum/nfoIndex.mjs cli/curriculum/build-index.mjs cli/curriculum/nfoIndex.test.mjs
git commit -m "feat(piano-reorg): index parses part/lane/group/song/treatment; 9-season meta"
```

---

### Task 3: `applyPlan.mjs` — backup-first, idempotent, reversible apply engine

**Files:**
- Create: `cli/curriculum/applyPlan.mjs`
- Create: `cli/curriculum/applyPlan.test.mjs`

**Interfaces:**
- Consumes: `buildNormalizationPlan` (Plan 1), `parseNfoFull`/`renderNfo` (Task 1).
- Produces: `planToApplyOps(plan, records) => Op[]` — pure; `Op = { wistia, from: {dir,base}, to: {dir,base}, nfo: string }` where `nfo` is the rendered new NFO content and `from/to` are the old/new `Season NN - Name` dir + basename (no extension). CLI `node cli/curriculum/applyPlan.mjs <nfo-root> [--season <oldN>] [--confirm]`: builds records+plan, and for each Op (optionally filtered to one OLD season) writes the new `.nfo`, renames the `.mp4` and `.nfo` into `to`, removes stale old files, and appends to an undo script. Without `--confirm` it prints the op count + first 10 ops and exits WITHOUT writing (dry apply).

- [ ] **Step 1: Write the failing test (pure op-builder, on a temp fixture)**

```js
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, readdirSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { planToApplyOps, applyOps } from './applyPlan.mjs';
import { buildNormalizationPlan } from './normalizePlan.mjs';

const rec = (o) => ({ file: `${o.dir}/${o.name}.nfo`, styles: [], wistia: o.wistia, oldSeason: o.oldSeason, oldEpisode: o.oldEpisode, course: o.course, title: o.title });

describe('planToApplyOps', () => {
  it('produces one op per record with rendered nfo + from/to paths', () => {
    const records = [
      { ...rec({ dir: 'Season 06 - Comping', name: 'Piano With Jonny - S06E01 - Jazzy Blues Comping – Demo', wistia: 'w1', oldSeason: 6, oldEpisode: 1, course: 'Jazzy Blues Comping', title: 'Jazzy Blues Comping – Demo' }),
        _full: { showtitle: 'Piano With Jonny', plot: 'p', genres: ['Music','Educational','Blues'], skill: 'Intermediate', focus: ['Rhythm'], type: 'Course', credits: 'X', studio: 'X', wistia: 'w1', wistiaDefault: true } },
    ];
    const plan = buildNormalizationPlan(records);
    const ops = planToApplyOps(plan, records);
    expect(ops).toHaveLength(1);
    expect(ops[0].to.dir).toBe('Season 06 - Comping & Rhythm');
    expect(ops[0].nfo).toContain('<tag>Lane: lessons</tag>');
    expect(ops[0].nfo).toContain('<tag>Group: Comping</tag>');
    expect(ops[0].nfo).toContain('<season>6</season>');
  });
});

describe('applyOps (temp dir round-trip)', () => {
  it('moves the pair into the new folder and writes the new nfo', () => {
    const root = mkdtempSync(join(tmpdir(), 'reorg-'));
    mkdirSync(join(root, 'Season 06 - Comping'));
    writeFileSync(join(root, 'Season 06 - Comping', 'Piano With Jonny - S06E01 - Jazzy Blues Comping – Demo.mp4'), 'VIDEO');
    writeFileSync(join(root, 'Season 06 - Comping', 'Piano With Jonny - S06E01 - Jazzy Blues Comping – Demo.nfo'), '<x/>');
    const ops = [{ wistia: 'w1',
      from: { dir: 'Season 06 - Comping', base: 'Piano With Jonny - S06E01 - Jazzy Blues Comping – Demo' },
      to: { dir: 'Season 06 - Comping & Rhythm', base: 'Piano With Jonny - S06E01 - Demo' },
      nfo: '<episodedetails><season>6</season></episodedetails>\n' }];
    const undo = applyOps(root, ops);
    expect(existsSync(join(root, 'Season 06 - Comping & Rhythm', 'Piano With Jonny - S06E01 - Demo.mp4'))).toBe(true);
    expect(readFileSync(join(root, 'Season 06 - Comping & Rhythm', 'Piano With Jonny - S06E01 - Demo.nfo'), 'utf8')).toContain('<season>6</season>');
    expect(existsSync(join(root, 'Season 06 - Comping', 'Piano With Jonny - S06E01 - Jazzy Blues Comping – Demo.mp4'))).toBe(false);
    expect(undo).toContain('mv');  // undo script references a reverse move
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run cli/curriculum/applyPlan.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
#!/usr/bin/env node
// cli/curriculum/applyPlan.mjs — apply the normalization plan to the NAS.
// Backup-first, idempotent, --confirm-gated, reversible (writes an undo script).
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, renameSync, rmSync } from 'fs';
import { join } from 'path';
import { buildNormalizationPlan } from './normalizePlan.mjs';
import { parseNfoFull, renderNfo } from './nfoRender.mjs';

const unesc = (s) => (s == null ? s : s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"'));
const one = (xml, el) => { const m = xml.match(new RegExp(`<${el}>([\\s\\S]*?)</${el}>`)); return m ? unesc(m[1].trim()) : null; };
const GENERIC = new Set(['Music', 'Educational']);

export function planToApplyOps(plan, records) {
  const byWistia = new Map(records.map((r) => [r.wistia, r]));
  return plan.episodes.map((e) => {
    const r = byWistia.get(e.wistia) || {};
    const full = r._full || {};
    const nfo = renderNfo({
      title: e.newTitle, showtitle: full.showtitle || 'Piano With Jonny',
      season: e.newSeason, episode: e.newEpisode, plot: full.plot, genres: full.genres || [],
      course: e.base, part: e.part, lane: e.lane, group: e.group,
      song: e.song, treatment: e.treatment, skillChallenge: e.skillChallenge,
      skill: full.skill, focus: full.focus || [], type: full.type,
      credits: full.credits, studio: full.studio, wistia: full.wistia, wistiaDefault: full.wistiaDefault,
    });
    const fromDir = r.file ? r.file.split('/')[0] : null;
    const fromBase = r.file ? r.file.split('/')[1].replace(/\.nfo$/, '') : null;
    return { wistia: e.wistia, from: { dir: fromDir, base: fromBase }, to: { dir: e.newDir, base: e.newBasename }, nfo };
  });
}

export function applyOps(root, ops) {
  const undo = ['#!/bin/sh', '# undo script — reverses applyOps moves', `cd "${root}" || exit 1`];
  for (const op of ops) {
    const toDir = join(root, op.to.dir);
    if (!existsSync(toDir)) mkdirSync(toDir, { recursive: true });
    for (const ext of ['mp4', 'nfo']) {
      const src = join(root, op.from.dir, `${op.from.base}.${ext}`);
      const dst = join(toDir, `${op.to.base}.${ext}`);
      if (ext === 'nfo') { writeFileSync(dst, op.nfo); if (existsSync(src) && src !== dst) rmSync(src); }
      else if (existsSync(src)) renameSync(src, dst);
      undo.push(`mv "${op.to.dir}/${op.to.base}.${ext}" "${op.from.dir}/${op.from.base}.${ext}" 2>/dev/null`);
    }
  }
  return undo.join('\n') + '\n';
}

// ---- CLI ----
if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2];
  const seasonArg = process.argv.includes('--season') ? Number(process.argv[process.argv.indexOf('--season') + 1]) : null;
  const confirm = process.argv.includes('--confirm');
  if (!root) { console.error('Usage: applyPlan.mjs <nfo-root> [--season <oldN>] [--confirm]'); process.exit(1); }

  const records = [];
  for (const dir of readdirSync(root)) {
    const p = join(root, dir);
    if (!statSync(p).isDirectory() || !/^Season /.test(dir)) continue;
    const os = Number((dir.match(/^Season (\d+)/) || [])[1]);
    for (const f of readdirSync(p)) {
      if (!f.endsWith('.nfo') || f === 'season.nfo') continue;
      const xml = readFileSync(join(p, f), 'utf8');
      const genres = [...xml.matchAll(/<genre>([^<]+)<\/genre>/g)].map((m) => unesc(m[1].trim()));
      const full = parseNfoFull(xml);
      records.push({
        file: `${dir}/${f}`, oldSeason: os, oldEpisode: Number(one(xml, 'episode')),
        course: (xml.match(/<tag>Course:\s*([^<]+)<\/tag>/) ? unesc(xml.match(/<tag>Course:\s*([^<]+)<\/tag>/)[1].trim()) : null),
        styles: genres.filter((g) => !GENERIC.has(g)), title: one(xml, 'title'), wistia: full.wistia, _full: full,
      });
    }
  }
  // Idempotency guard: if every dir is already a NEW-name season, refuse.
  const newNames = new Set(['Season 00 - Practice','Season 01 - Soloing','Season 02 - Improvisation','Season 03 - Chord Voicings','Season 04 - Chord Theory & Color','Season 05 - Lead Sheet Application','Season 06 - Comping & Rhythm','Season 07 - Intros, Endings & Fills','Season 08 - Song Library']);
  const dirs = readdirSync(root).filter((d) => statSync(join(root, d)).isDirectory() && /^Season /.test(d));
  if (dirs.every((d) => newNames.has(d))) { console.log('Already normalized (all dirs are new-name seasons). No-op.'); process.exit(0); }

  const plan = buildNormalizationPlan(records);
  let ops = planToApplyOps(plan, records);
  if (seasonArg != null) {
    const wByOldSeason = new Set(records.filter((r) => r.oldSeason === seasonArg).map((r) => r.wistia));
    ops = ops.filter((o) => wByOldSeason.has(o.wistia));
  }
  console.log(`ops: ${ops.length}${seasonArg != null ? ` (old season ${seasonArg} only)` : ''}`);
  for (const o of ops.slice(0, 10)) console.log(`  ${o.from.dir}/${o.from.base}  ->  ${o.to.dir}/${o.to.base}`);
  if (!confirm) { console.log('DRY (no --confirm): nothing written.'); process.exit(0); }

  const undo = applyOps(root, ops);
  const undoPath = join(root, `_undo-${seasonArg != null ? `s${seasonArg}` : 'all'}.sh`);
  writeFileSync(undoPath, undo);
  console.log(`APPLIED ${ops.length} ops. Undo script: ${undoPath}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run cli/curriculum/applyPlan.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/curriculum/applyPlan.mjs cli/curriculum/applyPlan.test.mjs
git commit -m "feat(piano-reorg): applyPlan engine (backup-safe ops + undo, idempotent, --confirm)"
```

---

### Task 4: `reconcile.mjs` — Plex episode capture + old→new ratingKey map

**Files:**
- Create: `cli/curriculum/reconcile.mjs`
- Test: `cli/curriculum/reconcile.test.mjs`

**Interfaces:**
- Produces:
  - `parseAllLeaves(xml: string) => { ratingKey, season, episode }[]` — pure; parses Plex `allLeaves` XML (`<Video ratingKey parentIndex index>`, attribute order-independent).
  - `composeRatingKeyMap({ before, plan, after }) => { map: Record<string,string>, unmatched: string[] }` — pure. `before` = allLeaves rows pre-apply → old ratingKey ↔ (oldSeason,oldEpisode); `plan.episodes` gives (oldSeason,oldEpisode)→(newSeason,newEpisode); `after` = allLeaves rows post-apply → (newSeason,newEpisode)→new ratingKey. Returns `oldRatingKey → newRatingKey` and the list of old ratingKeys that failed to map.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { parseAllLeaves, composeRatingKeyMap } from './reconcile.mjs';

const XML = `<MediaContainer size="2">
  <Video ratingKey="676057" parentIndex="6" index="1" title="a"/>
  <Video title="b" index="2" ratingKey="676058" parentIndex="6"/>
</MediaContainer>`;

describe('parseAllLeaves', () => {
  it('parses ratingKey/season/episode regardless of attribute order', () => {
    expect(parseAllLeaves(XML)).toEqual([
      { ratingKey: '676057', season: 6, episode: 1 },
      { ratingKey: '676058', season: 6, episode: 2 },
    ]);
  });
});

describe('composeRatingKeyMap', () => {
  it('maps old→new ratingKey through the plan (season,episode) pairing', () => {
    const before = [{ ratingKey: '676057', season: 6, episode: 1 }];          // old S6E1
    const plan = { episodes: [{ oldSeason: 6, oldEpisode: 1, newSeason: 6, newEpisode: 3 }] };
    const after = [{ ratingKey: '999001', season: 6, episode: 3 }];           // new S6E3
    const { map, unmatched } = composeRatingKeyMap({ before, plan, after });
    expect(map).toEqual({ '676057': '999001' });
    expect(unmatched).toEqual([]);
  });
  it('reports an old ratingKey that has no new counterpart', () => {
    const before = [{ ratingKey: '676057', season: 6, episode: 1 }];
    const plan = { episodes: [{ oldSeason: 6, oldEpisode: 1, newSeason: 6, newEpisode: 3 }] };
    const after = [];  // rescan didn't produce the new episode
    const { map, unmatched } = composeRatingKeyMap({ before, plan, after });
    expect(map).toEqual({});
    expect(unmatched).toEqual(['676057']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run cli/curriculum/reconcile.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
#!/usr/bin/env node
// cli/curriculum/reconcile.mjs — Plex allLeaves parse + old→new ratingKey map composition.
export function parseAllLeaves(xml) {
  const out = [];
  for (const m of String(xml).matchAll(/<Video\b[^>]*>/g)) {
    const tag = m[0];
    const rk = tag.match(/\bratingKey="(\d+)"/);
    const ps = tag.match(/\bparentIndex="(\d+)"/);
    const ix = tag.match(/\bindex="(\d+)"/);
    if (rk && ps && ix) out.push({ ratingKey: rk[1], season: Number(ps[1]), episode: Number(ix[1]) });
  }
  return out;
}

export function composeRatingKeyMap({ before, plan, after }) {
  const oldRkBySE = new Map(before.map((r) => [`${r.season}:${r.episode}`, r.ratingKey]));
  const newRkBySE = new Map(after.map((r) => [`${r.season}:${r.episode}`, r.ratingKey]));
  const map = {}; const unmatched = [];
  for (const e of plan.episodes) {
    const oldRk = oldRkBySE.get(`${e.oldSeason}:${e.oldEpisode}`);
    if (!oldRk) continue;                         // old ep not in Plex (shouldn't happen)
    const newRk = newRkBySE.get(`${e.newSeason}:${e.newEpisode}`);
    if (newRk) map[oldRk] = newRk; else unmatched.push(oldRk);
  }
  return { map, unmatched };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run cli/curriculum/reconcile.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/curriculum/reconcile.mjs cli/curriculum/reconcile.test.mjs
git commit -m "feat(piano-reorg): reconcile parseAllLeaves + old→new ratingKey map"
```

---

### Task 5: `migrateProgress.mjs` — remap progress YAML by ratingKey map

**Files:**
- Create: `cli/curriculum/migrateProgress.mjs`
- Test: `cli/curriculum/migrateProgress.test.mjs`

**Interfaces:**
- Produces:
  - `remapProgress(progress: object, map: Record<string,string>) => { out: object, moved: number, kept: number }` — pure. For each `plex:{old}` key, if `map[old]` exists, rewrite the key to `plex:{new}` (preserving the value); keys without a mapping are kept as-is. On a collision (two old keys map to one new — must not happen given unique pairing) keep the entry with the newer `lastPlayed`.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { remapProgress } from './migrateProgress.mjs';

describe('remapProgress', () => {
  it('rewrites mapped plex keys, keeps unmapped', () => {
    const progress = {
      'plex:676057': { percent: 100, lastPlayed: '2026-06-28T18:45:30Z' },
      'plex:111111': { percent: 40, lastPlayed: '2026-06-01T00:00:00Z' },  // unmapped (other show)
    };
    const map = { '676057': '999001' };
    const { out, moved, kept } = remapProgress(progress, map);
    expect(out['plex:999001']).toEqual({ percent: 100, lastPlayed: '2026-06-28T18:45:30Z' });
    expect(out['plex:676057']).toBeUndefined();
    expect(out['plex:111111']).toEqual({ percent: 40, lastPlayed: '2026-06-01T00:00:00Z' });
    expect(moved).toBe(1);
    expect(kept).toBe(1);
  });
  it('on collision keeps the newer lastPlayed', () => {
    const progress = {
      'plex:1': { percent: 50, lastPlayed: '2026-01-01T00:00:00Z' },
      'plex:2': { percent: 90, lastPlayed: '2026-05-01T00:00:00Z' },
    };
    const map = { '1': '999', '2': '999' };
    const { out } = remapProgress(progress, map);
    expect(out['plex:999'].percent).toBe(90);  // newer wins
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run cli/curriculum/migrateProgress.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
#!/usr/bin/env node
// cli/curriculum/migrateProgress.mjs — remap plex:{ratingKey} progress keys via a map.
export function remapProgress(progress, map) {
  const out = {}; let moved = 0; let kept = 0;
  const put = (key, val) => {
    if (out[key]) {
      const a = Date.parse(out[key].lastPlayed || 0) || 0;
      const b = Date.parse(val.lastPlayed || 0) || 0;
      if (b > a) out[key] = val;                 // newer wins on collision
    } else out[key] = val;
  };
  for (const [key, val] of Object.entries(progress || {})) {
    const m = key.match(/^plex:(\d+)$/);
    if (m && map[m[1]]) { put(`plex:${map[m[1]]}`, val); moved += 1; }
    else { put(key, val); kept += 1; }
  }
  return { out, moved, kept };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run cli/curriculum/migrateProgress.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/curriculum/migrateProgress.mjs cli/curriculum/migrateProgress.test.mjs
git commit -m "feat(piano-reorg): remapProgress pure ratingKey remap"
```

---

### Task 6: Rehearsal — apply ONE season end-to-end (old S05 Scales, 14 eps)

**⚠️ LIVE OPERATION. Requires explicit human go + clear deploy gates (no active fitness session / playing Player). Settles the two unknowns — does a rescan re-key moved episodes, and how long — on the smallest lane season before the full run.**

**Files:** none new (drives Tasks 1–5). Produces artifacts under the scratchpad.

- [ ] **Step 1: Pre-flight backup + snapshot**

```bash
NAS="/media/kckern/Media/Lectures/Piano With Jonny"
SCR="/tmp/claude-1001/-opt-Code-DaylightStation--claude-worktrees-meet-requirements/5530fc0c-2ba9-4d04-8b35-d9ed2cec2784/scratchpad"
# Full NFO + filename backup (all seasons — cheap insurance even for a 1-season rehearsal)
tar czf "$SCR/nfo-backup-$(git rev-parse --short HEAD).tgz" -C "$NAS" $(cd "$NAS" && ls -d Season* )
find "$NAS" -name '*.nfo' -o -name '*.mp4' | sort > "$SCR/files-before.txt"
# Plex episode snapshot BEFORE (old ratingKey ↔ old season,episode)
sudo docker exec daylight-station sh -c 'TOKEN=$(grep -i token data/household/auth/plex.yml | sed "s/.*: *//;s/[\" ]//g"); curl -s "http://plex:32400/library/metadata/676490/allLeaves?X-Plex-Token=$TOKEN"' > "$SCR/allleaves-before.xml"
grep -c '<Video ' "$SCR/allleaves-before.xml"   # expect 2434
```
Expected: backup tar created; `allleaves-before.xml` has 2434 `<Video>` rows.

- [ ] **Step 2: Dry apply for old season 5, then confirm**

```bash
node cli/curriculum/applyPlan.mjs "$NAS" --season 5           # dry: prints ~14 ops, writes nothing
node cli/curriculum/applyPlan.mjs "$NAS" --season 5 --confirm # writes: moves 14 eps into their new homes
```
Expected dry: `ops: 14 (old season 5 only)`. Expected confirm: `APPLIED 14 ops. Undo script: …/_undo-s5.sh`. Old S05 Scales episodes now live in `Season 00 - Practice` (Scales group). Since old S05 → new S00, the 14 episodes get NEW episode numbers within S00 — NOTE this reorders S00 numbering, so the rehearsal must treat S00 as partially-migrated. (Acceptable: the full run in Task 7 re-applies deterministically; the rehearsal's purpose is to observe Plex re-keying + progress migration mechanics, then UNDO.)

- [ ] **Step 3: Rescan Plex + capture AFTER**

```bash
sudo docker exec daylight-station sh -c 'TOKEN=$(grep -i token data/household/auth/plex.yml | sed "s/.*: *//;s/[\" ]//g"); curl -s "http://plex:32400/library/sections/17/refresh?X-Plex-Token=$TOKEN"'
# Poll until the scan settles (section refreshing → idle). Wait in short cycles; DO NOT assume instant.
```
Then, using a Monitor/until-loop, wait until `GET /library/sections/17` no longer reports `refreshing="1"`, then capture:
```bash
sudo docker exec daylight-station sh -c 'TOKEN=$(grep -i token data/household/auth/plex.yml | sed "s/.*: *//;s/[\" ]//g"); curl -s "http://plex:32400/library/metadata/676490/allLeaves?X-Plex-Token=$TOKEN"' > "$SCR/allleaves-after.xml"
grep -c '<Video ' "$SCR/allleaves-after.xml"   # expect 2434 (moved, not lost)
```
Expected: after settle, still 2434 videos. **Observe: did the moved 14 episodes get NEW ratingKeys, or did Plex keep the old ones?** Record the answer — it determines whether progress migration is even needed. Compare a moved episode's ratingKey before vs after by (season,episode).

- [ ] **Step 4: Build the ratingKey map + migrate ONE user's progress (rehearsal)**

Write a small driver `$SCR/rehearse-migrate.mjs` that: imports `parseAllLeaves`, `composeRatingKeyMap` (from `cli/curriculum/reconcile.mjs`), `buildNormalizationPlan` (records from the CURRENT — now partially-applied — NFOs is wrong for `before`; use the plan built from the PRE-apply records captured in Step 1). Because the plan must reflect old→new for the applied season, build the plan from a snapshot of pre-apply records. Simplest correct approach for the rehearsal: reconstruct `before` rows for old S5 from `allleaves-before.xml`, the `plan.episodes` for old S5 from a plan built on the backup tar's NFOs, and `after` from `allleaves-after.xml`; compose the map; then run `remapProgress` on a COPY of one user's `video-progress.yml` and confirm a known old S5 Scales ratingKey key was rewritten to its new ratingKey with the value intact. Do NOT write the real user file in the rehearsal — write the remapped copy to `$SCR/` and diff.

Expected: the map contains the 14 old→new ratingKeys (or is empty if Step 3 showed Plex KEPT ratingKeys — in which case migration is a no-op and the whole Task-7 migration collapses to verification only); `remapProgress` moves the relevant keys; unmatched is empty.

- [ ] **Step 5: UNDO the rehearsal + verify clean restoration**

```bash
sh "$NAS/_undo-s5.sh"                            # reverse the 14 moves
node cli/curriculum/build-index.mjs "$NAS" 676490 /tmp/verify-idx.json  # rebuild from restored NFOs
find "$NAS" -name '*.nfo' -o -name '*.mp4' | sort > "$SCR/files-after-undo.txt"
diff "$SCR/files-before.txt" "$SCR/files-after-undo.txt" && echo "RESTORED CLEAN"
```
Expected: `RESTORED CLEAN` (undo fully reversed the rehearsal). If NOT clean, restore from the Step-1 tar before doing anything else.

- [ ] **Step 6: Record rehearsal findings**

Write to the ledger: (a) whether Plex re-keys on move (Y/N) and scan duration; (b) whether the ratingKey map + progress remap worked; (c) confirmation the undo restored cleanly. **This gates Task 7.** If Plex KEPT ratingKeys, Task 7 skips the migration and only re-verifies. If it re-keyed, Task 7 runs the full migration.

- [ ] **Step 7: Commit any driver script kept for reuse**

```bash
git add -A cli/curriculum/  # only if a reusable reconcile driver was added; otherwise skip
git commit -m "chore(piano-reorg): rehearsal driver for season-scoped apply" || echo "nothing to commit"
```

---

### Task 7: Full apply + migrate + reindex + verify

**⚠️ LIVE OPERATION, the real reorg. Requires explicit human go + clear deploy gates. Do only after Task 6 restored clean and its findings are recorded.**

- [ ] **Step 1: Fresh full backup + before-snapshot**

```bash
NAS="/media/kckern/Media/Lectures/Piano With Jonny"; SCR="…/scratchpad"
tar czf "$SCR/nfo-backup-full-$(date -u +%Y%m%dT%H%M%SZ).tgz" -C "$NAS" $(cd "$NAS" && ls -d Season*)
sudo docker exec daylight-station sh -c 'TOKEN=$(grep -i token data/household/auth/plex.yml | sed "s/.*: *//;s/[\" ]//g"); curl -s "http://plex:32400/library/metadata/676490/allLeaves?X-Plex-Token=$TOKEN"' > "$SCR/full-before.xml"
```
Expected: tar written; `full-before.xml` = 2434 videos. Also back up every user `video-progress.yml` + `17_lectures.yml` (copy from the host mount to `$SCR/progress-backup/`).

- [ ] **Step 2: Full apply**

```bash
node cli/curriculum/applyPlan.mjs "$NAS"            # dry: ops: 2434
node cli/curriculum/applyPlan.mjs "$NAS" --confirm  # APPLIED 2434 ops. Undo: _undo-all.sh
```
Expected: `APPLIED 2434 ops`. Verify the 9 new season folders exist and old ones are empty/gone; `find "$NAS" -name '*.mp4' | wc -l` = 2434.

- [ ] **Step 3: Rescan + settle + after-snapshot**

Trigger `sections/17/refresh`; wait (Monitor until not `refreshing`) — use the duration observed in Task 6 to size the wait; capture `full-after.xml`; assert 2434 videos.

- [ ] **Step 4: Migrate progress (only if Task 6 showed re-keying)**

Build the map: `parseAllLeaves(full-before.xml)` + plan from the BACKUP NFOs (Step 1 tar) + `parseAllLeaves(full-after.xml)` → `composeRatingKeyMap`. Assert `unmatched` is empty (every old ratingKey found a new one). Then for EACH user `video-progress.yml` and `17_lectures.yml`: load, `remapProgress`, write back via `sudo docker exec` heredoc, `chown node:node`. Report per-file `{moved, kept}`.
Expected: unmatched=0; each file's mapped keys rewritten; no key lost.

- [ ] **Step 5: Regenerate the committed index**

```bash
node cli/curriculum/build-index.mjs "$NAS" 676490 backend/src/1_adapters/content/media/plex/curriculum/676490.json
```
Expected: `wrote …: 9 seasons, 2434 episodes`. Spot-check the JSON: seasons 0–8 with `lane`; a repertoire episode carries `song`/`treatment`; a multi-part course carries `part`.

- [ ] **Step 6: End-to-end verification**

- `find "$NAS" -name '*.mp4' | wc -l` = 2434 and `*.nfo` = 2434.
- Index episode count = 2434; every `(season,episode)` unique; seasons 0–8 counts = 155/133/155/220/74/40/81/61/1515.
- Pick 5 known-watched ratingKeys from a user's PRE-migration progress backup; confirm each now resolves (via the map) to a new ratingKey that the post-scan Plex `allLeaves` contains, and the user's migrated file has the value under the new key.
- Confirm no user progress file shrank in entry count (moved+kept == original count).

- [ ] **Step 7: Commit the regenerated index**

```bash
git add backend/src/1_adapters/content/media/plex/curriculum/676490.json
git commit -m "chore(piano-reorg): regenerate index for 9-season reorg (2434 eps)"
```

- [ ] **Step 8: Record completion + the undo path in the ledger**

Note the `_undo-all.sh` location and the backup tar path. **Do NOT deploy** — the backend still reads the old `category` model; Plans 3 (backend `lane`) and 4 (three-lane UX) must land first. Recovery: `sh _undo-all.sh` then restore progress from `$SCR/progress-backup/`, or untar the backup.

---

## Self-Review

**Spec coverage:** NFO rewrite (render preserving fields) → Task 1; index carries new tags + 9-season meta → Task 2; backup-first reversible apply → Task 3; Plex reconcile + ratingKey map → Task 4; progress remap → Task 5; rehearsal settling the re-key unknown → Task 6; full apply+migrate+reindex+verify → Task 7. Episode conservation asserted at Steps 1/2/3/6 of Task 7. The migration's stable-join concern (ratingKey) is handled by the (season,episode) composition, empirically validated in Task 6 before the full run.

**Placeholder scan:** Tasks 1–5 carry complete code + exact commands. Tasks 6–7 are live operations: they carry exact commands and explicit expected outputs; the one deliberately-open element is the rescan settle-wait (Task 6 Step 3 / Task 7 Step 3), which is empirically sized in the rehearsal rather than guessed — this is intentional, not a placeholder.

**Type consistency:** `planToApplyOps→Op{wistia,from,to,nfo}` and `applyOps(root,ops)→undoString` (Task 3); `parseAllLeaves→{ratingKey,season,episode}[]` and `composeRatingKeyMap→{map,unmatched}` (Task 4); `remapProgress→{out,moved,kept}` (Task 5) — consistent across tasks and their drivers. `renderNfo` field names match `parseNfoFull`/`buildNormalizationPlan` outputs (season/episode/title/course/part/lane/group/song/treatment/skillChallenge).

**Risk notes carried from Plan 1 final review:** `sanitize` handles only `/` (fine for ext4 NAS target — Task 3); source `.mp4` presence is checked (`if (existsSync(src))`) so a missing video won't crash but WILL leave its NFO — Task 7 Step 6 count-check (mp4==nfo==2434) catches that. The `_full` record field must be populated by the CLI's own parse (it is, via `parseNfoFull`), not assumed from Plan 1's lighter records.
