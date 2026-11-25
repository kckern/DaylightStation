// Anti-slop UI gate (design-system spec, Tier 1). Baseline-style like
// audit-layer-imports.mjs: existing violations don't block, growth does.
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

export const ROOTS = [
  'frontend/src/Apps',
  'frontend/src/lib/ui',
  'frontend/src/modules/Admin',
  '__app_modules/household/home/browser',
  '__app_modules/wellness/health/browser',
  '__app_modules/household/auto/browser',
  '__app_modules/personal/life/browser',
  '__app_modules/media/feed/browser',
  '__app_modules/media/media/browser',
  '__app_modules/money/finance/browser',
];
const SCHOOL_ROOT = '__app_modules/learning/school/browser';
const STRICT_SCHOOL = /^(portal|runtime|activities)\//;
const EXEMPT = [/frontend\/src\/lib\/theme\//, /\.test\./, /node_modules/];

const RULES = [
  {
    rule: 'raw-color',
    // hex colors, rgb()/rgba()/hsl() literals — in style-bearing lines
    re: /(#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\()/,
    files: /\.(scss|css|jsx|js)$/,
    exemptLine: /data-color|--ds-|--mantine-/,
  },
  {
    rule: 'raw-motion',
    re: /(transition:[^;]*\b\d+m?s\b|animation:[^;]*\b\d+m?s\b|@keyframes)/,
    files: /\.(scss|css)$/,
    exemptLine: /--ds-motion/,
    exemptFile: /lib\/ui\/ds\.scss$/, // the DS sheet defines the shared keyframes
  },
  {
    rule: 'raw-keydown',
    re: /addEventListener\(\s*['"]keydown['"]/,
    files: /\.(jsx|js)$/,
    exemptFile: /frontend\/src\/lib\//,
  },
  {
    rule: 'native-control',
    re: /<(button|select)\b/,
    files: /\.jsx$/,
    exemptFile: /frontend\/src\/lib\/ui\/|frontend\/src\/dev\//,
  },
  {
    rule: 'undefined-token',
    // any var(--ds-*) not in the manifest — silent fallback to `inherit`
    re: /var\((--ds-[a-z0-9-]+)/g,
    files: /\.(scss|css|jsx|js)$/,
    custom: 'checkTokenManifest',
  },
];

import { dsCssVars } from '../frontend/src/lib/theme/tokens.mjs';

const DS_TOKEN_NAMES = new Set(Object.keys(dsCssVars()));

export function scanSource(filePath, source, { strict = false } = {}) {
  const hits = [];
  const original = source.split('\n');
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, ' '));
  const lines = clean.split('\n');
  for (const rule of RULES) {
    if (!rule.files.test(filePath)) continue;
    if (rule.exemptFile && rule.exemptFile.test(filePath)) continue;
    // A fresh, always-global clone of the rule regex: avoids the /g-flag
    // lastIndex statefulness trap (a shared stateful regex tested repeatedly
    // across lines silently skips matches), and lets one line register a hit
    // per match rather than collapsing to a single hit when several
    // violations share a line (e.g. `transition: …; } @keyframes …`).
    const globalRe = new RegExp(rule.re.source, rule.re.flags.includes('g') ? rule.re.flags : `${rule.re.flags}g`);
    if (rule.rule === 'raw-keydown') {
      const uncommented = clean.replace(/(^|\n)(\s*\/\/[^\n]*)/g, (_, prefix, comment) => prefix + ' '.repeat(comment.length));
      for (const match of uncommented.matchAll(globalRe)) {
        hits.push({ rule: rule.rule, file: filePath, line: uncommented.slice(0, match.index).split('\n').length });
      }
      continue;
    }
    lines.forEach((line, i) => {
      if (/^\s*\/\//.test(line)) return;
      if (rule.custom === 'checkTokenManifest') {
        for (const m of line.matchAll(globalRe)) {
          if (!DS_TOKEN_NAMES.has(m[1])) {
            hits.push({ rule: rule.rule, file: filePath, line: i + 1, token: m[1] });
          }
        }
        return;
      }
      if (rule.rule === 'raw-color' && /data-art/.test(original[i])) return;
      if (rule.exemptLine && !(strict && rule.rule === 'raw-color') && rule.exemptLine.test(original[i])) return;
      for (const _m of line.matchAll(globalRe)) {
        hits.push({ rule: rule.rule, file: filePath, line: i + 1 });
      }
    });
  }
  return hits;
}

export function scanSchoolSource(relative, source) {
  return scanSource(`${SCHOOL_ROOT}/${relative}`, source, { strict: STRICT_SCHOOL.test(relative) })
    .filter(hit => !(relative === 'portal/useSchoolCommands.js' && hit.rule === 'raw-keydown'
      && /^\s*window\.addEventListener\(\s*['"]keydown['"],\s*dispatch\s*\);?\s*$/.test(source.split('\n')[hit.line - 1])));
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const RULE_NAMES = RULES.map((r) => r.rule);

function rootCount(counts, root, rule) {
  return counts[root]?.[rule] ?? 0;
}

// Pure: compare per-root counts to the per-root baseline. Growth fails;
// a count below baseline is reported as ratchetable.
export function compareToBaseline(counts, baseline) {
  const lines = [];
  let failed = false;
  const roots = new Set([...Object.keys(counts), ...Object.keys(baseline)]);
  for (const root of roots) {
    for (const rule of RULE_NAMES) {
      const n = rootCount(counts, root, rule);
      const base = rootCount(baseline, root, rule);
      if (n > base) {
        failed = true;
        lines.push(`${root} ${rule} ${n} (baseline ${base}) FAIL`);
      } else if (n < base) {
        lines.push(`${root} ${rule} ${n} (baseline ${base}) can ratchet down`);
      }
    }
  }
  return { failed, lines };
}

const isNumber = (v) => typeof v === 'number';

// A genuine old-shape file: non-empty, every top-level value a number, every
// key one of the rule names. Anything else is never migrated.
const isOldFlatShape = (b) => {
  if (!b || typeof b !== 'object') return false;
  const entries = Object.entries(b);
  return entries.length > 0 && entries.every(([k, v]) => isNumber(v) && RULE_NAMES.includes(k));
};

// Pure: decide whether --write-baseline may proceed. `existing` is null when
// the file is missing.
export function planBaselineWrite(counts, existing, { addRoot = null, initBaseline = false } = {}) {
  const refuse = (...errors) => ({ ok: false, migrated: false, errors });
  if (existing === null || existing === undefined) {
    return initBaseline
      ? { ok: true, migrated: false, errors: [] }
      : refuse('baseline file is missing; run with --init-baseline to create it');
  }
  if (initBaseline) return refuse('--init-baseline only works when no baseline file exists');
  if (isOldFlatShape(existing)) return { ok: true, migrated: true, errors: [] };
  if (typeof existing !== 'object' || Object.keys(existing).length === 0) {
    return refuse('baseline is empty; refusing to treat it as a migration (use --init-baseline only when the file is missing)');
  }
  const stray = Object.entries(existing).filter(([, v]) => !v || typeof v !== 'object');
  if (stray.length) {
    return refuse(...stray.map(([k, v]) => `baseline has a non-root entry "${k}": ${JSON.stringify(v)}; refusing to write over a malformed file`));
  }
  const errors = [];
  for (const root of Object.keys(counts)) {
    if (!(root in existing)) {
      if (addRoot !== root) errors.push(`${root} is not in the baseline; add it deliberately with --add-root ${root}`);
      continue;
    }
    for (const rule of RULE_NAMES) {
      const n = rootCount(counts, root, rule);
      const base = rootCount(existing, root, rule);
      if (n > base) errors.push(`${root} ${rule}: ${n} > baseline ${base}`);
    }
  }
  if (addRoot && (!(addRoot in counts) || addRoot in existing)) {
    errors.push(`--add-root ${addRoot}: not a new root in ROOTS`);
  }
  return { ok: errors.length === 0, migrated: false, errors };
}

function rootOf(file, roots = ROOTS) {
  return roots.find((r) => file === r || file.startsWith(`${r}/`));
}

// Pure: bucket hits per root; hits under no root are ignored.
export function bucketCounts(hits, roots) {
  const counts = {};
  for (const root of roots) counts[root] = Object.fromEntries(RULE_NAMES.map((r) => [r, 0]));
  for (const h of hits) {
    const root = rootOf(h.file, roots);
    if (root) counts[root][h.rule] += 1;
  }
  return counts;
}

function main() {
  const baselinePath = 'scripts/audit-ui-tokens.baseline.json';
  const baselineMissing = !fs.existsSync(baselinePath);
  const baseline = baselineMissing ? {} : JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const argAfter = (flag) => {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] ?? null : null;
  };

  const allHits = [];
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      if (EXEMPT.some((re) => re.test(file))) continue;
      if (!/\.(scss|css|jsx|js)$/.test(file)) continue;
      allHits.push(...scanSource(file, fs.readFileSync(file, 'utf8')));
    }
  }

  const counts = bucketCounts(allHits, ROOTS);

  if (process.argv.includes('--write-baseline') || process.argv.includes('--init-baseline')) {
    const plan = planBaselineWrite(counts, baselineMissing ? null : baseline, {
      addRoot: argAfter('--add-root'),
      initBaseline: process.argv.includes('--init-baseline'),
    });
    if (!plan.ok) {
      console.log('Refusing to write baseline:');
      plan.errors.forEach((e) => console.log(`  ${e}`));
      process.exit(1);
    }
    if (plan.migrated) console.log('Old flat baseline shape detected: migrating to per-root shape (one-time exception).');
    const dropped = Object.keys(baseline).filter((r) => !ROOTS.includes(r) && !plan.migrated);
    if (dropped.length) console.log(`Note: dropping baseline roots no longer in ROOTS: ${dropped.join(', ')}`);
    fs.writeFileSync(baselinePath, `${JSON.stringify(counts, null, 2)}\n`);
    console.log(`Wrote ${baselinePath}`);
    process.exit(0);
  }

  for (const root of ROOTS) {
    if (!fs.existsSync(root)) console.log(`WARNING: root does not exist on disk: ${root}`);
  }
  const flat = isOldFlatShape(baseline);
  const cmp = compareToBaseline(counts, flat ? {} : baseline);
  let failed = cmp.failed;
  if (flat) console.log('Baseline is in the old flat shape; run with --write-baseline once to migrate.');
  for (const root of ROOTS) {
    const summary = RULE_NAMES.map((r) => `${r}=${counts[root][r]}`).join(' ');
    console.log(`${root.padEnd(48)} ${summary}`);
  }
  cmp.lines.forEach((l) => console.log(l));
  if (cmp.failed) {
    for (const h of allHits) {
      const n = counts[rootOf(h.file)][h.rule];
      if (n > rootCount(baseline, rootOf(h.file), h.rule)) console.log(`  ${h.rule} ${h.file}:${h.line}`);
    }
  }
  // School is scoped separately: the historical global allowance never grows
  // to absorb a newly covered owner. Each legacy file can only spend its own
  // reviewed debt; portal/runtime/activity mechanisms always have a zero cap.
  const schoolBaselinePath = 'scripts/audit-ui-school.baseline.json';
  const schoolBaseline = fs.existsSync(schoolBaselinePath) ? JSON.parse(fs.readFileSync(schoolBaselinePath, 'utf8')).files ?? {} : {};
  let schoolHits = 0;
  for (const file of walk(SCHOOL_ROOT)) {
    if (EXEMPT.some(re => re.test(file)) || !/\.(scss|css|jsx|js)$/.test(file)) continue;
    const relative = file.slice(SCHOOL_ROOT.length + 1);
    const hits = scanSchoolSource(relative, fs.readFileSync(file, 'utf8'));
    schoolHits += hits.length;
    for (const rule of RULES.map(item => item.rule)) {
      const matching = hits.filter(hit => hit.rule === rule);
      const cap = STRICT_SCHOOL.test(relative) ? 0 : schoolBaseline[relative]?.[rule] ?? 0;
      if (matching.length <= cap) continue;
      failed = true;
      console.log(`School ${rule} FAIL ${relative}: ${matching.length} (baseline ${cap})`);
      matching.slice(0, 5).forEach(hit => console.log(`  ${hit.file}:${hit.line}`));
    }
  }
  console.log(`School scoped guard: ${schoolHits} reviewed legacy hits; new mechanisms cap 0`);
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] === url.fileURLToPath(import.meta.url)) main();
