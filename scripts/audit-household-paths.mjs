#!/usr/bin/env node
/**
 * `npm run audit:paths` — does every household path the code resolves
 * actually exist, and does every directory on disk have a reader?
 *
 * WHY THIS EXISTS. The 2026-08-16 domain-first reorganization moved ~260 MB
 * across ~30 household domains. The dangerous failure mode is not a crash —
 * it is a store that resolves a path nobody moved data to, quietly creates an
 * empty directory, and reports success. Two of those survived every grep in
 * that migration and were only found by checking resolved paths against disk:
 *
 *   - `YamlObservedStateStore` still defaulted to `history/triggers/…`, so
 *     the live NFC ledger was orphaned under a retired root.
 *   - `YamlConversationDatastore` resolved `shared/messaging/…`, and being
 *     lazily created, would have rebuilt `household/shared/` on first write.
 *
 * Both hid from a path-literal grep because the path was a CONSTRUCTOR
 * DEFAULT and an inline argument, not a `getHouseholdPath()` call. This audit
 * looks at every shape.
 *
 * MISSING IS NOT AUTOMATICALLY WRONG. Many stores are created on first write,
 * so a missing path is a QUESTION, not a failure: did this ever hold data? The
 * report separates the two by checking `data/_deleteme/` — where the
 * reorganization preserved every original — so a path that used to exist and
 * now doesn't is flagged loudly, and a never-used store is listed quietly.
 *
 * Exit 1 only on ORPHANED (data exists, nothing reads it) or MOVED-AWAY (the
 * code expects a path that used to hold data and no longer does).
 */
import fs from 'node:fs';
import path from 'node:path';

// Guards the executable body below so `findWriterReaderSplits` can be
// imported by tests (tests/isolated/tooling/auditHouseholdPaths.test.mjs)
// without running the full disk audit and its terminal `process.exit`.
const isMainModule = import.meta.url === `file://${process.argv[1]}`;

const DATA = process.env.DAYLIGHT_DATA
  || '/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data';
const HH = path.join(DATA, 'household');
const DELETED = path.join(DATA, '_deleteme');
const SCAN_DIRS = ['backend/src', 'cli', 'shared', 'scripts'];

/** Roots that are not domains and are excluded from the orphan sweep. */
const NOT_DOMAINS = new Set(['config', 'auth', 'screens', 'assets']);

const walk = (dir, out = []) => {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.mjs$/.test(e.name) && !/\.test\.mjs$/.test(e.name)) out.push(p);
  }
  return out;
};

/** Strip line comments and block comments so a historical note is not read as a call. */
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((l) => !/^\s*(\/\/|\*)/.test(l))
  .join('\n');

/**
 * Every shape a household path is written in. The last two are the ones that
 * hid real bugs: a bare `PATH = '...'` const and a constructor default.
 */
const PATTERNS = [
  /getHouseholdPath\(\s*'([^']+)'/g,
  /household\.(?:read|write|resolveDir|resolvePath)\(\s*'([^']+)'/g,
  /(?:loadFile|saveFile)\??\.?\(\s*'([^']+)'/g,
  /(?:path|PATH|_DIR|_PATH|Root|ROOT)\s*=\s*'([a-z][a-z0-9._/-]*\/[a-z0-9._/-]+)'/g,
  // Array-of-segments: `['household', 'gaming', 'log', 'pianochess']`. This
  // shape is why the chess review CLIs went on reading a directory the
  // household reorganization had moved, reporting "no archived games" for a
  // corpus of 32 sitting one level away. It matches none of the forms above.
  /(?:PATH|DIR|SUBPATH|Path|Dir|Root|ROOT)\w*\s*=\s*\[\s*'household'\s*,\s*((?:'[a-z0-9._-]+'\s*,?\s*)+)\]/g,
];

// Generic wrapper roots that are not themselves a domain — the domain is the
// segment underneath. `history/triggers` and `history/piano` (see the header
// comment above and the 2026-08-16 incident) are both filed under `history`,
// but the bounded context is `triggers` / `piano`, not `history` itself.
const GENERIC_PREFIXES = new Set(['history']);

/**
 * Find domains where the code WRITES one subpath and READS a different one.
 *
 * The existing checks ask "does every resolved path exist" and "does every
 * domain on disk have a reader". Both answered YES on 2026-08-16 while the
 * piano MIDI corpus was forked: the writer targeted history/piano, the render
 * jobs read piano/log, and both roots existed with readers. Nothing failed.
 *
 * A domain is the first path segment (after stripping a GENERIC_PREFIXES
 * wrapper, if any). Within one domain, if the set of written subpaths and the
 * set of read subpaths are both non-empty and share nothing, the two halves
 * disagree about which root is canonical.
 *
 * Write-only trails (barcode/log) and read-only trees (config/devices) are
 * NOT flagged — a missing counterpart is normal, a contradicting one is not.
 */
export function findWriterReaderSplits(sites) {
  const byDomain = new Map();
  for (const site of sites) {
    const segments = String(site.subpath).split('/');
    const domain = (GENERIC_PREFIXES.has(segments[0]) && segments[1]) ? segments[1] : segments[0];
    if (!byDomain.has(domain)) byDomain.set(domain, { writes: new Map(), reads: new Map() });
    const bucket = byDomain.get(domain);
    const target = site.mode === 'write' ? bucket.writes : bucket.reads;
    if (!target.has(site.subpath)) target.set(site.subpath, []);
    target.get(site.subpath).push(`${site.file}:${site.line}`);
  }

  const splits = [];
  for (const { writes, reads } of byDomain.values()) {
    if (writes.size === 0 || reads.size === 0) continue;
    const shared = [...writes.keys()].some((p) => reads.has(p));
    if (shared) continue; // at least one path agrees — not a split
    for (const [subpath, files] of writes) splits.push({ subpath, writers: files, readers: [] });
    for (const [subpath, files] of reads) splits.push({ subpath, writers: [], readers: files });
  }
  return splits;
}

/**
 * Determine read/write mode from the full matched text, independent of which
 * PATTERN matched. `household.read(`/`household.write(` and `loadFile`/
 * `saveFile` are the only shapes that say which direction the access is;
 * `resolveDir`/`resolvePath`/`getHouseholdPath` and the bare path-literal
 * shapes are ambiguous on their own and are left out of the writer/reader
 * check rather than guessed at.
 */
const modeOf = (matchText) => {
  if (/\.read\(/.test(matchText)) return 'read';
  if (/\.write\(/.test(matchText)) return 'write';
  if (/(?:^|[^a-zA-Z])loadFile/.test(matchText)) return 'read';
  if (/(?:^|[^a-zA-Z])saveFile/.test(matchText)) return 'write';
  return null;
};

// Everything below is the executable audit — scans disk, prints a report,
// and exits with a status code. Guarded so importing this module (e.g. to
// use `findWriterReaderSplits` from a test) doesn't run it as a side effect.
if (isMainModule) {

const expected = new Map(); // relPath -> Set(files)
const collectedSites = []; // { file, line, subpath, mode } — feeds findWriterReaderSplits
for (const dir of SCAN_DIRS) {
  for (const file of walk(dir)) {
    const src = stripComments(fs.readFileSync(file, 'utf8'));
    for (const re of PATTERNS) {
      for (const m of src.matchAll(re)) {
        let rel = m[1];
        // Array-of-segments capture: "'gaming', 'log'" -> "gaming/log"
        if (rel.includes("'")) rel = rel.split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean).join('/');
        if (!rel || rel.startsWith('.') || rel.endsWith('.mjs') || rel.includes('${')) continue;
        if (!expected.has(rel)) expected.set(rel, new Set());
        expected.get(rel).add(file);

        const mode = modeOf(m[0]);
        if (mode) {
          const line = src.slice(0, m.index).split('\n').length;
          collectedSites.push({ file, line, subpath: rel, mode });
        }
      }
    }
  }
}

const onDisk = (rel) => ['', '.yml', '.yaml'].some((ext) => fs.existsSync(path.join(HH, rel + ext)));
/**
 * Did this path hold data before the reorganization? `_deleteme` is the record.
 *
 * Matched by SUBPATH, not by name. A first-segment match is far too loose:
 * `school/captures` would match the preserved `household-apps-school` tree and
 * be reported as lost data when that subdirectory never existed. So this looks
 * for the actual tail — `<preserved tree>/captures` — and for the whole
 * relative path, and requires a real file underneath.
 */
const hasFileUnder = (dir) => {
  if (!fs.existsSync(dir)) return false;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
      if (e.isDirectory()) stack.push(path.join(cur, e.name));
      else return true;
    }
  }
  return false;
};
const wasPreserved = (rel) => {
  if (!fs.existsSync(DELETED)) return false;
  const tail = rel.split('/').slice(1).join('/');
  return fs.readdirSync(DELETED).some((d) => {
    const base = path.join(DELETED, d);
    return hasFileUnder(path.join(base, rel))
      || (tail && hasFileUnder(path.join(base, tail)));
  });
};

const movedAway = [];
const neverUsed = [];
for (const [rel, files] of [...expected].sort()) {
  if (onDisk(rel)) continue;
  (wasPreserved(rel) ? movedAway : neverUsed).push({ rel, files: [...files] });
}

// Reverse sweep: a domain on disk that no code mentions is orphaned data.
const orphans = [];
if (fs.existsSync(HH)) {
  const src = SCAN_DIRS.flatMap((d) => walk(d)).map((f) => stripComments(fs.readFileSync(f, 'utf8'))).join('\n');
  for (const entry of fs.readdirSync(HH)) {
    const name = entry.replace(/\.ya?ml$/, '');
    if (NOT_DOMAINS.has(name)) continue;
    const re = new RegExp(`['"\`]${name}(?:[/'"\`])|'${name}'\\s*[,)]`);
    if (!re.test(src)) orphans.push(entry);
  }
}

const line = (s) => process.stdout.write(`${s}\n`);
line(`household paths resolved by code: ${expected.size}`);
line(`  present on disk:  ${expected.size - movedAway.length - neverUsed.length}`);
line(`  never written yet: ${neverUsed.length}   (lazily created — not a fault)`);
line(`  MOVED AWAY:        ${movedAway.length}`);
line(`orphaned on disk (data with no reader): ${orphans.length}`);

if (neverUsed.length) {
  line('\nnever written yet — the store creates these on first use:');
  for (const { rel } of neverUsed) line(`  ${rel}`);
}
if (movedAway.length) {
  line('\nMOVED AWAY — code expects a path that used to hold data:');
  for (const { rel, files } of movedAway) line(`  ${rel}\n      ${files.join('\n      ')}`);
}
if (orphans.length) {
  line('\nORPHANED — data on disk that no code names:');
  for (const o of orphans) line(`  household/${o}`);
}

const splits = findWriterReaderSplits(collectedSites);
if (splits.length > 0) {
  console.log('\nWRITER/READER SPLIT — one half of a domain writes where the other never reads:');
  for (const s of splits) {
    const role = s.writers.length ? `written by ${s.writers.join(', ')}` : `read by ${s.readers.join(', ')}`;
    console.log(`  ${s.subpath} — ${role}`);
  }
  process.exitCode = 1;
} else {
  console.log('no writer/reader splits');
}

const bad = movedAway.length + orphans.length + splits.length;
line(bad === 0 ? '\nOK — every contract resolves, nothing orphaned' : `\nFAILED — ${bad} contract problem(s)`);
process.exit(bad === 0 ? 0 : 1);

}
