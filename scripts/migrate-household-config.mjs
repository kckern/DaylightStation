#!/usr/bin/env node
/**
 * Move every household app config out of the retiring flat `config/` directory
 * into its domain folder, as declared by shared/contracts/householdConfig.mjs.
 *
 * DRY RUN BY DEFAULT. Pass --apply to actually move anything.
 *
 *   node scripts/migrate-household-config.mjs            # plan only
 *   node scripts/migrate-household-config.mjs --apply
 *
 * Safety rules this script will not break:
 *   - never overwrites an existing destination (aborts the whole run)
 *   - never deletes: everything retired goes to data/_deleteme/
 *   - prints the complete plan before moving the first file
 *   - re-runnable: a source that is already gone is reported, not an error
 *
 * Run this ONLY after the code that reads the new paths has been deployed.
 * The data tree is Dropbox-synced and shared with prod, so a move here reaches
 * production before any code does. Readers currently prefer the new path and
 * fall back to the old one, which is what makes this move safe in either order
 * of sync — but only once that code is live.
 */
import fs from 'fs';
import path from 'path';
import { HOUSEHOLD_APP_CONFIGS } from '../shared/contracts/householdConfig.mjs';

const APPLY = process.argv.includes('--apply');

const DATA_DIR = process.env.DAYLIGHT_DATA_PATH
  || (process.env.DAYLIGHT_BASE_PATH && path.join(process.env.DAYLIGHT_BASE_PATH, 'data'));
if (!DATA_DIR) {
  console.error('Set DAYLIGHT_BASE_PATH (or DAYLIGHT_DATA_PATH). Refusing to guess the data root.');
  process.exit(1);
}
const H = path.join(DATA_DIR, 'household');
const DELETEME = path.join(DATA_DIR, '_deleteme', `config-retired-${new Date().toISOString().slice(0, 10)}`);

/**
 * Apps the generic loop must NOT touch.
 *
 * media/media-app is a SEMANTIC INVERSION, not a move. Today `config/media-app.yml`
 * holds the DOMAIN (plex host, infinity board ids) while `media/config.yml` holds
 * the SURFACE (browse, searchScopes) — the opposite of what the names suggest.
 * A naive registry loop would send `media-app` to `media/app.yml` and file the
 * domain config at the surface path. Both files are valid YAML objects, so that
 * mistake throws NOTHING; consumers just read the wrong file and get undefined
 * for every key. Handled explicitly in SPECIAL below, in order.
 */
const SKIP_GENERIC = new Set(['media', 'media-app']);

/** [source, destination] pairs relative to the household folder. */
const SPECIAL = [
  // Media swap — ORDER MATTERS. Surface moves out of the way first.
  //
  // These two renames are NOT atomic together. Intermediate states, and why
  // each is survivable:
  //   before step 1: media/config.yml = surface, config/media-app.yml = domain
  //   between:       media/config.yml ABSENT — a reader falls back to legacy
  //                  config/media-app.yml, which still exists. Safe.
  //   after step 2:  media/config.yml = domain, media/app.yml = surface
  //
  // Readers must not select between these by existence alone during the
  // window — both candidates exist before step 1, and the SURFACE file is the
  // one sitting at the grouped path. cli/plex-sync.cli.mjs learned this the
  // hard way: it now requires the candidate to actually carry `plex.host`.
  ['media/config.yml', 'media/app.yml'],
  ['config/media-app.yml', 'media/config.yml'],
  // Key bindings are a uid'd list like triggers/bindings/nfc/, not app config.
  ['config/keyboard.yml', 'triggers/bindings/keyboard.yml'],
  // Trigger config joins the trigger state already at household/triggers/.
  ['config/triggers/sources.yml', 'triggers/sources.yml'],
  ['config/triggers/responses.yml', 'triggers/responses.yml'],
  ['config/triggers/endpoints.yml', 'triggers/endpoints.yml'],
  ['config/triggers/bindings/nfc/books.yml', 'triggers/bindings/nfc/books.yml'],
  ['config/triggers/bindings/nfc/cards.yml', 'triggers/bindings/nfc/cards.yml'],
  ['config/triggers/state/locations.yml', 'triggers/state/locations.yml'],
  // Runtime state belongs beside the other trigger state, not at the root.
  ['triggers/nfc.observed.yml', 'triggers/state/nfc.observed.yml'],
];

/** Retired outright — moved to _deleteme/, never deleted. */
const RETIRE = [
  // Dead duplicate: its identity_mappings are never read. configLoader builds
  // them from users/<name>/profile.yml -> identities.telegram.user_id.
  'config/chatbots.yml',
  // One line (`host:`); folded into hardware/devices.yml as a device entry.
  'config/jamcorder.yml',
  // Superseded backup left by the 2026-07-29 nfc bindings split.
  'config/triggers/bindings/nfc.yml.migrated-20260729-214106',
];

/** Directory renames: [from, to] relative to the household folder. */
const RENAME_DIRS = [
  // 3_applications/finance is singular; the data folder was not.
  // NOTE: only YamlFinanceDatastore.mjs:50 (getHouseholdPath) changes with this.
  // Lines 113 and 123 join 'finances' as a FILENAME inside the folder
  // (finance/finances.yml) and must NOT be renamed.
  ['finances', 'finance'],
];

const plan = [];
const notes = [];

const exists = (rel) => fs.existsSync(path.join(H, rel));
const add = (from, to, kind) => plan.push({ from, to, kind });

// ── Generic: registry-declared app configs still sitting in config/ ──────────
for (const [app, rel] of Object.entries(HOUSEHOLD_APP_CONFIGS)) {
  if (SKIP_GENERIC.has(app)) continue;
  const src = `config/${app}.yml`;
  const dest = `${rel}.yml`;
  if (!exists(src)) {
    notes.push(exists(dest)
      ? `already migrated: ${app} -> ${dest}`
      : `NO SOURCE and NO DEST for '${app}' (expected ${src} or ${dest})`);
    continue;
  }
  add(src, dest, 'app');
}

for (const [src, dest] of SPECIAL) {
  if (!exists(src)) { notes.push(`already moved or absent: ${src}`); continue; }
  add(src, dest, 'special');
}
for (const src of RETIRE) {
  if (!exists(src)) { notes.push(`already retired or absent: ${src}`); continue; }
  plan.push({ from: src, to: null, kind: 'retire' });
}
for (const [from, to] of RENAME_DIRS) {
  if (!exists(from)) { notes.push(`already renamed or absent: ${from}/`); continue; }
  plan.push({ from, to, kind: 'renamedir' });
}

// ── Refuse to clobber ───────────────────────────────────────────────────────
const collisions = plan.filter((m) => m.to && exists(m.to));
// The media swap legitimately frees its own destination earlier in the plan.
const freed = new Set(plan.filter((m) => m.kind === 'special').map((m) => m.from));
const realCollisions = collisions.filter((m) => !freed.has(m.to));

console.log(`\ndata root: ${DATA_DIR}`);
console.log(`mode:      ${APPLY ? 'APPLY (files will move)' : 'DRY RUN (nothing will move)'}\n`);
console.log(`planned moves: ${plan.length}\n`);
for (const m of plan) {
  const arrow = m.kind === 'retire' ? `-> _deleteme/` : `-> ${m.to}`;
  console.log(`  [${m.kind.padEnd(9)}] ${m.from.padEnd(46)} ${arrow}`);
}
if (notes.length) {
  console.log(`\nnotes (${notes.length}):`);
  for (const n of notes) console.log(`  - ${n}`);
}

const problems = notes.filter((n) => n.startsWith('NO SOURCE'));
if (problems.length) {
  console.error(`\nABORT: ${problems.length} registered app(s) have neither a source nor a destination.`);
  console.error('That means the registry names a config nothing has ever written. Fix the registry first.');
  process.exit(1);
}
// A directory rename whose destination is created by another step in this same
// plan (see the ORDER note below) — caught here rather than at apply time.
const renameTargets = plan.filter((m) => m.kind === 'renamedir').map((m) => m.to);
const shadowed = renameTargets.filter((dir) =>
  plan.some((m) => m.kind !== 'renamedir' && m.to && m.to.startsWith(`${dir}/`)));
if (shadowed.length) {
  console.log(`\nordering: ${shadowed.join(', ')} renamed BEFORE the file moves that land inside it`);
}

if (realCollisions.length) {
  console.error(`\nABORT: ${realCollisions.length} destination(s) already exist:`);
  for (const m of realCollisions) console.error(`  ${m.to}`);
  console.error('Refusing to overwrite. Inspect each one by hand.');
  process.exit(1);
}

if (!APPLY) {
  console.log('\nDry run only. Re-run with --apply to move.\n');
  process.exit(0);
}

// ── Apply ───────────────────────────────────────────────────────────────────
// ORDER MATTERS: directory renames run FIRST.
//
// `config/finance.yml -> finance/config.yml` creates `finance/` as a side
// effect of mkdir. If that ran before `finances -> finance`, the rename would
// then fail on an existing destination and leave the tree half-migrated. The
// collision check above cannot see this, because `finance/` does not exist at
// plan time — it is created by another step in the same plan.
const ORDER = { renamedir: 0, app: 1, special: 2, retire: 3 };
plan.sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);

let moved = 0;
for (const m of plan) {
  const from = path.join(H, m.from);
  const to = m.kind === 'retire'
    ? path.join(DELETEME, m.from)
    : path.join(H, m.to);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
  console.log(`moved ${m.from} -> ${m.kind === 'retire' ? path.relative(DATA_DIR, to) : m.to}`);
  moved += 1;
}

// Prune the directories the moves emptied. rmdir fails loudly on a non-empty
// directory, which is the point: anything left behind is something this script
// did not know about, and a human needs to look at it.
for (const dir of ['config/triggers/bindings/nfc', 'config/triggers/bindings', 'config/triggers/state', 'config/triggers']) {
  const abs = path.join(H, dir);
  if (!fs.existsSync(abs)) continue;
  const left = fs.readdirSync(abs);
  if (left.length === 0) { fs.rmdirSync(abs); console.log(`pruned empty ${dir}/`); }
  else console.log(`LEFT BEHIND in ${dir}/: ${left.join(', ')}  <- inspect by hand`);
}

const leftover = fs.existsSync(path.join(H, 'config')) ? fs.readdirSync(path.join(H, 'config')) : [];
console.log(`\nmoved ${moved} item(s).`);
console.log(leftover.length
  ? `household/config/ still holds: ${leftover.join(', ')}`
  : 'household/config/ is empty — safe to retire the directory.');
console.log('\nNOW: restart the backend (config is cached at boot), then diff the app union.\n');
