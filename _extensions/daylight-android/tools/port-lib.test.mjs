import test from 'node:test';
import assert from 'node:assert/strict';
import { compare, judge, normalize, sameLine } from './port-lib.mjs';

const SOURCE = `package net.example.old;

import java.util.List;

final class Probe {
    static int count(List<String> l) { return l.size(); }
    int twice(int n) { return n * 2; }
}
`;

test('package, imports, blank lines and trailing space are set aside', () => {
  const ported = SOURCE.replace('package net.example.old;', 'package net.example.fresh;')
    .replace('import java.util.List;', 'import java.util.List;\nimport java.util.Map;')
    .replace('final class Probe {', 'final class Probe {   ');
  assert.equal(compare(normalize(SOURCE), normalize(ported)).differing, 0);
});

test('a recorded rename is applied to the source before comparing', () => {
  const ported = SOURCE.replaceAll('Probe', 'Gauge');
  assert.equal(compare(normalize(SOURCE, ['Probe=Gauge']), normalize(ported)).differing, 0);
  assert.equal(compare(normalize(SOURCE), normalize(ported)).differing, 1);
});

test('a declaration made public is the one change a move may carry', () => {
  assert.equal(sameLine('final class Probe {', 'public final class Probe {'), true);
  assert.equal(sameLine('    static int count() {', '    public static int count() {'), true);
});

test('a public taken away, or one moved inside the line, is a change', () => {
  assert.equal(sameLine('public final class Probe {', 'final class Probe {'), false);
  assert.equal(sameLine('    static int count() {', '    static public int count() {'), false);
  assert.equal(sameLine('    return a;', '    return b;'), false);
  // The old check stripped the word everywhere, so these two lines compared equal.
  assert.equal(sameLine('    log("is public now");', '    log("is now");'), false);
});

test('a changed body is counted and the first changed source line is named', () => {
  const ported = SOURCE.replace('return n * 2;', 'return n * 3;');
  const r = compare(normalize(SOURCE), normalize(ported));
  assert.equal(r.differing, 1);
  assert.match(r.first, /twice/);
});

test('added or removed lines are counted', () => {
  const ported = SOURCE.replace('}\n', '    int extra() { return 0; }\n}\n');
  assert.ok(compare(normalize(SOURCE), normalize(ported)).differing > 0);
});

test('a move that differs fails', () => {
  assert.deepEqual(judge('move', 0), { ok: true });
  assert.equal(judge('move', 3).ok, false);
});

test('an adapt that is identical to its source fails, so the label stays true', () => {
  assert.deepEqual(judge('adapt', 12), { ok: true });
  const identical = judge('adapt', 0);
  assert.equal(identical.ok, false);
  assert.match(identical.why, /label it move/);
});

test('a mode that is neither is refused', () => {
  assert.equal(judge('copy', 0).ok, false);
});
