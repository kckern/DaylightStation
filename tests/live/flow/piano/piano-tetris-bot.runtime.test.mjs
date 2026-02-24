/**
 * Piano Tetris Sight-Reading Bot
 *
 * A headed Playwright test that plays Piano Tetris in real-time by:
 * 1. Navigating to OfficeApp and triggering the piano visualizer via MIDI
 * 2. Activating the Tetris game via backtick dev shortcut
 * 3. Reading the staff targets (via page.evaluate on window.__TETRIS_DEBUG__)
 * 4. Computing optimal piece placement using a simple heuristic AI
 * 5. Sending matching MIDI notes via WebSocket to execute moves
 *
 * Run headed:
 *   npx playwright test tests/live/flow/piano/piano-tetris-bot.runtime.test.mjs --headed
 */

import { test, expect } from '@playwright/test';
import WebSocket from 'ws';
import { WS_URL } from '#fixtures/runtime/urls.mjs';

// ─── Tetris Piece Definitions ───────────────────────────────────
// Duplicated from tetrisEngine.js for use in Node.js test context

const PIECE_SHAPES = {
  I: [
    [[0, 0], [0, 1], [0, 2], [0, 3]],
    [[0, 0], [1, 0], [2, 0], [3, 0]],
    [[0, 0], [0, 1], [0, 2], [0, 3]],
    [[0, 0], [1, 0], [2, 0], [3, 0]],
  ],
  O: [
    [[0, 0], [0, 1], [1, 0], [1, 1]],
    [[0, 0], [0, 1], [1, 0], [1, 1]],
    [[0, 0], [0, 1], [1, 0], [1, 1]],
    [[0, 0], [0, 1], [1, 0], [1, 1]],
  ],
  T: [
    [[0, 0], [0, 1], [0, 2], [1, 1]],
    [[0, 0], [1, 0], [2, 0], [1, 1]],
    [[1, 0], [1, 1], [1, 2], [0, 1]],
    [[0, 0], [1, 0], [2, 0], [1, -1]],
  ],
  S: [
    [[0, 1], [0, 2], [1, 0], [1, 1]],
    [[0, 0], [1, 0], [1, 1], [2, 1]],
    [[0, 1], [0, 2], [1, 0], [1, 1]],
    [[0, 0], [1, 0], [1, 1], [2, 1]],
  ],
  Z: [
    [[0, 0], [0, 1], [1, 1], [1, 2]],
    [[0, 1], [1, 0], [1, 1], [2, 0]],
    [[0, 0], [0, 1], [1, 1], [1, 2]],
    [[0, 1], [1, 0], [1, 1], [2, 0]],
  ],
  J: [
    [[0, 0], [1, 0], [1, 1], [1, 2]],
    [[0, 0], [0, 1], [1, 0], [2, 0]],
    [[0, 0], [0, 1], [0, 2], [1, 2]],
    [[0, 0], [1, 0], [2, 0], [2, -1]],
  ],
  L: [
    [[0, 2], [1, 0], [1, 1], [1, 2]],
    [[0, 0], [1, 0], [2, 0], [2, 1]],
    [[0, 0], [0, 1], [0, 2], [1, 0]],
    [[0, 0], [0, 1], [1, 1], [2, 1]],
  ],
};

const BOARD_ROWS = 20;
const BOARD_COLS = 20;

// ─── MIDI Simulator ─────────────────────────────────────────────

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const midiNoteToName = (note) => `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`;

class MidiSimulator {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.sessionId = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.on('open', () => resolve());
      this.ws.on('error', (err) => reject(err));
    });
  }

  close() {
    if (this.ws) this.ws.close();
  }

  send(message) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  sessionStart() {
    this.sessionId = `bot-${Date.now()}`;
    this.send({
      topic: 'midi',
      source: 'piano',
      type: 'session',
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      data: {
        event: 'session_start',
        sessionId: this.sessionId,
        device: 'Tetris Bot',
      },
    });
  }

  noteOn(note, velocity = 80) {
    this.send({
      topic: 'midi',
      source: 'piano',
      type: 'note',
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      data: {
        event: 'note_on',
        note,
        noteName: midiNoteToName(note),
        velocity,
        channel: 0,
      },
    });
  }

  noteOff(note) {
    this.send({
      topic: 'midi',
      source: 'piano',
      type: 'note',
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      data: {
        event: 'note_off',
        note,
        noteName: midiNoteToName(note),
        velocity: 0,
        channel: 0,
      },
    });
  }

  /** Press notes, wait for React to process, release */
  async playNotes(notes, durationMs = 150) {
    for (const n of notes) this.noteOn(n);
    await sleep(durationMs);
    for (const n of notes) this.noteOff(n);
  }
}

// ─── Tetris AI ──────────────────────────────────────────────────

function getPieceCells(type, rotation, x, y) {
  return PIECE_SHAPES[type][rotation].map(([dr, dc]) => [y + dr, x + dc]);
}

function isValid(board, type, rotation, x, y) {
  for (const [r, c] of getPieceCells(type, rotation, x, y)) {
    if (r < 0 || r >= BOARD_ROWS || c < 0 || c >= BOARD_COLS) return false;
    if (board[r]?.[c] !== null) return false;
  }
  return true;
}

function dropY(board, type, rotation, x) {
  if (!isValid(board, type, rotation, x, 0)) return -1;
  let y = 0;
  while (isValid(board, type, rotation, x, y + 1)) y++;
  return y;
}

/**
 * Evaluate a board after placing a piece — lower score = better placement.
 * Uses standard Tetris AI heuristics:
 *   - Lines cleared (reward)
 *   - Aggregate height (penalty)
 *   - Holes (heavy penalty)
 *   - Bumpiness (penalty)
 */
function evaluatePlacement(board, type, rotation, x) {
  const y = dropY(board, type, rotation, x);
  if (y < 0) return Infinity;

  // Simulate lock
  const sim = board.map(row => [...row]);
  for (const [r, c] of getPieceCells(type, rotation, x, y)) {
    if (r >= 0 && r < BOARD_ROWS && c >= 0 && c < BOARD_COLS) {
      sim[r][c] = { type };
    }
  }

  // Clear lines
  const remaining = sim.filter(row => row.some(cell => cell === null));
  const linesCleared = BOARD_ROWS - remaining.length;
  const evalBoard = linesCleared > 0
    ? [...Array.from({ length: linesCleared }, () => Array(BOARD_COLS).fill(null)), ...remaining]
    : sim;

  // Metrics
  let aggregateHeight = 0;
  let holes = 0;
  let bumpiness = 0;
  const colHeights = [];

  for (let c = 0; c < BOARD_COLS; c++) {
    let colH = 0;
    for (let r = 0; r < BOARD_ROWS; r++) {
      if (evalBoard[r][c] !== null) { colH = BOARD_ROWS - r; break; }
    }
    colHeights.push(colH);
    aggregateHeight += colH;

    let foundBlock = false;
    for (let r = 0; r < BOARD_ROWS; r++) {
      if (evalBoard[r][c] !== null) foundBlock = true;
      else if (foundBlock) holes++;
    }
  }

  for (let c = 0; c < BOARD_COLS - 1; c++) {
    bumpiness += Math.abs(colHeights[c] - colHeights[c + 1]);
  }

  // Standard weights — tuned for decent play
  return (
    -7.6 * linesCleared +
    0.51 * aggregateHeight +
    3.6 * holes +
    0.18 * bumpiness
  );
}

/**
 * Compute the best placement and return a list of actions to execute.
 */
function computeMoves(board, piece) {
  if (!piece || !board) return [];

  let bestScore = Infinity;
  let bestRot = piece.rotation;
  let bestX = piece.x;

  for (let rot = 0; rot < 4; rot++) {
    for (let x = -2; x < BOARD_COLS + 2; x++) {
      const score = evaluatePlacement(board, piece.type, rot, x);
      if (score < bestScore) {
        bestScore = score;
        bestRot = rot;
        bestX = x;
      }
    }
  }

  const moves = [];

  // Rotations first (order matters — rotate before horizontal moves)
  let rotDiff = (bestRot - piece.rotation + 4) % 4;
  if (rotDiff === 3) {
    moves.push('rotateCCW');
  } else {
    for (let i = 0; i < rotDiff; i++) moves.push('rotateCW');
  }

  // Then horizontal moves
  const dx = bestX - piece.x;
  const dir = dx > 0 ? 'moveRight' : 'moveLeft';
  for (let i = 0; i < Math.abs(dx); i++) moves.push(dir);

  // Hard drop to lock instantly
  moves.push('hardDrop');

  return moves;
}

// ─── Helpers ────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getState(page) {
  return page.evaluate(() => window.__TETRIS_DEBUG__);
}

async function waitForPhase(page, phase, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await getState(page);
    if (state?.phase === phase) return state;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for phase: ${phase}`);
}

// ─── Test ───────────────────────────────────────────────────────

test.describe('Piano Tetris Bot', () => {
  test.setTimeout(300_000);

  test('plays tetris via sight-reading MIDI input', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    // 1. Connect MIDI simulator
    const midi = new MidiSimulator(WS_URL);
    await midi.connect();
    await sleep(300);

    // 2. Navigate to OfficeApp (at /office, not root)
    await page.goto('/office');
    await page.waitForLoadState('networkidle');
    await sleep(1000);

    // 3. Trigger piano via MIDI
    midi.sessionStart();
    await sleep(300);
    midi.noteOn(60, 80);
    await sleep(200);
    midi.noteOff(60);
    await page.waitForSelector('.piano-visualizer', { timeout: 10000 });

    // 4. Activate Tetris via MIDI combo (G1 + G7 = notes 31 + 103)
    // Using MIDI combo goes directly to tetris without cycling through rhythm first.
    await sleep(2000); // Wait for piano config API to load gamesConfig

    midi.noteOn(31, 80);
    midi.noteOn(103, 80);
    await sleep(400);
    midi.noteOff(31);
    midi.noteOff(103);
    await page.waitForSelector('.piano-tetris', { timeout: 15000 });

    // 5. Wait for PLAYING phase (after 3-2-1-GO countdown)
    await waitForPhase(page, 'PLAYING', 15000);

    // 6. Game loop — the bot plays until game over or max pieces
    const MAX_PIECES = 150; // Cap to keep test runtime reasonable
    let piecesPlayed = 0;
    let lastSpawnCount = -1; // Track which piece we already handled via spawnCount
    let idleLoops = 0;
    let lastScore = 0;
    let lastLines = 0;

    try {
      while (piecesPlayed < MAX_PIECES) {
        const state = await getState(page);
        if (!state || state.phase === 'GAME_OVER') {
          if (state) { lastScore = state.score ?? 0; lastLines = state.linesCleared ?? 0; }
          break;
        }
        // Track latest score/lines in case page closes
        lastScore = state.score ?? lastScore;
        lastLines = state.linesCleared ?? lastLines;

        if (state.phase !== 'PLAYING' || !state.currentPiece || !state.targets) {
          idleLoops++;
          if (idleLoops > 100) break;
          await sleep(100);
          continue;
        }
        idleLoops = 0;

        // Skip if we already handled this piece (spawnCount hasn't changed)
        if (state.spawnCount === lastSpawnCount) {
          await sleep(80);
          continue;
        }

        // Wait briefly for React state to settle after new piece spawn
        await sleep(120);

        // Re-read state after settle delay
        const settled = await getState(page);
        if (!settled || settled.phase !== 'PLAYING' || !settled.currentPiece || !settled.targets) continue;

        const piece = settled.currentPiece;

        // Compute optimal moves
        const moves = computeMoves(settled.board, piece);

        if (moves.length > 0) {
          // Execute each move by playing the matching MIDI notes
          for (const action of moves) {
            const current = await getState(page);
            if (!current || current.phase !== 'PLAYING' || !current.currentPiece) break;
            // If a new piece spawned during execution, abort this sequence
            if (current.spawnCount !== settled.spawnCount) break;

            const pitches = current.targets?.[action];
            if (!pitches?.length) continue;

            await midi.playNotes(pitches, 150);
            await sleep(100); // gap for React state to settle
          }
        }

        lastSpawnCount = settled.spawnCount;
        piecesPlayed++;
        await sleep(80);
      }
    } catch (e) {
      // Page may close after game over auto-deactivation — that's expected
    }

    // 7. Display results
    console.log('');
    console.log('  ╔══════════════════════════════════════╗');
    console.log('  ║       PIANO TETRIS BOT RESULTS       ║');
    console.log('  ╠══════════════════════════════════════╣');
    console.log(`  ║  Pieces Played: ${String(piecesPlayed).padStart(18)} ║`);
    console.log(`  ║  Lines Cleared: ${String(lastLines).padStart(18)} ║`);
    console.log(`  ║  Final Score:   ${String(lastScore).padStart(18)} ║`);
    console.log('  ╚══════════════════════════════════════╝');
    console.log('');

    expect(piecesPlayed).toBeGreaterThan(0);

    midi.close();
    await context.close();
  });
});
