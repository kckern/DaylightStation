# Recording in Pieces Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Let a learner on the Sentence Ladder recording rung say a long sentence in two or three pieces (hear a piece, say it, hear the rest, say it), redo any single piece, and bank the joined result as one ordinary recording.

**Architecture:** The learner cuts the model sentence live with → while it plays. The cut snaps back to the nearest pause in the model audio. Each piece is its own mic take with its own model span `[fromMs, toMs]`. After the last piece the tablet decodes the pieces, joins them as 16 kHz mono with 250 ms gaps, encodes a WAV, and the WAV enters the existing single-take review/keep/upload path unchanged. Pure logic lives in three small modules (`pauses.js`, `pieces.js`, `joinTake.js`); `RecordingRung.jsx` only wires phases and keys.

**Tech Stack:** React 18 hooks, MediaRecorder, Web Audio (`AudioContext.decodeAudioData`, `OfflineAudioContext` for resampling), vitest + @testing-library/react (happy-dom env, no Web Audio), Express raw-body route, YAML/filesystem datastore.

---

## Design (agreed 2026-09-22)

### Why

Production log, run `c8f5b336…`, 2026-09-22: takes of 12–14 s against 2–3 s model sentences, and four Tab restarts in a row on seq 15, each ~3 s into the recording. Long sentences are all-or-nothing today.

### The flow (keys)

The whole-sentence flow is unchanged: Space plays the sentence, then the ding, then the mic. Space stops, the take plays back, and Space keeps it.

| Moment | Key | Effect |
|---|---|---|
| model sentence playing (open-ended span) | **→** (or "Pause here" tile) | Model stops. Cut snaps to a pause ≤500 ms earlier. Ding plays, mic opens for **this piece**. |
| recording a piece | Space | Stop. The piece plays back, then piece review. |
| recording a piece | Tab | Throw away this piece's take, replay **its** span, ding, mic. Earlier pieces kept. |
| piece review | Space | Not the last piece: play the rest of the model **from the cut**, ding, mic. Last piece: join everything. |
| piece review | Backspace | Redo **this piece only**: its span, ding, mic. |
| piece review | Tab | Compare: this piece's span, then this piece's take. Nothing deleted. |
| rest of the model playing | → | Another cut (3+ pieces). |
| joined-take review | Space / Backspace / Tab | Keep / start the whole sentence over (sentence, ding, mic, cuttable again) / compare. |

A piece is "last" when no cut was made during its span.

### Checks

- **Each piece:** refused if loudness was measurable and nothing was heard (`too-quiet`), or if it is shorter than `MIN_PIECE_MS` = 500 (`too-short`). A refused piece blocks Space. The existing three-refusals escape hatch still applies.
- **Joined take:** refused `too-short` if the total recorded time is under `MIN_TAKE_MS` (1200).

### Failure paths

- Leaving the rung partway through: every piece is dropped, the mic is released, `capture.pieces-abandoned {seq, pieces}` is logged, and nothing is uploaded.
- Join fails: `capture.stitch-failed` is logged. The rung returns to idle with "Couldn't put the parts together — say it in one go." and cutting is disabled for this sentence.
- Mic denied: the same as today, and the pieces are dropped.
- → pressed during the meaning clip, the ding, a bounded span (redo of a non-last piece), or within `MIN_CUT_GAP_MS` (300) of the span start: ignored.

### Storage

Nothing changes downstream. The joined WAV is uploaded through the existing `POST /users/:id/recording` with `ext=wav`. Two fixes are required for that:

1. The router's raw-body parser does not accept `audio/wav`, so the body would arrive empty.
2. `writeRecording` never removed a sibling in another format. Because the reader tries `webm` before `wav`, an old `.webm` would be served instead of the new `.wav`.

### Logging (all via `languageLog.capture`)

`cut {seq, piece, rawMs, cutMs, snapped}` · `piece-stop {seq, piece, durationMs, heard, bytes}` · `refused {…, piece}` · `piece-redo {seq, piece}` · `compare {seq, from, piece?}` · `replay-restart {seq, from, piece?}` · `stitched {seq, pieces, durationMs, bytes}` · `stitch-failed {seq, pieces, error}` · `pieces-abandoned {seq, pieces}`.

---

## Conventions for every task

- Work in the worktree `/Users/kckern/Documents/GitHub/DaylightStation/.worktrees/recording-in-pieces` on branch `feat/recording-in-pieces`. All commands run from that worktree root.
- Run tests with `npx vitest run <file>`.
- Never use raw `console.*`. Log through `languageLog` (frontend).
- Match the surrounding comment style: comments explain *why*, in full sentences, with CAPS lead-ins for rules.
- End every commit message with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Never start a dev server or `node backend/index.js` (it is a live household controller).

---

### Task 0: Worktree + commit the Tab-compare fix

The main checkout has an uncommitted fix: Tab after a take compares instead of deleting it. It touches `rungs/RecordingRung.jsx`, `SentenceLadderProgram.test.jsx` and `docs/reference/school/sentence-ladder.md`. This feature builds on it.

**Step 1:** From the main checkout:

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
git worktree add .worktrees/recording-in-pieces -b feat/recording-in-pieces main
ln -s /Users/kckern/Documents/GitHub/DaylightStation/node_modules .worktrees/recording-in-pieces/node_modules
ln -s /Users/kckern/Documents/GitHub/DaylightStation/frontend/node_modules .worktrees/recording-in-pieces/frontend/node_modules
for f in frontend/src/modules/School/Programs/SentenceLadder/rungs/RecordingRung.jsx \
         frontend/src/modules/School/Programs/SentenceLadder/SentenceLadderProgram.test.jsx \
         docs/reference/school/sentence-ladder.md \
         docs/_wip/plans/2026-09-22-recording-in-pieces.md; do
  mkdir -p ".worktrees/recording-in-pieces/$(dirname $f)"; cp "$f" ".worktrees/recording-in-pieces/$f"; done
```

**Step 2:** In the worktree, run `npx vitest run frontend/src/modules/School/Programs/SentenceLadder`. Expected: 187 passed.

**Step 3:** Commit in the worktree:

```bash
git add frontend/src/modules/School/Programs/SentenceLadder docs/reference/school/sentence-ladder.md docs/_wip/plans/2026-09-22-recording-in-pieces.md
git commit -m "fix(sentence-ladder): Tab after a take compares instead of deleting it

Production 2026-09-22 (seq 13, 14): Tab pressed to hear the model against a
finished take threw the take away and reopened the mic. Tab now plays the
sentence then the take and keeps it; Backspace is the only retake key.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

**Step 4:** Back in the main checkout, restore the files. The fix now lives on the branch.

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
git checkout -- frontend/src/modules/School/Programs/SentenceLadder/rungs/RecordingRung.jsx frontend/src/modules/School/Programs/SentenceLadder/SentenceLadderProgram.test.jsx docs/reference/school/sentence-ladder.md
mv docs/_wip/plans/2026-09-22-recording-in-pieces.md _deleteme/ 2>/dev/null || true
```

---

### Task 1: A new recording replaces siblings in other formats

**Files:**
- Modify: `backend/src/1_adapters/persistence/yaml/YamlLanguageStudyDatastore.mjs` (import line ~19, `writeRecording` ~167)
- Test: `backend/src/1_adapters/persistence/yaml/YamlLanguageStudyDatastore.test.mjs`

**Step 1: Write the failing test.** Append:

```js
describe('writeRecording', () => {
  it('replaces a recording of the same sentence stored in another format', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lang-rec-'));
    const store = new YamlLanguageStudyDatastore({
      configService: { ...configService, getMediaDir: () => root },
    });
    const webm = store.writeRecording('glossika-korean', 'kckern', 7, 'KR', Buffer.from('old'), 'webm');
    const wav = store.writeRecording('glossika-korean', 'kckern', 7, 'KR', Buffer.from('new'), 'wav');
    // The reader tries webm before wav, so a surviving .webm would be served
    // instead of the take the learner just kept.
    expect(fs.existsSync(webm)).toBe(false);
    expect(fs.readFileSync(wav, 'utf8')).toBe('new');
    expect([...store.listRecordingKeys('glossika-korean', 'kckern')]).toEqual(['7-KR']);
  });

  it('leaves other sentences alone', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lang-rec-'));
    const store = new YamlLanguageStudyDatastore({
      configService: { ...configService, getMediaDir: () => root },
    });
    const other = store.writeRecording('glossika-korean', 'kckern', 8, 'KR', Buffer.from('x'), 'webm');
    store.writeRecording('glossika-korean', 'kckern', 7, 'KR', Buffer.from('y'), 'wav');
    expect(fs.existsSync(other)).toBe(true);
  });
});
```

Add `import fs from 'fs';` and `import os from 'os';` at the top of the test file.

**Step 2:** `npx vitest run backend/src/1_adapters/persistence/yaml/YamlLanguageStudyDatastore.test.mjs`. Expected: FAIL, because the `.webm` still exists.

**Step 3: Implement.** Add `deleteFile` to the FileIO import. Above the class, add:

```js
/** Every format a recording can be stored in — the same list the reader tries. */
const RECORDING_FORMATS = Object.freeze(['webm', 'mp3', 'ogg', 'm4a', 'wav']);
```

Replace `writeRecording`:

```js
  /**
   * ONE RECORDING PER SENTENCE. A take joined from pieces is a WAV while a
   * one-go take is WebM, and the reader tries formats in a fixed order — so a
   * surviving sibling in another format would be served instead of the take
   * the learner just kept. The new file is written first, then the siblings go,
   * so a failed write never costs the old recording.
   */
  writeRecording(corpusId, userId, seq, language, buffer, ext = 'webm') {
    const target = this.resolveRecordingPath(corpusId, userId, seq, language, ext);
    if (!target) return null;
    ensureDir(path.dirname(target));
    writeBinary(target, buffer);
    const base = target.slice(0, -path.extname(target).length);
    for (const format of RECORDING_FORMATS) {
      const sibling = `${base}.${format}`;
      if (sibling !== target) deleteFile(sibling);
    }
    return target;
  }
```

**Step 4:** Rerun. Expected: PASS (all tests in the file).

**Step 5:** Commit: `fix(school): a new recording replaces its sibling in another format`.

---

### Task 2: The upload route accepts WAV

**Files:**
- Modify: `backend/src/4_api/v1/routers/language.mjs:262-265`
- Test: `backend/src/4_api/v1/routers/language.test.mjs` (next to "preserves the raw recording upload status…", ~line 140)

**Step 1: Failing test.**

```js
  it('accepts a WAV upload — a take joined from pieces', async () => {
    const bytes = Buffer.from('RIFF-joined-take');
    const { app, service } = appWith();
    service.saveRecording.mockReturnValue({ rung: 'recording', seq: 7 });

    const res = await request(app)
      .post('/api/v1/school/sentence-ladder/users/learner3/recording?corpus=korean&seq=7&ext=wav&microphone=1&textInput=KR')
      .set('X-School-Study-Grant', 'signed')
      .set('Content-Type', 'audio/wav')
      .send(bytes);

    expect(res.status).toBe(200);
    const { buffer, ext } = service.saveRecording.mock.calls[0][0];
    expect(ext).toBe('wav');
    expect(Buffer.isBuffer(buffer) && buffer.equals(bytes)).toBe(true);
  });
```

**Step 2:** `npx vitest run backend/src/4_api/v1/routers/language.test.mjs`. Expected: FAIL. `buffer` is `{}` because the parser skipped `audio/wav`.

**Step 3:** Change the parser type list to:

```js
    type: ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/wave', 'application/octet-stream'],
```

and extend its comment with one line: "WAV is what a take joined from pieces is (see `rungs/joinTake.js`)."

**Step 4:** Rerun. Expected: PASS.

**Step 5:** Commit: `feat(school): the recording route accepts a WAV take`.

---

### Task 3: The client sends WAV as `ext=wav`

**Files:**
- Modify: `frontend/src/modules/School/Programs/SentenceLadder/languageApi.js` (~line 155, the `ext` ternary)
- Test: `frontend/src/modules/School/Programs/SentenceLadder/languageApi.test.js`

**Step 1: Failing test.** Add it to the file's existing describe that mocks `globalThis.fetch`. Follow the file's `beforeEach` pattern, and read the URL from `globalThis.fetch.mock.calls.at(-1)[0]`.

```js
it('uploads a joined WAV take as ext=wav with its own content type', async () => {
  globalThis.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  await languageApi.recording('test-user', 'ko-basic', 4, new Blob(['x'], { type: 'audio/wav' }), {}, 'grant-1');
  const [url, init] = globalThis.fetch.mock.calls.at(-1);
  expect(url).toContain('ext=wav');
  expect(init.headers['Content-Type']).toBe('audio/wav');
});
```

**Step 2:** Run `npx vitest run frontend/src/modules/School/Programs/SentenceLadder/languageApi.test.js`. Expected: FAIL (`ext=webm`).

**Step 3:** Change the ternary to:

```js
      const type = blob.type || '';
      const ext = type.includes('ogg') ? 'ogg'
        : type.includes('mp4') ? 'm4a'
          : type.includes('wav') ? 'wav' : 'webm';
```

**Step 4:** Rerun. Expected: PASS.

**Step 5:** Commit: `feat(sentence-ladder): a WAV take uploads as ext=wav`.

---

### Task 4: `pauses.js` — find the model's pauses, snap a cut to one

**Files:**
- Create: `frontend/src/modules/School/Programs/SentenceLadder/rungs/pauses.js`
- Test: `frontend/src/modules/School/Programs/SentenceLadder/rungs/pauses.test.js`

**Step 1: Failing tests.**

```js
import { describe, it, expect } from 'vitest';
import { findPauses, snapCut } from './pauses.js';

const RATE = 1000; // 1 sample per ms keeps the arithmetic readable
/** Build a signal from [ms, loud?] runs. */
const signal = (...runs) => {
  const out = [];
  for (const [ms, loud] of runs) for (let i = 0; i < ms; i += 1) out.push(loud ? (i % 2 ? 0.5 : -0.5) : 0);
  return Float32Array.from(out);
};

describe('findPauses', () => {
  it('returns the midpoint of a silence between two stretches of speech', () => {
    expect(findPauses(signal([1000, true], [200, false], [800, true]), RATE)).toEqual([1100]);
  });

  it('ignores leading and trailing silence — only a pause INSIDE the sentence can be a cut', () => {
    expect(findPauses(signal([300, false], [1000, true], [400, false]), RATE)).toEqual([]);
  });

  it('ignores a gap shorter than a pause (a stop consonant, not a phrase break)', () => {
    expect(findPauses(signal([1000, true], [60, false], [800, true]), RATE)).toEqual([]);
  });
});

describe('snapCut', () => {
  it('moves a late press back to the pause the learner meant', () => {
    expect(snapCut(1350, [1100])).toBe(1100);
  });

  it('keeps the raw point when no pause is within reach', () => {
    expect(snapCut(1800, [1100])).toBe(1800);
  });

  it('never snaps forward — the learner has not heard what comes after the press', () => {
    expect(snapCut(1000, [1100])).toBe(1000);
  });

  it('takes the latest pause in reach', () => {
    expect(snapCut(1400, [1000, 1300])).toBe(1300);
  });
});
```

**Step 2:** `npx vitest run frontend/src/modules/School/Programs/SentenceLadder/rungs/pauses.test.js`. Expected: FAIL (module missing).

**Step 3: Implement.**

```js
/**
 * Where the model sentence breathes, and where a learner's cut belongs.
 *
 * A child presses → a beat AFTER the word they meant — reaction time is a
 * quarter second or so — so a raw cut starts the next piece mid-syllable. The
 * model audio has real phrase breaks (sentence 900: one clean 0.22s gap at
 * 3.6s of 5.7s), and a cut that lands just past one belongs on it.
 *
 * Pure: samples in, milliseconds out. Decoding lives in `useModelPauses`.
 */

/** RMS below this is silence in the model recordings (studio-clean). */
export const PAUSE_FLOOR = 0.02;
/** Shorter than this is a stop consonant, not a phrase break. */
export const MIN_PAUSE_MS = 120;
/** How far back a cut may snap. Past this, the learner meant where they pressed. */
export const SNAP_WINDOW_MS = 500;
const FRAME_MS = 10;

/**
 * Midpoints (ms) of the silences INSIDE the sentence. Leading and trailing
 * silence are excluded: a cut there would make an empty piece.
 */
export function findPauses(samples, sampleRate, { floor = PAUSE_FLOOR, minPauseMs = MIN_PAUSE_MS } = {}) {
  const frame = Math.max(1, Math.round((sampleRate * FRAME_MS) / 1000));
  const pauses = [];
  let quietSince = null;
  let spoken = false;
  for (let i = 0; i < samples.length; i += frame) {
    const end = Math.min(samples.length, i + frame);
    let sum = 0;
    for (let j = i; j < end; j += 1) sum += samples[j] * samples[j];
    const rms = Math.sqrt(sum / (end - i));
    const ms = (i / sampleRate) * 1000;
    if (rms < floor) {
      if (quietSince == null) quietSince = ms;
    } else {
      if (quietSince != null && spoken && ms - quietSince >= minPauseMs) {
        pauses.push(Math.round((quietSince + ms) / 2));
      }
      quietSince = null;
      spoken = true;
    }
  }
  return pauses;
}

/** The latest pause at or before `rawMs` and within the window; else `rawMs`. */
export function snapCut(rawMs, pauses, { windowMs = SNAP_WINDOW_MS } = {}) {
  let best = null;
  for (const p of pauses) if (p <= rawMs && rawMs - p <= windowMs) best = p;
  return best ?? rawMs;
}
```

**Step 4:** Rerun. Expected: 7 passed.

**Step 5:** Commit: `feat(sentence-ladder): find the model's pauses and snap a cut to one`.

---

### Task 5: `pieces.js` — spans, cuts and verdicts for a take in pieces

**Files:**
- Create: `frontend/src/modules/School/Programs/SentenceLadder/rungs/pieces.js`
- Test: `frontend/src/modules/School/Programs/SentenceLadder/rungs/pieces.test.js`

**Step 1: Failing tests.**

```js
import { describe, it, expect } from 'vitest';
import {
  emptyPieces, spanOf, canCut, addCut, setTake, isLast, pieceVerdict, totalMs, allHeard, MIN_PIECE_MS,
} from './pieces.js';

const take = (durationMs, heard = true) => ({ blob: new Blob(['x']), durationMs, heard });

describe('spans', () => {
  it('a sentence with no cut is one open-ended piece', () => {
    expect(spanOf(emptyPieces(), 0)).toEqual({ fromMs: 0, toMs: null });
    expect(isLast(emptyPieces(), 0)).toBe(true);
  });

  it('two cuts make three pieces, the last open-ended', () => {
    const s = addCut(addCut(emptyPieces(), 1100), 2600);
    expect([0, 1, 2].map((i) => spanOf(s, i))).toEqual([
      { fromMs: 0, toMs: 1100 }, { fromMs: 1100, toMs: 2600 }, { fromMs: 2600, toMs: null },
    ]);
    expect([0, 1, 2].map((i) => isLast(s, i))).toEqual([false, false, true]);
  });
});

describe('canCut', () => {
  it('cuts only an open-ended span, and not in its first moments', () => {
    const s = addCut(emptyPieces(), 1100);
    expect(canCut(s, 0, 500)).toBe(false);   // piece 0 already ends at 1100
    expect(canCut(s, 1, 1200)).toBe(false);  // 100ms into piece 1: too soon
    expect(canCut(s, 1, 1500)).toBe(true);
  });
});

describe('takes', () => {
  it('redoing a piece replaces its take and nothing else', () => {
    const first = take(900);
    let s = setTake(setTake(addCut(emptyPieces(), 1100), 0, first), 1, take(800));
    const redo = take(1000);
    s = setTake(s, 1, redo);
    expect(s.takes).toEqual([first, redo]);
    expect(totalMs(s)).toBe(1900);
    expect(allHeard(s)).toBe(true);
  });
});

describe('pieceVerdict', () => {
  it('refuses silence only when loudness could be measured', () => {
    expect(pieceVerdict({ durationMs: 900, heard: false, measurable: true })).toBe('too-quiet');
    expect(pieceVerdict({ durationMs: 900, heard: false, measurable: false })).toBeNull();
  });

  it('allows a short phrase but not a tap', () => {
    expect(pieceVerdict({ durationMs: MIN_PIECE_MS, heard: true, measurable: true })).toBeNull();
    expect(pieceVerdict({ durationMs: MIN_PIECE_MS - 1, heard: true, measurable: true })).toBe('too-short');
  });
});
```

**Step 2:** `npx vitest run frontend/src/modules/School/Programs/SentenceLadder/rungs/pieces.test.js`. Expected: FAIL.

**Step 3: Implement.**

```js
/**
 * A take said in pieces (design 2026-09-22): the learner cuts the model
 * sentence live, says what they heard so far, then hears and says the rest.
 *
 * State is two lists. `cuts` are points in the MODEL clip (ms, ascending);
 * piece i is the model from cut i-1 (or 0) to cut i (or the end of the clip).
 * `takes[i]` is what the learner recorded for piece i. A piece is only ever
 * added at the end and only ever redone in place, so the lists stay aligned.
 *
 * Pure — the rung owns the microphone, the players and the phases.
 */

/** A piece may be a two-word phrase, well under the one-go floor (1200ms),
 *  but still has to be longer than a tap. */
export const MIN_PIECE_MS = 500;
/** A cut this close to the start of its span would make an empty piece. */
export const MIN_CUT_GAP_MS = 300;

export const emptyPieces = () => ({ cuts: [], takes: [] });

export function spanOf({ cuts }, i) {
  return { fromMs: i === 0 ? 0 : cuts[i - 1], toMs: cuts[i] ?? null };
}

/** Only an open-ended span can be cut — a bounded one already ends at a cut. */
export function canCut(state, i, atMs) {
  const { fromMs, toMs } = spanOf(state, i);
  return toMs == null && atMs - fromMs >= MIN_CUT_GAP_MS;
}

export const addCut = (state, atMs) => ({ ...state, cuts: [...state.cuts, atMs] });

export function setTake(state, i, take) {
  const takes = [...state.takes];
  takes[i] = take;
  return { ...state, takes };
}

/** No cut was made during piece i, so it runs to the end of the sentence. */
export const isLast = (state, i) => i === state.cuts.length;

/** Same rule as a one-go take, with the piece floor: loudness is only judged
 *  when a level was measured at all. */
export function pieceVerdict({ durationMs, heard, measurable }) {
  if (measurable && !heard) return 'too-quiet';
  if (durationMs < MIN_PIECE_MS) return 'too-short';
  return null;
}

export const totalMs = (state) => state.takes.reduce((n, t) => n + (t?.durationMs || 0), 0);
export const allHeard = (state) => state.takes.every((t) => t?.heard);
```

**Step 4:** Rerun. Expected: PASS.

**Step 5:** Commit: `feat(sentence-ladder): spans, cuts and verdicts for a take in pieces`.

---

### Task 6: `joinTake.js` — pieces in, one WAV out

**Files:**
- Create: `frontend/src/modules/School/Programs/SentenceLadder/rungs/joinTake.js`
- Test: `frontend/src/modules/School/Programs/SentenceLadder/rungs/joinTake.test.js`

**Step 1: Failing tests.**

```js
import { describe, it, expect, vi } from 'vitest';
import { concatWithGaps, encodeWav, joinTake, JOIN_RATE } from './joinTake.js';

describe('concatWithGaps', () => {
  it('puts a silence between pieces and none at the ends', () => {
    const out = concatWithGaps([Float32Array.of(1, 1), Float32Array.of(2)], 1000, 3);
    expect(Array.from(out)).toEqual([1, 1, 0, 0, 0, 2]);
  });
});

describe('encodeWav', () => {
  it('writes a 16-bit mono PCM header and clamps the samples', () => {
    const buf = encodeWav(Float32Array.of(0, 1, -1, 2), 16000);
    const v = new DataView(buf);
    const str = (o, n) => String.fromCharCode(...new Uint8Array(buf, o, n));
    expect(str(0, 4)).toBe('RIFF');
    expect(str(8, 4)).toBe('WAVE');
    expect(v.getUint16(22, true)).toBe(1);        // mono
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint16(34, true)).toBe(16);       // bits
    expect(v.getUint32(40, true)).toBe(8);        // 4 samples × 2 bytes
    expect(v.getInt16(46, true)).toBe(32767);
    expect(v.getInt16(48, true)).toBe(-32768);
    expect(v.getInt16(50, true)).toBe(32767);     // 2 clamped to 1
  });
});

describe('joinTake', () => {
  it('decodes each piece and returns one audio/wav blob', async () => {
    const decode = vi.fn(async () => new Float32Array(JOIN_RATE / 10)); // 100ms each
    const blob = await joinTake([new Blob(['a']), new Blob(['b'])], { decode });
    expect(decode).toHaveBeenCalledTimes(2);
    expect(blob.type).toBe('audio/wav');
    // 2 × 100ms + one 250ms gap at 16kHz, 2 bytes a sample, 44-byte header
    expect(blob.size).toBe(44 + 2 * (1600 * 2 + 4000));
  });

  it('fails loudly when a piece will not decode, so the rung can fall back', async () => {
    const decode = vi.fn().mockRejectedValueOnce(new Error('bad piece'));
    await expect(joinTake([new Blob(['a'])], { decode })).rejects.toThrow('bad piece');
  });
});
```

**Step 2:** `npx vitest run frontend/src/modules/School/Programs/SentenceLadder/rungs/joinTake.test.js`. Expected: FAIL.

**Step 3: Implement.**

```js
/**
 * Pieces in, one recording out.
 *
 * A take said in pieces is still ONE recording to everything downstream —
 * review, playback on the shelf, credit — so the pieces are joined on the
 * tablet into a single file before upload. WebM chunks from separate
 * MediaRecorder sessions cannot simply be concatenated (each carries its own
 * header), so each piece is decoded, resampled to one rate and written out as
 * plain 16-bit WAV: no encoder needed, and every browser and the review shelf
 * play it. At 16kHz mono a 15s take is under 0.5MB.
 */

export const JOIN_RATE = 16000;
/** The breath between pieces. Long enough to hear the seam, short enough that
 *  the result still sounds like one sentence. */
export const GAP_MS = 250;

export function concatWithGaps(parts, sampleRate, gapMs = GAP_MS) {
  const gap = Math.round((sampleRate * gapMs) / 1000);
  const length = parts.reduce((n, p) => n + p.length, 0) + gap * Math.max(0, parts.length - 1);
  const out = new Float32Array(length);
  let at = 0;
  parts.forEach((p, i) => {
    if (i > 0) at += gap;
    out.set(p, at);
    at += p.length;
  });
  return out;
}

export function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buffer);
  const str = (o, s) => { for (let i = 0; i < s.length; i += 1) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);              // PCM
  v.setUint16(22, 1, true);              // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true);              // block align
  v.setUint16(34, 16, true);             // bits per sample
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

/** Decode one piece and resample it to mono at `sampleRate`. Throws when the
 *  browser has no Web Audio or cannot decode the piece. */
export async function decodeToMono(blob, sampleRate = JOIN_RATE) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Ctx || !Offline) throw new Error('no-web-audio');
  const ctx = new Ctx();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const offline = new Offline(1, Math.max(1, Math.ceil(decoded.duration * sampleRate)), sampleRate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    return (await offline.startRendering()).getChannelData(0);
  } finally {
    ctx.close?.().catch?.(() => {});
  }
}

export async function joinTake(blobs, { decode = decodeToMono } = {}) {
  const parts = [];
  for (const blob of blobs) parts.push(await decode(blob, JOIN_RATE));
  return new Blob([encodeWav(concatWithGaps(parts, JOIN_RATE), JOIN_RATE)], { type: 'audio/wav' });
}
```

**Step 4:** Rerun. Expected: PASS.

**Step 5:** Commit: `feat(sentence-ladder): join a take's pieces into one WAV`.

---

### Task 7: `useSentenceAudio` plays a span and reports its position

**Files:**
- Modify: `frontend/src/modules/School/Programs/SentenceLadder/useSentenceAudio.js`
- Test: `frontend/src/modules/School/Programs/SentenceLadder/useSentenceAudio.test.js`

**Step 1: Failing tests.** Append. The file already uses fake timers and records `elements`. Add a `currentTime` accessor for this describe only:

```js
describe('spans and position (recording in pieces)', () => {
  let original;
  beforeEach(() => {
    original = Object.getOwnPropertyDescriptor(window.HTMLMediaElement.prototype, 'currentTime');
    Object.defineProperty(window.HTMLMediaElement.prototype, 'currentTime', {
      configurable: true, get() { return this._t ?? 0; }, set(v) { this._t = v; },
    });
  });
  afterEach(() => {
    if (original) Object.defineProperty(window.HTMLMediaElement.prototype, 'currentTime', original);
    else delete window.HTMLMediaElement.prototype.currentTime;
  });

  it('starts a clip at startMs', () => {
    const { result } = renderHook(() => useSentenceAudio());
    act(() => result.current.playSequence([{ url: '/kr.mp3', startMs: 1100 }]));
    expect(elements.at(-1).currentTime).toBeCloseTo(1.1);
  });

  it('ends a clip at endMs and moves on to the next step', async () => {
    const onSequenceEnd = vi.fn();
    const { result } = renderHook(() => useSentenceAudio({ onSequenceEnd }));
    act(() => result.current.playSequence([{ url: '/kr.mp3', startMs: 1000, endMs: 1600 }, { url: '/cue.mp3' }]));
    await act(async () => {});           // let play() resolve
    act(() => vi.advanceTimersByTime(599));
    expect(playCount()).toBe(1);
    act(() => vi.advanceTimersByTime(1));
    expect(playCount()).toBe(2);
    expect(elements.at(-1).src).toContain('/cue.mp3');
  });

  it('a clip that ends on its own does not also fire its span timer', async () => {
    const { result } = renderHook(() => useSentenceAudio());
    act(() => result.current.playSequence([{ url: '/kr.mp3', endMs: 600 }, { url: '/cue.mp3' }, { url: '/b.mp3' }]));
    await act(async () => {});
    endCurrentClip();                    // natural end → cue
    act(() => vi.advanceTimersByTime(1000));
    expect(playCount()).toBe(2);         // the stale timer did not skip the cue
  });

  it('reports the playing clip and how far into it playback is', () => {
    const { result } = renderHook(() => useSentenceAudio());
    expect(result.current.position()).toBeNull();
    act(() => result.current.playSequence([{ url: '/kr.mp3', language: 'KR' }]));
    elements.at(-1).currentTime = 1.35;
    expect(result.current.position()).toEqual({ language: 'KR', role: undefined, ms: 1350 });
    act(() => result.current.stop());
    expect(result.current.position()).toBeNull();
  });
});
```

**Step 2:** `npx vitest run frontend/src/modules/School/Programs/SentenceLadder/useSentenceAudio.test.js`. Expected: the 4 new tests FAIL.

**Step 3: Implement.** In `useSentenceAudio`:

- Add refs `const spanTimerRef = useRef(null);` and `const activeRef = useRef(null);`.
- Add `const clearSpan = () => { if (spanTimerRef.current) { clearTimeout(spanTimerRef.current); spanTimerRef.current = null; } };`
- In `stop`, call `clearSpan()` and set `activeRef.current = null`.
- In the unmount cleanup, call `clearTimeout(spanTimerRef.current)`.
- At the very top of `advance`, call `clearSpan()`. In the `queue.length === 0` end branch, before `setPlaying(false)`, set `activeRef.current = null`.
- In `run`, replace the body with:

```js
    const run = () => {
      el.src = next.url;
      // A SPAN: a piece of the model, for a take said in pieces. Seek before
      // play; the element honours a pre-metadata seek as its start position.
      if (next.startMs != null) el.currentTime = next.startMs / 1000;
      activeRef.current = next;
      el.onended = () => advance();
      el.onerror = () => {
        languageLog.audioError('load-failed', { url: next.url });
        advance();
      };
      const armSpanEnd = () => {
        if (next.endMs == null || activeRef.current !== next) return;
        spanTimerRef.current = setTimeout(() => {
          spanTimerRef.current = null;
          el.pause();
          advance();
        }, Math.max(0, next.endMs - (next.startMs || 0)));
      };
      const result = el.play();
      if (result?.then) {
        result.then(armSpanEnd, (err) => {
          languageLog.audioError('play-blocked', { url: next.url, error: err?.message });
          setBlocked(true);
          setPlaying(false);
        });
      } else {
        armSpanEnd();
      }
    };
```

Keep the existing `load-failed` comment above `el.onerror`.

- Add and return `position`:

```js
  /** The clip sounding now and how far into it playback is — what a live cut
   *  reads. Null between sequences. */
  const position = useCallback(() => {
    const el = elementRef.current;
    const clip = activeRef.current;
    if (!el || !clip) return null;
    return { language: clip.language, role: clip.role, ms: Math.round(el.currentTime * 1000) };
  }, []);
```

Return: `{ playSequence, preload, stop, position, playing, step, blocked, REPEAT_GAP_MS, LOOP_GAP_MS }`.

The span timer is only armed after `play()` resolves. That is why the tests await one microtask.

**Step 4:** Rerun the file. Expected: all pass. Then run `npx vitest run frontend/src/modules/School/Programs/SentenceLadder`. Expected: all pass, with no regression.

**Step 5:** Commit: `feat(sentence-ladder): the sentence player plays a span and reports its position`.

---

### Task 8: `useModelPauses` — decode the model once, keep its pauses

**Files:**
- Create: `frontend/src/modules/School/Programs/SentenceLadder/rungs/useModelPauses.js`
- Test: `frontend/src/modules/School/Programs/SentenceLadder/rungs/useModelPauses.test.js`

**Step 1: Failing tests.**

```js
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import useModelPauses from './useModelPauses.js';

afterEach(() => { delete window.AudioContext; vi.restoreAllMocks(); });

describe('useModelPauses', () => {
  it('is empty without Web Audio — cuts fall back to where the learner pressed', () => {
    delete window.AudioContext;
    const { result } = renderHook(() => useModelPauses('/audio/1/KR'));
    expect(result.current.current).toEqual([]);
  });

  it('decodes the model and keeps its pauses', async () => {
    const rate = 1000;
    const samples = new Float32Array(2000);
    for (let i = 0; i < 1000; i += 1) samples[i] = i % 2 ? 0.5 : -0.5;
    for (let i = 1200; i < 2000; i += 1) samples[i] = i % 2 ? 0.5 : -0.5;
    window.AudioContext = class {
      decodeAudioData() { return Promise.resolve({ sampleRate: rate, getChannelData: () => samples }); }
      close() { return Promise.resolve(); }
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
    const { result } = renderHook(() => useModelPauses('/audio/1/KR'));
    await waitFor(() => expect(result.current.current).toEqual([1100]));
  });
});
```

**Step 2:** Run it. Expected: FAIL.

**Step 3: Implement.**

```js
import { useEffect, useRef } from 'react';
import { findPauses } from './pauses.js';

/**
 * The model sentence's pauses, decoded once per sentence, so a live cut can
 * snap to the phrase break the learner meant (see `pauses.js`).
 *
 * A ref, not state: nothing renders from it, and a cut reads it at the moment
 * of the key press. Empty until decoded, and empty for good on a browser
 * without Web Audio or when the fetch fails — then a cut simply lands where
 * the learner pressed, which is still a working cut.
 */
export default function useModelPauses(url) {
  const pauses = useRef([]);
  useEffect(() => {
    pauses.current = [];
    const Ctx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!Ctx || !url) return undefined;
    let live = true;
    (async () => {
      let ctx;
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        ctx = new Ctx();
        const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
        if (live) pauses.current = findPauses(buffer.getChannelData(0), buffer.sampleRate);
      } catch {
        // Raw cuts still work; nothing to tell the learner.
      } finally {
        ctx?.close?.().catch?.(() => {});
      }
    })();
    return () => { live = false; };
  }, [url]);
  return pauses;
}
```

**Step 4:** Rerun. Expected: PASS.

**Step 5:** Commit: `feat(sentence-ladder): decode the model sentence's pauses for cut snapping`.

---

### Task 9: The recording rung records in pieces

This is the largest task, and it splits into 9a (the happy path) and 9b (redo, Tab, refusal, abandonment, join failure). Commit after each.

**Files:**
- Modify: `frontend/src/modules/School/Programs/SentenceLadder/rungs/RecordingRung.jsx`
- Modify: `frontend/src/modules/School/Programs/SentenceLadder/SentenceLadder.scss` (only if a new class needs a rule; reuse `lang-tile` classes)
- Test: `frontend/src/modules/School/Programs/SentenceLadder/SentenceLadderProgram.test.jsx`

#### Test scaffolding (put this at the top of a new `describe('recording in pieces', …)` block at the end of the test file)

At file top, next to the other `vi.hoisted` mocks:

```js
const { joinTakeMock } = vi.hoisted(() => ({ joinTakeMock: vi.fn() }));
vi.mock('./rungs/joinTake.js', () => ({ joinTake: (...a) => joinTakeMock(...a) }));
```

Inside the describe:

```js
describe('recording in pieces', () => {
  const path = (url) => url.replace(/^https?:\/\/[^/]+/, '');
  const pressKey = (key) => fireEvent.keyDown(document.body, { key });
  let originalTime;
  let clock;
  beforeEach(() => {
    originalTime = Object.getOwnPropertyDescriptor(window.HTMLMediaElement.prototype, 'currentTime');
    Object.defineProperty(window.HTMLMediaElement.prototype, 'currentTime', {
      configurable: true, get() { return this._t ?? 0; }, set(v) { this._t = v; },
    });
    const real = Date.now;
    let offset = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => real() + offset);
    clock = { advance: (ms) => { offset += ms; } };
    joinTakeMock.mockReset();
    joinTakeMock.mockImplementation(async (blobs) => new Blob(['joined'], { type: 'audio/wav' }));
  });
  afterEach(() => {
    Date.now.mockRestore?.();
    if (originalTime) Object.defineProperty(window.HTMLMediaElement.prototype, 'currentTime', originalTime);
    else delete window.HTMLMediaElement.prototype.currentTime;
  });

  /** The FIRST full sentence hangs so the test can cut into it; every other
   *  clip ends at once. `played` records the src and the seek point. */
  const modelPlayer = () => {
    const played = [];
    let held = null;
    window.HTMLMediaElement.prototype.pause = vi.fn();
    window.HTMLMediaElement.prototype.play = vi.fn(function play() {
      const src = path(this.src);
      played.push({ src, atMs: Math.round((this._t ?? 0) * 1000) });
      if (!held && src.endsWith('/KR')) { held = this; return Promise.resolve(); }
      setTimeout(() => this.onended?.(), 0);
      return Promise.resolve();
    });
    return { played, at: (ms) => { held._t = ms / 1000; } };
  };
  /** Each take is a distinct blob, so a test can tell which piece was kept. */
  const fakeMic = () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })),
        enumerateDevices: vi.fn(async () => [{ kind: 'audioinput' }]),
      },
    });
    let n = 0;
    class FakeRecorder {
      constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; }
      start() { this.state = 'recording'; }
      stop() {
        this.state = 'inactive';
        n += 1;
        this.ondataavailable?.({ data: new Blob([`take${n}`], { type: 'audio/webm' }) });
        this.onstop?.();
      }
    }
    window.MediaRecorder = FakeRecorder;
    window.URL.createObjectURL = vi.fn((b) => `blob:${Math.random()}`);
    window.URL.revokeObjectURL = vi.fn();
    window.HTMLCanvasElement.prototype.getContext = vi.fn(() => null);
  };
  const recordingDay = () => dayMock.mockResolvedValue(
    dayPayload({ chain: ['recording'], queue: [entry(1, 'recording')], cues: ['record'] }),
  );
  const program = () => render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);
  /** Say one piece: the mic is open, `ms` pass, Space stops. */
  const sayPiece = async (ms) => {
    await screen.findByRole('button', { name: 'Stop' });
    clock.advance(ms);
    pressKey(' ');
  };
```

Add `afterEach` to the vitest import at the top of the test file if it isn't already there.

#### 9a — the happy path

**Step 1: Failing test.**

```js
  it('→ cuts the sentence: part one, then the rest from the cut, then one WAV is kept', async () => {
    const model = modelPlayer();
    fakeMic();
    recordingDay();
    program();
    const { languageApi } = await import('./languageApi.js');
    const { languageLog } = await import('./languageLog.js');

    await screen.findByRole('button', { name: 'Listen, then record' });
    pressKey(' ');
    await waitFor(() => expect(model.played.map((p) => p.src)).toEqual(['/audio/glossika-korean/1/KR']));
    model.at(1500);
    pressKey('ArrowRight');

    // The model stops, the ding sounds, the mic opens for part one.
    await sayPiece(800);
    expect(model.played.map((p) => p.src)).toContain('/cue/record');
    expect(languageLog.capture).toHaveBeenCalledWith('cut', expect.objectContaining({ seq: 1, piece: 0, rawMs: 1500, cutMs: 1500 }));

    // Part one plays back; Space goes on to the rest, FROM THE CUT.
    const before = model.played.length;
    await screen.findByRole('button', { name: 'Next part' });
    pressKey(' ');
    await sayPiece(900);
    expect(model.played.slice(before)).toEqual(expect.arrayContaining([
      { src: '/audio/glossika-korean/1/KR', atMs: 1500 },
    ]));

    // The last part: Finish joins the pieces into one take.
    await screen.findByRole('button', { name: 'Finish' });
    pressKey(' ');
    await waitFor(() => expect(joinTakeMock).toHaveBeenCalledTimes(1));
    const pieces = joinTakeMock.mock.calls[0][0];
    expect(await Promise.all(pieces.map((b) => b.text()))).toEqual(['take1', 'take2']);

    await screen.findByRole('button', { name: 'Keep it' });
    pressKey(' ');
    await waitFor(() => expect(languageApi.recording).toHaveBeenCalledTimes(1));
    expect(languageApi.recording.mock.calls[0][3].type).toBe('audio/wav');
    expect(languageLog.capture).toHaveBeenCalledWith('stitched', expect.objectContaining({ seq: 1, pieces: 2, durationMs: 1700 }));
  });
```

**Step 2:** Run `npx vitest run frontend/src/modules/School/Programs/SentenceLadder/SentenceLadderProgram.test.jsx -t "recording in pieces"`. Expected: FAIL (→ does nothing).

**Step 3: Implement in `RecordingRung.jsx`.**

Imports:

```js
import useModelPauses from './useModelPauses.js';
import { snapCut } from './pauses.js';
import {
  emptyPieces, spanOf, canCut, addCut, setTake, isLast, pieceVerdict, totalMs, allHeard,
} from './pieces.js';
import { joinTake } from './joinTake.js';
```

Update the header docblock flow diagram with:

```
 *   → while the sentence plays ─▶ ding ─▶ say that much ─▶ Space ─▶ the rest
 *     plays from the cut ─▶ ding ─▶ say it ─▶ … ─▶ Finish joins them into one take
```

State and refs, next to the existing ones:

```js
  /**
   * RECORDING IN PIECES (2026-09-22). `piece` is the index of the piece in
   * hand, or null for an ordinary one-go take. The pieces themselves live in a
   * ref (`pieces.js` shape) because every handler reads them at key-press time.
   */
  const [piece, setPiece] = useState(null);
  const pieceRef = useRef(null);
  useEffect(() => { pieceRef.current = piece; }, [piece]);
  const piecesRef = useRef(emptyPieces());
  const pieceUrlRef = useRef(null);
  /** Set when a join failed: this sentence is said in one go from then on. */
  const noPiecesRef = useRef(false);
  /** The kept take was joined from pieces, so "again" starts the sentence over. */
  const joinedRef = useRef(false);
  const modelUrl = targetLang ? audioUrl(entry.seq, targetLang) : null;
  const pauses = useModelPauses(modelUrl);
```

`targetLang` is declared above these. Move these lines below the `targetLang`/`sourceLang` declarations.

`dropPieces`, next to `dropTake`:

```js
  const dropPieces = useCallback(() => {
    if (pieceUrlRef.current) URL.revokeObjectURL(pieceUrlRef.current);
    pieceUrlRef.current = null;
    piecesRef.current = emptyPieces();
    setPiece(null);
  }, []);
```

Split `onTake` into `receiveTake` plus a thin router. Rename the existing `onTake` body to:

```js
  const receiveTake = useCallback(({ blob, durationMs, heard, measurable }) => { … existing body … }, [entry.seq]);
```

Inside it, replace `const heard = silenceRef.current.heard;` and `const measurable = silenceRef.current.sampled === true;` with the parameters. Keep `languageLog.capture('stop', …)` inside. Then:

```js
  const pieceTakeRef = useRef(null); // assigned below; onTake is created before it
  const onTake = useCallback(({ blob, durationMs }) => {
    const heard = silenceRef.current.heard;
    const measurable = silenceRef.current.sampled === true;
    if (pieceRef.current != null) { pieceTakeRef.current?.({ blob, durationMs, heard, measurable }); return; }
    receiveTake({ blob, durationMs, heard, measurable });
  }, [receiveTake]);
```

Destructure `position` from the capturing player: `const { playSequence, stop, blocked, position } = useSentenceAudio({ onSequenceEnd: beginCapture });`

Model span clip:

```js
  const spanClip = useCallback((i) => {
    const { fromMs, toMs } = spanOf(piecesRef.current, i);
    return { url: modelUrl, language: targetLang, startMs: fromMs, ...(toMs != null ? { endMs: toMs } : {}) };
  }, [modelUrl, targetLang]);

  /** Piece i's part of the model, then the ding, then the mic. */
  const playPiece = useCallback((i) => {
    stopPlayback();
    setTakeVerdict(null);
    setPhase('prompting');
    playSequence([spanClip(i), ...cue()]);
  }, [cue, playSequence, spanClip, stopPlayback]);
```

The cut:

```js
  /**
   * → WHILE THE SENTENCE PLAYS: "that's enough — let me say this much". Only
   * the target clip can be cut, only an open-ended span, and the cut snaps back
   * to the pause the learner meant (`pauses.js`).
   */
  const cut = useCallback(() => {
    if (phaseRef.current !== 'prompting' || noPiecesRef.current) return;
    const at = position();
    if (!at || at.language !== targetLang) return;
    const i = pieceRef.current ?? 0;
    if (!canCut(piecesRef.current, i, at.ms)) return;
    const snapped = snapCut(at.ms, pauses.current);
    const cutMs = canCut(piecesRef.current, i, snapped) ? snapped : at.ms;
    piecesRef.current = addCut(piecesRef.current, cutMs);
    stop();
    setPiece(i);
    pieceRef.current = i;
    languageLog.capture('cut', { seq: entry.seq, piece: i, rawMs: at.ms, cutMs, snapped: cutMs !== at.ms });
    playSequence(cue());
  }, [cue, entry.seq, pauses, playSequence, position, stop, targetLang]);
```

`pieceRef.current = i` is set synchronously because the ding can end before the effect runs.

A finished piece:

```js
  pieceTakeRef.current = ({ blob, durationMs, heard, measurable }) => {
    const i = pieceRef.current;
    piecesRef.current = setTake(piecesRef.current, i, { blob, durationMs, heard });
    languageLog.capture('piece-stop', { seq: entry.seq, piece: i, durationMs, heard, bytes: blob.size });
    const verdict = pieceVerdict({ durationMs, heard, measurable });
    setTakeVerdict(verdict);
    if (verdict) {
      setRefusals((n) => n + 1);
      languageLog.capture('refused', { seq: entry.seq, piece: i, reason: verdict, durationMs, bytes: blob.size, heard, measurable });
    } else {
      setRefusals(0);
    }
    if (pieceUrlRef.current) URL.revokeObjectURL(pieceUrlRef.current);
    pieceUrlRef.current = URL.createObjectURL(blob);
    playBack(pieceUrlRef.current);
  };
```

Extract the existing playback block in `receiveTake` (from `setPhase('playback')` through the `.catch`) into a `playBack(url)` callback, then call `playBack(takeUrlRef.current)` from `receiveTake`. Declare `playBack` before `receiveTake`. It only uses refs, setters and `languageLog`, so its deps are `[]`.

Going on, and finishing:

```js
  const finishPieces = useCallback(async () => {
    const state = piecesRef.current;
    setPhase('joining');
    try {
      const blob = await joinTake(state.takes.map((t) => t.blob));
      const durationMs = totalMs(state);
      languageLog.capture('stitched', { seq: entry.seq, pieces: state.takes.length, durationMs, bytes: blob.size });
      dropPieces();
      pieceRef.current = null;
      joinedRef.current = true;
      if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current);
      takeUrlRef.current = URL.createObjectURL(blob);
      blobRef.current = blob;
      receiveTake({ blob, durationMs, heard: allHeard(state), measurable: false });
    } catch (err) {
      languageLog.capture('stitch-failed', { seq: entry.seq, pieces: state.takes.length, error: err?.message });
      dropPieces();
      pieceRef.current = null;
      noPiecesRef.current = true;
      setError('Couldn’t put the parts together — say it in one go.');
      setPhase('idle');
    }
  }, [dropPieces, entry.seq, receiveTake]);

  /** Space in piece review: the rest of the sentence, or — after the last piece — the join. */
  const nextPiece = useCallback(() => {
    if (takeVerdict) return;
    const i = pieceRef.current;
    stopPlayback();
    if (!isLast(piecesRef.current, i)) {
      setPiece(i + 1);
      pieceRef.current = i + 1;
      playPiece(i + 1);
    } else {
      finishPieces();
    }
  }, [finishPieces, playPiece, stopPlayback, takeVerdict]);
```

`receiveTake` sets `blobRef` and `takeUrlRef` itself in the current code (`blobRef.current = blob; … takeUrlRef.current = URL.createObjectURL(blob)`), so don't duplicate that in `finishPieces`. Remove the three `takeUrlRef`/`blobRef` lines above if `receiveTake` already does them. Loudness was judged per piece, so the joined take passes `measurable: false`, and only the `MIN_TAKE_MS` length check applies.

Reset on a new start: in `start`, call `dropPieces(); pieceRef.current = null; joinedRef.current = false;` next to `dropTake()`. In `recordAgain`, if `joinedRef.current` is true, call `start()` and return: the whole sentence starts over and can be cut again.

Keys: in the keydown handler, after `if (ownsKeys(e.target)) return;` and before `const go = …`, handle `ArrowRight`:

```js
      if (e.key === 'ArrowRight') {
        if (phaseRef.current === 'prompting') { e.preventDefault(); cut(); }
        return;
      }
```

The `ownsKeys` check currently sits after `go`/`again` are computed. Restructure it so ArrowRight also respects `ownsKeys`. In the `go` branch, `review` becomes:

```js
        else if (current === 'review') { e.preventDefault(); if (pieceRef.current != null) nextPiece(); else accept(); }
```

Add `cut` and `nextPiece` to the effect deps.

Render:
- While `phase === 'prompting'`, and cutting is possible (`!noPiecesRef.current && (piece == null || isLast(piecesRef.current, piece))`), render the Listen status tile plus a button:

```jsx
<button type="button" className="lang-tile" onClick={() => { cut(); rootRef.current?.focus?.({ preventScroll: true }); }} aria-label="Pause here">
  <Icon name="stop" className="lang-tile__glyph" />
  <span className="lang-tile__word" aria-hidden="true">Pause</span>
</button>
```

- `phase === 'joining'`: a status tile (`role="status"`, aria-label "Putting it together", word "Joining").
- In `phase === 'review'` with `piece != null`: the Again tile (`aria-label="Redo this part"`, `onClick={redoPiece}`, which 9b adds; in 9a, wire it to `() => playPiece(piece)`), and the primary tile with `aria-label={isLast(piecesRef.current, piece) ? 'Finish' : 'Next part'}`, `onClick={nextPiece}`, `disabled={Boolean(takeVerdict)}`. Show a small `<p className="lang-rung__part">Part {piece + 1}</p>` above the controls. Add a matching SCSS rule next to `.lang-rung__keys`, using the same muted text style.
- Otherwise, the existing review tiles.
- Keys hint: in piece review show `'Space: next part · Tab: compare · Backspace: redo this part'`, and while prompting add `· →: pause here`.

Unmount/sentence change: in the `[entry.seq, …]` effect cleanup, before the other calls:

```js
      if (piecesRef.current.takes.length) {
        languageLog.capture('pieces-abandoned', { seq: entry.seq, pieces: piecesRef.current.takes.length });
      }
      piecesRef.current = emptyPieces();
      if (pieceUrlRef.current) URL.revokeObjectURL(pieceUrlRef.current);
      pieceUrlRef.current = null;
```

In the effect body, reset `noPiecesRef.current = false; joinedRef.current = false; pieceRef.current = null; setPiece(null);`.

`onDenied`: add `dropPieces(); pieceRef.current = null;`.

**Step 4:** Run the test. Expected: PASS. Then run the whole ladder: `npx vitest run frontend/src/modules/School/Programs/SentenceLadder`. Expected: all pass.

**Step 5:** Commit: `feat(sentence-ladder): record a long sentence in pieces with →`.

#### 9b — redo, Tab, refusal, abandonment, join failure

**Step 1: Failing tests** (same describe):

```js
  /** Cut at 1.5s and say part one; leaves the rung in part-one review. */
  const firstPiece = async (model, ms = 800) => {
    await screen.findByRole('button', { name: 'Listen, then record' });
    pressKey(' ');
    await waitFor(() => expect(model.played).toHaveLength(1));
    model.at(1500);
    pressKey('ArrowRight');
    await sayPiece(ms);
  };

  it('Backspace redoes only the part in hand', async () => {
    const model = modelPlayer(); fakeMic(); recordingDay(); program();
    const { languageLog } = await import('./languageLog.js');
    await firstPiece(model);
    await screen.findByRole('button', { name: 'Next part' });
    pressKey(' ');
    await sayPiece(900);                              // take2 = part two
    await screen.findByRole('button', { name: 'Finish' });
    const before = model.played.length;
    pressKey('Backspace');
    await sayPiece(1000);                             // take3 = part two again
    expect(model.played.slice(before)[0]).toEqual({ src: '/audio/glossika-korean/1/KR', atMs: 1500 });
    expect(languageLog.capture).toHaveBeenCalledWith('piece-redo', { seq: 1, piece: 1 });
    await screen.findByRole('button', { name: 'Finish' });
    pressKey(' ');
    await waitFor(() => expect(joinTakeMock).toHaveBeenCalled());
    expect(await Promise.all(joinTakeMock.mock.calls[0][0].map((b) => b.text()))).toEqual(['take1', 'take3']);
  });

  it('Tab mid-part starts that part over and keeps the parts before it', async () => {
    const model = modelPlayer(); fakeMic(); recordingDay(); program();
    await firstPiece(model);
    await screen.findByRole('button', { name: 'Next part' });
    pressKey(' ');
    await screen.findByRole('button', { name: 'Stop' });
    const before = model.played.length;
    pressKey('Tab');                                  // abandons part two's take
    await sayPiece(900);
    expect(model.played.slice(before)[0]).toEqual({ src: '/audio/glossika-korean/1/KR', atMs: 1500 });
    await screen.findByRole('button', { name: 'Finish' });
    pressKey(' ');
    await waitFor(() => expect(joinTakeMock).toHaveBeenCalled());
    expect(joinTakeMock.mock.calls[0][0]).toHaveLength(2);
    expect(await joinTakeMock.mock.calls[0][0][0].text()).toBe('take1');
  });

  it('Tab in part review compares — its span, then its take — and deletes nothing', async () => {
    const model = modelPlayer(); fakeMic(); recordingDay(); program();
    await firstPiece(model);
    await screen.findByRole('button', { name: 'Next part' });
    const before = model.played.length;
    pressKey('Tab');
    await waitFor(() => expect(model.played.length).toBe(before + 2));
    expect(model.played[before]).toEqual({ src: '/audio/glossika-korean/1/KR', atMs: 0 });
    expect(model.played[before + 1].src).toMatch(/^blob:/);
    expect(screen.getByRole('button', { name: 'Next part' })).toBeEnabled();
  });

  it('a part too short to be a phrase cannot be moved past', async () => {
    const model = modelPlayer(); fakeMic(); recordingDay(); program();
    await firstPiece(model, 100);
    expect(await screen.findByText(/too quick/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next part' })).toBeDisabled();
    const before = model.played.length;
    pressKey(' ');
    await new Promise((r) => setTimeout(r, 0));
    expect(model.played).toHaveLength(before);
  });

  it('leaving partway uploads nothing and says how far it got', async () => {
    const model = modelPlayer(); fakeMic(); recordingDay();
    const { unmount } = program();
    const { languageApi } = await import('./languageApi.js');
    const { languageLog } = await import('./languageLog.js');
    await firstPiece(model);
    await screen.findByRole('button', { name: 'Next part' });
    unmount();
    expect(languageApi.recording).not.toHaveBeenCalled();
    expect(languageLog.capture).toHaveBeenCalledWith('pieces-abandoned', { seq: 1, pieces: 1 });
  });

  it('a join that fails falls back to saying it in one go', async () => {
    joinTakeMock.mockRejectedValueOnce(new Error('no-web-audio'));
    const model = modelPlayer(); fakeMic(); recordingDay(); program();
    await firstPiece(model);
    await screen.findByRole('button', { name: 'Next part' });
    pressKey(' ');
    await sayPiece(900);
    await screen.findByRole('button', { name: 'Finish' });
    pressKey(' ');
    expect(await screen.findByText(/say it in one go/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Listen, then record' })).toBeTruthy();
  });
```

The shared `languageApi.recording` / `languageLog.capture` mocks are `vi.fn()`s that persist across tests. Check how the file resets mocks: search it for `beforeEach(` / `clearAllMocks`. If the file doesn't clear them, add `vi.clearAllMocks()` at the start of this describe's `beforeEach` (before `joinTakeMock.mockReset()`), and re-install `languageApi.recording`'s resolved value if clearing drops it (`mockClear` keeps implementations; `clearAllMocks` calls `mockClear`, so it's fine).

**Step 2:** Run them. Expected: the new tests FAIL (redo and Tab behave as the whole-take paths).

**Step 3: Implement.**

```js
  /** Backspace in piece review: this piece only — its span, the ding, the mic. */
  const redoPiece = useCallback(() => {
    const i = pieceRef.current;
    languageLog.capture('piece-redo', { seq: entry.seq, piece: i });
    playPiece(i);
  }, [entry.seq, playPiece]);
```

- Backspace branch in keys: `if (current === 'playback' || current === 'review') { e.preventDefault(); if (pieceRef.current != null) redoPiece(); else recordAgain(); }`. Wire the "Redo this part" tile to `redoPiece`.
- `replaySentence` (Tab), add a pieces branch at the top, after the idle check:

```js
    if (pieceRef.current != null) {
      const i = pieceRef.current;
      if ((current === 'playback' || current === 'review') && pieceUrlRef.current) {
        stopPlayback();
        setPhase('review');
        languageLog.capture('compare', { seq: entry.seq, from: current, piece: i });
        listenTo([spanClip(i), { url: pieceUrlRef.current, role: 'take', gapMs: 400 }]);
        return;
      }
      languageLog.capture('replay-restart', { seq: entry.seq, from: current, piece: i });
      if (current === 'recording') cancelCapture();
      stop();
      playPiece(i);
      return;
    }
```

  Add `spanClip`, `playPiece` and `stop` to its deps.
- `accept` is unchanged. It's only reachable when `piece == null`.

**Step 4:** Run the describe, then the whole ladder folder. Expected: all pass.

**Step 5:** Commit: `feat(sentence-ladder): redo, compare and restart a single piece`.

---

### Task 10: Docs

**Files:**
- Modify: `docs/reference/school/sentence-ladder.md`

Add a `### Recording in pieces` section after the "Once a take exists, Tab compares" paragraph. Cover:
- the flow table from this plan's Design section;
- snapping (500 ms window, interior pauses only, raw fallback without Web Audio);
- piece floor 500 ms vs one-go 1200 ms;
- the joined WAV (16 kHz mono, 250 ms gaps), and that downstream sees one recording;
- the storage rule: a new recording deletes its siblings in other formats, and why;
- failure paths;
- the log events.

In the key table's `recording` row, add `→ pause here (record in pieces)` to the Arrows column. Also update the "Hands-free" sentence that says the recording rung has no arrow keys, if present.

Commit: `docs(sentence-ladder): recording in pieces`.

---

### Task 11: Full verification

1. `npx vitest run frontend/src/modules/School/Programs/SentenceLadder backend/src/1_adapters/persistence/yaml/YamlLanguageStudyDatastore.test.mjs backend/src/4_api/v1/routers/language.test.mjs`. Expected: all pass.
2. `npm run check:parse` if it exists in package.json. Expected: clean.
3. `git diff main --stat`. Check that only the planned files changed and that there's no stray `console.*`: `git diff main | grep -n "console\." || true`.
4. Hand off to the final code review (subagent-driven-development).

The live tablet check needs a deploy, and it happens after merge. It isn't part of this plan's automated steps.
