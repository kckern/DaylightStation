// GameGate, MEASURED.
//
// The gate's Leave button is the only way out of a dead end: the run has
// settled into a state it cannot leave, its own header Exit is gone with it,
// and this button is what remains. `.piano-exercise-run` is
// `height: 100%; overflow: hidden` (Exercises.scss), so a Leave appended as a
// plain sibling after it lands below the fold — present in the DOM, tappable by
// a test, and off the bottom of a 1280x800 tablet.
//
// jsdom cannot see layout. `GameGate.test.jsx` therefore passes whether or not
// that button is reachable, which is precisely the class of regression this
// repo has shipped fully green before. So the geometry is asserted where a
// layout engine exists, following the pattern already checked in at
// `frontend/src/modules/Surround/band.measure.test.jsx`: compile the SHIPPED
// SCSS with `sass-embedded`, render the REAL component tree, and read pixels
// off headless Chromium.
//
// WHY THE MARKUP IS NOT HAND-WRITTEN. A fixture would drift from the JSX the
// moment either changed, and a stale fixture that measures fine is worse than
// no measurement. The DOM here is produced by rendering the real `GameGate`
// (with the real `ExerciseRun` inside it — only the MIDI/user contexts and the
// bank HTTP calls are doubled) under happy-dom, then handing that settled
// `innerHTML` to Chromium. What is measured is what the component builds.
//
// WHY THE PARENT BOX IS WHAT IT IS. `.piano-app` is `100vw/100vh`, a flex
// column, `overflow: hidden`. `GameHost` renders `.piano-game-fullscreen`
// directly inside it (PianoApp's <Routes> adds no wrapper of its own), and the
// gate replaces the game INSIDE that same stage (D11) — one route, one box.
// So that is the parent measured here: an earlier version of this file guessed
// at a `.piano-mode.piano-mode--games` wrapper that the seam turned out not to
// have, and a fixture that measures a box the app never builds is worth less
// than no measurement. The viewport is 1280x800 — the kiosk's declared design
// canvas (`display.designWidth/designHeight`), i.e. the SM-T590's CSS viewport.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, '../../../../../..');

const h = vi.hoisted(() => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), sampled: vi.fn() };
  logger.child = () => logger;
  return { logger, activeNotes: new Map() };
});

vi.mock('../../../../../lib/logging/Logger.js', () => ({ default: () => h.logger, getLogger: () => h.logger }));
vi.mock('../../PianoMidiContext.jsx', () => ({
  usePianoMidi: () => ({ connected: true }),
  usePianoMidiNotes: () => ({ activeNotes: h.activeNotes }),
}));
vi.mock('../../PianoUserContext.jsx', () => ({ usePianoUser: () => ({ currentUser: 'learner4' }) }));
// The engraver draws into a canvas happy-dom does not have, and the notation is
// not what is being measured — only the box it is given. A stand-in of the same
// size keeps the run's grid honest without a canvas.
vi.mock('../Exercises/ExerciseNotation.jsx', () => ({
  default: () => <div className="abc-renderer" style={{ height: '100%' }} />,
}));
vi.mock('../SheetMusic/useMetronomeClick.js', () => ({ useMetronomeClick: vi.fn() }));

const INSTANCE = {
  id: 'scales/c-major@hands=2',
  title: 'C major, both hands',
  form: 'scale',
  ordering: 'strict',
  key: 'C',
  meter: '4/4',
  tempo: { start_bpm: 90 },
  level: { free: 1 },
  supports: ['free', 'cued'],
  axes: { hands: 2 },
  events: [
    { id: 'first', value: 'quarter', notes: [{ midi: 60, hand: 'right' }] },
    { id: 'second', value: 'quarter', notes: [{ midi: 62, hand: 'right' }] },
  ],
};

vi.mock('../Exercises/pianoLearningApi.js', () => ({
  pianoLearningApi: {
    catalog: vi.fn(async () => ({
      ok: true,
      data: { seeds: [{ id: 'scales/c-major', category: 'scales', supports: ['free', 'cued'] }] },
    })),
    instances: vi.fn(async () => ({ ok: true, data: { instances: [INSTANCE] } })),
    instance: vi.fn(async () => ({ ok: true, data: INSTANCE })),
    program: vi.fn(async () => ({ ok: false, data: null })),
  },
}));

const { default: GameGate } = await import('./GameGate.jsx');

/** The kiosk's declared design canvas — the SM-T590's CSS viewport. */
const KIOSK = { width: 1280, height: 800 };

/**
 * Compile the sheets that actually govern this box: the app shell (`.piano-app`,
 * `.piano-mode`), the run (`.piano-exercise-run`), and the gate's own.
 */
async function compileSheet() {
  const sass = await import('sass-embedded');
  const sheets = [
    path.join(FRONTEND, 'src/Apps/PianoApp.scss'),
    path.join(HERE, '../Exercises/Exercises.scss'),
    path.join(HERE, 'GameGate.scss'),
  ];
  const out = [];
  for (const file of sheets) {
    out.push((await sass.compileAsync(file, { loadPaths: [path.dirname(file), FRONTEND] })).css);
  }
  // The shell's @font-face urls have no origin to resolve against in a
  // setContent page. Nothing here is measured against a font face, so drop them
  // rather than let Chromium log failed loads over the measurement.
  return out.join('\n').replace(/@font-face\s*\{[^}]*\}/g, '');
}

/** Render the real gate under happy-dom and hand back its settled markup. */
async function markupOf(trigger) {
  const view = render(
    <MemoryRouter initialEntries={['/piano/games/tetris']}>
      <GameGate learnerId="learner4" gateConfig={{}} onPassed={() => {}} onLeave={() => {}} />
    </MemoryRouter>
  );
  await screen.findByText('Begin challenge');
  if (trigger) await trigger();
  const html = document.body.firstElementChild.innerHTML;
  view.unmount();
  return html;
}

/**
 * Put that markup where the gate actually lives — inside the fullscreen game
 * stage `GameHost` mounts it into — and measure it at the kiosk canvas.
 */
async function measure(page, css, markup) {
  await page.setViewportSize(KIOSK);
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>
       html, body { margin: 0; padding: 0; }
       ${css}
     </style></head><body>
       <div class="piano-app">
         <div class="piano-game-fullscreen">${markup}</div>
       </div>
     </body></html>`,
    { waitUntil: 'load' },
  );
  return page.evaluate((viewport) => {
    const read = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const box = el.getBoundingClientRect();
      // Is the thing at the middle of this element actually this element? A
      // button that is present, on-screen and covered is still unreachable.
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return {
        top: box.top, bottom: box.bottom, left: box.left, right: box.right,
        width: box.width, height: box.height,
        withinViewport: box.top >= 0 && box.bottom <= viewport.height
          && box.left >= 0 && box.right <= viewport.width,
        reachable: Boolean(hit) && (hit === el || el.contains(hit)),
      };
    };
    return {
      viewport,
      gate: read('.piano-game-gate'),
      run: read('.piano-exercise-run'),
      leave: read('.piano-game-gate__leave'),
      actions: [...document.querySelectorAll('.piano-game-gate__actions button')].map((b) => {
        const box = b.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return {
          label: b.textContent,
          height: box.height, width: box.width,
          withinViewport: box.top >= 0 && box.bottom <= viewport.height,
          reachable: Boolean(hit) && (hit === b || b.contains(hit)),
        };
      }),
      // The buttons the RUN owns, inside the gate. Their paint is the whole
      // question for the cascade check below.
      runButtons: [...document.querySelectorAll('.piano-exercise-run button')].map((b) => ({
        label: b.textContent,
        background: getComputedStyle(b).backgroundColor,
      })),
      documentScrolls: document.documentElement.scrollHeight > viewport.height,
    };
  }, KIOSK);
}

let browser;
let page;
let css;

beforeAll(async () => {
  css = await compileSheet();
  const { chromium } = await import('playwright');
  browser = await chromium.launch();
  page = await browser.newPage();
}, 120_000);

afterAll(async () => { await browser?.close(); });

describe('GameGate geometry at the kiosk canvas (1280x800, real compiled SCSS)', () => {
  it('keeps the attempt-phase Leave button on screen, reachable, and a real tap target', async () => {
    const measured = await measure(page, css, await markupOf());

    expect(measured.leave, 'the Leave button is not in the rendered gate at all').not.toBeNull();
    expect(measured.leave.withinViewport,
      `Leave is off the kiosk canvas: bottom ${measured.leave.bottom}px vs viewport ${KIOSK.height}px`).toBe(true);
    expect(measured.leave.reachable, 'Leave is on screen but something is painted over it').toBe(true);
    // Touch-UI rule: discrete tap targets, sized for a child's fingertip.
    expect(measured.leave.height).toBeGreaterThanOrEqual(44);
    expect(measured.leave.width).toBeGreaterThanOrEqual(44);
  });

  it('gives the run the rest of the box rather than collapsing it to make room', async () => {
    // The failure mode on the other side of the fix: reserving the footer by
    // starving the run would leave a stave nobody can read.
    const measured = await measure(page, css, await markupOf());

    expect(measured.run.height).toBeGreaterThan(KIOSK.height * 0.7);
    // The run ends above the button, and the two do not overlap.
    expect(measured.run.bottom).toBeLessThanOrEqual(measured.leave.top + 0.5);
    expect(measured.gate.bottom).toBeLessThanOrEqual(KIOSK.height);
    expect(measured.documentScrolls,
      'the kiosk page scrolls — the canvas is fixed and nothing may push past it').toBe(false);
  });

  it('leaves the embedded run\'s buttons painted by the RUN, not restyled by the gate', async () => {
    // Two sheets, one element. `.piano-game-gate button` and
    // `.piano-exercise-run button` have identical specificity, and the gate's
    // sheet is imported later — so an unscoped `button` rule here silently
    // repaints "Begin challenge" and "Continue" as flat surface chrome. jsdom
    // resolves no cascade at all, so only a measurement can see it; the gate's
    // own rule is scoped to `> button` and `__actions button` for this reason.
    const measured = await measure(page, css, await markupOf());
    const dumped = JSON.stringify(measured.runButtons);
    const begin = measured.runButtons.find((b) => b.label === 'Begin challenge');

    expect(begin, `the run's primary action is not in the markup — ${dumped}`).toBeTruthy();
    // The run's accent — --ex-accent, i.e. --piano-accent #2ec46f.
    expect(begin.background, `Begin challenge lost the run's accent — ${dumped}`)
      .toBe('rgb(46, 196, 111)');
    // And nothing the run owns is wearing the GATE's surface (--gg-surface
    // #1f1f26), which is what an unscoped rule here paints them.
    for (const button of measured.runButtons) {
      expect(button.background, `${button.label} was repainted by the gate — ${dumped}`)
        .not.toBe('rgb(31, 31, 38)');
    }
  });

  it('puts all three failure buttons on screen as reachable tap targets', async () => {
    const markup = await markupOf(async () => {
      // Play the attempt to a genuine, completed miss: three wrong notes then
      // the two right ones. That is the real path to the fail panel.
      fireEvent.click(screen.getByText('Begin challenge'));
      const { act } = await import('@testing-library/react');
      const press = (midi) => {
        act(() => { h.activeNotes = new Map([[midi, { velocity: 1 }]]); });
        act(() => { h.activeNotes = new Map(); });
      };
      for (const midi of [61, 61, 61, 60, 62]) press(midi);
      await waitFor(() => expect(screen.getByText('Not this time')).toBeTruthy());
    });
    const measured = await measure(page, css, markup);

    expect(measured.actions.map((b) => b.label)).toEqual(['Try again', 'Practice this', 'Leave']);
    for (const button of measured.actions) {
      expect(button.withinViewport, `${button.label} is off the kiosk canvas`).toBe(true);
      expect(button.reachable, `${button.label} is covered by something`).toBe(true);
      expect(button.height, `${button.label} is under the tap-target floor`).toBeGreaterThanOrEqual(44);
    }
  });
});
