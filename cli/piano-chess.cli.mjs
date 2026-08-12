#!/usr/bin/env node
/**
 * Piano Chess playability verifier — it plays a real move, or fails loudly.
 *
 * This exists because the game once shipped with four rounds of review, 145
 * green tests, and screenshots — and a player at the piano completed zero
 * moves. Every check compared the implementation to the spec; none tried to
 * move a piece. This CLI is that missing check: it stands in for the player.
 *
 * It drives the DEPLOYED page through the same door the kiosk uses — a fake
 * piano bridge on ws://localhost:8770 (`usePianoBridgeNotes` is bridge-first,
 * so this both satisfies the connect gate and delivers notes). It reads the
 * live chord map off the board's own rim (the map is seeded per game and can
 * re-deal, so it must be read, never assumed), plays the chord of a movable
 * White piece twice to pick it up, reads a destination badge, plays that
 * chord once, and asserts the move landed in the move list.
 *
 * Any failure exits non-zero naming the step that failed.
 */

import { mkdir } from 'node:fs/promises';
import { dirname, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { chromium } from 'playwright';
import { INITIAL_FEN, legalMoves } from '../shared/gaming/chess/engine.mjs';

export const DEFAULT_URL = 'https://daylightlocal.kckern.net/piano/games/chess';
const DEFAULT_USER = 'guest';
const DEFAULT_BRIDGE_PORT = 8770;

// Hold/gap timing against the game's own clocks: the cursor settles a stable
// chord after 140ms (read on a 25ms tick), and the second recognition must
// land within 800ms of the first release to count as a double.
const CHORD_HOLD_MS = 450;
const DOUBLE_GAP_MS = 150;

/* ------------------------------------------------------------------ *
 * Argv                                                               *
 * ------------------------------------------------------------------ */

function requiredValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`);
  return value;
}

function positiveNumber(value, option) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${option} must be a positive number`);
  return parsed;
}

export function parseArgs(argv) {
  const options = {
    url: DEFAULT_URL,
    user: DEFAULT_USER,
    bridgePort: DEFAULT_BRIDGE_PORT,
    timeoutMs: 30_000,
    screenshot: null,
    headed: false,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--url') options.url = requiredValue(argv, index++, token);
    else if (token === '--user') options.user = requiredValue(argv, index++, token);
    else if (token === '--bridge-port') options.bridgePort = positiveNumber(requiredValue(argv, index++, token), token);
    else if (token === '--timeout') options.timeoutMs = positiveNumber(requiredValue(argv, index++, token), token) * 1000;
    else if (token === '--screenshot') options.screenshot = resolvePath(requiredValue(argv, index++, token));
    else if (token === '--headed') options.headed = true;
    else if (token === '--json') options.json = true;
    else if (token === '--help' || token === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${token}`);
  }
  const target = new URL(options.url);
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error('--url must use http or https');
  options.url = target.href;
  return options;
}

/* ------------------------------------------------------------------ *
 * Chords — mirrors chordAddress.js, which the CLI cannot import      *
 * (its @shared-gaming alias is vite-only). The unit test cross-checks *
 * this table against the real CHORD_QUALITIES so drift cannot hide.  *
 * ------------------------------------------------------------------ */

export const PITCH_CLASSES = Object.freeze({
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
});

/**
 * Rim label -> intervals. The board renders major's empty label as 'maj'
 * (`label || 'maj'`), and a badge renders major as the bare root, so both
 * '' and 'maj' mean major here.
 */
export const INTERVALS_BY_LABEL = Object.freeze({
  '': [0, 4, 7],
  maj: [0, 4, 7],
  m: [0, 3, 7],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  7: [0, 4, 7, 10],
  6: [0, 4, 7, 9],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  add9: [0, 4, 7, 14],
  m6: [0, 3, 7, 9],
});

/** 'Bbm7' -> { root: 'Bb', label: 'm7', intervals }. Throws on gibberish. */
export function parseChordSymbol(symbol) {
  const match = /^([A-G][b#]?)(.*)$/.exec(String(symbol ?? '').trim());
  if (!match || !(match[1] in PITCH_CLASSES)) throw new Error(`unreadable chord root in "${symbol}"`);
  const [, root, label] = match;
  const intervals = INTERVALS_BY_LABEL[label];
  if (!intervals) throw new Error(`unreadable chord quality "${label}" in "${symbol}"`);
  return { root, label, intervals };
}

/** MIDI notes for a chord, root in the bass so ambiguous sets resolve to it. */
export function chordMidiNotes(symbol, { base = 48 } = {}) {
  const { root, intervals } = parseChordSymbol(symbol);
  const bass = base + PITCH_CLASSES[root];
  return intervals.map((interval) => bass + interval);
}

/* ------------------------------------------------------------------ *
 * The rim                                                            *
 * ------------------------------------------------------------------ */

/**
 * Runs inside the page (playwright serializes it), so it must stay
 * self-contained. `doc` is a seam for the unit test's fixture DOM; in the
 * browser it is called with null and reads the real document.
 */
export function readRimFromDocument(doc) {
  const root = doc ?? document;
  const texts = (selector) => Array.from(root.querySelectorAll(selector))
    .map((node) => (node.textContent ?? '').trim());
  return {
    rankLabelsTopToBottom: texts('.chess-board__rank-axis .chess-board__axis-label'),
    fileLabelsLeftToRight: texts('.chess-board__file-axis .chess-board__axis-label'),
  };
}

/**
 * Rim labels -> the live chord map. For a White-facing board the file axis
 * reads a..h left to right and the rank axis reads 8..1 top to bottom;
 * a Black-facing board reverses both.
 */
export function buildRimMap({ fileLabelsLeftToRight, rankLabelsTopToBottom, orientation = 'white' }) {
  if (fileLabelsLeftToRight?.length !== 8 || rankLabelsTopToBottom?.length !== 8) {
    throw new Error(`rim must show 8 file and 8 rank labels, saw ${fileLabelsLeftToRight?.length ?? 0}/${rankLabelsTopToBottom?.length ?? 0}`);
  }
  const roots = orientation === 'black' ? [...fileLabelsLeftToRight].reverse() : [...fileLabelsLeftToRight];
  const qualityLabels = orientation === 'black' ? [...rankLabelsTopToBottom] : [...rankLabelsTopToBottom].reverse();
  for (const root of roots) {
    if (!(root in PITCH_CLASSES)) throw new Error(`rim file label "${root}" is not a note name`);
  }
  for (const label of qualityLabels) {
    if (!(label in INTERVALS_BY_LABEL)) throw new Error(`rim rank label "${label}" is not a chord quality`);
  }
  return { roots, qualityLabels };
}

/** 'e2' -> the chord symbol the rim currently assigns that square. */
export function chordSymbolForSquare(square, rimMap) {
  const file = 'abcdefgh'.indexOf(square[0]);
  const rank = '12345678'.indexOf(square[1]);
  if (file < 0 || rank < 0) throw new Error(`not a square: ${square}`);
  const root = rimMap.roots[file];
  const label = rimMap.qualityLabels[rank];
  return `${root}${label === 'maj' ? '' : label}`;
}

/* ------------------------------------------------------------------ *
 * Choosing the piece                                                 *
 * ------------------------------------------------------------------ */

/**
 * A White source square with legal moves, from the position the page shows on
 * a fresh game. Deterministic: the source with the most destinations, ties
 * broken alphabetically, so reruns pick the same piece.
 */
export function pickSource(fen = INITIAL_FEN) {
  const byFrom = new Map();
  for (const move of legalMoves(fen)) {
    if (move.color !== 'w') continue;
    if (!byFrom.has(move.from)) byFrom.set(move.from, []);
    byFrom.get(move.from).push(move.to);
  }
  const [entry] = [...byFrom.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  if (!entry) throw new Error('the position offers White no legal moves');
  return { from: entry[0], destinations: entry[1] };
}

/* ------------------------------------------------------------------ *
 * The fake piano bridge                                              *
 * ------------------------------------------------------------------ */

class FakePianoBridge {
  constructor(port) {
    this.port = port;
    this.server = null;
  }

  start() {
    return new Promise((resolve, reject) => {
      const server = new WebSocketServer({ port: this.port });
      server.once('listening', () => { this.server = server; resolve(); });
      server.once('error', (error) => reject(new Error(
        error?.code === 'EADDRINUSE'
          ? `port ${this.port} is already taken — a real or leftover piano bridge is running`
          : `bridge server failed: ${error.message}`,
      )));
    });
  }

  async waitForClient(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if ([...(this.server?.clients ?? [])].some((client) => client.readyState === 1)) return;
      await sleep(50);
    }
    throw new Error('the page never connected to the bridge');
  }

  broadcast(frame) {
    const data = JSON.stringify(frame);
    for (const client of this.server?.clients ?? []) {
      if (client.readyState === 1) client.send(data);
    }
  }

  async playChord(notes, { holdMs = CHORD_HOLD_MS } = {}) {
    for (const note of notes) this.broadcast({ type: 'note.on', note, velocity: 96 });
    await sleep(holdMs);
    for (const note of notes) this.broadcast({ type: 'note.off', note, velocity: 0 });
  }

  close() {
    return new Promise((resolve) => {
      if (!this.server) { resolve(); return; }
      for (const client of this.server.clients) client.terminate();
      this.server.close(() => resolve());
    });
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ *
 * The run                                                            *
 * ------------------------------------------------------------------ */

class StepError extends Error {
  constructor(step, message) {
    super(`[${step}] ${message}`);
    this.step = step;
  }
}

async function countSelector(page, selector) {
  return page.locator(selector).count();
}

/** Poll for a condition on the page; throws a StepError naming `step` on timeout. */
async function waitForPage(page, step, describe, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(100);
  }
  throw new StepError(step, describe);
}

export async function verifyPianoChess(options, { onProgress = () => {} } = {}) {
  const report = {
    valid: false,
    url: options.url,
    checkedAt: new Date().toISOString(),
    steps: [],
    move: null,
    pageErrors: [],
    errors: [],
  };
  const step = async (name, describe, fn) => {
    onProgress(`${name}: ${describe}`);
    try {
      const detail = await fn();
      report.steps.push({ name, ok: true, ...(detail ? { detail } : {}) });
      return detail;
    } catch (error) {
      if (error instanceof StepError) throw error;
      throw new StepError(name, error?.message || String(error));
    }
  };

  const bridge = new FakePianoBridge(options.bridgePort);
  let browser = null;
  let page = null;
  try {
    await step('bridge-listen', `fake piano bridge on ws://localhost:${options.bridgePort}`, () => bridge.start());

    await step('page-open', `open ${options.url} and find the board`, async () => {
      browser = await chromium.launch({ headless: !options.headed });
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
      page = await context.newPage();
      page.on('pageerror', (error) => report.pageErrors.push(error.message));
      const target = new URL(options.url);
      target.searchParams.set('user', options.user);
      const response = await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: options.timeoutMs });
      if (!response?.ok()) throw new Error(`route returned HTTP ${response?.status() ?? 'unknown'}`);
      await page.locator('.chess-board__square').first().waitFor({ state: 'visible', timeout: options.timeoutMs });
      const squares = await countSelector(page, '.chess-board__square');
      if (squares !== 64) throw new Error(`expected 64 squares, found ${squares}`);
      return { squares };
    });

    await step('bridge-connect', 'the page connects to the bridge', () => bridge.waitForClient(options.timeoutMs));

    const rimMap = await step('read-rim', 'read the live chord map off the board rim', async () => {
      const rim = await page.evaluate(readRimFromDocument, null);
      return buildRimMap({ ...rim, orientation: 'white' });
    });

    const source = await step('pick-piece', 'choose a movable White piece', async () => {
      const emptyLog = await countSelector(page, '.piano-chess__move--empty');
      if (emptyLog !== 1) throw new Error('the move list is not empty — the game is not fresh');
      const picked = pickSource(INITIAL_FEN);
      const holder = await page.locator(`.chess-board__square[data-square="${picked.from}"]`)
        .getAttribute('aria-label');
      if (!/ — w/.test(holder || '')) throw new Error(`${picked.from} does not hold a White piece on the page (${holder})`);
      const symbol = chordSymbolForSquare(picked.from, rimMap);
      return { ...picked, symbol, notes: chordMidiNotes(symbol) };
    });

    await step('pickup', `play ${source.symbol} twice to lift the piece on ${source.from}`, async () => {
      await bridge.playChord(source.notes);
      await sleep(DOUBLE_GAP_MS);
      await bridge.playChord(source.notes);
      await waitForPage(page, 'pickup',
        `no piece in hand after playing ${source.symbol} (${source.notes.join(',')}) twice — expected exactly one .chess-board__square--held on ${source.from}`,
        async () => await countSelector(page, '.chess-board__square--held') === 1,
        5_000);
      const held = await page.locator('.chess-board__square--held').getAttribute('data-square');
      if (held !== source.from) throw new Error(`the held piece is on ${held}, not ${source.from}`);
      return { held };
    });

    const badge = await step('badges', 'the destinations are legible on the board', async () => {
      await waitForPage(page, 'badges',
        'no .chess-board__badge appeared — the held piece\'s destinations are not labelled',
        async () => await countSelector(page, '.chess-board__badge') >= 1,
        3_000);
      const badges = await page.locator('.chess-board__square:has(.chess-board__badge)').evaluateAll((squares) => (
        squares.map((node) => ({
          square: node.dataset.square,
          symbol: node.querySelector('.chess-board__badge')?.textContent?.trim(),
        }))
      ));
      const chosen = badges.find((entry) => source.destinations.includes(entry.square)) || badges[0];
      return { ...chosen, count: badges.length };
    });

    await step('drop', `play ${badge.symbol} once to land on ${badge.square}`, async () => {
      await bridge.playChord(chordMidiNotes(badge.symbol));
    });

    report.move = await step('move-list', 'the move appears in the move list', async () => {
      await waitForPage(page, 'move-list',
        'the move list is still empty — the move never happened',
        async () => await countSelector(page, '.piano-chess__move:not(.piano-chess__move--empty)') >= 1,
        5_000);
      const text = (await page.locator('.piano-chess__move').first().innerText()).replace(/\s+/g, ' ').trim();
      return { entry: text };
    });

    report.valid = true;
  } catch (error) {
    const stepName = error instanceof StepError ? error.step : 'unexpected';
    report.steps.push({ name: stepName, ok: false, error: error.message });
    report.errors.push(error.message);
  } finally {
    if (options.screenshot && page) {
      await mkdir(dirname(options.screenshot), { recursive: true }).catch(() => {});
      await page.screenshot({ path: options.screenshot, fullPage: true }).catch(() => {});
      report.screenshot = options.screenshot;
    }
    await browser?.close().catch(() => {});
    await bridge.close().catch(() => {});
  }
  return report;
}

/* ------------------------------------------------------------------ *
 * CLI                                                                *
 * ------------------------------------------------------------------ */

const USAGE = `Piano Chess playability verifier — plays a real move on the deployed page

  node cli/piano-chess.cli.mjs [options]

Options:
  --url <url>          Game route (default ${DEFAULT_URL})
  --user <id>          Kiosk identity (default ${DEFAULT_USER})
  --bridge-port <n>    Fake piano bridge port (default ${DEFAULT_BRIDGE_PORT})
  --timeout <seconds>  Per-operation timeout (default 30)
  --screenshot <path>  Save the final board (also captures failures)
  --headed             Show Chromium while the verifier plays
  --json               Machine-readable report on stdout
  -h, --help           Show this help
`;

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`✗ ${error.message}\n\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    process.stdout.write(USAGE);
    return;
  }
  const progress = options.json ? () => {} : (message) => process.stderr.write(`• ${message}\n`);
  const report = await verifyPianoChess(options, { onProgress: progress });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (report.valid) {
    process.stdout.write(`✓ Piano Chess is playable at ${report.url}\n`);
    process.stdout.write(`  Move played: ${report.move.entry}\n`);
  } else {
    const failed = report.steps.find((entry) => !entry.ok);
    process.stderr.write(`✗ Piano Chess is NOT playable — failed at step "${failed?.name}"\n`);
    process.stderr.write(`  ${report.errors.join('\n  ')}\n`);
    if (report.pageErrors.length) process.stderr.write(`  page errors: ${report.pageErrors.join('; ')}\n`);
  }
  if (!report.valid) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    process.stderr.write(`✗ ${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
