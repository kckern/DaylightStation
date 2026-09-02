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
    re: /<(button|select)[\s>]/,
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

export function scanSource(filePath, source) {
  const hits = [];
  const lines = source.split('\n');
  for (const rule of RULES) {
    if (!rule.files.test(filePath)) continue;
    if (rule.exemptFile && rule.exemptFile.test(filePath)) continue;
    // A fresh, always-global clone of the rule regex: avoids the /g-flag
    // lastIndex statefulness trap (a shared stateful regex tested repeatedly
    // across lines silently skips matches), and lets one line register a hit
    // per match rather than collapsing to a single hit when several
    // violations share a line (e.g. `transition: …; } @keyframes …`).
    const globalRe = new RegExp(rule.re.source, rule.re.flags.includes('g') ? rule.re.flags : `${rule.re.flags}g`);
    lines.forEach((line, i) => {
      if (rule.custom === 'checkTokenManifest') {
        for (const m of line.matchAll(/var\((--ds-[a-z-]+)/g)) {
          if (!DS_TOKEN_NAMES.has(m[1])) {
            hits.push({ rule: rule.rule, file: filePath, line: i + 1, token: m[1] });
          }
        }
        return;
      }
      if (rule.exemptLine && rule.exemptLine.test(line)) return;
      for (const _m of line.matchAll(globalRe)) {
        hits.push({ rule: rule.rule, file: filePath, line: i + 1 });
      }
    });
  }
  return hits;
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
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] === url.fileURLToPath(import.meta.url)) main();
