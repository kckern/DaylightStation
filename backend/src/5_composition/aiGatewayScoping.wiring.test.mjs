/**
 * Guard: no bare shared AI gateway is handed to a consumer. Every value that
 * composition passes as an AI dependency must be a scoped view — a
 * `.scoped({ … })` / `scopedGateway(…)` expression, or an identifier assigned
 * from one — so its spend is attributed to an app in the AI usage ledger.
 *
 * Scans the composition root (5_composition/) and app.mjs. An identifier that
 * is never assigned in the file is a parameter handed in by a caller, which
 * this same scan checks at its own call site, so it passes through.
 * Offenders are listed as file:line.
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

const KEYS = ['aiGateway', 'openaiAdapter', 'transcriptionService', 'decisionGateway', 'speechGateway', 'openai', 'anthropic', 'anthropicAdapter', 'anthropicGateway'];
// `key: value`, or shorthand `{ key,` / `, key }` inside an object literal.
const KEY_RE = new RegExp(`(^|[{,\\s])(${KEYS.join('|')})\\s*(:(?!:)|(?=\\s*[,}]))`, 'g');
const SCOPED = /\bscoped(?:Gateway)?\s*(?:\?\.)?\s*\(/;

/** Blank out comments and string contents, keeping offsets and newlines. */
export function stripNoise(text) {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const two = text.slice(i, i + 2);
    if (two === '//') {
      while (i < text.length && text[i] !== '\n') { out += ' '; i += 1; }
      out += text[i] ?? '';
    } else if (two === '/*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop - 1;
    } else if (text[i] === '\'' || text[i] === '"' || text[i] === '`') {
      const quote = text[i];
      out += quote;
      i += 1;
      while (i < text.length && text[i] !== quote) {
        if (text[i] === '\\') { out += '  '; i += 2; continue; }
        out += text[i] === '\n' ? '\n' : 'x';
        i += 1;
      }
      out += quote;
    } else {
      out += text[i];
    }
  }
  return out;
}

/** The value expression starting at `start`, up to a depth-0 `,` `}` `)` `;`. */
function valueAt(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) {
      if (depth === 0) return text.slice(start, i);
      depth -= 1;
    } else if ((ch === ',' || ch === ';') && depth === 0) return text.slice(start, i);
  }
  return text.slice(start);
}

/** Right-hand sides of every `name = …` assignment of this identifier. */
function assignmentsOf(text, name) {
  const re = new RegExp(`(?:\\b(?:const|let|var)\\s+|[^.\\w$])${name}\\s*=(?![=>])`, 'g');
  return [...text.matchAll(re)].map(m => valueAt(text, m.index + m[0].length));
}

/** Split at depth-0 occurrences of any of `seps` (checked longest first). */
function splitTop(expr, seps) {
  const parts = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < expr.length; i += 1) {
    const ch = expr[i];
    if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) depth -= 1;
    else if (depth === 0) {
      const sep = seps.find(s => expr.startsWith(s, i) && !(s === '?' && (expr[i + 1] === '.' || expr[i + 1] === '?')));
      if (sep) { parts.push(expr.slice(last, i)); i += sep.length - 1; last = i + 1; }
    }
  }
  parts.push(expr.slice(last));
  return parts.map(p => p.trim());
}

/** The values an expression can hand over: both ternary branches, every `||`/`??` arm. */
function handedOver(expr) {
  const cond = splitTop(expr, ['?']);
  // `test ? a : b` hands over a or b; the test only reads config.
  const branches = cond.length > 1 ? splitTop(cond.slice(1).join('?'), [':']) : [expr];
  return branches.flatMap(b => splitTop(b, ['||', '??']));
}

function judge(text, expr) {
  const value = expr.trim();
  if (!value) return null;
  const bad = [];
  for (const arm of handedOver(value)) {
    if (!arm || /^(null|undefined|false|true|\d+|'[^']*'|"[^"]*"|`[^`]*`)$/.test(arm)) continue;
    if (arm.startsWith('{')) continue; // an object literal: code, not a gateway
    if (SCOPED.test(arm)) continue;
    const ident = /^[A-Za-z_$][\w$]*$/.exec(arm)?.[0];
    if (!ident) { bad.push(arm); continue; }
    const rhs = assignmentsOf(text, ident);
    if (rhs.length === 0) continue; // parameter: its caller is checked
    if (!rhs.every(r => SCOPED.test(r) || /^\s*(null|undefined)\s*$/.test(r))) bad.push(arm);
  }
  return bad.length ? bad.join(' | ') : null;
}

function offendersIn(raw, label) {
  const found = [];
  {
    const text = stripNoise(raw);
    for (const m of text.matchAll(KEY_RE)) {
      const key = m[2];
      const keyEnd = m.index + m[0].length;
      const shorthand = m[3] !== ':';
      // Skip destructuring (`const { aiGateway } = …`, `({ aiGateway }) =>`):
      // the object literal closes and is followed by `=` or `) =>` / `) {`.
      const literal = valueAt(text, keyEnd);
      const after = text.slice(keyEnd + literal.length).match(/^[\s\S]*?[}\)]\s*(\S{1,2})/);
      if (after && /^(=[^=>]|=$|=>|\{)/.test(after[1])) {
        // could still be a default parameter `{ aiGateway = null }` — no value to check
        continue;
      }
      const expr = shorthand ? key : literal;
      const problem = judge(text, expr);
      if (problem) {
        found.push(`${label}:${text.slice(0, m.index + m[1].length).split('\n').length} ${key}: ${problem.replace(/\s+/g, ' ').slice(0, 80)}`);
      }
    }
  }
  return found;
}

function offenders() {
  return sources.flatMap(file => offendersIn(fs.readFileSync(file, 'utf8'), path.relative(srcRoot, file)));
}

describe('every AI gateway composition hands out is a scoped view', () => {
  it('finds hand-off sites to check', () => {
    const text = sources.map(f => fs.readFileSync(f, 'utf8')).join('\n');
    expect((text.match(SCOPED.source ? new RegExp(SCOPED.source, 'g') : /x/g) || []).length).toBeGreaterThan(10);
  });

  it('catches bare hand-offs and accepts scoped ones (self-test)', () => {
    const sample = [
      "let sharedAiGateway = makeAdapter();",
      "const healthAi = sharedAiGateway.scoped({ app: 'health' });",
      "a({ aiGateway: sharedAiGateway });",                                  // bare
      "b({ aiGateway: healthAi });",                                         // assigned from scoped
      "c({ openaiAdapter: scopedGateway(sharedAiGateway, { app: 'x' }) });",
      "d({ decisionGateway });",                                             // parameter pass-through
      "e({ transcriptionService: container.getAIGateway() });",             // bare member call
      "f({ aiGateway: flag ? sharedAiGateway : null });",                   // bare in a branch
      "g({ aiGateway: flag ? healthAi : null, anthropic: 'ai' });",
      "function h({ aiGateway }) { return aiGateway; }",                    // destructuring
    ].join('\n');
    expect(offendersIn(sample, 'sample').map(o => o.split(' ')[0])).toEqual(['sample:3', 'sample:7', 'sample:8']);
  });

  it('has no bare gateway hand-off', () => {
    expect(offenders()).toEqual([]);
  });
});
