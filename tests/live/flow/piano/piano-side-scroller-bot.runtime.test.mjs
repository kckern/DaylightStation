/**
 * Piano Side-Scroller Bot
 *
 * A headed Playwright test that plays the side-scroller game in real-time by:
 * 1. Navigating to OfficeApp and triggering the piano visualizer via MIDI
 * 2. Activating the side-scroller game via MIDI combo (A1 + A7)
 * 3. Reading world state (via window.__SIDE_SCROLLER_DEBUG__)
 * 4. Detecting upcoming obstacles and deciding to jump or duck
 * 5. Sending matching MIDI notes via WebSocket to execute actions
 *
 * Run headed:
 *   npx playwright test tests/live/flow/piano/piano-side-scroller-bot.runtime.test.mjs --headed
 */

import { test, expect } from '@playwright/test';
import WebSocket from 'ws';
import { WS_URL } from '#fixtures/runtime/urls.mjs';

// ─── Constants ──────────────────────────────────────────────────

const PLAYER_X = 0.25;        // Must match sideScrollerEngine.js
const PLAYER_WIDTH = 0.04;
const REACTION_DISTANCE = 0.22; // How far ahead to start reacting to obstacles
const JUMP_DURATION_MS = 1200;  // Must match piano.yml jump_duration_ms

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
    this.sessionId = `scroller-bot-${Date.now()}`;
    this.send({
      topic: 'midi',
      source: 'piano',
      type: 'session',
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      data: {
        event: 'session_start',
        sessionId: this.sessionId,
        device: 'Side-Scroller Bot',
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

  /** Hold notes down (for sustained duck) — caller must release */
  holdNotes(notes) {
    for (const n of notes) this.noteOn(n);
  }

  /** Release previously held notes */
  releaseNotes(notes) {
    for (const n of notes) this.noteOff(n);
  }
}

// ─── Side-Scroller AI ───────────────────────────────────────────

/**
 * Find the nearest obstacle that hasn't been hit or dodged yet
 * and is approaching the player (to the right of, or overlapping, the player).
 */
function findNextObstacle(obstacles) {
  let nearest = null;
  let nearestDist = Infinity;

  for (const ob of obstacles) {
    if (ob.hit || ob.dodged) continue;
    // Only consider obstacles still to the right of (or at) the player
    const dist = ob.x - PLAYER_X;
    if (dist < -ob.width) continue; // already past player
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = ob;
    }
  }

  return nearest ? { obstacle: nearest, distance: nearestDist } : null;
}

/**
 * Decide what action to take based on the nearest obstacle.
 *
 * Returns: 'jump' | 'duck' | 'hold_duck' | 'release' | null
 * - 'jump': tap the jump notes (brief press)
 * - 'duck' / 'hold_duck': hold the duck notes
 * - 'release': stop ducking
 * - null: no action needed yet
 */
function decideAction(world, currentAction) {
  const next = findNextObstacle(world.obstacles);

  if (!next) {
    // No obstacles approaching — release duck if holding
    return currentAction === 'ducking' ? 'release' : null;
  }

  const { obstacle, distance } = next;

  // React when obstacle is within reaction distance
  if (distance > REACTION_DISTANCE) {
    return currentAction === 'ducking' ? 'release' : null;
  }

  if (obstacle.type === 'low') {
    // Jump over low obstacles — only if on the ground (not already jumping)
    if (world.playerState === 'jumping') return null;
    if (currentAction === 'ducking') return 'release'; // un-duck first
    return 'jump';
  }

  if (obstacle.type === 'high') {
    // Duck under high obstacles — sustain the duck
    if (world.playerState === 'jumping') return null; // can't duck while jumping
    return currentAction === 'ducking' ? null : 'duck';
  }

  return null;
}

// ─── Helpers ────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getState(page) {
  return page.evaluate(() => window.__SIDE_SCROLLER_DEBUG__);
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

test.describe('Piano Side-Scroller Bot', () => {
  test.setTimeout(300_000); // 5 min max

  test('plays side-scroller via sight-reading MIDI input', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    // 1. Connect MIDI simulator
    const midi = new MidiSimulator(WS_URL);
    await midi.connect();
    await sleep(300);

    // 2. Navigate to OfficeApp
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

    // 4. Activate Side-Scroller via MIDI combo (E1 + E7 = notes 28 + 100)
    await sleep(2000); // Wait for piano config API to load gamesConfig

    midi.noteOn(28, 80);
    midi.noteOn(100, 80);
    await sleep(400);
    midi.noteOff(28);
    midi.noteOff(100);
    await page.waitForSelector('.side-scroller', { timeout: 15000 });

    // 5. Wait for PLAYING phase (after 3-2-1-GO countdown)
    await waitForPhase(page, 'PLAYING', 15000);

    // 6. Game loop — the bot plays until game over or time limit
    const MAX_LOOPS = 5000;   // Safety cap
    let loopCount = 0;
    let dodgeCount = 0;
    let lastScore = 0;
    let lastLevel = 0;
    let lastHealth = 28;
    let currentAction = null;  // null | 'ducking'
    let duckNotes = [];        // currently held duck notes

    try {
      while (loopCount < MAX_LOOPS) {
        loopCount++;
        const state = await getState(page);

        if (!state || state.phase === 'GAME_OVER') {
          if (state) {
            lastScore = state.score ?? lastScore;
            lastLevel = state.level ?? lastLevel;
            lastHealth = state.health ?? 0;
          }
          break;
        }

        if (state.phase !== 'PLAYING') {
          await sleep(100);
          continue;
        }

        // Track stats
        lastScore = state.score ?? lastScore;
        lastLevel = state.level ?? lastLevel;
        lastHealth = state.health ?? lastHealth;

        const world = state.world;
        if (!world || !state.targets) {
          await sleep(50);
          continue;
        }

        dodgeCount = world.dodgeCount ?? dodgeCount;

        // Decide action
        const action = decideAction(world, currentAction);

        if (action === 'jump') {
          // Release duck first if needed
          if (currentAction === 'ducking' && duckNotes.length > 0) {
            midi.releaseNotes(duckNotes);
            duckNotes = [];
            currentAction = null;
            await sleep(50);
          }

          // Brief tap for jump
          const jumpPitches = state.targets.jump;
          if (jumpPitches?.length) {
            await midi.playNotes(jumpPitches, 200);
          }
        } else if (action === 'duck') {
          // Start holding duck notes
          const duckPitches = state.targets.duck;
          if (duckPitches?.length) {
            duckNotes = [...duckPitches];
            midi.holdNotes(duckNotes);
            currentAction = 'ducking';
          }
        } else if (action === 'release') {
          // Release duck
          if (duckNotes.length > 0) {
            midi.releaseNotes(duckNotes);
            duckNotes = [];
          }
          currentAction = null;
        }

        // Poll rate: ~30ms per loop for responsive reactions
        await sleep(30);
      }
    } catch (e) {
      // Page may close after game over auto-deactivation — that's expected
    }

    // Make sure we release any held notes
    if (duckNotes.length > 0) {
      midi.releaseNotes(duckNotes);
    }

    // 7. Display results
    console.log('');
    console.log('  ╔══════════════════════════════════════╗');
    console.log('  ║    PIANO SIDE-SCROLLER BOT RESULTS    ║');
    console.log('  ╠══════════════════════════════════════╣');
    console.log(`  ║  Obstacles Dodged: ${String(dodgeCount).padStart(15)} ║`);
    console.log(`  ║  Final Score:      ${String(lastScore).padStart(15)} ║`);
    console.log(`  ║  Level Reached:    ${String(lastLevel).padStart(15)} ║`);
    console.log(`  ║  Final Health:     ${String(lastHealth).padStart(15)} ║`);
    console.log(`  ║  Loop Iterations:  ${String(loopCount).padStart(15)} ║`);
    console.log('  ╚══════════════════════════════════════╝');
    console.log('');

    expect(dodgeCount).toBeGreaterThan(0);

    midi.close();
    await context.close();
  });
});
