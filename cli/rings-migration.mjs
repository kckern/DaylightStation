#!/usr/bin/env node
/**
 * rings-migration — rewrite stored fitness "coins" keys as "rings".
 *
 * Companion to docs/superpowers/specs/2026-08-26-rings-and-weekly-measures-design.md
 * (§6-§9). The code ships dual-read FIRST (backend ringSeries.mjs, frontend
 * buildSessionSummary/SessionSerializerV3), so this can run at any time
 * afterwards with the app live: a half-migrated archive is a supported state.
 *
 * ── THE HAZARD THIS SCRIPT EXISTS TO AVOID ────────────────────────────────
 *
 * 6,215 files under data/ contain the string "coin". Roughly HALF are
 * Shakespeare quiz content — The Merchant of Venice, "a risky bond", "caskets
 * and courtships". A word-level coin→ring sweep would silently rewrite the
 * children's literature curriculum, and it would surface months later inside a
 * quiz rather than here.
 *
 * So there are two independent guards, and neither is sufficient alone:
 *
 *   1. SCOPE. It refuses to run anywhere but the fitness log root (--root),
 *      and ALLOWED_ROOTS is a whitelist, not a suggestion.
 *   2. SHAPE. Every pattern is anchored to a YAML/JSON key boundary — a `:`
 *      or an exact camelCase token. None of them can match a bare "coin" in
 *      prose. See the tests in cli/rings-migration.test.mjs, which assert a
 *      Merchant-of-Venice fixture passes through byte-identical.
 *
 * Dry-run by default. `--apply` writes, and only after backing up.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Only these roots may ever be rewritten. */
const ALLOWED_ROOTS = [
  'data/household/fitness/log',
  'data/_backups/fitness-merge-20260622',
];

/**
 * Key-shape substitutions. Order matters only in that the flat-series pattern
 * must run before the bare-key one, or `global:coins:` would be seen as a bare
 * `coins:` at some indent and lose its namespace.
 */
const RULES = [
  // YAML: `    kckern:coins: '[[...]]'` and `    global:coins: ...`
  { name: 'yaml-flat-series', re: /^(\s*)([A-Za-z0-9_@#.-]+):coins:/gm, to: '$1$2:rings:' },
  // YAML: `  coins:` — bare key, with or without an inline value
  { name: 'yaml-bare-key', re: /^(\s*)coins:/gm, to: '$1rings:' },
  // Both formats: the camelCase token, quoted or not
  { name: 'total-camel', re: /\btotalCoins\b/g, to: 'totalRings' },
  // Both formats: the v2 namespaced cumulative metric
  { name: 'coins-total', re: /\bcoins_total\b/g, to: 'rings_total' },
  // JSON: `"kckern:coins":` and `"global:coins":`
  { name: 'json-flat-series', re: /"([A-Za-z0-9_@#.-]+):coins"/g, to: '"$1:rings"' },
  // JSON: `"coins":`
  { name: 'json-bare-key', re: /"coins"(\s*):/g, to: '"rings"$1:' },
];

function migrateText(text) {
  let out = text;
  const hits = {};
  for (const rule of RULES) {
    let n = 0;
    out = out.replace(rule.re, (...args) => {
      n += 1;
      // Rebuild from the capture groups the rule declared.
      return rule.to.replace(/\$(\d)/g, (_, d) => args[Number(d)] ?? '');
    });
    if (n) hits[rule.name] = n;
  }
  return { text: out, changed: out !== text, hits };
}

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      // Never descend into a backup we just made, or anything retired.
      if (e.name === '_deleteme' || e.name.startsWith('rings-migration-')) continue;
      walk(full, out);
    } else if (/\.(yml|yaml|json)$/i.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const rootArg = argv.includes('--root') ? argv[argv.indexOf('--root') + 1] : ALLOWED_ROOTS[0];
  const root = rootArg.replace(/\/+$/, '');

  if (!ALLOWED_ROOTS.includes(root)) {
    console.error(`refusing to run against '${root}'.`);
    console.error(`allowed roots: ${ALLOWED_ROOTS.join(', ')}`);
    console.error('this guard exists because data/content holds Shakespeare quizzes about coins.');
    process.exit(2);
  }
  if (!fs.existsSync(root)) {
    console.error(`root does not exist: ${root}`);
    process.exit(2);
  }

  const stamp = process.env.MIGRATION_STAMP || 'run';
  const backupDir = path.join(root, '_backups', `rings-migration-${stamp}`);

  const files = walk(root);
  let scanned = 0; let changed = 0; let skipped = 0;
  const totals = {};

  for (const file of files) {
    scanned += 1;
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); } catch { skipped += 1; continue; }
    const result = migrateText(raw);
    if (!result.changed) continue;
    changed += 1;
    for (const [k, v] of Object.entries(result.hits)) totals[k] = (totals[k] || 0) + v;

    if (apply) {
      const rel = path.relative(root, file);
      const dest = path.join(backupDir, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(file, dest);          // back up BEFORE writing
      fs.writeFileSync(file, result.text, 'utf8');
      // docker exec runs as root; the app runs as node.
      try { fs.chownSync(file, 1000, 1000); } catch { /* non-root host run */ }
    }
  }

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    root,
    scanned,
    changed,
    skipped,
    substitutions: totals,
    ...(apply ? { backupDir } : {}),
  }, null, 2));

  // Idempotence is the contract: a second --apply run must report changed: 0.
  if (!apply && changed > 0) console.log('\n(dry run — re-run with --apply to write)');
}

if (import.meta.url === `file://${process.argv[1]}`) main();

export { migrateText, RULES, ALLOWED_ROOTS };
