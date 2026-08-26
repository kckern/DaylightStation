#!/usr/bin/env node
/**
 * Parse gate — every source file must actually parse, and no file may carry a
 * merge conflict marker.
 *
 * WHY THIS EXISTS. Twice on 2026-08-25 a file that could not parse shipped past
 * a fully green test run:
 *
 *   - a duplicate `}` closed a class early in `PianoCourseProgramLauncher.mjs`,
 *     stranding a private method outside it. Vitest reported 859 passed.
 *   - conflict markers were committed into `agenda.test.mjs` by a merge that
 *     reported a DIFFERENT file as the only conflict. Vitest reported
 *     "No test suite found", which reads as an absent file rather than a broken
 *     one; 18 tests silently stopped running.
 *
 * Both took under a second to find with a parser and neither was visible in a
 * pass/fail count. That is the whole gap this closes: a test runner answers
 * "did the assertions hold", and a file that never loaded has no assertions to
 * hold. The morning's outage was the same shape one layer up — a dead import
 * that failed to wire while 1283 unit tests stayed green.
 *
 * This is deliberately NOT a linter. It has no opinions about style and cannot
 * be argued with: either the file parses or the build is broken.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Directories that are never ours to judge: dependencies, build output, other
// checkouts, and the tree the household empties by hand.
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '_deleteme',
  '.claude', '.claire', '.worktrees', '.superpowers', 'playwright-report',
  'test-results', '.vite', '.cache', 'venv', '__pycache__',
  // Firmware build output. `pio run` drops a vendored Arduino/ESP-IDF tree in
  // here, so a host that has ever built an `_extensions/*/firmware` target
  // would otherwise have this gate grading Espressif's C — code we neither own
  // nor can fix, and whose failure would say nothing about this repo.
  '.pio',
]);

const PARSE_EXT = new Set(['.mjs', '.cjs', '.js', '.jsx', '.ts', '.tsx']);

// Conflict markers are scanned in a WIDER set than we parse: YAML and JSON
// carry household config and cannot parse-check here, but a marker in one is
// just as fatal. Markdown is deliberately excluded — `=======` is a legitimate
// setext heading rule, and docs in this repo discuss merges by name.
const MARKER_EXT = new Set([...PARSE_EXT, '.json', '.yml', '.yaml', '.scss', '.css', '.html']);

// Anchored and specific: a bare `=======` is too common in real prose and
// generated output to be evidence of anything on its own.
const MARKER = /^(?:<{7} |>{7} |\|{7} )/m;

const LOADER = { '.jsx': 'jsx', '.tsx': 'tsx', '.ts': 'ts' };

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // unreadable dir is not this gate's business
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

const failures = [];
let parsed = 0;
let scanned = 0;

for (const file of walk(ROOT)) {
  const ext = extname(file);
  if (!MARKER_EXT.has(ext)) continue;

  let source;
  try {
    if (statSync(file).size > 4 * 1024 * 1024) continue; // minified/vendored blob
    source = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  scanned += 1;

  const marker = MARKER.exec(source);
  if (marker) {
    const line = source.slice(0, marker.index).split('\n').length;
    failures.push({
      file: relative(ROOT, file),
      line,
      why: `merge conflict marker: ${marker[0].trim()}`,
    });
    continue; // a conflicted file will not parse either; one finding is enough
  }

  if (!PARSE_EXT.has(ext)) continue;
  try {
    // Parse only. No bundling, no resolution — an unresolvable import is a
    // different problem with a different owner (the boot-image guard).
    transformSync(source, {
      loader: LOADER[ext] ?? 'js',
      format: ext === '.cjs' ? 'cjs' : 'esm',
      sourcefile: file,
    });
    parsed += 1;
  } catch (error) {
    const [first] = error?.errors ?? [];
    failures.push({
      file: relative(ROOT, file),
      line: first?.location?.line ?? 0,
      why: first?.text ?? error?.message ?? 'unparseable',
    });
  }
}

if (failures.length) {
  console.error(`\nParse gate FAILED — ${failures.length} file(s) will not load:\n`);
  for (const f of failures) console.error(`  ${f.file}:${f.line}\n    ${f.why}`);
  console.error('\nA test run cannot see this: a file that never parses has no');
  console.error('assertions to fail, so it is reported as absent, not broken.\n');
  process.exit(1);
}

console.log(`Parse gate OK — ${parsed} parsed, ${scanned} scanned for conflict markers.`);
