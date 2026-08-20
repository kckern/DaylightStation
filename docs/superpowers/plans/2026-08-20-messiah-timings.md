# Messiah Timings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Derive and verify the 53 movement boundaries of `plex:6918` (Handel's *Messiah*, Sydney Opera House 2009), and ship a performance sidecar that gives the item a working — if coarse — surround today.

**Architecture:** Three pure, separately-tested stages behind one CLI: a **libretto reader** (PDF → 53 structured numbers), a **candidate finder** (audio → boundary candidates), and an **aligner** that maps the libretto's sequence onto the audible spans, allowing merges and omissions, scored by whether each span is plausible for its own form. The aligner is a publish gate: if it cannot account for the audible span without contradictions, the plan ships the three Part boundaries alone rather than 53 approximate ones. All file I/O lives in a thin shell around the pure functions so the logic is unit-testable without a 3 GB video.

**Tech Stack:** Node ESM (`cli/*.cli.mjs` + `cli/*.cli.test.mjs`, vitest), `pdftotext` (poppler), `ffmpeg`/`ffprobe`, `js-yaml`.

**This is plan 1 of 3** from `docs/superpowers/specs/2026-08-20-messiah-surround-design.md`. It gates the other two: if the boundaries cannot be derived, the corpus/collapse and libretto-panel plans change shape.

## Global Constraints

- **`-v error` silences `silencedetect`.** It logs at *info*. Always `ffmpeg -hide_banner -nostats … 2>&1 | grep silencedetect`. Pass `-vn` so 134 minutes of video are not decoded to find audio gaps.
- **The media is on the local Media drive** (`/media/kckern/Media/Stage/…`), not the Dropbox mount, so full-file ffmpeg passes are fine. A silence pass takes several minutes; run it backgrounded.
- **PDF numbering is 1–54 where №1 is `Play All`**, a DVD menu entry. The corpus numbers the music **1–53**. Every artifact this plan writes uses corpus numbering; the reader is the only place PDF numbering appears.
- **`claude` cannot write the data volume.** Write via `sudo docker exec daylight-station sh -c "echo '<base64>' | base64 -d > <path> && chown node:node <path>"`. Chunk anything over ~100 KB with `split -b 30000`.
- **Never `rm` in the data tree** — move to `data/_deleteme/`.
- **The store rebuilds on mtime in ~2 s.** No restart, no redeploy, for any corpus or sidecar edit.
- **Facts are verified, not remembered.** Performer/venue/date come from `Program.pdf`, not from recall.
- Run tests from the worktree root: `npx vitest run cli/`.

## Source material

```
/media/kckern/Media/Stage/Handel's Messiah—Live from the Sydney Opera House (2009)/
├── …(2009).mp4      3.17 GB, 134.0 min, h264 1920x1080 + one stereo AAC track
├── Libretto.pdf     6 pages — the 53 numbers
├── Program.pdf      17 pages — performers, venue, date
└── nfo.json         summary, studio, country
```

No chapter atoms and no subtitle track: both were probed during design and are absent.

## What the design pass already measured

Do not re-derive these; they are the plan's starting facts.

| Measurement | Value |
|---|---|
| `silencedetect=noise=-38dB:d=0.6` over the full file | **142** silences |
| Internal boundaries needed | **52** (53 numbers) |
| Implied span lengths | min 1 s · p25 6 s · median 18 s · p75 69 s · max 420 s |
| Spans under 30 s (false splits: rests, fermatas, breaths) | **84** |
| Spans over 400 s (a possibly-missed boundary) | **1** |
| Longest silences — the two Part breaks, found without the libretto | **48.6 min** and **~111 min** |
| Audible span (music + applause + interval) | **~118 min** |
| Complete Messiah, music alone | **~140 min** |

**This performance is cut by roughly twenty minutes** — eight to twelve numbers.
Both PDFs are titled *"Messiah Download"*, which reads as a generic libretto
rather than this concert's running order, so the printed sequence cannot be
assumed to be the running order. **The libretto is the work; the file is a
performance.** Reconciling them is alignment, not selection, and the four cases
are 1:1, n:1 (attacca joins with no gap to detect), 1:0 (cut), and 1:n (a break
inside a number).

**A cut number gets a `null` start.** The store drops an invalid `starts` entry
to `undefined` and preserves positions rather than compacting, so the segment
keeps its name and notes while the rail declines to draw it
(`surround.segments.unplaceable`). No new syntax is needed, and the division of
labour is: the corpus records the work, the sidecar records the performance, the
rail draws the recording.

**Over-triggering ~2.7× is the good outcome.** A false candidate can be filtered; a boundary never detected cannot be recovered. The job is selection from a superset.

A libretto parse was also trialled, and it found **three traps** Task 1 exists to handle. Recorded so they are not rediscovered:

1. **`pdftotext -raw` destroys reading order.** The libretto is two-column; `-raw` interleaves them, so movement numbers do not even ascend — a strict-sequence filter over `-raw` recovered **16 of 54**. Use `-layout`, which keeps the columns physically separated on each line, and split at the gutter before reading column 1 then column 2.
2. **The PDF's own page numbers parse as movement numbers.** Pages are numbered 12–17, and `12`, `13`, `14`, `16` all appeared as duplicate "movements".
3. **Text continues after a citation.** Eight numbers cite more than one passage; a parser that stops at the first `(…)` loses **41 lines of verse and 9 citations**, measured on this libretto.

The Part division is **21 / 23 / 9** — Part One ending at *His yoke is easy*, Part Two at *Hallelujah*, Part Three at the closing *Amen* — and the trial parse got that right. (An earlier draft of this plan called 20 / 25 / 9 the true division and the parse wrong; the reverse was the case. The anchors in Task 1 are what settle it.)

---

### Task 1: The libretto reader

**Files:**
- Create: `cli/libretto.cli.mjs`
- Create: `cli/libretto.cli.test.mjs`

**Interfaces:**
- Produces: `parseLibretto(rawText)` → `{ items: Array<{n, part, form, voice, incipit, scripture, text}>, warnings: string[] }`, where `n` is **corpus** numbering 1–53 and `part` is `'One'|'Two'|'Three'`.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { parseLibretto } from './libretto.cli.mjs';

const SAMPLE = [
  'PART ONE',
  '',
  '2 Sinfonia (Ouverture)',
  '',
  'Recitative (Accompanied – Tenor)',
  '3 Comfort ye, comfort ye my people,',
  'saith your God.',
  '(Isaiah 40: 1-3)',
  '',
  'Air (Tenor)',
  "4 Ev'ry valley shall be exalted,",
  '(Isaiah 40: 4)',
].join('\n');

describe('parseLibretto', () => {
  it('renumbers from the PDF’s 1-54 to the corpus’s 1-53', () => {
    const { items } = parseLibretto(SAMPLE);
    // PDF 2 (Sinfonia) is corpus 1, PDF 3 is corpus 2, PDF 4 is corpus 3.
    expect(items.map((i) => i.n)).toEqual([1, 2, 3]);
    expect(items[0].incipit).toBe('Sinfonia');
  });

  it('drops "Play All" — a DVD menu entry, not music', () => {
    const { items } = parseLibretto('PART ONE\n\n1 Play All\n\n2 Sinfonia (Ouverture)\n');
    expect(items).toHaveLength(1);
    expect(items[0].incipit).toBe('Sinfonia');
  });

  it('carries the form and voice down from the label line', () => {
    const { items } = parseLibretto(SAMPLE);
    expect(items[1]).toMatchObject({ form: 'Recitative', voice: 'Accompanied – Tenor' });
    expect(items[2]).toMatchObject({ form: 'Air', voice: 'Tenor' });
  });

  it('gives an instrumental number its own form, taken from its title', () => {
    const { items } = parseLibretto(SAMPLE);
    expect(items[0].form).toBe('Sinfonia');
    expect(items[0].voice).toBeNull();
  });

  it('captures the scripture citation and the sung text separately', () => {
    const { items } = parseLibretto(SAMPLE);
    expect(items[1].scripture).toBe('Isaiah 40: 1-3');
    expect(items[1].text.split('\n')).toHaveLength(2);
    expect(items[1].text.startsWith('Comfort ye')).toBe(true);
  });

  /**
   * A number may draw on more than one passage, and its text CONTINUES after the
   * first citation — No. 53 does exactly this. A parser that stops capturing at
   * the first `(…)` silently drops the rest of the verse, which is the kind of
   * loss nothing downstream would ever reveal.
   */
  it('keeps capturing text after a citation, and keeps every citation', () => {
    const multi = [
      'Air (Soprano)',
      '53 If God be for us, who can be against us?',
      '(Romans 8: 31)',
      'Who shall lay anything to the charge',
      "of God's elect?",
      '(Romans 8: 33-34)',
    ].join('\n');
    const { items } = parseLibretto(multi);
    expect(items[0].scripture).toBe('Romans 8: 31; Romans 8: 33-34');
    expect(items[0].text.split('\n')).toHaveLength(3);
    expect(items[0].text).toContain("of God's elect?");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run cli/libretto.cli.test.mjs`
Expected: FAIL — `parseLibretto is not a function`

- [ ] **Step 3: Implement the reader**

```js
const FORM_LINE = /^(Recitative|Air|Chorus|Duet|Soli|Sinfonia|Pifa|Symphony)\b\s*(?:\((.+?)\))?\s*$/;
const NUM_LINE  = /^(\d{1,2})\s+(.*)$/;
const CITE_LINE = /^\((.+?)\)\s*$/;
const PART_LINE = /^PART\s+(One|Two|Three)$/i;
/** Instrumental numbers name their own form: "2 Sinfonia (Ouverture)". */
const INSTRUMENTAL = /^(Sinfonia|Pifa|Symphony)\b\s*(?:\((.+?)\))?/;

export function parseLibretto(rawText) {
  const warnings = [];
  const items = [];
  let pending = null;
  let current = null;
  for (const line of String(rawText).split('\n')) {
    const s = line.trim();
    if (!s) continue;
    if (PART_LINE.test(s)) { current = null; pending = null; continue; }
    let m = FORM_LINE.exec(s);
    if (m) { pending = { form: m[1], voice: m[2] ?? null }; continue; }
    m = NUM_LINE.exec(s);
    if (m) {
      const title = m[2].trim();
      if (/^Play All$/i.test(title)) { pending = null; continue; }
      const inst = INSTRUMENTAL.exec(title);
      current = {
        n: 0,
        part: null,
        form: inst ? inst[1] : (pending?.form ?? null),
        voice: inst ? null : (pending?.voice ?? null),
        incipit: inst ? inst[1] : title,
        cites: [],
        text: inst ? '' : title,
      };
      if (!current.form) warnings.push(`no form for "${title}"`);
      items.push(current);
      pending = null;
      continue;
    }
    m = CITE_LINE.exec(s);
    // EVERY citation, and the text keeps going after it: a number may draw on
    // several passages, and No. 53 resumes its verse after the first one.
    if (m && current) { current.cites.push(m[1]); continue; }
    if (current) {
      current.text = current.text ? `${current.text}\n${s}` : s;
    }
  }
  items.forEach((it, i) => {
    it.n = i + 1;
    it.scripture = it.cites.length ? it.cites.join('; ') : null;
    delete it.cites;
  });
  return { items, warnings };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run cli/libretto.cli.test.mjs`
Expected: PASS

- [ ] **Step 4b: Add the column splitter**

`-layout` preserves the two columns as text separated by a run of spaces at a
consistent x-offset. Reading a `-layout` page line-by-line therefore interleaves
the columns just as `-raw` did; the fix is to cut every line at the gutter and
read the left column entirely before the right.

```js
/**
 * Split a `-layout` page into single-column reading order.
 *
 * The gutter is found per page as the column offset that is blank on the most
 * lines — derived rather than hardcoded, because the two columns do not start at
 * the same x on every page of this PDF.
 */
export function splitColumns(laidOut) {
  const pages = String(laidOut).split('\f');
  const out = [];
  for (const page of pages) {
    const lines = page.split('\n');
    if (!lines.length) continue;
    const width = Math.max(...lines.map((l) => l.length));
    if (width < 20) { out.push(page); continue; }
    let best = -1;
    let bestScore = -1;
    for (let c = Math.floor(width * 0.3); c < Math.floor(width * 0.7); c += 1) {
      const score = lines.filter((l) => (l[c] ?? ' ') === ' ').length;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    const left = lines.map((l) => l.slice(0, best).trimEnd()).filter((l) => l.trim());
    const right = lines.map((l) => l.slice(best).trimEnd()).filter((l) => l.trim());
    out.push([...left, ...right].join('\n'));
  }
  return out.join('\n');
}
```

Test it against the real PDF rather than a fixture, because the property that
matters is a fact about this document:

```bash
node -e '
const { splitColumns, parseLibretto, assignParts } = await import("./cli/libretto.cli.mjs");
const { execFileSync } = await import("node:child_process");
const laid = execFileSync("pdftotext", ["-layout", process.argv[1], "-"], { encoding: "utf8", maxBuffer: 1<<24 });
const { items } = parseLibretto(splitColumns(laid));
const parts = assignParts(items).reduce((a,i)=>({...a,[i.part]:(a[i.part]??0)+1}),{});
console.log(items.length, JSON.stringify(parts));
' "/media/kckern/Media/Stage/Handel's Messiah—Live from the Sydney Opera House (2009)/Libretto.pdf"
```

Expected: `53 {"One":21,"Two":23,"Three":9}`

- [ ] **Step 5: Write the failing test for the Part anchors**

Parts are assigned by **anchor**, never by reading order. Even after column-splitting, a heading can fall on the wrong side of a column break, and the cost of getting it wrong is silent: the validator uses Part membership to pin the applause breaks, so a misplaced division poisons every later stage. These two incipits open Parts Two and Three in every edition.

```js
import { assignParts, PART_ANCHORS } from './libretto.cli.mjs';

describe('assignParts', () => {
  const items = Array.from({ length: 53 }, (_, i) => ({
    n: i + 1,
    // No. 22 opens Part Two, No. 45 opens Part Three.
    incipit: i === 21 ? 'Behold the Lamb of God'
      : i === 44 ? 'I know that my Redeemer liveth' : `Number ${i + 1}`,
  }));

  it('splits the work at its two known anchors', () => {
    const out = assignParts(items);
    const count = (p) => out.filter((i) => i.part === p).length;
    // Messiah divides 21 / 23 / 9.
    expect([count('One'), count('Two'), count('Three')]).toEqual([21, 23, 9]);
  });

  it('refuses rather than guessing when an anchor is missing', () => {
    const broken = items.map((i) => ({ ...i, incipit: 'x' }));
    expect(() => assignParts(broken)).toThrow(/anchor/i);
  });
});
```

- [ ] **Step 6: Run it, watch it fail, then implement**

Run: `npx vitest run cli/libretto.cli.test.mjs -t assignParts` → FAIL (`assignParts is not a function`)

```js
/**
 * WHERE THE PARTS DIVIDE — by anchor, never by reading order.
 *
 * `pdftotext -raw` interleaves a two-column page near a heading, so numbers land
 * on the wrong side of a PART line: the trial parse produced 21/23/9 against a
 * true 20/25/9. These two incipits open Parts Two and Three in every edition of
 * Messiah, so they locate the divisions without trusting the column order.
 */
export const PART_ANCHORS = Object.freeze({
  Two: 'Behold the Lamb of God',
  Three: 'I know that my Redeemer liveth',
});

export function assignParts(items) {
  const find = (needle) => items.findIndex(
    (i) => i.incipit.toLowerCase().startsWith(needle.toLowerCase()),
  );
  const two = find(PART_ANCHORS.Two);
  const three = find(PART_ANCHORS.Three);
  if (two < 0) throw new Error(`Part Two anchor not found: "${PART_ANCHORS.Two}"`);
  if (three <= two) throw new Error(`Part Three anchor not found after Part Two`);
  return items.map((it, i) => ({
    ...it,
    part: i < two ? 'One' : i < three ? 'Two' : 'Three',
  }));
}
```

- [ ] **Step 7: Run it and watch it pass**

Run: `npx vitest run cli/libretto.cli.test.mjs`
Expected: PASS

- [ ] **Step 8: Add the CLI shell and run it on the real PDF**

```js
// at the bottom of cli/libretto.cli.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  const { execFileSync } = await import('node:child_process');
  const fs = await import('node:fs');
  const pdf = process.argv[2];
  if (!pdf) { console.error('Usage: node cli/libretto.cli.mjs <libretto.pdf> [out.json]'); process.exit(1); }
  // `-layout`, NOT `-raw`: this libretto is two-column and `-raw` interleaves
  // them so badly the movement numbers do not ascend. `splitColumns` reads
  // column 1 top-to-bottom, then column 2.
  const laid = execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8', maxBuffer: 1 << 24 });
  const raw = splitColumns(laid);
  const { items, warnings } = parseLibretto(raw);
  const withParts = assignParts(items);
  warnings.forEach((w) => console.error(`warn: ${w}`));
  const counts = withParts.reduce((a, i) => ({ ...a, [i.part]: (a[i.part] ?? 0) + 1 }), {});
  console.error(`${withParts.length} numbers  parts=${JSON.stringify(counts)}`);
  fs.writeFileSync(process.argv[3] ?? 'libretto.json', JSON.stringify(withParts, null, 1));
}
```

Run it:

```bash
node cli/libretto.cli.mjs \
  "/media/kckern/Media/Stage/Handel's Messiah—Live from the Sydney Opera House (2009)/Libretto.pdf" \
  "$SCRATCH/messiah.libretto.json"
```

Expected: `53 numbers  parts={"One":21,"Two":23,"Three":9}`

**If the counts differ, stop.** Report the actual counts and the warnings. A wrong Part division silently poisons every later stage, because the validator uses Part membership to anchor the applause breaks.

- [ ] **Step 9: Commit**

```bash
git add cli/libretto.cli.mjs cli/libretto.cli.test.mjs
git commit -m "feat(cli): read the Messiah libretto into 53 structured numbers"
```

---

### Task 2: Candidate boundaries from the audio

**Files:**
- Create: `cli/segment-timings.cli.mjs`
- Create: `cli/segment-timings.cli.test.mjs`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `parseSilences(ffmpegStderr)` → `Array<{start:number, end:number, duration:number}>`; `candidateBoundaries(silences, {minGapS})` → `number[]` of seconds where music resumes.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { parseSilences, candidateBoundaries } from './segment-timings.cli.mjs';

const STDERR = [
  '[silencedetect @ 0x1] silence_start: 83.4',
  '[silencedetect @ 0x1] silence_end: 85.1 | silence_duration: 1.7',
  '[silencedetect @ 0x1] silence_start: 90.0',
  '[silencedetect @ 0x1] silence_end: 90.8 | silence_duration: 0.8',
].join('\n');

describe('parseSilences', () => {
  it('pairs each start with its end and duration', () => {
    expect(parseSilences(STDERR)).toEqual([
      { start: 83.4, end: 85.1, duration: 1.7 },
      { start: 90.0, end: 90.8, duration: 0.8 },
    ]);
  });

  it('ignores a trailing unpaired start', () => {
    expect(parseSilences(`${STDERR}\n[silencedetect @ 0x1] silence_start: 99.0`)).toHaveLength(2);
  });
});

describe('candidateBoundaries', () => {
  it('takes the point music RESUMES, not where it stopped', () => {
    expect(candidateBoundaries(parseSilences(STDERR), { minGapS: 0 })).toEqual([85.1, 90.8]);
  });

  it('drops a candidate that would make an implausibly short span', () => {
    // 90.8 is only 5.7s after 85.1 — a breath, not a movement.
    expect(candidateBoundaries(parseSilences(STDERR), { minGapS: 30 })).toEqual([85.1]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run cli/segment-timings.cli.test.mjs`
Expected: FAIL — `parseSilences is not a function`

- [ ] **Step 3: Implement**

```js
const SIL = /silence_(start|end): (-?[\d.]+)(?: \| silence_duration: ([\d.]+))?/g;

/** `silencedetect` logs at INFO — a run with `-v error` yields nothing at all. */
export function parseSilences(stderr) {
  const out = [];
  let open = null;
  for (const m of String(stderr).matchAll(SIL)) {
    if (m[1] === 'start') { open = Number(m[2]); continue; }
    if (open === null) continue;
    out.push({ start: open, end: Number(m[2]), duration: Number(m[3] ?? (Number(m[2]) - open)) });
    open = null;
  }
  return out;
}

/**
 * A boundary is where the music RESUMES, not where it stopped: taking the start
 * of a silence puts the mark before the applause and the settling.
 *
 * `minGapS` drops candidates that would carve a span too short to be a movement.
 * Measured on this recording: 84 of the raw spans are under 30 s — rests,
 * fermatas and breaths inside recitative, not boundaries.
 */
export function candidateBoundaries(silences, { minGapS = 30 } = {}) {
  const out = [];
  for (const s of silences.slice().sort((a, b) => a.start - b.start)) {
    if (out.length && s.end - out[out.length - 1] < minGapS) continue;
    out.push(s.end);
  }
  return out;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run cli/segment-timings.cli.test.mjs`
Expected: PASS

- [ ] **Step 5: Produce the real candidate set**

```bash
F="/media/kckern/Media/Stage/Handel's Messiah—Live from the Sydney Opera House (2009)/Handel's Messiah—Live from the Sydney Opera House (2009).mp4"
ffmpeg -hide_banner -nostats -i "$F" -vn -af "silencedetect=noise=-38dB:d=0.6" -f null - 2>&1 \
  | grep silencedetect > "$SCRATCH/silence.txt"
wc -l "$SCRATCH/silence.txt"     # expect ~284 lines / 142 silences
```

Then report the candidate count at several `minGapS` values (20/30/45/60) against the 52 needed. **Do not tune `minGapS` until it yields exactly 52** — that would be fitting the filter to the answer. The validator in Task 4 does the selecting; this step only has to produce a superset that *contains* the 52.

- [ ] **Step 6: Commit**

```bash
git add cli/segment-timings.cli.mjs cli/segment-timings.cli.test.mjs
git commit -m "feat(cli): candidate movement boundaries from silence analysis"
```

---

### Task 3: Applause detection anchors the Part breaks

**Files:**
- Modify: `cli/segment-timings.cli.mjs`
- Modify: `cli/segment-timings.cli.test.mjs`

**Interfaces:**
- Produces: `applauseRuns(frames, {hfFloorDb, minRunS})` → `Array<{start:number, end:number}>`, where `frames` is `Array<{t:number, full:number, hf:number}>` of per-second dB levels.

- [ ] **Step 1: Write the failing test**

```js
import { applauseRuns } from './segment-timings.cli.mjs';

/** Applause is broad-band: its >9kHz energy sits close to its full-band energy. */
const frame = (t, full, hf) => ({ t, full, hf });

describe('applauseRuns', () => {
  it('finds a sustained broad-band run and reports its span', () => {
    const frames = [
      ...Array.from({ length: 5 }, (_, i) => frame(i, -20, -60)),      // music
      ...Array.from({ length: 8 }, (_, i) => frame(5 + i, -25, -45)),  // applause
      ...Array.from({ length: 5 }, (_, i) => frame(13 + i, -20, -60)), // music
    ];
    expect(applauseRuns(frames, { hfFloorDb: -26, minRunS: 5 }))
      .toEqual([{ start: 5, end: 12 }]);
  });

  it('ignores a bright passage that is not sustained', () => {
    const frames = [
      ...Array.from({ length: 5 }, (_, i) => frame(i, -20, -60)),
      frame(5, -25, -45), frame(6, -25, -45),                          // two bright seconds
      ...Array.from({ length: 5 }, (_, i) => frame(7 + i, -20, -60)),
    ];
    expect(applauseRuns(frames, { hfFloorDb: -26, minRunS: 5 })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it, watch it fail, then implement**

Run: `npx vitest run cli/segment-timings.cli.test.mjs -t applauseRuns` → FAIL

```js
/**
 * APPLAUSE IS BROAD-BAND AND SUSTAINED, and that pair is what separates it from
 * a loud tutti. The ratio of >9 kHz energy to full-band energy rises sharply
 * (hands, not instruments), and it holds for seconds rather than a bar.
 *
 * Anchoring matters here beyond tidiness: the two Part breaks are the only
 * boundaries this recording gives up without the libretto, and the design pass
 * already found them at ~48.6 min and ~111 min from silence alone. This confirms
 * them positively rather than by elimination.
 */
export function applauseRuns(frames, { hfFloorDb = -26, minRunS = 5 } = {}) {
  const runs = [];
  let open = null;
  for (const f of frames) {
    const bright = (f.hf - f.full) >= hfFloorDb;
    if (bright && open === null) open = f.t;
    if (!bright && open !== null) {
      if (f.t - open >= minRunS) runs.push({ start: open, end: f.t - 1 });
      open = null;
    }
  }
  if (open !== null) {
    const last = frames[frames.length - 1];
    if (last.t - open >= minRunS) runs.push({ start: open, end: last.t });
  }
  return runs;
}
```

- [ ] **Step 3: Run it and watch it pass**

Run: `npx vitest run cli/segment-timings.cli.test.mjs`
Expected: PASS

- [ ] **Step 4: Extract the real frames and find the anchors**

```bash
F="…/Handel's Messiah—…(2009).mp4"
ffmpeg -v error -y -i "$F" -vn -af "aresample=8000,asetnsamples=8000,astats=metadata=1:reset=1,\
ametadata=print:key=lavfi.astats.Overall.RMS_level:file=$SCRATCH/rms.txt" -f null -
ffmpeg -v error -y -i "$F" -vn -af "aresample=32000,highpass=f=9000,asetnsamples=32000,\
astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=$SCRATCH/hf.txt" -f null -
```

Zip the two into per-second `{t, full, hf}` frames, run `applauseRuns`, and report every run found.

**Acceptance:** at least two sustained runs, one near **48.6 min** and one near **111 min**, matching what the silence pass found independently. If they do not appear, sweep `hfFloorDb` from −30 to −20 and report the sweep rather than picking a value that produces the hoped-for answer.

- [ ] **Step 5: Aim the texture detector inside over-long spans**

The aligner (Task 4) reports which spans are **too long for their form** — those
are attacca joins, where two numbers share one audible span because there is no
gap between them. Sweeping 134 minutes for texture changes would be hopeless;
searching a known 6-minute span for exactly one join is tractable.

So this step runs only after a first alignment pass, over the spans it flagged:
compute the per-second full/HF frames for that span alone, and look for the
largest sustained change in the HF-to-full ratio away from the span's own
baseline — a recitative over continuo giving way to a full-orchestra air is a
different spectral picture even when nothing goes quiet.

**Report candidates; do not auto-insert them.** Each proposed join goes back
through `validateSpans`, and it is kept only if it makes *both* resulting spans
plausible for their own forms. A join that fixes one number and breaks the next
is not a join.

- [ ] **Step 6: Commit**

```bash
git add cli/segment-timings.cli.mjs cli/segment-timings.cli.test.mjs
git commit -m "feat(cli): anchor the Part breaks, and find attacca joins by texture"
```

---

### Task 4: The aligner — the publish gate

**Files:**
- Modify: `cli/segment-timings.cli.mjs`
- Modify: `cli/segment-timings.cli.test.mjs`

**Interfaces:**
- Consumes: the libretto items from Task 1, candidates from Task 2, applause runs from Task 3.
- Produces: `FORM_DURATIONS` (the priors) and `validateSpans({ items, starts, endS })` → `{ ok:boolean, spans:Array<{n, form, seconds:number|null, plausible:boolean, omitted:boolean}>, failures:string[] }`.

`starts` is **always length 53**, positional against the libretto, and an entry
may be `null` — meaning this performance omits that number. A number's span runs
from its own start to the **next non-null start**, so an omission never shifts a
neighbour's timing.

- [ ] **Step 1: Write the failing test**

```js
import { validateSpans, FORM_DURATIONS } from './segment-timings.cli.mjs';

const items = [
  { n: 1, form: 'Sinfonia', incipit: 'Sinfonia' },
  { n: 2, form: 'Recitative', incipit: 'Comfort ye' },
  { n: 3, form: 'Air', incipit: "Ev'ry valley" },
];

describe('validateSpans', () => {
  it('accepts spans whose lengths suit their own forms', () => {
    //           Sinfonia 180s     Recitative 70s    Air 250s
    const r = validateSpans({ items, starts: [0, 180, 250], endS: 500 });
    expect(r.ok).toBe(true);
    expect(r.spans.map((s) => s.seconds)).toEqual([180, 70, 250]);
  });

  it('rejects a recitative that runs six minutes — a missed boundary', () => {
    const r = validateSpans({ items, starts: [0, 180, 540], endS: 800 });
    expect(r.ok).toBe(false);
    expect(r.failures.join(' ')).toMatch(/Recitative/);
  });

  it('rejects when the starts do not pair positionally with the libretto', () => {
    const r = validateSpans({ items, starts: [0, 180], endS: 500 });
    expect(r.ok).toBe(false);
    expect(r.failures.join(' ')).toMatch(/3 numbers.*2 starts/);
  });

  /**
   * THE CUT. This performance omits roughly a fifth of the work, so an omitted
   * number is an ordinary state, not a failure — it carries a null start, is
   * reported as omitted, and crucially does NOT consume its neighbour's span.
   */
  it('accepts a null start as an omission and does not shift the next number', () => {
    const r = validateSpans({ items, starts: [0, null, 180], endS: 430 });
    expect(r.ok).toBe(true);
    expect(r.spans[1]).toMatchObject({ n: 2, omitted: true, seconds: null });
    // No. 1 runs to the next NON-NULL start (180), not to the null one.
    expect(r.spans[0].seconds).toBe(180);
    expect(r.spans[2].seconds).toBe(250);
  });

  it('reports how much of the work this performance leaves out', () => {
    const r = validateSpans({ items, starts: [0, null, 180], endS: 430 });
    expect(r.spans.filter((s) => s.omitted).map((s) => s.n)).toEqual([2]);
  });

  it('publishes a prior for every form the libretto uses', () => {
    for (const form of ['Recitative', 'Air', 'Chorus', 'Duet', 'Sinfonia', 'Pifa']) {
      expect(FORM_DURATIONS[form], `no prior for ${form}`).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run it, watch it fail, then implement**

Run: `npx vitest run cli/segment-timings.cli.test.mjs -t validateSpans` → FAIL

```js
/**
 * HOW LONG A NUMBER OF EACH FORM RUNS, in seconds.
 *
 * Deliberately WIDE. These are not a model of Messiah, they are a sieve: their
 * job is to reject a span that could not possibly be its own form — a
 * "recitative" of six minutes is a missed boundary, not a slow reading — while
 * never rejecting a real one. A tight prior here would silently discard correct
 * boundaries, which is the failure this whole gate exists to avoid.
 */
export const FORM_DURATIONS = Object.freeze({
  Recitative: [15, 180],
  Air: [90, 480],
  Duet: [90, 420],
  Chorus: [60, 420],
  Sinfonia: [120, 300],
  Pifa: [60, 240],
  Symphony: [60, 300],
});

/**
 * THE GATE. A candidate boundary set is accepted only if it yields one span per
 * libretto number, in the libretto's own order, each plausible for its own form.
 *
 * Returning the failures rather than a bare false is the point: a rejected set
 * names which numbers were implausible and by how much, which is what makes the
 * next iteration a correction instead of a guess.
 */
export function validateSpans({ items, starts, endS }) {
  const failures = [];
  if (items.length !== starts.length) {
    failures.push(`${items.length} numbers but ${starts.length} starts`);
    return { ok: false, spans: [], failures };
  }
  /** The next start that actually sounds — an omitted number owns no time. */
  const nextSounding = (from) => {
    for (let j = from; j < starts.length; j += 1) {
      if (Number.isFinite(starts[j])) return starts[j];
    }
    return endS;
  };
  const spans = items.map((it, i) => {
    if (!Number.isFinite(starts[i])) {
      return { n: it.n, form: it.form, seconds: null, plausible: true, omitted: true };
    }
    const seconds = Math.round(nextSounding(i + 1) - starts[i]);
    const prior = FORM_DURATIONS[it.form];
    const plausible = !prior || (seconds >= prior[0] && seconds <= prior[1]);
    if (!plausible) {
      // TOO LONG means a hidden attacca join — two numbers sharing one span, and
      // the place to aim the texture detector. TOO SHORT means a break inside a
      // number. The message says which, because the two need opposite fixes.
      const how = seconds > prior[1] ? 'too long — a hidden join?' : 'too short — a break inside it?';
      failures.push(`No. ${it.n} "${it.incipit}" (${it.form}) ran ${seconds}s, expected ${prior[0]}-${prior[1]}s — ${how}`);
    }
    return { n: it.n, form: it.form, seconds, plausible, omitted: false };
  });
  return { ok: failures.length === 0, spans, failures };
}
```

- [ ] **Step 3: Run it and watch it pass**

Run: `npx vitest run cli/segment-timings.cli.test.mjs`
Expected: PASS

- [ ] **Step 4: Run the real selection**

Align the libretto's 53 numbers onto the candidate spans such that
`validateSpans` returns `ok`, with the Part breaks pinned to the applause anchors
from Task 3. The output is 53 positional starts, some `null`. Report:

- the candidate count fed in,
- whether a valid selection was found,
- and if not, the `failures` list verbatim.

- [ ] **Step 5: HALT AND REPORT — this is the gate, not a checkpoint**

**If the alignment holds** — every sounding number plausible for its own form,
and the omissions accounting for the ~20 minutes the arithmetic says are missing
— write it to `$SCRATCH/messiah.starts.json` (53 entries, some `null`) and
continue to Task 5. This artifact is what plan 2 consumes. Report the omitted
numbers by name: that list is a fact about this performance and the first thing
a reviewer should sanity-check, because a plausible-looking alignment that has
quietly cut the wrong numbers is the failure mode with no other symptom.

**If it does not hold:** stop. Do not hand-tune boundaries into place, and do not
widen `FORM_DURATIONS` until it passes — either would produce a rail that lies
about position, which the design rejects explicitly. Report the failures verbatim
and continue to Task 5 with **three** starts (the Part boundaries) instead of 53.
That still ships a working surround; it just ships the coarse one.

- [ ] **Step 6: Commit**

```bash
git add cli/segment-timings.cli.mjs cli/segment-timings.cli.test.mjs
git commit -m "feat(cli): validate boundaries against the libretto's own form sequence"
```

---

### Task 5: The performance sidecar

**Files:**
- Create (data volume): `data/content/surround/classical/handel/messiah.sydney-2009.yml`

The corpus work `handel/messiah` already exists with **three** segments (Part I / II / III), and this plan does not change it — restructuring to 53 is plan 2. So this sidecar carries **three** `starts:`, whatever Task 4 produced, and the 53-boundary artifact waits for plan 2.

- [ ] **Step 1: Read the performers out of the programme**

```bash
pdftotext -raw "/media/kckern/Media/Stage/Handel's Messiah—Live from the Sydney Opera House (2009)/Program.pdf" - | head -80
```

Take the conductor, the choir, the orchestra, the soloists, the venue and the **performance date** — the `nfo.json` date (2019-12-14) is the upload/broadcast date and the title says 2009, so the programme is the authority. If the two cannot be reconciled, record what the programme says and note the discrepancy in the sidecar as a comment.

- [ ] **Step 2: Write the sidecar**

```yaml
work: handel/messiah
surround: concert-hall
match:
  contentId: plex:6918
  title: "Handel's Messiah—Live from the Sydney Opera House"
performance: "<conductor · choir · orchestra · venue · date, from Program.pdf>"
# Three starts, pairing positionally with the work's three Parts. The 53 movement
# boundaries derived in this pass — including the nulls for the numbers this
# performance omits — are parked for the corpus restructure in plan 2.
starts: [0, <part two start>, <part three start>]
musicEndsAt: <end of the final Amen, before the closing applause>
```

- [ ] **Step 3: Write it to the data volume**

```bash
B64=$(base64 -w0 "$SCRATCH/messiah.sydney-2009.yml")
sudo docker exec daylight-station sh -c \
  "mkdir -p data/content/surround/classical/handel && echo '$B64' | base64 -d > data/content/surround/classical/handel/messiah.sydney-2009.yml && chown -R node:node data/content/surround/classical/handel"
```

- [ ] **Step 4: Verify it resolves**

```bash
curl -s http://localhost:3111/api/v1/play/plex:6918 \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const s=JSON.parse(d).surround;
      console.log("surround:", s?.id, "| segments:", s?.segments?.length,
                  "| starts:", JSON.stringify(s?.pieceSegments?.map(m=>m.start)),
                  "| musicEndsAt:", s?.piece?.musicEndsAt)})'
```

Expected: `surround: concert-hall | segments: 3 | starts: [0,…,…]`

`null` means no sidecar matched — check `surround.lookup.miss` and `surround.sidecar.invalid` in the log store before editing anything.

- [ ] **Step 5: Confirm nothing else regressed**

```bash
sudo docker logs --since 3m daylight-station 2>&1 \
  | grep -oE 'surround\.(work\.missing|sidecar\.invalid|starts\.mismatch|segments\.none|index\.built)' \
  | sort | uniq -c
```

Expected: `surround.index.built` only, with `pieces` one higher than before (21).

- [ ] **Step 6: Commit the derivation artifacts and document**

The sidecar lives on the data volume (not in git). Commit the tooling output that explains it, and add Messiah to the corpus README's worked examples with the measured boundary table.

```bash
git add docs/reference/player/surround/classical/README.md
git commit -m "docs(surround): Messiah's timings, and how they were derived"
```

---

## Ship

- [ ] `npx vitest run cli/` — the three pure stages pass
- [ ] `curl -s http://localhost:3111/api/v1/play/plex:6918` resolves a `concert-hall` surround
- [ ] No redeploy needed — corpus and sidecar changes are picked up on mtime
- [ ] Report to the owner: the gate's verdict (53 spans or 3), the candidate counts, the applause anchors, and — if the gate failed — the `failures` list, which is the input to deciding whether plan 2 proceeds as designed
