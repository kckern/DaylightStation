#!/usr/bin/env node
// Compares every ported file with its source in the old project.
// "move" rows must be identical once package/import lines and the recorded class
// renames are set aside; the one further allowance is a declaration made `public`.
// "adapt" rows are reported, and must really differ: an adapt row that is identical
// to its source fails, so the labels stay true. A source that changed after the port
// shows up here, so a fix made to an old helper during the port is not lost.
// The Gradle build runs this (the root project's portCheck task, part of check).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compare, judge, normalize } from './port-lib.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const rows = readFileSync(join(repo, '_extensions/daylight-android/tools/port-map.tsv'), 'utf8')
  .split('\n').filter(Boolean).map((l) => l.split('\t'));

let failed = 0;
for (const [mode, src, dest, renameField = ''] of rows) {
  const renames = renameField.split(' ').filter((r) => r.includes('='));
  const a = normalize(readFileSync(join(repo, src), 'utf8'), renames);
  const b = normalize(readFileSync(join(repo, dest), 'utf8'), []);
  const { differing, first } = compare(a, b);
  const verdict = judge(mode, differing);
  if (!verdict.ok) {
    failed++;
    console.error(`✗ ${dest}: ${verdict.why}${differing ? ` (${src}, near: ${first})` : ` (${src})`}`);
  } else if (mode === 'adapt') {
    console.log(`~ ${dest}: adapted, ${differing} lines differ from ${src}`);
  }
}
const moved = rows.filter((r) => r[0] === 'move').length;
console.log(failed ? `✗ ${failed} row(s) of port-map.tsv are wrong` : `✓ ${moved} moved files match their sources, ${rows.length - moved} adapted files differ from theirs`);
process.exit(failed ? 1 : 0);
