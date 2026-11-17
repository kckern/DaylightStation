// Anti-slop UI gate (design-system spec, Tier 1). Baseline-style like
// audit-layer-imports.mjs: existing violations don't block, growth does.
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOTS = [
  'frontend/src/Apps',
  'frontend/src/modules/Health',
  'frontend/src/modules/Life',
  'frontend/src/modules/Auto',
  'frontend/src/modules/Media',
  'frontend/src/lib/ui',
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
    re: /var\(--ds-[a-z-]+/g,
    files: /\.(scss|css|jsx|js)$/,
    custom: 'checkTokenManifest',
  },
];

// Manifest of legal --ds-* names, derived from the token contract. Kept as a
// literal list here (scripts can't import frontend ESM with JSX deps): update
// it when tokens.mjs changes — the tokens test pins the roles, this pins usage.
const DS_TOKEN_NAMES = new Set([
  '--ds-background', '--ds-surface', '--ds-surface-alt', '--ds-border',
  '--ds-text-high', '--ds-text-mid', '--ds-text-low',
  '--ds-success', '--ds-warning', '--ds-danger', '--ds-info', '--ds-live',
  '--ds-motion-fast', '--ds-motion-base', '--ds-motion-reveal', '--ds-motion-easing',
  '--ds-accent',
]);

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
        for (const m of line.matchAll(/var\((--ds-[a-z-]+)/g)) {
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

function main() {
  const baselinePath = 'scripts/audit-ui-tokens.baseline.json';
  const baseline = fs.existsSync(baselinePath)
    ? JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
    : {};

  const allHits = [];
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      if (EXEMPT.some((re) => re.test(file))) continue;
      if (!/\.(scss|css|jsx|js)$/.test(file)) continue;
      allHits.push(...scanSource(file, fs.readFileSync(file, 'utf8')));
    }
  }

  const counts = {};
  for (const h of allHits) counts[h.rule] = (counts[h.rule] || 0) + 1;

  let failed = false;
  for (const rule of RULES.map((r) => r.rule)) {
    const n = counts[rule] || 0;
    const base = baseline[rule] ?? 0;
    const ok = n <= base;
    if (!ok) failed = true;
    console.log(`${rule.padEnd(20)} ${String(n).padStart(4)} (baseline ${base}) ${ok ? 'ok' : 'FAIL'}`);
    if (!ok) {
      for (const h of allHits.filter((x) => x.rule === rule).slice(0, 20)) {
        console.log(`  ${h.file}:${h.line}`);
      }
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
