#!/usr/bin/env node
/**
 * `npm run sheet` — render a printable sheet to a PDF without booting the server.
 *
 * Same code path the HTTP route uses (SheetService -> SheetLayout -> QRSheetRenderer),
 * wired against the real household config, so what this writes is byte-for-byte
 * what `GET /api/v1/sheets/<id>.pdf` would serve. That matters: the point of a
 * local generator is to iterate on `sheets.yml` without a restart, and it is only
 * useful if it cannot drift from the served artifact.
 *
 * It also VERIFIES before it writes. Every code the sheet is about to print is
 * fed back through `parseScan`, and the run aborts if any of them fails to
 * resolve. A sheet gets laminated and stuck to a fridge; a code that does not
 * parse is discovered weeks later as a scanner that beeps and does nothing.
 * Checking here costs a millisecond.
 *
 * Usage:
 *   npm run sheet                          # fridge -> ./fridge.pdf
 *   npm run sheet -- --list                # what sheets are configured?
 *   npm run sheet -- fridge -o ~/Desktop/  # pick sheet and destination
 *   npm run sheet -- fridge --open         # write, then open it
 *   npm run sheet -- catalog --param source=plex --param id=42
 *
 * Requires DAYLIGHT_BASE_PATH (see .env) — same variable backend/index.js uses.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import yaml from 'js-yaml';

import { normalizeScaleNutribotConfig } from '#apps/nutribot/lib/scaleNutribotConfig.mjs';
import { createNutritionProviders } from '#composition/modules/sheetProviders.mjs';
import { createCellRenderers } from '#rendering/pdf/cellRenderers.mjs';
import { createSheetService } from '#apps/sheets/SheetService.mjs';
import { renderSheetPdf } from '#rendering/pdf/QRSheetRenderer.mjs';
import { parseScan } from '#domains/nutrition/services/ScanVocabularyService.mjs';

// ---- args ------------------------------------------------------------------
// Single left-to-right pass. An earlier version inferred the positional by
// filtering on `--` prefixes and peeking at neighbours, which silently misread
// `-o ~/Desktop/` as the sheet name and wrote the PDF into the repo. Consuming
// each option's value as it is encountered is the version that cannot do that.
const argv = process.argv.slice(2);
const VALUE_OPTS = new Set(['-o', '--out', '--param']);
const flags = new Set();
const opts = {};
const params = {};
const positionals = [];

for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (VALUE_OPTS.has(a)) {
    const value = argv[i += 1];
    if (value === undefined) {
      console.error(`${a} needs a value`);
      process.exit(1);
    }
    if (a === '--param') {
      const eq = value.indexOf('=');
      if (eq === -1) {
        console.error(`--param expects key=value, got "${value}"`);
        process.exit(1);
      }
      params[value.slice(0, eq)] = value.slice(eq + 1);
    } else {
      opts.out = value;
    }
  } else if (a.startsWith('-')) {
    flags.add(a.replace(/^-+/, ''));
  } else {
    positionals.push(a);
  }
}

const flag = (name) => flags.has(name);
const sheetId = positionals[0] || 'fridge';

// ---- config ----------------------------------------------------------------
// Read the YAML directly rather than through ConfigService. ConfigService caches
// at startup, which is exactly the behaviour this script exists to sidestep —
// editing sheets.yml and re-running should show the edit, with no restart.
const base = process.env.DAYLIGHT_BASE_PATH;
if (!base) {
  console.error('DAYLIGHT_BASE_PATH not set. It lives in .env — try:\n'
    + '  export $(grep DAYLIGHT_BASE_PATH .env | xargs) && npm run sheet');
  process.exit(1);
}
const configDir = path.join(base, 'data', 'household', 'config');

function readYaml(name) {
  const file = path.join(configDir, `${name}.yml`);
  if (!fs.existsSync(file)) {
    console.error(`missing ${file}`);
    process.exit(1);
  }
  return yaml.load(fs.readFileSync(file, 'utf8')) || {};
}

const sheetsConfig = readYaml('sheets');
const scalesConfig = readYaml('scales');

if (flag('list')) {
  const entries = Object.entries(sheetsConfig.sheets || {});
  if (!entries.length) console.log('no sheets configured in sheets.yml');
  for (const [id, spec] of entries) {
    const blocks = (spec.blocks || []).map((b) => `${b.source} ${b.grid?.cols}x${b.grid?.rows}`).join(', ');
    console.log(`  ${id.padEnd(18)} ${spec.title || ''}\n${' '.repeat(20)}${blocks}`);
  }
  process.exit(0);
}

// ---- build -----------------------------------------------------------------
const cellKinds = createCellRenderers();
const service = createSheetService({
  getConfig: () => sheetsConfig,
  providers: createNutritionProviders({
    getScaleConfig: () => normalizeScaleNutribotConfig(scalesConfig),
  }),
  cellKinds,
  logger: {
    debug: (event, data) => console.log(`  note  ${event} ${JSON.stringify(data)}`),
  },
});

let model;
try {
  model = await service.build(sheetId, params);
} catch (err) {
  console.error(`\ncannot build "${sheetId}": ${err.message}`);
  console.error('run with --list to see what is configured.');
  process.exit(1);
}

// ---- verify every printed code round-trips ---------------------------------
// The sheet outlives the config that made it. A code that does not parse is a
// dead button on a laminated page, so refuse to write one.
const unparseable = [];
let codes = 0;
for (const block of model.blocks) {
  for (const item of block.items) {
    if (!item.code) continue;      // label-only cells (e.g. foods) carry no code
    codes += 1;
    if (!parseScan(item.code)) unparseable.push({ block: block.id, code: item.code, label: item.label });
  }
}
if (unparseable.length) {
  console.error(`\nREFUSING TO WRITE — ${unparseable.length} code(s) do not parse:`);
  for (const u of unparseable) console.error(`  ${u.block}: ${u.code}  (${u.label})`);
  console.error('\nThe sheet and the scanner grammar have drifted. Fix the provider or the'
    + '\ngrammar before printing — a code that does not parse is a dead button.');
  process.exit(1);
}

// ---- write -----------------------------------------------------------------
const pdf = await renderSheetPdf(model, {
  cellKinds,
  logger: { warn: (event, data) => console.warn(`  warn  ${event} ${JSON.stringify(data)}`) },
});

let out = opts.out || process.cwd();
if (fs.existsSync(out) && fs.statSync(out).isDirectory()) out = path.join(out, `${sheetId}.pdf`);
fs.writeFileSync(out, pdf);

const marks = model.placements.cells.length;
console.log(`\n  ${sheetId}  ->  ${out}`);
console.log(`  ${model.placements.pages} page(s), ${marks} marks, ${codes} scannable, fingerprint ${model.fingerprint}`);
for (const b of model.blocks) {
  console.log(`    ${String(b.items.length).padStart(3)}  ${b.title || b.id}  (${b.kind})`);
}
if (model.placements.pages > 1) {
  console.log('\n  more than one page — tune max_w_pt / grid.cols in sheets.yml to compact it.');
}

if (flag('open')) {
  try { execFileSync('open', [out]); } catch { /* non-macOS, or no handler */ }
}
