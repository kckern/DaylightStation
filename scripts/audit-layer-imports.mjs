#!/usr/bin/env node
// scripts/audit-layer-imports.mjs
// Layer-import ratchet. Scans backend/src for forbidden import patterns per
// docs/reference/core/layers-of-abstraction/. Compares counts to
// scripts/audit-baseline.json; exits 1 if any rule's count INCREASED.
// Usage:
//   node scripts/audit-layer-imports.mjs             # check against baseline
//   node scripts/audit-layer-imports.mjs --update    # rewrite baseline (only after a task legitimately lowers counts)
//   node scripts/audit-layer-imports.mjs --list=<rule>  # print offending file:line for one rule
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const IMPORT_RE = /^\s*(?:import\b[^'"]*|export\b[^'"]*from\s*)['"]([^'"]+)['"]/;

// exempt: composition root (bootstrap) — the one sanctioned cross-layer zone
const isCompositionRoot = (f) =>
  f.includes('0_system/bootstrap') || f.endsWith('0_system/bootstrap.mjs') ||
  f.includes('5_composition/'); // future home (Task P2.7)
const isTest = (f) => f.includes('__tests__') || f.endsWith('.test.mjs');

export const RULES = [
  { rule: 'system-no-upward', layer: '0_system/', bad: s => /^#(domains|adapters|apps|applications|api|rendering)\//.test(s), exempt: isCompositionRoot },
  { rule: 'domains-no-adapters', layer: '2_domains/', bad: s => /^#(adapters|apps|applications|api|system|rendering)\//.test(s) },
  { rule: 'domains-no-node-io', layer: '2_domains/', bad: s => /^(node:)?(fs|fs\/promises|path|child_process)$/.test(s) },
  { rule: 'apps-no-adapters', layer: '3_applications/', bad: s => /^#adapters\//.test(s) || /1_adapters\//.test(s) },
  { rule: 'apps-no-config-internals', layer: '3_applications/', bad: s => /^#system\/config\//.test(s) },
  { rule: 'apps-no-fs', layer: '3_applications/', bad: s => /^(node:)?(fs|fs\/promises|child_process)$/.test(s) },
  { rule: 'apps-no-fileio', layer: '3_applications/', bad: s => /#system\/utils\/FileIO\.mjs$/.test(s) },
  { rule: 'adapters-no-config-singleton', layer: '1_adapters/', bad: s => /^#system\/config\//.test(s) },
  { rule: 'adapters-no-rendering', layer: '1_adapters/', bad: s => /^#rendering\//.test(s) },
  { rule: 'adapters-no-cross-adapter', layer: '1_adapters/', bad: s => /^#adapters\//.test(s) },
  { rule: 'rendering-no-adapters-apps', layer: '1_rendering/', bad: s => /^#(adapters|apps|applications)\//.test(s) },
  { rule: 'api-no-adapters', layer: '4_api/', bad: s => /^#adapters\//.test(s) || /1_adapters\//.test(s) },
  { rule: 'api-no-apps', layer: '4_api/', bad: s => /^#(apps|applications)\//.test(s) || /3_applications\//.test(s) },
  { rule: 'api-no-domains', layer: '4_api/', bad: s => /^#domains\//.test(s) || /2_domains\//.test(s) },
  { rule: 'api-no-config', layer: '4_api/', bad: s => /^#system\/config\//.test(s) },
  { rule: 'no-applications-alias', layer: 'backend/src/', bad: s => /^#applications\//.test(s) },
  { rule: 'no-deep-relative-layer-cross', layer: 'backend/src/', bad: s => /^(\.\.\/){3,}.*(0_system|1_adapters|1_rendering|2_domains|3_applications|4_api)\//.test(s) },
];

// Content-based counters (count string occurrences, not imports). Ratcheted
// alongside RULES against the same baseline.
export const CONTENT_RULES = [
  { rule: 'api-handrolled-500', layer: '4_api/', re: /res\.status\(500\)/ },
  { rule: 'apps-success-false', layer: '3_applications/', re: /\{\s*success:\s*false/ },
];

export function scanContent(filePath, content) {
  const out = [];
  const lines = content.split('\n');
  for (const r of CONTENT_RULES) {
    if (!filePath.includes(r.layer)) continue;
    lines.forEach((line, i) => {
      if (r.re.test(line)) out.push({ rule: r.rule, file: filePath, line: i + 1, spec: line.trim() });
    });
  }
  return out;
}

export function scanViolations(filePath, content) {
  const out = [];
  const lines = content.split('\n');
  for (const r of RULES) {
    if (!filePath.includes(r.layer)) continue;
    if (r.exempt?.(filePath)) continue;
    lines.forEach((line, i) => {
      const m = line.match(IMPORT_RE);
      if (m && r.bad(m[1])) out.push({ rule: r.rule, file: filePath, line: i + 1, spec: m[1] });
    });
  }
  return out;
}

function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (p.endsWith('.mjs') && !isTest(p)) acc.push(p);
  }
  return acc;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const files = walk('backend/src');
  const all = files.flatMap(f => scanViolations(f, readFileSync(f, 'utf8')));
  const allContent = files.flatMap(f => scanContent(f, readFileSync(f, 'utf8')));
  const counts = {};
  for (const r of RULES) counts[r.rule] = all.filter(v => v.rule === r.rule).length;
  for (const r of CONTENT_RULES) counts[r.rule] = allContent.filter(v => v.rule === r.rule).length;

  const listArg = args.find(a => a.startsWith('--list='));
  if (listArg) {
    const rule = listArg.split('=')[1];
    for (const v of [...all, ...allContent].filter(v => v.rule === rule)) console.log(`${v.file}:${v.line}  ${v.spec}`);
    process.exit(0);
  }
  const baselinePath = 'scripts/audit-baseline.json';
  if (args.includes('--update') || !existsSync(baselinePath)) {
    writeFileSync(baselinePath, JSON.stringify(counts, null, 2) + '\n');
    console.log('Baseline written:', counts);
    process.exit(0);
  }
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  let regressed = false;
  for (const [rule, n] of Object.entries(counts)) {
    const base = baseline[rule] ?? 0;
    const mark = n > base ? 'REGRESSION' : n < base ? 'improved' : 'ok';
    if (n > base) regressed = true;
    console.log(`${rule.padEnd(36)} ${String(n).padStart(4)} (baseline ${base}) ${mark}`);
  }
  process.exit(regressed ? 1 : 0);
}
