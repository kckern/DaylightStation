/**
 * Guard: every MastraAdapter built by production composition code receives a
 * `usageRecorder`, so agent spend reaches the AI usage ledger. Scans the
 * composition root (5_composition/) and app.mjs; a new construction site that
 * forgets the recorder fails here with its file:line.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const compositionRoot = path.resolve(import.meta.dirname);
const srcRoot = path.resolve(compositionRoot, '..');

const sources = [
  ...fs.readdirSync(compositionRoot, { recursive: true })
    .filter(f => f.endsWith('.mjs') && !f.includes('.test.'))
    .map(f => path.join(compositionRoot, f)),
  path.join(srcRoot, 'app.mjs'),
];

/** The constructor call's argument text, found by balancing parentheses. */
function constructorArgs(text, openParenIndex) {
  let depth = 0;
  for (let i = openParenIndex; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(openParenIndex, i + 1);
    }
  }
  return text.slice(openParenIndex);
}

/** Top-level keys of the object literal passed in, ignoring nested objects/calls. */
function topLevelText(args) {
  let depth = 0;
  let out = '';
  for (const ch of args) {
    if ('({['.includes(ch)) depth += 1;
    if (depth <= 2) out += ch;
    if (')}]'.includes(ch)) depth -= 1;
  }
  return out;
}

describe('every MastraAdapter is built with a usage recorder', () => {
  it('finds construction sites to check', () => {
    const count = sources.reduce((n, file) =>
      n + [...fs.readFileSync(file, 'utf8').matchAll(/new MastraAdapter\(/g)].length, 0);
    expect(count).toBeGreaterThan(0);
  });

  it('passes usageRecorder at each construction site', () => {
    const missing = [];
    for (const file of sources) {
      const text = fs.readFileSync(file, 'utf8');
      for (const match of text.matchAll(/new MastraAdapter\(/g)) {
        const args = constructorArgs(text, match.index + match[0].length - 1);
        if (!/\busageRecorder\b/.test(topLevelText(args))) {
          missing.push(`${path.relative(srcRoot, file)}:${text.slice(0, match.index).split('\n').length}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
