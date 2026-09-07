// Measure the real piano-only gate markup on the kiosk canvas.
// Recovery labels must stay visible and the run must retain its notation space.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
 * The header bar eats the top of that canvas before the gate sees any of it.
 * `.piano-app` also contains `<PianoChrome/>` (PianoApp.jsx), `flex: 0 0 auto`
 * with `padding: .5rem 1rem` and a 1px bottom border, sized by a 2.5rem home
 * glyph and a user chip. Measuring without it measures a box ~8% taller than
 * the kiosk ever gives the gate.
 *
 * Its real height is content-driven and this fixture does not render the real
 * component (it needs the breadcrumb, config, user, sound and link-banner
 * providers — a lot of surface to drag in for a box whose only relevant
 * property is how tall it is). So it is pinned, deliberately PESSIMISTIC:
 * geometry that survives the worst case survives the real one, and the number
 * is stated rather than guessed at.
 *
 * 70px of CONTENT plus the sheet's own `padding: .5rem 0` and 1px bottom border
 * lands on an 87px border box — above the estimated real 55-70px, so the gate
 * is measured against strictly less room than the kiosk gives it.
 */
const CHROME_CONTENT_HEIGHT = 70;
/** The floor the measured header box must clear to count as a worst case. */
const CHROME_WORST_CASE = 70;

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

/**
 * Stable props, re-rendered by identity. `gateConfig` and the callbacks land in
 * the gate's own memo dependencies (GameGate.jsx:216) — a fresh literal on a
 * re-render rebuilds the attempt and throws the run's state away mid-test.
 */
// The repertoire is pinned to ONE cued tier-3 level on purpose. What is measured
// here is the notation stage — the paper card, the keyboard footer, the result
// panel — and the tier is what decides that a run mounts it at all. A gate left
// on the default repertoire would open at tier 2 (the sequence staff) and this
// file would silently measure a different box than the one it names.
const GATE_CONFIG = {
  repertoire: [{
    id: 'cued-scale',
    tier: 3,
    grading: { cleanliness: 0.8 },
    material: [{ kind: 'exercise', instanceId: 'scales/c-major@hands=2' }],
  }],
};
const NOOP = () => {};
const gateElement = () => (
  <MemoryRouter initialEntries={['/piano/games/tetris']}>
    <GameGate learnerId="learner4" gateConfig={GATE_CONFIG} gameLabel="Tetris" onPassed={NOOP} onLeave={NOOP} />
  </MemoryRouter>
);

/**
 * Render the real gate under happy-dom and hand back its settled markup. The
 * trigger gets the view, because MIDI now reaches the run through renders it
 * has to ask for: with no button to click, a run sitting in its ready phase
 * publishes no snapshots and would never see a mutated `h.activeNotes`.
 */
async function markupOf(trigger) {
  const view = render(gateElement());
  // The run arms itself from the piano now, so its ready phase has no button to
  // wait on — this hint is the settled-and-ready barrier in its place. The
  // gate's level is cued (`GATE_CONFIG`'s tier-3 level), so it is this hint.
  await screen.findByText(/Press any key to start\./);
  if (trigger) await trigger(view);
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
         <header class="piano-chrome" style="height: ${CHROME_CONTENT_HEIGHT}px"></header>
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
      chrome: read('.piano-chrome'),
      stage: read('.piano-game-fullscreen'),
      gate: read('.piano-game-gate'),
      run: read('.piano-exercise-run'),
      recovery: read('.piano-game-gate__piano-guidance'),
      exitHint: read('.piano-game-gate__exit-guidance'),
      buttonCount: document.querySelectorAll('button').length,
      actions: [...document.querySelectorAll('.piano-game-gate__actions li')].map((b) => {
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
        classes: b.className,
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
  it('uses the full attempt stage without pointer controls', async () => {
    const measured = await measure(page, css, await markupOf());
    expect(measured.buttonCount).toBe(0);
    expect(measured.chrome.height).toBeGreaterThanOrEqual(CHROME_WORST_CASE);
    expect(measured.stage.top).toBeGreaterThanOrEqual(measured.chrome.height);
    expect(measured.stage.bottom).toBeLessThanOrEqual(KIOSK.height);
    expect(measured.run.height).toBeGreaterThan(KIOSK.height * .7);
    expect(measured.gate.bottom).toBeLessThanOrEqual(KIOSK.height);
    expect(measured.documentScrolls).toBe(false);
  });

  it('keeps piano recovery choices visible after a real cued failure', async () => {
    const markup = await markupOf(async (view) => {
      const { act } = await import('@testing-library/react');
      vi.useFakeTimers();
      try {
        act(() => { h.activeNotes = new Map([[60, { velocity: 1 }]]); view.rerender(gateElement()); });
        act(() => { h.activeNotes = new Map(); view.rerender(gateElement()); });
        await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      } finally { vi.useRealTimers(); }
      await waitFor(() => expect(screen.getByText('Not this time')).toBeTruthy());
    });
    const measured = await measure(page, css, markup);
    expect(measured.buttonCount).toBe(0);
    expect(measured.recovery.withinViewport).toBe(true);
    expect(measured.exitHint.withinViewport).toBe(true);
    expect(measured.recovery.reachable).toBe(true);
    expect(measured.documentScrolls).toBe(false);
  });
});
