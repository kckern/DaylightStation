/**
 * Piano Game Load Test
 *
 * Verifies that all piano games can be activated and their lazy-loaded
 * components actually render. Catches stale-asset / chunk-loading failures
 * that occur when the browser has a cached main bundle but the server
 * has been redeployed with new chunk hashes.
 *
 * Run:
 *   npx playwright test tests/live/flow/piano/piano-game-load.runtime.test.mjs
 *   npx playwright test tests/live/flow/piano/piano-game-load.runtime.test.mjs --headed
 */

import { test, expect } from '@playwright/test';
import WebSocket from 'ws';
import { WS_URL } from '#fixtures/runtime/urls.mjs';

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
    this.sessionId = `test-${Date.now()}`;
    this.send({
      topic: 'midi',
      source: 'piano',
      type: 'session',
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      data: {
        event: 'session_start',
        sessionId: this.sessionId,
        device: 'Game Load Test',
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
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Game definitions ───────────────────────────────────────────

const GAMES = [
  {
    id: 'space-invaders',
    combo: [30, 102],       // F#1 + F#7
    selector: '.space-invaders-game',
    debugVar: '__SPACE_INVADERS_DEBUG__',
  },
  {
    id: 'tetris',
    combo: [31, 103],       // G1 + G7
    selector: '.piano-tetris',
    debugVar: '__TETRIS_DEBUG__',
  },
  {
    id: 'flashcards',
    combo: [29, 101],       // F1 + F7
    selector: '.piano-flashcards',
    debugVar: null,
  },
  {
    id: 'side-scroller',
    combo: [28, 100],       // E1 + E7
    selector: '.side-scroller',
    debugVar: '__SIDE_SCROLLER_DEBUG__',
  },
  {
    id: 'hero',
    combo: [32, 104],       // G#1 + G#7
    selector: '.piano-hero-placeholder',
    debugVar: null,
  },
];

// ─── Tests ──────────────────────────────────────────────────────

test.describe('Piano Game Loading', () => {
  test.setTimeout(120_000);

  for (const game of GAMES) {
    test(`${game.id}: lazy chunk loads and component renders`, async ({ browser }) => {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
      });
      const page = await context.newPage();

      // Collect console errors for diagnostics
      const errors = [];
      page.on('pageerror', (err) => errors.push(err.message));

      // 1. Connect MIDI simulator
      const midi = new MidiSimulator(WS_URL);
      await midi.connect();
      await sleep(300);

      // 2. Navigate to office screen
      await page.goto('/office');
      await page.waitForLoadState('networkidle');
      await sleep(1000);

      // 3. Trigger piano overlay via MIDI session_start
      midi.sessionStart();
      await sleep(300);
      midi.noteOn(60, 80);
      await sleep(200);
      midi.noteOff(60);
      await page.waitForSelector('.piano-visualizer', { timeout: 10000 });

      // 4. Wait for gamesConfig to load from API
      await sleep(2500);

      // 5. Activate game via MIDI combo
      midi.noteOn(game.combo[0], 80);
      midi.noteOn(game.combo[1], 80);
      await sleep(400);
      midi.noteOff(game.combo[0]);
      midi.noteOff(game.combo[1]);

      // 6. Verify the game component renders (lazy chunk loaded successfully)
      try {
        await page.waitForSelector(game.selector, { timeout: 15000 });
      } catch {
        const chunkErrors = errors.filter(e =>
          e.includes('dynamically imported module') || e.includes('chunk')
        );
        const errorDetail = chunkErrors.length > 0
          ? `Chunk load failure: ${chunkErrors[0]}`
          : `Component ${game.selector} not found. Errors: ${errors.join('; ') || 'none'}`;
        expect(false, errorDetail).toBe(true);
      }

      // 7. If there's a debug var, verify the game actually initialized
      if (game.debugVar) {
        const state = await page.evaluate((varName) => window[varName], game.debugVar);
        if (state) {
          expect(state.phase).toBeDefined();
        }
      }

      // Check no chunk-loading errors occurred
      const chunkErrors = errors.filter(e =>
        e.includes('dynamically imported module') || e.includes('chunk')
      );
      expect(chunkErrors, `Chunk load errors for ${game.id}`).toHaveLength(0);

      midi.close();
      await context.close();
    });
  }
});
