# Piano MIDI → MP3 Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A daily job that renders every piano `.mid` under `household/history/piano/` to a loudness-normalized MP3 mirrored at `media/audio/piano/<same relative path>.mp3`.

**Architecture:** A pure domain path helper (`.mid`→`.mp3`), an application use case depending only on two ports (`IMidiLibrary` lists pending conversions, `IMidiConverter` renders one), two adapters that own all I/O (`FsMidiLibrary` walks the tree; `FluidSynthMp3Converter` shells out to fluidsynth+ffmpeg via an injectable exec seam), a thin `PianoMp3Harvester` that plugs the use case into the scheduler, and bootstrap wiring. Mirrors the just-shipped JamCorder harvester feature exactly.

**Tech Stack:** Node ESM (`.mjs`), Vitest, layered DDD (`0_system`/`1_adapters`/`2_domains`/`3_applications`/`5_composition`), `node:child_process` (`execFile`), Alpine `fluidsynth` + `soundfont-timgm` (in the container image), `ffmpeg` (already in the image).

## Global Constraints

- **Layer rules** (`docs/reference/core/layers-of-abstraction/`): domain is pure (no I/O, no imports outside `2_domains`); the use case depends only on its two ports (no adapter/`fs`/`child_process` imports); adapters `extends` their port and own all I/O; `5_composition/bootstrap.mjs` is the ONLY construction/wiring site.
- **Import aliases:** `#domains/*`→`2_domains`, `#apps/*`→`3_applications`, `#adapters/*`→`1_adapters`, `#system/*`→`0_system`.
- **Source base:** `configService.getHouseholdPath('history/piano')` (absolute). **Dest base:** `` `${configService.getMediaDir()}/audio/piano` `` (absolute). Mirror is exact: relative subdirs preserved, `.mid`→`.mp3`.
- **Per-file pipeline (exact argv, in order):**
  1. `fluidsynth` `['-ni', '-F', <wavPath>, '-r', '44100', <soundfontPath>, <midiPath>]`
  2. `ffmpeg` `['-i', <wavPath>, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-codec:a', 'libmp3lame', '-qscale:a', '2', <mp3Path>.tmp, '-y']`
  3. rename `<mp3Path>.tmp` → `<mp3Path>` (atomic)
  4. delete the scratch WAV
- **Dedup / resumability:** skip any file whose final `.mp3` already exists. **Order:** newest-first (by MIDI mtime).
- **Error isolation:** a per-file failure (non-zero exit / timeout) is logged and skipped, never fatal; only successes are counted. No exception escapes `harvest()` — it always returns `{ count, status }`.
- **Soundfont path (default):** `/usr/share/soundfonts/TimGM6mb.sf2` (provided by Alpine `soundfont-timgm`; confirm the exact path at build in Task 6).
- **Scratch dir:** `/tmp/pianoaudio` (created per run).
- **Harvester serviceId:** `'piano-mp3'` (must equal the jobs.yml `id`); category `HarvesterCategory.OTHER`.
- **Tests:** Vitest, one file per unit under `tests/isolated/{domain,application,adapter}/pianoaudio/`. Run a single file with `npx vitest run <path>`.
- **`data/` is gitignored:** `jobs.yml` lives in the data volume, NOT the repo — its entry is a deploy-phase `docker exec` edit (documented in the Deploy section), never a git commit. Only `docker/Dockerfile` and `backend/src/**` are committed.

---

### Task 1: Domain — `pianoAudioPaths.mjs`

**Files:**
- Create: `backend/src/2_domains/pianoaudio/pianoAudioPaths.mjs`
- Test: `tests/isolated/domain/pianoaudio/pianoAudioPaths.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `mp3RelForMidiRel(rel: string): string` — swaps a trailing `.mid` (case-insensitive) for `.mp3`, preserving all leading subdirectories; throws `Error` on any input that is not a string ending in `.mid`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/domain/pianoaudio/pianoAudioPaths.test.mjs
import { describe, it, expect } from 'vitest';
import { mp3RelForMidiRel } from '#domains/pianoaudio/pianoAudioPaths.mjs';

describe('mp3RelForMidiRel', () => {
  it('swaps .mid for .mp3 preserving jamcorder subdirs', () => {
    expect(mp3RelForMidiRel('jamcorder/2025/2025-12/2025-12-22 18.35.16.mid'))
      .toBe('jamcorder/2025/2025-12/2025-12-22 18.35.16.mp3');
  });

  it('swaps .mid for .mp3 preserving per-user subdirs', () => {
    expect(mp3RelForMidiRel('kckern/2026-01-02/take1.mid'))
      .toBe('kckern/2026-01-02/take1.mp3');
  });

  it('normalizes an uppercase .MID extension to lowercase .mp3', () => {
    expect(mp3RelForMidiRel('a.MID')).toBe('a.mp3');
  });

  it('throws on a non-.mid path', () => {
    expect(() => mp3RelForMidiRel('notes.txt')).toThrow();
  });

  it('throws on a non-string input', () => {
    expect(() => mp3RelForMidiRel(null)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/domain/pianoaudio/pianoAudioPaths.test.mjs`
Expected: FAIL — cannot resolve `#domains/pianoaudio/pianoAudioPaths.mjs`.

- [ ] **Step 3: Write minimal implementation**

```javascript
/**
 * pianoAudioPaths — pure path math for the piano MIDI→MP3 mirror.
 * Layer: DOMAIN (2_domains/pianoaudio). No I/O.
 * @module domains/pianoaudio/pianoAudioPaths
 */

/**
 * Mirror a MIDI relative path to its MP3 relative path: swap a trailing `.mid`
 * (case-insensitive) for `.mp3`, preserving all leading subdirectories.
 * @param {string} rel - relative path ending in `.mid`
 * @returns {string} the same path with a `.mp3` extension
 * @throws {Error} if `rel` is not a string ending in `.mid`
 */
export function mp3RelForMidiRel(rel) {
  if (typeof rel !== 'string' || !/\.mid$/i.test(rel)) {
    throw new Error(`mp3RelForMidiRel: not a .mid path: ${rel}`);
  }
  return rel.replace(/\.mid$/i, '.mp3');
}

export default { mp3RelForMidiRel };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/domain/pianoaudio/pianoAudioPaths.test.mjs`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/pianoaudio/pianoAudioPaths.mjs tests/isolated/domain/pianoaudio/pianoAudioPaths.test.mjs
git commit -m "feat(pianoaudio): add mp3RelForMidiRel domain path helper"
```

---

### Task 2: Application — ports + `ConvertPendingPianoMidi` use case

**Files:**
- Create: `backend/src/3_applications/pianoaudio/ports/IMidiLibrary.mjs`
- Create: `backend/src/3_applications/pianoaudio/ports/IMidiConverter.mjs`
- Create: `backend/src/3_applications/pianoaudio/ConvertPendingPianoMidi.mjs`
- Test: `tests/isolated/application/pianoaudio/ConvertPendingPianoMidi.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks (ports are defined here).
- Produces:
  - `IMidiLibrary` with `async listPending(): Promise<Array<{midiPath: string, mp3Path: string}>>` — absolute paths, already filtered to missing-mp3, newest-first.
  - `IMidiConverter` with `async convert(midiPath: string, mp3Path: string): Promise<void>`.
  - `ConvertPendingPianoMidi` — constructor `{ library, converter, logger }`; `async execute(): Promise<{count: number, status: 'success'|'error', reason?: string}>`. Converts every pending ref, per-file errors logged-and-skipped (not fatal), `count` = successes. If `listPending()` throws → `{count: 0, status: 'error', reason}`. Empty pending → `{count: 0, status: 'success'}`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/application/pianoaudio/ConvertPendingPianoMidi.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { ConvertPendingPianoMidi } from '#apps/pianoaudio/ConvertPendingPianoMidi.mjs';

const silent = { info() {}, warn() {}, error() {}, debug() {} };

function fakeLibrary(pending) {
  return { listPending: vi.fn(async () => pending) };
}

describe('ConvertPendingPianoMidi', () => {
  it('converts every pending ref and counts successes', async () => {
    const pending = [
      { midiPath: '/src/a.mid', mp3Path: '/dst/a.mp3' },
      { midiPath: '/src/b.mid', mp3Path: '/dst/b.mp3' },
    ];
    const converter = { convert: vi.fn(async () => {}) };
    const uc = new ConvertPendingPianoMidi({ library: fakeLibrary(pending), converter, logger: silent });

    const result = await uc.execute();

    expect(converter.convert).toHaveBeenCalledTimes(2);
    expect(converter.convert).toHaveBeenNthCalledWith(1, '/src/a.mid', '/dst/a.mp3');
    expect(converter.convert).toHaveBeenNthCalledWith(2, '/src/b.mid', '/dst/b.mp3');
    expect(result).toEqual({ count: 2, status: 'success' });
  });

  it('skips a per-file failure without aborting the run', async () => {
    const pending = [
      { midiPath: '/src/a.mid', mp3Path: '/dst/a.mp3' },
      { midiPath: '/src/b.mid', mp3Path: '/dst/b.mp3' },
      { midiPath: '/src/c.mid', mp3Path: '/dst/c.mp3' },
    ];
    const converter = {
      convert: vi.fn(async (midiPath) => {
        if (midiPath === '/src/b.mid') throw new Error('fluidsynth exit 1');
      }),
    };
    const uc = new ConvertPendingPianoMidi({ library: fakeLibrary(pending), converter, logger: silent });

    const result = await uc.execute();

    expect(converter.convert).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ count: 2, status: 'success' });
  });

  it('returns success with count 0 when nothing is pending', async () => {
    const converter = { convert: vi.fn() };
    const uc = new ConvertPendingPianoMidi({ library: fakeLibrary([]), converter, logger: silent });

    expect(await uc.execute()).toEqual({ count: 0, status: 'success' });
    expect(converter.convert).not.toHaveBeenCalled();
  });

  it('returns an error result when listing fails', async () => {
    const library = { listPending: vi.fn(async () => { throw new Error('EACCES'); }) };
    const converter = { convert: vi.fn() };
    const uc = new ConvertPendingPianoMidi({ library, converter, logger: silent });

    const result = await uc.execute();

    expect(result).toEqual({ count: 0, status: 'error', reason: 'EACCES' });
    expect(converter.convert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/application/pianoaudio/ConvertPendingPianoMidi.test.mjs`
Expected: FAIL — cannot resolve `#apps/pianoaudio/ConvertPendingPianoMidi.mjs`.

- [ ] **Step 3: Write the ports**

```javascript
// backend/src/3_applications/pianoaudio/ports/IMidiLibrary.mjs
/**
 * IMidiLibrary — port: enumerate MIDI files still needing an MP3.
 * Layer: APPLICATION (3_applications/pianoaudio/ports).
 * @module applications/pianoaudio/ports/IMidiLibrary
 */
export class IMidiLibrary {
  /** @returns {Promise<Array<{midiPath:string, mp3Path:string}>>} absolute paths, missing-mp3 only, newest-first */
  async listPending() { throw new Error('IMidiLibrary.listPending not implemented'); }
}

export default IMidiLibrary;
```

```javascript
// backend/src/3_applications/pianoaudio/ports/IMidiConverter.mjs
/**
 * IMidiConverter — port: render one MIDI file to a normalized MP3.
 * Layer: APPLICATION (3_applications/pianoaudio/ports).
 * @module applications/pianoaudio/ports/IMidiConverter
 */
export class IMidiConverter {
  /** @param {string} midiPath @param {string} mp3Path @returns {Promise<void>} */
  async convert(midiPath, mp3Path) { throw new Error('IMidiConverter.convert not implemented'); }
}

export default IMidiConverter;
```

- [ ] **Step 4: Write the use case**

```javascript
// backend/src/3_applications/pianoaudio/ConvertPendingPianoMidi.mjs
/**
 * Use case: convert every pending piano MIDI to MP3. Orchestration only — the
 * library lists what needs converting, the converter renders each one. A
 * per-file failure is logged and skipped, never fatal.
 *
 * Layer: APPLICATION (3_applications/pianoaudio).
 * @module applications/pianoaudio/ConvertPendingPianoMidi
 */
export class ConvertPendingPianoMidi {
  #library; #converter; #logger;

  constructor({ library, converter, logger = console }) {
    if (!library) throw new Error('ConvertPendingPianoMidi requires library');
    if (!converter) throw new Error('ConvertPendingPianoMidi requires converter');
    this.#library = library;
    this.#converter = converter;
    this.#logger = logger;
  }

  /** @returns {Promise<{count:number, status:'success'|'error', reason?:string}>} */
  async execute() {
    let pending;
    try {
      pending = await this.#library.listPending();
    } catch (err) {
      this.#logger.warn?.('pianoaudio.list.failed', { error: err.message });
      return { count: 0, status: 'error', reason: err.message };
    }

    let converted = 0;
    for (const ref of pending) {
      try {
        await this.#converter.convert(ref.midiPath, ref.mp3Path);
        converted += 1;
        this.#logger.info?.('pianoaudio.converted', { midiPath: ref.midiPath, mp3Path: ref.mp3Path });
      } catch (err) {
        this.#logger.warn?.('pianoaudio.convert.failed', { midiPath: ref.midiPath, error: err.message });
      }
    }

    this.#logger.info?.('pianoaudio.harvest.done', { pending: pending.length, converted });
    return { count: converted, status: 'success' };
  }
}

export default ConvertPendingPianoMidi;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/isolated/application/pianoaudio/ConvertPendingPianoMidi.test.mjs`
Expected: PASS (4/4).

- [ ] **Step 6: Commit**

```bash
git add backend/src/3_applications/pianoaudio tests/isolated/application/pianoaudio/ConvertPendingPianoMidi.test.mjs
git commit -m "feat(pianoaudio): add IMidiLibrary/IMidiConverter ports + ConvertPendingPianoMidi use case"
```

---

### Task 3: Adapter — `FsMidiLibrary`

**Files:**
- Create: `backend/src/1_adapters/pianoaudio/FsMidiLibrary.mjs`
- Test: `tests/isolated/adapter/pianoaudio/FsMidiLibrary.test.mjs`

**Interfaces:**
- Consumes: `IMidiLibrary` (Task 2), `mp3RelForMidiRel` (Task 1), `fileExists` from `#system/utils/FileIO.mjs`.
- Produces: `FsMidiLibrary extends IMidiLibrary` — constructor `{ sourceDir, destDir, logger }`; `listPending()` recursively walks `sourceDir` for `*.mid` (case-insensitive, skipping `._` files), computes the mirror `mp3Path` under `destDir`, drops any whose `.mp3` already exists, and returns the survivors sorted newest-first by MIDI mtime as `{midiPath, mp3Path}` (absolute).

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/adapter/pianoaudio/FsMidiLibrary.test.mjs
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FsMidiLibrary } from '#adapters/pianoaudio/FsMidiLibrary.mjs';

const silent = { info() {}, warn() {}, error() {}, debug() {} };
let root, sourceDir, destDir;

function writeFile(p, content, mtimeMs) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  if (mtimeMs != null) fs.utimesSync(p, mtimeMs / 1000, mtimeMs / 1000);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pianoaudio-lib-'));
  sourceDir = path.join(root, 'history', 'piano');
  destDir = path.join(root, 'media', 'audio', 'piano');
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('FsMidiLibrary.listPending', () => {
  it('returns only midis missing a mirror mp3, newest-first, with mirrored dest paths', async () => {
    // older midi, no mp3 yet
    writeFile(path.join(sourceDir, 'kckern/2026-01-02/take1.mid'), 'MID', 1_000_000);
    // newer midi, no mp3 yet
    writeFile(path.join(sourceDir, 'jamcorder/2026/2026-01/s.mid'), 'MID', 5_000_000);
    // midi that already has a mirror mp3 → excluded
    writeFile(path.join(sourceDir, 'kckern/2026-01-02/done.mid'), 'MID', 9_000_000);
    writeFile(path.join(destDir, 'kckern/2026-01-02/done.mp3'), 'MP3');
    // a non-midi → ignored
    writeFile(path.join(sourceDir, 'kckern/2026-01-02/notes.txt'), 'x');

    const lib = new FsMidiLibrary({ sourceDir, destDir, logger: silent });
    const pending = await lib.listPending();

    expect(pending).toEqual([
      {
        midiPath: path.join(sourceDir, 'jamcorder/2026/2026-01/s.mid'),
        mp3Path: path.join(destDir, 'jamcorder/2026/2026-01/s.mp3'),
      },
      {
        midiPath: path.join(sourceDir, 'kckern/2026-01-02/take1.mid'),
        mp3Path: path.join(destDir, 'kckern/2026-01-02/take1.mp3'),
      },
    ]);
  });

  it('returns an empty array when the source dir does not exist', async () => {
    const lib = new FsMidiLibrary({ sourceDir: path.join(root, 'nope'), destDir, logger: silent });
    expect(await lib.listPending()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/adapter/pianoaudio/FsMidiLibrary.test.mjs`
Expected: FAIL — cannot resolve `#adapters/pianoaudio/FsMidiLibrary.mjs`.

- [ ] **Step 3: Write the adapter**

```javascript
// backend/src/1_adapters/pianoaudio/FsMidiLibrary.mjs
/**
 * FsMidiLibrary — walks household/history/piano for .mid files and mirrors each
 * to media/audio/piano/<same rel>.mp3, returning only those whose mp3 is still
 * missing, newest-first. Owns all filesystem access.
 *
 * Layer: ADAPTER (1_adapters/pianoaudio).
 * @module adapters/pianoaudio/FsMidiLibrary
 */
import fs from 'node:fs';
import path from 'node:path';
import { IMidiLibrary } from '#apps/pianoaudio/ports/IMidiLibrary.mjs';
import { mp3RelForMidiRel } from '#domains/pianoaudio/pianoAudioPaths.mjs';
import { fileExists } from '#system/utils/FileIO.mjs';

export class FsMidiLibrary extends IMidiLibrary {
  #sourceDir; #destDir; #logger;

  constructor({ sourceDir, destDir, logger = console }) {
    super();
    if (!sourceDir) throw new Error('FsMidiLibrary requires sourceDir');
    if (!destDir) throw new Error('FsMidiLibrary requires destDir');
    this.#sourceDir = sourceDir;
    this.#destDir = destDir;
    this.#logger = logger;
  }

  async listPending() {
    const midis = this.#walk(this.#sourceDir);
    const pending = [];
    for (const m of midis) {
      const rel = path.relative(this.#sourceDir, m.abs);
      const mp3Path = path.join(this.#destDir, mp3RelForMidiRel(rel));
      if (fileExists(mp3Path)) continue;
      pending.push({ midiPath: m.abs, mp3Path, mtimeMs: m.mtimeMs });
    }
    pending.sort((a, b) => b.mtimeMs - a.mtimeMs); // newest-first
    return pending.map(({ midiPath, mp3Path }) => ({ midiPath, mp3Path }));
  }

  /** @returns {Array<{abs:string, mtimeMs:number}>} */
  #walk(dir) {
    const out = [];
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return out; // missing/unreadable dir → nothing
    }
    for (const e of entries) {
      if (e.name.startsWith('._')) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        out.push(...this.#walk(abs));
      } else if (e.isFile() && /\.mid$/i.test(e.name)) {
        let mtimeMs = 0;
        try { mtimeMs = fs.statSync(abs).mtimeMs; } catch { /* keep 0 */ }
        out.push({ abs, mtimeMs });
      }
    }
    return out;
  }
}

export default FsMidiLibrary;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/adapter/pianoaudio/FsMidiLibrary.test.mjs`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/pianoaudio/FsMidiLibrary.mjs tests/isolated/adapter/pianoaudio/FsMidiLibrary.test.mjs
git commit -m "feat(pianoaudio): add FsMidiLibrary adapter (walk + mirror + newest-first)"
```

---

### Task 4: Adapter — `FluidSynthMp3Converter`

**Files:**
- Create: `backend/src/1_adapters/pianoaudio/FluidSynthMp3Converter.mjs`
- Test: `tests/isolated/adapter/pianoaudio/FluidSynthMp3Converter.test.mjs`

**Interfaces:**
- Consumes: `IMidiConverter` (Task 2), `ensureDir`/`fileExists` from `#system/utils/FileIO.mjs`.
- Produces: `FluidSynthMp3Converter extends IMidiConverter` — constructor `{ soundfontPath, scratchDir = '/tmp/pianoaudio', logger, execFile }` where `execFile(cmd, args, opts) → Promise` is an injectable seam (default: promisified `node:child_process.execFile`). `convert(midiPath, mp3Path)`: skip if `mp3Path` exists; ensure scratch + mp3 parent dirs; run fluidsynth then ffmpeg with the exact argv from Global Constraints (ffmpeg writes `<mp3Path>.tmp`); rename `.tmp`→final; always delete the scratch WAV and any leftover `.tmp` in a `finally`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/adapter/pianoaudio/FluidSynthMp3Converter.test.mjs
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FluidSynthMp3Converter } from '#adapters/pianoaudio/FluidSynthMp3Converter.mjs';

const silent = { info() {}, warn() {}, error() {}, debug() {} };
let root, scratchDir, midiPath, mp3Path;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pianoaudio-conv-'));
  scratchDir = path.join(root, 'scratch');
  midiPath = path.join(root, 'src', 'take.mid');
  mp3Path = path.join(root, 'dst', 'nested', 'take.mp3');
  fs.mkdirSync(path.dirname(midiPath), { recursive: true });
  fs.writeFileSync(midiPath, 'MID');
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

// Fake exec seam that emulates fluidsynth (writes the wav named after -F) and
// ffmpeg (writes the output file, the second-to-last argv before '-y').
function fakeExec() {
  return vi.fn(async (cmd, args) => {
    if (cmd === 'fluidsynth') {
      const wav = args[args.indexOf('-F') + 1];
      fs.writeFileSync(wav, 'WAV');
    } else if (cmd === 'ffmpeg') {
      const out = args[args.length - 2];
      fs.writeFileSync(out, 'MP3');
    }
    return { stdout: '', stderr: '' };
  });
}

describe('FluidSynthMp3Converter.convert', () => {
  it('runs fluidsynth then ffmpeg with the exact argv and produces the mp3', async () => {
    const execFile = fakeExec();
    const conv = new FluidSynthMp3Converter({
      soundfontPath: '/sf/TimGM6mb.sf2', scratchDir, logger: silent, execFile,
    });

    await conv.convert(midiPath, mp3Path);

    expect(execFile).toHaveBeenCalledTimes(2);

    const [fsCmd, fsArgs] = execFile.mock.calls[0];
    expect(fsCmd).toBe('fluidsynth');
    const fIdx = fsArgs.indexOf('-F');
    const wavPath = fsArgs[fIdx + 1];
    expect(fsArgs).toEqual(['-ni', '-F', wavPath, '-r', '44100', '/sf/TimGM6mb.sf2', midiPath]);
    expect(path.dirname(wavPath)).toBe(scratchDir);
    expect(wavPath.endsWith('.wav')).toBe(true);

    const [ffCmd, ffArgs] = execFile.mock.calls[1];
    expect(ffCmd).toBe('ffmpeg');
    expect(ffArgs).toEqual([
      '-i', wavPath,
      '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
      '-codec:a', 'libmp3lame',
      '-qscale:a', '2',
      `${mp3Path}.tmp`, '-y',
    ]);

    expect(fs.existsSync(mp3Path)).toBe(true);        // final mp3 present
    expect(fs.existsSync(`${mp3Path}.tmp`)).toBe(false); // tmp renamed away
    expect(fs.existsSync(wavPath)).toBe(false);          // scratch wav cleaned
  });

  it('skips conversion (no exec) when the final mp3 already exists', async () => {
    fs.mkdirSync(path.dirname(mp3Path), { recursive: true });
    fs.writeFileSync(mp3Path, 'EXISTING');
    const execFile = fakeExec();
    const conv = new FluidSynthMp3Converter({
      soundfontPath: '/sf/TimGM6mb.sf2', scratchDir, logger: silent, execFile,
    });

    await conv.convert(midiPath, mp3Path);

    expect(execFile).not.toHaveBeenCalled();
    expect(fs.readFileSync(mp3Path, 'utf8')).toBe('EXISTING');
  });

  it('cleans up the scratch wav and leaves no final mp3 when ffmpeg fails', async () => {
    let wavPath;
    const execFile = vi.fn(async (cmd, args) => {
      if (cmd === 'fluidsynth') {
        wavPath = args[args.indexOf('-F') + 1];
        fs.writeFileSync(wavPath, 'WAV');
        return { stdout: '', stderr: '' };
      }
      throw new Error('ffmpeg exit 1');
    });
    const conv = new FluidSynthMp3Converter({
      soundfontPath: '/sf/TimGM6mb.sf2', scratchDir, logger: silent, execFile,
    });

    await expect(conv.convert(midiPath, mp3Path)).rejects.toThrow('ffmpeg exit 1');

    expect(fs.existsSync(mp3Path)).toBe(false);
    expect(fs.existsSync(`${mp3Path}.tmp`)).toBe(false);
    expect(fs.existsSync(wavPath)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/adapter/pianoaudio/FluidSynthMp3Converter.test.mjs`
Expected: FAIL — cannot resolve `#adapters/pianoaudio/FluidSynthMp3Converter.mjs`.

- [ ] **Step 3: Write the adapter**

```javascript
// backend/src/1_adapters/pianoaudio/FluidSynthMp3Converter.mjs
/**
 * FluidSynthMp3Converter — renders one MIDI to a normalized MP3:
 *   fluidsynth (MIDI → scratch WAV) → ffmpeg loudnorm (WAV → <mp3>.tmp) → rename.
 * The scratch WAV is always cleaned up; a crash mid-ffmpeg never leaves a partial
 * final mp3 (we write .tmp then rename). The subprocess call is an injectable
 * seam (`execFile`) so the argv and file flow are unit-testable without binaries.
 *
 * Layer: ADAPTER (1_adapters/pianoaudio).
 * @module adapters/pianoaudio/FluidSynthMp3Converter
 */
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile as _execFile } from 'node:child_process';
import { IMidiConverter } from '#apps/pianoaudio/ports/IMidiConverter.mjs';
import { ensureDir, fileExists } from '#system/utils/FileIO.mjs';

const execFileAsync = promisify(_execFile);
const LOUDNORM = 'loudnorm=I=-16:TP=-1.5:LRA=11';
const MIN_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 600_000;

export class FluidSynthMp3Converter extends IMidiConverter {
  #soundfontPath; #scratchDir; #logger; #execFile; #counter = 0;

  constructor({ soundfontPath, scratchDir = '/tmp/pianoaudio', logger = console, execFile = execFileAsync }) {
    super();
    if (!soundfontPath) throw new Error('FluidSynthMp3Converter requires soundfontPath');
    this.#soundfontPath = soundfontPath;
    this.#scratchDir = scratchDir;
    this.#logger = logger;
    this.#execFile = execFile;
  }

  async convert(midiPath, mp3Path) {
    if (fileExists(mp3Path)) return; // already rendered — resumable skip

    ensureDir(this.#scratchDir);
    ensureDir(path.dirname(mp3Path));

    const base = path.basename(mp3Path, '.mp3').replace(/[^\w.-]/g, '_');
    const wavPath = path.join(this.#scratchDir, `${base}.${process.pid}.${this.#counter++}.wav`);
    const tmpMp3 = `${mp3Path}.tmp`;

    try {
      await this.#execFile(
        'fluidsynth',
        ['-ni', '-F', wavPath, '-r', '44100', this.#soundfontPath, midiPath],
        { timeout: this.#timeoutFor(midiPath) },
      );
      await this.#execFile(
        'ffmpeg',
        ['-i', wavPath, '-af', LOUDNORM, '-codec:a', 'libmp3lame', '-qscale:a', '2', tmpMp3, '-y'],
        { timeout: this.#timeoutFor(wavPath) },
      );
      fs.renameSync(tmpMp3, mp3Path);
    } finally {
      this.#safeUnlink(wavPath);
      this.#safeUnlink(tmpMp3); // no-op if the rename already consumed it
    }
  }

  /** Timeout scales with input size: 60s base + 1s per 4KB, capped at 600s. */
  #timeoutFor(filePath) {
    let size = 0;
    try { size = fs.statSync(filePath).size; } catch { /* keep 0 */ }
    return Math.min(MAX_TIMEOUT_MS, MIN_TIMEOUT_MS + Math.floor(size / 4096) * 1000);
  }

  #safeUnlink(p) {
    try { fs.unlinkSync(p); } catch { /* already gone */ }
  }
}

export default FluidSynthMp3Converter;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/adapter/pianoaudio/FluidSynthMp3Converter.test.mjs`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/pianoaudio/FluidSynthMp3Converter.mjs tests/isolated/adapter/pianoaudio/FluidSynthMp3Converter.test.mjs
git commit -m "feat(pianoaudio): add FluidSynthMp3Converter adapter (fluidsynth+ffmpeg, atomic tmp rename)"
```

---

### Task 5: Adapter — `PianoMp3Harvester`

**Files:**
- Create: `backend/src/1_adapters/harvester/other/PianoMp3Harvester.mjs`
- Test: `tests/isolated/adapter/pianoaudio/PianoMp3Harvester.test.mjs`

**Interfaces:**
- Consumes: `IHarvester`, `HarvesterCategory` from `../ports/IHarvester.mjs`; the `ConvertPendingPianoMidi` use case shape (`execute()`) from Task 2.
- Produces: `PianoMp3Harvester extends IHarvester` — constructor `{ convertUseCase, logger }`; `get serviceId()` → `'piano-mp3'`; `get category()` → `HarvesterCategory.OTHER`; `async harvest(_username, _options)` → delegates to `convertUseCase.execute()`; `getStatus()` → `{state:'closed', failures:0, lastFailure:null, cooldownUntil:null}`; `getParams()` → `[]`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/adapter/pianoaudio/PianoMp3Harvester.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { PianoMp3Harvester } from '#adapters/harvester/other/PianoMp3Harvester.mjs';

const silent = { info() {}, warn() {}, error() {}, debug() {} };

describe('PianoMp3Harvester', () => {
  it('exposes the scheduler contract (serviceId, category, status, params)', () => {
    const h = new PianoMp3Harvester({ convertUseCase: { execute: vi.fn() }, logger: silent });
    expect(h.serviceId).toBe('piano-mp3');
    expect(h.category).toBe('other');
    expect(h.getStatus()).toEqual({ state: 'closed', failures: 0, lastFailure: null, cooldownUntil: null });
    expect(h.getParams()).toEqual([]);
  });

  it('delegates harvest() to the use case and returns its result', async () => {
    const convertUseCase = { execute: vi.fn(async () => ({ count: 7, status: 'success' })) };
    const h = new PianoMp3Harvester({ convertUseCase, logger: silent });

    const result = await h.harvest('kckern', {});

    expect(convertUseCase.execute).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ count: 7, status: 'success' });
  });

  it('throws if constructed without a use case', () => {
    expect(() => new PianoMp3Harvester({ logger: silent })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/adapter/pianoaudio/PianoMp3Harvester.test.mjs`
Expected: FAIL — cannot resolve `#adapters/harvester/other/PianoMp3Harvester.mjs`.

- [ ] **Step 3: Write the harvester**

```javascript
// backend/src/1_adapters/harvester/other/PianoMp3Harvester.mjs
/**
 * PianoMp3Harvester — thin IHarvester adapter that plugs the piano MIDI→MP3
 * conversion use case into the scheduler. serviceId 'piano-mp3' must match the
 * jobs.yml id. Layer: ADAPTER (1_adapters/harvester). Delegates all work.
 * @module adapters/harvester/other/PianoMp3Harvester
 */
import { IHarvester, HarvesterCategory } from '../ports/IHarvester.mjs';

export class PianoMp3Harvester extends IHarvester {
  #convertUseCase; #logger;

  constructor({ convertUseCase, logger = console }) {
    super();
    if (!convertUseCase) throw new Error('PianoMp3Harvester requires convertUseCase');
    this.#convertUseCase = convertUseCase;
    this.#logger = logger;
  }

  get serviceId() { return 'piano-mp3'; }
  get category() { return HarvesterCategory.OTHER; }

  async harvest(_username, _options = {}) {
    return this.#convertUseCase.execute();
  }

  getStatus() {
    return { state: 'closed', failures: 0, lastFailure: null, cooldownUntil: null };
  }

  getParams() { return []; }
}

export default PianoMp3Harvester;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/adapter/pianoaudio/PianoMp3Harvester.test.mjs`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/harvester/other/PianoMp3Harvester.mjs tests/isolated/adapter/pianoaudio/PianoMp3Harvester.test.mjs
git commit -m "feat(pianoaudio): add PianoMp3Harvester scheduler adapter"
```

---

### Task 6: Wiring — barrel export, bootstrap, Dockerfile

**Files:**
- Modify: `backend/src/1_adapters/harvester/index.mjs` (add barrel export near the other `other/` exports, ~line 63)
- Modify: `backend/src/5_composition/bootstrap.mjs` (add imports near line 334-340; add `registerHarvester('piano-mp3', …)` right after the JamCorder block, ~line 3495)
- Modify: `docker/Dockerfile:8` (add `fluidsynth soundfont-timgm` to the `apk add` line)

**Interfaces:**
- Consumes: `FsMidiLibrary` (Task 3), `FluidSynthMp3Converter` (Task 4), `ConvertPendingPianoMidi` (Task 2), `PianoMp3Harvester` (Task 5), `configService.getHouseholdPath` / `getMediaDir`, the in-scope `registerHarvester(name, factory)` helper.
- Produces: a registered `'piano-mp3'` harvester in the harvester service; the container image with `fluidsynth` + a GM soundfont.

> This task has no new unit test (it is composition-root wiring, which the isolated-test layer does not cover — the layer-import audit and the deploy smoke test are its gates). Its verification steps run the layer audit and the full isolated suite to prove nothing regressed.

- [ ] **Step 1: Add the barrel export**

In `backend/src/1_adapters/harvester/index.mjs`, in the `// Other Harvesters` block, directly after the `JamCorderHarvester` export line, add:

```javascript
export { PianoMp3Harvester } from './other/PianoMp3Harvester.mjs';
```

- [ ] **Step 2: Add bootstrap imports**

In `backend/src/5_composition/bootstrap.mjs`:

(a) Add `PianoMp3Harvester` to the existing `#adapters/harvester/index.mjs` import list (the block ending at line ~335 that already imports `JamCorderHarvester`):

```javascript
  JamCorderHarvester,
  PianoMp3Harvester
} from '#adapters/harvester/index.mjs';
```

(b) After the JamCorder adapter imports (~line 340), add the pianoaudio imports:

```javascript
// Piano MIDI→MP3 adapters + use case (daily render of history/piano into media/audio/piano)
import { FsMidiLibrary } from '#adapters/pianoaudio/FsMidiLibrary.mjs';
import { FluidSynthMp3Converter } from '#adapters/pianoaudio/FluidSynthMp3Converter.mjs';
import { ConvertPendingPianoMidi } from '#apps/pianoaudio/ConvertPendingPianoMidi.mjs';
```

- [ ] **Step 3: Register the harvester**

In `backend/src/5_composition/bootstrap.mjs`, immediately after the JamCorder `if (httpClient) { registerHarvester('jamcorder', …); }` block (~line 3495) and before the `// Create job executor` comment, add (note: NOT guarded by `httpClient` — this harvester needs no HTTP client):

```javascript
  // Piano MIDI→MP3 — daily render of every history/piano .mid into media/audio/piano.
  registerHarvester('piano-mp3', () => {
    const sourceDir = configService.getHouseholdPath('history/piano');
    const destDir = `${configService.getMediaDir()}/audio/piano`;
    const soundfontPath = '/usr/share/soundfonts/TimGM6mb.sf2'; // Alpine soundfont-timgm (confirmed at build)
    const library = new FsMidiLibrary({ sourceDir, destDir, logger });
    const converter = new FluidSynthMp3Converter({ soundfontPath, scratchDir: '/tmp/pianoaudio', logger });
    const convertUseCase = new ConvertPendingPianoMidi({ library, converter, logger });
    return new PianoMp3Harvester({ convertUseCase, logger });
  });
```

- [ ] **Step 4: Add the container dependencies**

In `docker/Dockerfile`, line 8, append `fluidsynth soundfont-timgm` to the `apk add` list:

```dockerfile
RUN apk add --no-cache openssh-client git curl ffmpeg tzdata yq android-tools su-exec fluidsynth soundfont-timgm
```

- [ ] **Step 5: Verify the layer-import audit still passes**

Run: `npx vitest run tests/unit/tooling/auditLayerImports.test.mjs`
Expected: PASS — no layer violations (domain has no I/O imports; the use case imports only its ports; adapters import their port + `#system`/`#domains`; wiring lives only in `5_composition`).

- [ ] **Step 6: Verify the full isolated suite is green**

Run: `npm run test:isolated`
Expected: PASS — all pianoaudio tests plus the existing suite; no regressions.

- [ ] **Step 7: Commit**

```bash
git add backend/src/1_adapters/harvester/index.mjs backend/src/5_composition/bootstrap.mjs docker/Dockerfile
git commit -m "feat(pianoaudio): wire piano-mp3 harvester + add fluidsynth/soundfont to image"
```

---

## Deploy & Backfill (post-merge, operator-run — not a git task)

`data/` is gitignored, so the scheduler entry is a data-volume edit, and the soundfont path must be confirmed against the freshly built image.

1. **Confirm the soundfont path in the built image.** After `sudo docker build …`, before deploy:
   `sudo docker run --rm --entrypoint sh kckern/daylight-station:latest -c 'ls -1 /usr/share/soundfonts/'`
   is NOT permitted (no `docker run` in sudoers). Instead confirm inside the running container after deploy:
   `sudo docker exec daylight-station sh -c 'ls -1 /usr/share/soundfonts/ && command -v fluidsynth'`.
   If the `.sf2` filename differs from `TimGM6mb.sf2`, update the `soundfontPath` literal in bootstrap (Task 6 Step 3), rebuild.
2. **Gate-check before deploy** (never redeploy while the garage is in use — CLAUDE.local.md): confirm no active fitness session and no live playing video.
3. **Add the jobs.yml entry** (data volume, via `docker exec` heredoc — never `sed -i`):
   ```yaml
   - id: piano-mp3
     name: Piano MIDI to MP3
     schedule: "30 4 * * *"
     timeout: 1200000
   ```
   Append it to `data/system/config/jobs.yml`. (`Job` reads `timeout` from the entry, default 300000ms; executor-routed jobs omit `module`.)
4. **Build + deploy:** `sudo docker build …` then `sudo docker stop/rm daylight-station` + `sudo deploy-daylight`.
5. **Backfill:** trigger `POST /api/v1/scheduling/run/piano-mp3` repeatedly until the run reports `count: 0` (nothing left pending), draining the ~1169-file backlog. Runs are resumable (skip-if-mp3-exists), so repeated triggers converge.
6. **Verify:** mp3 count under `media/audio/piano/` matches the missing set drained; spot-check one rendered mp3 has audio (`ffprobe` shows an mp3 stream with non-zero duration).

---

## Self-Review

**Spec coverage** (design doc `2026-07-12-piano-midi-mp3-design.md`):
- Source/dest/mirror → Global Constraints + Task 3 (`FsMidiLibrary`). ✓
- Synth = fluidsynth + soundfont-timgm → Task 4 + Task 6 Dockerfile. ✓
- Exact pipeline (fluidsynth → WAV → ffmpeg loudnorm → `.tmp` → rename → rm WAV) → Task 4, argv asserted in tests. ✓
- Dedup skip-if-mp3-exists → Task 3 (filter) + Task 4 (guard). ✓
- Newest-first → Task 3 sort + test. ✓
- Daily `30 4 * * *`, timeout 1.2M → Deploy step 3. ✓
- Backfill via repeated triggers → Deploy step 5. ✓
- Per-file error isolation, whole-run error result → Task 2 (use case) + tests. ✓
- Config/paths (getHouseholdPath/getMediaDir, soundfont default, scratch) → Task 6 wiring. ✓
- Testing across domain/application/adapter layers → Tasks 1-5 each ship a test. ✓
- Non-goals (no re-encode, no source deletion, no tagging, single soundfont) → nothing in the plan violates them. ✓

**Placeholder scan:** no TBD/TODO/"add error handling"/"similar to Task N" — every code step carries complete code. ✓

**Type consistency:** `listPending()` returns `{midiPath, mp3Path}` in Task 2/3/tests; `convert(midiPath, mp3Path)` in Task 2/4/tests; use case `execute()` → `{count, status, reason?}` in Task 2/5/tests; harvester `serviceId 'piano-mp3'`, `category 'other'` consistent Task 5/6. `mp3RelForMidiRel` name consistent Task 1/3. ✓
