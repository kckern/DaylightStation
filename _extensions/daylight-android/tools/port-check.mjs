#!/usr/bin/env node
// Compares every ported file with its source in the old project.
// "move" rows must be identical once package/import lines, the recorded class
// renames and added `public` modifiers are set aside. "adapt" rows are reported.
// A source that changed after the port shows up here, so a fix made to an old
// helper during the port is not lost.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const rows = readFileSync(join(repo, '_extensions/daylight-android/tools/port-map.tsv'), 'utf8')
  .split('\n').filter(Boolean).map((l) => l.split('\t'));

const normalize = (text, renames) => {
  let t = text;
  for (const r of renames) {
    const [from, to] = r.split('=');
    t = t.replace(new RegExp(`\\b${from}\\b`, 'g'), to);
  }
  return t.split('\n')
    .filter((l) => !/^\s*(package|import)\s/.test(l))
    .map((l) => l.replace(/\bpublic /g, '').trimEnd())
    .filter((l) => l.length > 0);
};

let failed = 0;
for (const [mode, src, dest, renameField = ''] of rows) {
  const renames = renameField.split(' ').filter((r) => r.includes('='));
  const a = normalize(readFileSync(join(repo, src), 'utf8'), renames);
  const b = normalize(readFileSync(join(repo, dest), 'utf8'), []);
  const differing = Math.abs(a.length - b.length) + a.filter((l, i) => b[i] !== l).length;
  if (mode === 'move' && differing > 0) {
    failed++;
    const at = a.findIndex((l, i) => b[i] !== l);
    console.error(`✗ ${dest} differs from ${src} near: ${a[at] ?? '(end of file)'}`);
  } else if (mode === 'adapt') {
    console.log(`~ ${dest}: adapted, ${differing} lines differ from ${src}`);
  }
}
console.log(failed ? `✗ ${failed} moved file(s) differ` : `✓ ${rows.filter((r) => r[0] === 'move').length} moved files match their sources`);
process.exit(failed ? 1 : 0);
