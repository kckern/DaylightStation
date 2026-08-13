/**
 * Piano Chess — layout stability.
 *
 * Three defects shipped to the tablet in one afternoon, all of the same kind:
 * a message changed and the furniture moved. The prompt grew by a line and
 * pushed the gesture cards down — and, through a flex free-space split, pulled
 * the in-hand socket UP. The read-out gained a fourth grid row the moment a
 * chord finally resolved, jumping everything below it 31px at the instant the
 * player was watching hardest.
 *
 * None of them were visible in the CSS. All three were found by driving the
 * real states and reading the geometry back, and in each case the first fix was
 * measurably wrong — a reserved height that was simply too low still let the
 * cards step 9px. That is why this is a test and not a comment: the invariant
 * is "nothing moves", and only a measurement can hold it.
 *
 * Run:
 *   npx playwright test tests/live/flow/piano/piano-chess-layout-stability.runtime.test.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');

/**
 * Every sentence the prompt can show. Kept here as literals because the source
 * imports vite-only aliases and cannot be loaded from node — so a drift guard
 * below reads the real file and fails if a message appears that this list has
 * never measured.
 */
const PROMPTS = [
  "Play a piece's chord twice to pick it up.",
  "Play a piece's two notes twice to pick it up.",
  'Play Am again to pick that piece up.',
  'Now play the chord of the square to move to.',
  'Now play the two notes of the square to move to.',
  'You are in check. Play a chord to answer it.',
  'Your opponent is thinking.',
  'That chord is not on the board. Try another.',
  'The game is over.',
  'Wait for your opponent.',
  'Nothing on that square.',
  'That piece belongs to your opponent.',
  'That piece has nowhere to go.',
  'That piece cannot reach that square.',
  'Checkmate. You win.',
  'Checkmate. Your opponent wins.',
  'Draw — stalemate.',
];

/**
 * The read-out's verdicts, read from the source at run time rather than copied.
 * The first version of this test hard-coded them, and when the copy was
 * shortened the test kept measuring a sentence the app no longer showed — a
 * fixture that fails for the wrong reason is worse than no fixture.
 */
const READOUT = readFileSync(
  resolve(REPO, 'frontend/src/modules/Piano/PianoChessGame/ChordReadout.jsx'),
  'utf8',
);
const verdictFor = (state) => {
  const line = new RegExp(`state === '${state}' && (?:\\(isReading \\? )?'([^']+)'`).exec(READOUT);
  return line?.[1] ?? null;
};
const VERDICTS = {
  idle: verdictFor('idle'),
  partial: verdictFor('partial'),
  unmapped: verdictFor('unmapped'),
};

/** The kiosk's MIDI input is bridge-first; without this the board never mounts. */
async function stubPianoBridge(page) {
  await page.addInitScript(() => {
    const Native = window.WebSocket;
    class BridgeSocket {
      constructor(url) {
        this.url = String(url);
        this.readyState = 0;
        window.setTimeout(() => { this.readyState = 1; this.onopen?.(new Event('open')); }, 0);
      }

      send() {}

      close() {
        if (this.readyState === 3) return;
        this.readyState = 3;
        this.onclose?.({ code: 1000, reason: 'test complete' });
      }
    }
    function TestWebSocket(url, protocols) {
      if (String(url).startsWith('ws://localhost:8770')) return new BridgeSocket(url);
      return protocols === undefined ? new Native(url) : new Native(url, protocols);
    }
    for (const key of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) TestWebSocket[key] = Native[key];
    window.WebSocket = TestWebSocket;
  });
}

async function openChess(page) {
  await stubPianoBridge(page);
  // The design canvas is 1280x800; at that size the scale is 1:1 and the
  // numbers below are layout pixels rather than scaled ones.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/piano/games/chess', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.chess-board__square', { timeout: 30_000 });
  await page.waitForSelector('.piano-chess__says', { timeout: 30_000 });
}

test.describe('Piano Chess layout stability', () => {
  test('the prompt changing moves nothing above or below it', async ({ page }) => {
    await openChess(page);

    const positions = await page.evaluate((messages) => {
      const prompt = document.querySelector('.piano-chess__prompt');
      const hand = document.querySelector('.piano-chess__hand');
      const cards = document.querySelector('.gesture-cards');
      const seen = [];
      for (const text of messages) {
        prompt.textContent = text;
        void document.body.offsetHeight; // force layout
        seen.push({
          text,
          handTop: Math.round(hand.getBoundingClientRect().top),
          cardsTop: Math.round(cards.getBoundingClientRect().top),
        });
      }
      return seen;
    }, PROMPTS);

    const handTops = [...new Set(positions.map((p) => p.handTop))];
    const cardTops = [...new Set(positions.map((p) => p.cardsTop))];

    // The socket ABOVE the prompt is the one that must never move: it is what a
    // stuck player is looking at when a refusal arrives.
    expect(handTops, `in-hand moved: ${JSON.stringify(positions)}`).toHaveLength(1);
    expect(cardTops, `gesture cards moved: ${JSON.stringify(positions)}`).toHaveLength(1);
  });

  test('the read-out resolving a square moves nothing below it', async ({ page }) => {
    await openChess(page);

    const states = await page.evaluate((verdicts) => {
      const readout = document.querySelector('.chess-readout');
      const line = readout.querySelector('.chess-readout__line');
      const cards = document.querySelector('.gesture-cards');
      const chord = readout.querySelector('.chess-readout__chord');
      const says = readout.querySelector('.chess-readout__says');
      const snap = (state) => {
        void document.body.offsetHeight;
        return {
          state,
          readoutH: Math.round(readout.getBoundingClientRect().height),
          cardsTop: Math.round(cards.getBoundingClientRect().top),
        };
      };
      const seen = [snap('idle')];

      if (chord) chord.textContent = '3 notes';
      says.textContent = verdicts.partial;
      seen.push(snap('partial'));

      if (chord) chord.textContent = 'Am';
      says.textContent = 'names';
      // The state that used to add a whole extra row.
      const square = document.createElement('span');
      square.className = 'chess-readout__square';
      square.textContent = 'a4';
      line.appendChild(square);
      seen.push(snap('square'));

      square.remove();
      says.textContent = verdicts.idle;
      if (chord) chord.textContent = '—';
      seen.push(snap('back to idle'));
      return seen;
    }, VERDICTS);

    const heights = [...new Set(states.map((s) => s.readoutH))];
    const tops = [...new Set(states.map((s) => s.cardsTop))];
    expect(heights, `read-out changed height: ${JSON.stringify(states)}`).toHaveLength(1);
    expect(tops, `gesture cards moved: ${JSON.stringify(states)}`).toHaveLength(1);
  });

  test('the board is horizontally centred, in both addressing vocabularies', async ({ page }) => {
    await openChess(page);

    const measure = () => page.evaluate(() => {
      const stage = document.querySelector('.piano-chess__stage').getBoundingClientRect();
      const board = document.querySelector('.chess-board').getBoundingClientRect();
      return {
        left: Math.round(board.left - stage.left),
        right: Math.round(stage.right - board.right),
        square: +(document.querySelector('.chess-board__square').getBoundingClientRect().width
          / document.querySelector('.chess-board__square').getBoundingClientRect().height).toFixed(2),
      };
    });

    const chords = await measure();
    // The board is the thing the player looks at, so the BOARD is centred — not
    // the frame, which includes the rim strip hanging off its left.
    expect(Math.abs(chords.left - chords.right), `board off centre: ${JSON.stringify(chords)}`).toBeLessThanOrEqual(2);
    expect(chords.square, 'squares must be square').toBe(1);

    // The reading vocabulary swaps the rim for staff cards and enlarges both
    // strips; centring must survive that, since it is the layout rule and not a
    // coincidence of the current label widths.
    await page.evaluate(() => document.querySelector('.piano-chess').classList.add('piano-chess--reading'));
    const reading = await measure();
    expect(Math.abs(reading.left - reading.right), `board off centre in reading mode: ${JSON.stringify(reading)}`).toBeLessThanOrEqual(2);
  });

  test('the read-out verdicts were found in the source, not assumed', () => {
    // If this fails the regexes above have gone stale and the state test has
    // been measuring nulls — which would pass while testing nothing.
    for (const [state, text] of Object.entries(VERDICTS)) {
      expect(text, `no verdict found for the "${state}" state`).toBeTruthy();
    }
    // The longest verdict is the one the reservation has to survive.
    expect(VERDICTS.partial.length, 'partial verdict grew — re-check the two-line reservation')
      .toBeLessThanOrEqual(34);
  });

  test('every shipped prompt message is one this suite has measured', async () => {
    // Drift guard: the lists above are literals because the source cannot be
    // imported from node. If someone adds a refusal message, this fails rather
    // than the new message silently going unmeasured.
    const state = readFileSync(resolve(REPO, 'frontend/src/modules/Piano/PianoChessGame/chessGameState.js'), 'utf8');
    const block = /REJECTION_MESSAGES = Object\.freeze\(\{([\s\S]*?)\}\)/.exec(state);
    expect(block, 'REJECTION_MESSAGES not found — did it move?').toBeTruthy();
    const shipped = [...block[1].matchAll(/:\s*'([^']+)'/g)].map((m) => m[1]);
    expect(shipped.length).toBeGreaterThan(0);
    for (const message of shipped) {
      expect(PROMPTS, `unmeasured refusal message: "${message}"`).toContain(message);
    }
  });
});
