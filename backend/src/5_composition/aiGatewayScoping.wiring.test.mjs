/**
 * Guard: no AI spend leaves composition unattributed. Instead of checking the
 * keys a gateway is handed out under (which misses positional arguments,
 * spreads and renamed keys), this checks every reference to a ROOT — an
 * unscoped provider gateway — in app.mjs and 5_composition/. Each reference
 * must be one of:
 *
 *   - its declaration or an assignment to it;
 *   - a truthiness / null check (`if (root)`, `!root`, `root ?`, `root &&`,
 *     `root.isConfigured()`);
 *   - the first argument of `scopedGateway(root, { app… })` or the receiver of
 *     `root.scoped({ app… })`, with literal tags that name an `app`;
 *   - a `return` from the factory that constructs it (a producer; its caller's
 *     binding becomes the root there and is checked at that site).
 *
 * References inside a function that takes the same name as a parameter (or
 * destructures it from its config) are that function's own binding, not the
 * root, and are skipped. Roots are the app.mjs bindings named below, anything
 * assigned from a provider adapter constructor, and the adapter-registry
 * lookups for 'ai' / 'decision' plus the hardware TTS adapter.
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

const NAMED_ROOTS = ['sharedAiGateway', 'decisionGateway', 'aiAnthropicAdapter', 'voiceTranscriptionService'];
const PROVIDER_CTOR = /\b([A-Za-z_$][\w$]*)\s*=\s*new\s+(?:OpenAIAdapter|AnthropicAdapter|JevAdapter|OpenAITTSAdapter|TelegramVoiceTranscriptionService)\s*\(/g;
const MEMBER_ROOTS = [
  /householdAdapters\s*\??\.\s*get\s*\??\.?\s*\(\s*'(?:ai|decision)'\s*\)/g,
  /hardwareAdapters\s*\??\.\s*ttsAdapter\b/g,
];

/** Blank out comments and string contents (quotes kept), preserving offsets and newlines. */
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
    } else if (text[i] === '`') {
      // template literals: keep ${…} code, blank the text
      out += '`';
      i += 1;
      while (i < text.length && text[i] !== '`') {
        if (text[i] === '\\') { out += '  '; i += 2; continue; }
        if (text[i] === '$' && text[i + 1] === '{') {
          let depth = 0;
          for (; i < text.length; i += 1) {
            out += text[i];
            if (text[i] === '{') depth += 1;
            else if (text[i] === '}') { depth -= 1; if (depth === 0) break; }
          }
          i += 1;
          continue;
        }
        out += text[i] === '\n' ? '\n' : 'x';
        i += 1;
      }
      out += '`';
    } else if (text[i] === '\'' || text[i] === '"') {
      const quote = text[i];
      let j = i + 1;
      let body = '';
      while (j < text.length && text[j] !== quote && text[j] !== '\n') {
        if (text[j] === '\\') { body += '  '; j += 2; continue; }
        body += text[j];
        j += 1;
      }
      // keep short literal tokens ('ai', 'decision') the member roots match on
      out += quote + (/^(ai|decision)$/.test(body) ? body : body.replace(/[^\n]/g, 'x')) + (text[j] ?? '');
      i = j;
    } else {
      out += text[i];
    }
  }
  return out;
}

/** Index of the bracket matching the one at `open`. */
function matchBracket(text, open) {
  const pairs = { '(': ')', '{': '}', '[': ']' };
  const close = pairs[text[open]];
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === text[open]) depth += 1;
    else if (text[i] === close) { depth -= 1; if (depth === 0) return i; }
  }
  return text.length;
}

/** [start, end) body ranges of functions that bind `name` themselves. */
function shadowRanges(text, name) {
  const ranges = [];
  const id = new RegExp(`(^|[^\\w$.])${name}(?![\\w$])`);
  // function f(…) { … } / (…) => { … } / name(…) { … } — parameter lists
  for (const m of text.matchAll(/\(/g)) {
    const close = matchBracket(text, m.index);
    const params = text.slice(m.index, close + 1);
    if (!id.test(params)) continue;
    const after = text.slice(close + 1, close + 8);
    const arrow = /^\s*=>\s*\{/.exec(after);
    const brace = /^\s*\{/.exec(after);
    const before = text.slice(Math.max(0, m.index - 40), m.index);
    const isFn = arrow || (brace && /(function\s*[\w$]*\s*|[\w$]+\s*)$/.test(before) && !/\b(if|for|while|switch|catch)\s*$/.test(before));
    if (!isFn) continue;
    const open = text.indexOf('{', close + 1);
    ranges.push([m.index, matchBracket(text, open)]); // the parameter list and the body
  }
  // const { …name… } = config; inside a function body → the rest of that body
  for (const m of text.matchAll(/\b(?:const|let)\s*\{/g)) {
    const open = m.index + m[0].length - 1;
    const close = matchBracket(text, open);
    if (!/^\s*=/.test(text.slice(close + 1)) || !id.test(text.slice(open, close + 1))) continue;
    // enclosing body: nearest unmatched `{` before
    let depth = 0;
    let start = -1;
    for (let i = m.index; i >= 0; i -= 1) {
      if (text[i] === '}') depth += 1;
      else if (text[i] === '{') { if (depth === 0) { start = i; break; } depth -= 1; }
    }
    if (start >= 0) ranges.push([close, matchBracket(text, start)]);
  }
  return ranges;
}

const TAGS_WITH_APP = String.raw`\{[^{}]*\bapp\s*:[^{}]*\}`;

/** Is the reference at [start, end) one of the allowed forms? */
function allowed(text, start, end) {
  const before = text.slice(Math.max(0, start - 200), start);
  const after = text.slice(end, end + 200);
  const lineStart = text.lastIndexOf('\n', start) + 1;
  const stmt = text.slice(lineStart, start);
  // declaration / assignment (to the root, or a member root on the right of one)
  if (/\b(?:let|const|var)\s+$/.test(before) || /^\s*=(?![=>])/.test(after)) return true;
  if (/^\s*(?:let|const|var)?\s*[\w$]+\s*=(?![=>])/.test(stmt) && NAMED_OR_BOUND.test(stmt.replace(/=.*$/, ''))) return true;
  // checks
  if (/!\s*$/.test(before) || /\bif\s*\(\s*$/.test(before) || /\bBoolean\(\s*$/.test(before)) return true;
  if (/^\s*(\?(?![.?])|&&)/.test(after)) return true;
  if (/^\s*\??\.\s*isConfigured\b/.test(after)) return true;
  // scoped with an app
  if (/\bscopedGateway\s*\(\s*$/.test(before) && new RegExp(String.raw`^\s*,\s*${TAGS_WITH_APP}`).test(after)) return true;
  if (new RegExp(String.raw`^\s*\??\.\s*scoped\s*(?:\?\.)?\s*\(\s*${TAGS_WITH_APP}`).test(after)) return true;
  // a producer's return
  if (/\breturn\s*(\{[^;]*)?$/.test(before.slice(before.lastIndexOf(';') + 1))) return true;
  return false;
}

let NAMED_OR_BOUND = /$^/;

export function offendersIn(raw, label, { named = [] } = {}) {
  const text = stripNoise(raw);
  const bound = [...text.matchAll(PROVIDER_CTOR)].map(m => m[1]);
  const names = [...new Set([...named, ...bound])];
  NAMED_OR_BOUND = names.length ? new RegExp(`\\b(${names.join('|')})\\b`) : /$^/;
  const found = [];
  const lineOf = (i) => text.slice(0, i).split('\n').length;
  for (const name of names) {
    const shadows = shadowRanges(text, name);
    for (const m of text.matchAll(new RegExp(`(^|[^\\w$.])(${name})(?![\\w$])`, 'g'))) {
      const start = m.index + m[1].length;
      const end = start + name.length;
      if (/^\s*:(?!:)/.test(text.slice(end)) && /[{,]\s*$/.test(text.slice(0, start))) continue; // an object key
      if (shadows.some(([a, b]) => start > a && start < b)) continue;
      if (!allowed(text, start, end)) found.push(`${label}:${lineOf(start)} ${name}`);
    }
  }
  for (const re of MEMBER_ROOTS) {
    for (const m of text.matchAll(re)) {
      if (!allowed(text, m.index, m.index + m[0].length)) found.push(`${label}:${lineOf(m.index)} ${m[0].replace(/\s+/g, '')}`);
    }
  }
  return found;
}

function offenders() {
  return sources.flatMap(file => offendersIn(fs.readFileSync(file, 'utf8'), path.relative(srcRoot, file),
    { named: file.endsWith('app.mjs') ? NAMED_ROOTS : [] }));
}

describe('every reference to an unscoped AI gateway is a declaration, a check, or a scope with an app', () => {
  it('catches every way of handing a root out (self-test)', () => {
    const sample = [
      "let sharedAiGateway = makeAdapter();",                                  // 1 declaration
      "if (!sharedAiGateway) warn();",                                         // 2 check
      "const health = scopedGateway(sharedAiGateway, { app: 'health' });",    // 3 ok
      "a({ aiGateway: sharedAiGateway });",                                    // 4 bare hand-off
      "b(sharedAiGateway, 1);",                                                // 5 positional
      "c(...[sharedAiGateway]);",                                              // 6 spread
      "d({ aiGateway: flag ? sharedAiGateway : null });",                     // 7 ternary branch
      "e(scopedGateway(sharedAiGateway, {}));",                                // 8 empty tags
      "f(sharedAiGateway.scoped({ feature: 'x' }));",                          // 9 tags without app
      "g(sharedAiGateway?.scoped({ app: 'school' }), sharedAiGateway?.isConfigured());", // 10 ok
      "const ok = sharedAiGateway ? 1 : 0;",                                   // 11 check
      "function h({ sharedAiGateway }) { return use(sharedAiGateway); }",      // 12 its own parameter
      "const tts = new OpenAITTSAdapter({}, {});",                             // 13 bound root
      "speak(tts);",                                                           // 14 bare
      "k(scopedGateway(householdAdapters.get('ai'), { app: 'x' }), householdAdapters.get('decision'));", // 15 member bare
    ].join('\n');
    expect(offendersIn(sample, 's', { named: ['sharedAiGateway'] }).map(o => o.split(' ')[0]).sort())
      .toEqual(['s:14', 's:15', 's:4', 's:5', 's:6', 's:7', 's:8', 's:9'].sort());
  });

  it('finds the roots it guards', () => {
    const app = stripNoise(fs.readFileSync(path.join(srcRoot, 'app.mjs'), 'utf8'));
    for (const name of NAMED_ROOTS) expect(app, name).toMatch(new RegExp(`\\blet\\s+${name}\\b`));
  });

  it('has no root reference outside the allowed forms', () => {
    expect(offenders()).toEqual([]);
  });
});
