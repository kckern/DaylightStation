#!/usr/bin/env node
/**
 * OMR scan tools.
 *
 *   school omr rebuild          rebuild decoded quiz day files from the raw manifest
 *   school omr replay           re-deliver a scan the relay read but never delivered
 *
 * `rebuild` is the whole-file, idempotent regeneration of the decoded record
 * (test ID + answers) from the byte-faithful manifest the relay writes. Use it
 * after a form-layout fix. It can only ever re-derive what is already on disk.
 *
 * `replay` is for the other failure: a card the reader read correctly and the
 * relay NEVER MANAGED TO DELIVER, so nothing was written anywhere and there is
 * no manifest entry for `rebuild` to work from. That is not hypothetical — see
 * the 2026-08-25 half-open-socket incident in _extensions/omr-relay/README.md,
 * where four sheets were destroyed while /health reported `ok: true`. Before
 * this command the only recovery was to physically re-feed the card, which is
 * impossible once it has been erased, re-used, or thrown away.
 *
 * REPLAY PUBLISHES ONTO THE LIVE BUS. It does not reimplement any part of the
 * pipeline: it sends the exact message shape the firmware sends
 * (`_extensions/omr-relay/firmware/src/main.cpp`, handleFrame), so the running
 * backend does the ingest, the persistence AND the grading through the same
 * code path a physical feed takes. There is deliberately no second composition
 * root here — a recovery tool that grades by its own rules is a tool that
 * disagrees with production exactly when you most need to trust it.
 *
 * Usage:
 *   node cli/school.mjs omr                       # rebuild (default, back-compat)
 *   node cli/school.mjs omr rebuild [--data-dir DIR]
 *
 *   node cli/school.mjs omr replay --hex <frame-hex>   [--apply]
 *   node cli/school.mjs omr replay --marks 1056,1536,… [--apply]
 *     --hex        a raw frame exactly as /recent reports it (2 bytes/column)
 *     --marks      already-decoded 12-bit column masks, comma separated
 *     --reader     reader id (default: the first in the household SSOT)
 *     --at         ISO timestamp the scan actually happened (default: now)
 *     --apply      actually publish; WITHOUT IT THIS IS A DRY RUN
 *
 * Dry run by default, like `school ops` — this writes a grade against a real
 * learner's assessment, so it prints what it would do and stops.
 *
 * @module cli/school/omr
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path, { join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { YamlDecodedQuizScanStore } from '../../backend/src/1_adapters/persistence/yaml/YamlDecodedQuizScanStore.mjs';
import yaml from 'js-yaml';

import { rebuildQuizDayFiles, decodeQuizSheet } from '#apps/quizzes/quizScanRecorder.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '..', '.env') });

const RELAY_SOURCE = 'omr-relay';

// ---------------------------------------------------------------------------
// shared
// ---------------------------------------------------------------------------

function resolveDataDir(argv) {
  const i = argv.indexOf('--data-dir');
  if (i !== -1) return path.resolve(argv[i + 1]);
  return process.env.DAYLIGHT_BASE_PATH
    ? join(process.env.DAYLIGHT_BASE_PATH, 'data')
    : null;
}

// The grouped path (hardware/omr/readers.yml per shared/contracts/householdConfig.mjs)
// is the only location — Phase E deleted the retiring flat config/ fallback.
// Getting this wrong is not cosmetic: the `persistence.dir` / `quizzes.dir`
// overrides come from this file, so a miss silently rebuilds history into the
// DEFAULT directories instead of the household's configured ones.
function loadReaderConfig(dataDir) {
  const p = join(dataDir, 'household', 'hardware', 'omr', 'readers.yml');
  try {
    return yaml.load(readFileSync(p, 'utf8')) || {};
  } catch {
    return {};
  }
}

const opt = (argv, name) => {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : undefined;
};

// ---------------------------------------------------------------------------
// rebuild
// ---------------------------------------------------------------------------

async function rebuild(argv) {
  const dataDir = resolveDataDir(argv);
  if (!dataDir) {
    console.error('ERROR: pass --data-dir or set DAYLIGHT_BASE_PATH in .env');
    return 1;
  }
  const config = loadReaderConfig(dataDir);

  // The CLI is its own composition root here: it resolves both roots and passes
  // them down, the same way app.mjs does for the live recorder.
  const resolveRoot = (override, fallback) => (override
    ? join(dataDir, ...String(override).replace(/^\/+/, '').split('/'))
    : join(dataDir, 'household', fallback));

  const result = await rebuildQuizDayFiles({
    // MUST match app.mjs's live default for the recorder (school/records/assessments/omr).
    // These are two composition roots writing the same tree, so a drift here
    // silently rebuilds history into a directory nothing reads — which is what
    // happened when `quizzes/` was folded under `school/` and only app.mjs was
    // updated.
    decodedScanStore: new YamlDecodedQuizScanStore({
      rawHistoryRoot: resolveRoot(config?.persistence?.dir, 'hardware/omr/log'),
      decodedRoot: resolveRoot(config?.quizzes?.dir, 'school/records/assessments/omr'),
    }),
    logger: console,
  });
  console.log(`Rebuilt ${result.days} day file(s), ${result.sheets} sheet(s), across ${result.readers} reader(s).`);
  return 0;
}

// ---------------------------------------------------------------------------
// replay
// ---------------------------------------------------------------------------

// One column is two bytes, low byte first, six data bits each: bits 0-5 come
// from the first byte (masks 01/02/04/08/10/40) and bits 6-11 from the second.
// Bit 5 (0x20) is forced high by the reader so every byte stays printable, and
// bit 6 (0x40) IS a data bit — a 5-bit mask decodes wrong. This mirrors
// packColumn() in the firmware; keep the two in step.
export function marksFromHex(hex) {
  const clean = String(hex).trim().replace(/[^0-9a-fA-F]/g, '');
  if (clean.length % 4 !== 0) {
    throw new Error(`hex length ${clean.length} is not a whole number of 2-byte columns`);
  }
  const bytes = Buffer.from(clean, 'hex');
  const six = (b) => (b & 0x1f) | (((b & 0x40) ? 1 : 0) << 5);
  const cols = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    cols.push(six(bytes[i]) | (six(bytes[i + 1]) << 6));
  }
  return cols;
}

// A full household card is 32 columns: 7 of test ID, 25 of question banks.
const FULL_CARD_COLUMNS = 32;

function findCardAllocations(dataDir, cardId) {
  const p = join(dataDir, 'household', 'school', 'artifacts', 'print', 'cards', `${cardId}.yml`);
  if (!existsSync(p)) return null;
  try {
    const rows = yaml.load(readFileSync(p, 'utf8'));
    return Array.isArray(rows) ? rows : [rows];
  } catch {
    return null;
  }
}

async function replay(argv) {
  const dataDir = resolveDataDir(argv);
  if (!dataDir) {
    console.error('ERROR: pass --data-dir or set DAYLIGHT_BASE_PATH in .env');
    return 1;
  }
  const config = loadReaderConfig(dataDir);

  const hex = opt(argv, '--hex');
  const marksArg = opt(argv, '--marks');
  if (!hex && !marksArg) {
    console.error('ERROR: pass --hex <frame-hex> or --marks <csv>.');
    console.error('       A lost frame is usually still on the relay: curl http://<ip>/recent');
    return 2;
  }
  if (hex && marksArg) {
    console.error('ERROR: --hex and --marks are alternatives; pass one.');
    return 2;
  }

  let marks;
  try {
    marks = hex
      ? marksFromHex(hex)
      : String(marksArg).split(',').map((s) => {
        const n = Number(s.trim());
        if (!Number.isInteger(n) || n < 0 || n > 0xfff) {
          throw new Error(`"${s.trim()}" is not a 12-bit column mask`);
        }
        return n;
      });
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    return 2;
  }
  if (!marks.length) {
    console.error('ERROR: no columns decoded.');
    return 2;
  }

  const scanners = config.scanners || {};
  const readerId = opt(argv, '--reader') || Object.keys(scanners)[0] || 'study-omr';
  const topic = scanners[readerId]?.topic || 'omr';

  const at = opt(argv, '--at');
  const atMs = at ? Date.parse(at) : Date.now();
  if (Number.isNaN(atMs)) {
    console.error(`ERROR: --at "${at}" is not a parseable timestamp.`);
    return 2;
  }
  // The firmware stamps every delivered message with how long it sat queued, and
  // the backend SUBTRACTS it when recording `ts`. Reusing that here is what makes
  // a recovered scan file under the moment the card was actually fed rather than
  // the moment we noticed — without it a sheet recovered the next morning lands
  // in the wrong day file entirely.
  const ageMs = Math.max(0, Date.now() - atMs);

  const { testId, answers, testIdCandidates } = decodeQuizSheet(marks);

  console.log(`reader        ${readerId}   topic ${topic}`);
  console.log(`columns       ${marks.length}${marks.length < FULL_CARD_COLUMNS ? `  ⚠ PARTIAL (a full card is ${FULL_CARD_COLUMNS})` : ''}`);
  console.log(`markedColumns ${marks.filter((m) => m !== 0).length}`);
  console.log(`scanned at    ${new Date(atMs).toISOString()}  (ageMs ${ageMs})`);
  console.log(`test id       ${testId ?? '(unreadable)'}${testIdCandidates ? `  candidates ${JSON.stringify(testIdCandidates)}` : ''}`);
  console.log(`answers       ${JSON.stringify(answers)}`);

  if (marks.length < FULL_CARD_COLUMNS) {
    // Say this plainly rather than let a short frame look like a clean read. The
    // decoder OMITS unmarked questions, so a truncated frame is indistinguishable
    // from a card the student left blank once it reaches the record.
    const lostFrom = Math.max(0, marks.length - 7) + 1;
    console.log('');
    console.log(`⚠ PARTIAL FRAME — only columns 1-${marks.length} survive.`);
    console.log(`  Questions ${lostFrom}-25 and ${lostFrom + 25}-50 are NOT missing answers, they are UNKNOWN.`);
    console.log('  Grading is still correct IF the live allocation falls inside the recovered range.');
  }

  if (testId) {
    const allocations = findCardAllocations(dataDir, testId);
    if (!allocations) {
      console.log(`\n⚠ no allocation file for card ${testId} — this will resolve as unknown_card.`);
    } else {
      const live = allocations.filter((a) => a?.status === 'live');
      console.log(`\ncard ${testId}: ${allocations.length} allocation(s), ${live.length} live`);
      for (const a of live) {
        const r = a.rowRange || {};
        const rows = Object.keys(answers).map(Number);
        const covered = Number.isFinite(r.start) && Number.isFinite(r.end)
          && rows.some((q) => q >= r.start && q <= r.end);
        console.log(`  rows ${r.start}-${r.end}  ${a.learnerId}  ${a.documentId}`);
        console.log(`    answers present for these rows: ${covered ? 'YES' : 'NO — this would grade as blank'}`);
        for (let q = r.start; q <= r.end; q++) {
          console.log(`      ${q}: ${answers[q] === undefined ? '(none)' : JSON.stringify(answers[q])}`);
        }
      }
      if (!live.length) console.log('  nothing live — this scan would resolve but grade nothing.');
    }
  }

  if (!argv.includes('--apply')) {
    console.log('\nDRY RUN — nothing published. Re-run with --apply to deliver this scan.');
    return 0;
  }

  const backend = config.backend || {};
  const host = opt(argv, '--host') || backend.host || 'localhost';
  const port = Number(opt(argv, '--port') || backend.port || 3111);
  const wsPath = backend.ws_path || '/ws';
  const url = `ws://${host}:${port}${wsPath}`;

  // Exactly the firmware's message. Anything else here is a second definition of
  // the wire format that will drift from the board.
  const message = {
    source: RELAY_SOURCE,
    type: 'sheet',
    id: readerId,
    columns: marks.length,
    marks,
    markedColumns: marks.filter((m) => m !== 0).length,
    ageMs,
  };

  const { WebSocket } = await import('ws');
  console.log(`\npublishing to ${url} …`);

  return await new Promise((resolve) => {
    const ws = new WebSocket(url);
    let settled = false;
    const done = (code, msg) => {
      if (settled) return;
      settled = true;
      if (msg) console.log(msg);
      try { ws.close(); } catch { /* already closing */ }
      clearTimeout(timer);
      resolve(code);
    };

    // The relay treats the backend's re-broadcast as its ack, and so do we: it
    // is proof the message was received, validated and accepted. The grading
    // consumer publishes its outcome on the same topic just after, so waiting a
    // beat longer than the echo is what turns "delivered" into "graded".
    const timer = setTimeout(
      () => done(1, '✗ no echo from the bus within 10s — nothing was recorded.'),
      10000,
    );

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'bus_command', action: 'subscribe', topic }));
      ws.send(JSON.stringify(message));
    });

    ws.on('message', (raw) => {
      let payload;
      try { payload = JSON.parse(raw.toString()); } catch { return; }
      const body = payload?.data ?? payload;
      if (body?.id && body.id !== readerId) return;

      if (body?.event === 'sheet') {
        console.log(`✓ echoed: ${body.columns} columns, ${body.markedColumns} marked, ts ${body.ts}`);
        // Keep listening — the grade outcome lands a moment later.
        return;
      }
      if (typeof body?.event === 'string' && body.event.startsWith('scan-')) {
        const ok = body.event === 'scan-graded' || body.event === 'scan-review';
        done(ok ? 0 : 1, `${ok ? '✓' : '✗'} ${body.event}${body.code ? ` (${body.code})` : ''}${body.recordId ? ` recordId=${body.recordId}` : ''}`);
      }
    });

    ws.on('error', (err) => done(1, `✗ ${err.message}`));
    ws.on('close', () => done(1, '✗ socket closed before an outcome arrived.'));
  });
}

// ---------------------------------------------------------------------------

const SUBCOMMANDS = { rebuild, replay };

export async function main(argv = process.argv.slice(2)) {
  const [first] = argv;

  if (first === '--help' || first === '-h') {
    console.log([
      'school omr — OMR scan tools',
      '',
      '  rebuild   regenerate decoded day files from the raw manifest (default)',
      '  replay    re-deliver a scan the relay read but never delivered',
      '',
      '  school omr rebuild [--data-dir DIR]',
      '  school omr replay (--hex HEX | --marks CSV) [--reader ID] [--at ISO] [--apply]',
      '',
      'replay publishes the firmware\'s own message shape onto the live bus, so',
      'the running backend does the ingest, persistence and grading. Dry run',
      'unless --apply. A lost frame is usually still on the relay: curl',
      'http://<relay-ip>/recent',
    ].join('\n'));
    return 0;
  }

  // Back-compat: `school omr` and `school omr --data-dir X` have always meant
  // rebuild, and scripts call them that way. Only an explicit subcommand routes
  // elsewhere.
  const sub = SUBCOMMANDS[first];
  if (!sub) return rebuild(argv);
  return sub(argv.slice(1));
}

const ENTRYPOINT = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === ENTRYPOINT) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}
