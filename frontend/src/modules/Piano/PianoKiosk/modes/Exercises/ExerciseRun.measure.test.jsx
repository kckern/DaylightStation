// THE SCREEN A CHILD SEES, MEASURED.
//
// Every other spec on this surface renders under happy-dom, which has no layout
// engine and no SVG metrics. That is why the bug this branch started from — an
// empty bass clef under a treble dyad, with a notehead drawn off the bottom of
// the card — shipped through a fully green suite: nothing in the repo could see
// where a notehead landed, only that one existed. This file is the answer to
// that, and it is the only test on this surface that can fail for a reason a
// child would notice.
//
// ── WHY THIS ONE RUNS LIVE, WHERE ITS TWO SIBLINGS HAND OVER MARKUP ──────────
// `GameGate.measure.test.jsx` and `Surround/band.measure.test.jsx` render under
// happy-dom and hand the settled `innerHTML` to Chromium. That is exactly right
// for a box whose geometry is decided by the cascade alone, and it is NOT enough
// here, for a reason that is itself a measurement:
//
//   `ClefGlyph` (MusicNotation/renderers/staffGlyphs.jsx) sizes itself from its
//   own `getBBox()` and renders at `opacity: 0` until that returns a non-zero
//   box. happy-dom returns nothing, so in handed-over markup the clef is present
//   and INVISIBLE — and "the ask is on a treble staff" is one of the facts this
//   file exists to assert. The same is true of abcjs and of OSMD, both of which
//   engrave by measuring.
//
// So the real components are BUILT INTO A BROWSER BUNDLE (esbuild) and mounted
// in headless Chromium, over the SHIPPED SCSS compiled with `sass-embedded`.
// Nothing about the notation is emulated: abcjs draws tier 3, `SvgSequenceStaff`
// draws tiers 1-2, and OpenSheetMusicDisplay engraves the score fixture, all in
// a real layout engine at the kiosk's declared canvas.
//
// ── WHICH STYLESHEETS ARE COMPILED, AND WHY IT CANNOT DRIFT ──────────────────
// The bundler COLLECTS every `.scss`/`.css` the component graph imports and this
// file compiles exactly that list. A sheet added to a component tomorrow is
// compiled tomorrow, with nothing to remember. This matters: an earlier
// tier-2 measurement built on the GameGate harness compiled only the app shell,
// the run and the gate — `SvgSequenceStaff.scss` was absent, so the staff was
// measured with no paper card, no `overflow: hidden`, and none of its own box
// model. It measured the wrong element and would have passed a cropped staff.
//
// ── WHAT IS DOUBLED, EACH FOR A STATED REASON ────────────────────────────────
// Six modules, all of them I/O or hardware, none of them presentation:
//   Logger.js            — no log backend in a `setContent` page.
//   PianoMidiContext     — the piano. Replaced by a real external store the
//                          spec can push notes into; the run subscribes to it
//                          exactly as it subscribes to the real one.
//   PianoUserContext     — the roster fetch.
//   pianoLearningApi     — the exercise bank (HTTP).
//   lib/api.mjs          — the media tree (HTTP); `DaylightAPIText` serves the
//                          score fixture, which is how the score MATERIAL path
//                          is exercised end to end rather than stubbed past.
//   useMetronomeClick    — an AudioContext, which headless Chromium has no
//                          output device for. It is a sound, not a sight.
// `window.fetch` is stubbed to a 201 so the attempt-evidence POST — a real call
// the run makes on completion — resolves instead of logging a network failure
// over the measurement.
//
// ── THE BOX ──────────────────────────────────────────────────────────────────
// The kiosk canvas is 1280x800 (`display.designWidth/designHeight`, the
// SM-T590's CSS viewport), and the run is measured where the gate mounts it:
// inside `.piano-game-gate--attempt`, itself inside `.piano-game-fullscreen`,
// itself inside `.piano-app` under a pessimistic 70px header. The gate's Leave
// button is rendered as a sibling because the gate's column RESERVES it before
// the run gets its share — measuring without it would give the run more room
// than the kiosk ever does. Whether that button is reachable is
// `GameGate.measure.test.jsx`'s assertion, not this file's.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { keysInstance } from '../Games/gateMaterial.js';
import fourBars from './__fixtures__/fourBars.musicxml?raw';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, '../../../../../..');
const MAIN_FRONTEND = path.resolve(fs.realpathSync(path.join(FRONTEND, '../node_modules')), '../frontend');

/** The kiosk's declared design canvas — the SM-T590's CSS viewport. */
const KIOSK = Object.freeze({ width: 1280, height: 800 });
/**
 * The header bar's height, pinned and deliberately PESSIMISTIC — the same
 * number and the same argument as `GameGate.measure.test.jsx`, so the two files
 * measure the run against the same worst case.
 */
const CHROME_HEIGHT = 70;
/**
 * How long a played note is given to reach the screen.
 *
 * `createAssessmentRuntime` throttles its published store snapshot to 50ms
 * (`snapshotMs`, assessmentRuntime.js) and the run reads presses against that
 * published snapshot, so anything shorter than one throttle window measures the
 * frame BEFORE the press — and, worse, a second press inside the same window is
 * dropped. 80ms is that window with room to spare; it is a property of the
 * shipped runtime, not a hopeful sleep.
 */
const SETTLE = 80;
/**
 * The paper card's own box model: `.sequence-staff` is `border: 1px` +
 * `padding: 2px 0`, which is 2px across and 6px down. That is chrome, not
 * notation, and it is all the card is allowed to be — the assertions below pin
 * it at exactly this so a card that grew a real box model would be caught.
 *
 * It is no longer a TOLERANCE for overflow. The card sizes its BORDER box
 * (`box-sizing: border-box`, SvgSequenceStaff.scss), so the cap a host writes is
 * the cap the card obeys and the staff sits inside its container at the ordinary
 * half-pixel slack. Under the old content-box sizing the border box always stood
 * 6px proud of the row and the tier-1 assertion had to tolerate it; reverting
 * that one declaration fails this file.
 */
const CARD_HAIRLINE = 6;

/* -------------------------------------------------------------------------- */
/* The fixtures — the shape the gate actually serves                          */
/* -------------------------------------------------------------------------- */

/**
 * Tier 0's ask, built by the SHIPPED synthesizer rather than transcribed:
 * `keysInstance({ notes: 1 }, 0)` is literally what a tier-0 gate rung hands the
 * run. A transcription would keep passing after the synthesizer changed.
 */
const ONE_KEY = keysInstance({ notes: 1 }, 0);
/** Tier 1's treble dyad, likewise: C4 + E4, one event, `ordering: 'any'`. */
const TREBLE_DYAD = keysInstance({ notes: 2 }, 0);

/**
 * Tier 1's BASS dyad — G3 + C4, the exact ask task 6 fixed.
 *
 * `keysInstance` draws from C4 up and can never produce this, so it is authored
 * in that function's own shape. The staff's majority rule ties 1-1 here and a
 * tie goes treble, which puts G3 five steps below the bottom line, past the
 * bottom of the viewBox and under the card's `overflow: hidden`. The fix hands
 * the staff the clef the ask was JUDGED to fit on. That fix is invisible to
 * jsdom and plain to see here.
 */
const BASS_DYAD = Object.freeze({
  ...TREBLE_DYAD,
  id: 'keys/lit@notes=2,arrangement=together,bass',
  events: [{ id: 'lit-1', value: 'quarter', notes: [{ midi: 55, hand: 'left' }, { midi: 60, hand: 'left' }] }],
});

/** A C major right-hand scale, one octave: the tier-2 ask, eight notes. */
const SCALE_MIDIS = Object.freeze([60, 62, 64, 65, 67, 69, 71, 72]);
const scaleInstance = (midis) => Object.freeze({
  id: `scales/c-major@hands=1,notes=${midis.length}`,
  title: 'C major, right hand',
  form: 'scale',
  ordering: 'strict',
  key: 'C',
  meter: '4/4',
  tempo: { unit: 'quarter', start_bpm: 90 },
  level: { free: 1, cued: 2 },
  supports: ['free', 'cued'],
  axes: { hands: 1 },
  staff: 'treble',
  events: midis.map((midi, i) => ({ id: `n${i + 1}`, value: 'quarter', notes: [{ midi, hand: 'right' }] })),
});
const SCALE = scaleInstance(SCALE_MIDIS);
/** The SHORT ask: two notes, the aspect ratio at which the sizing cap bites. */
const SHORT_ASK = scaleInstance(SCALE_MIDIS.slice(0, 2));
/** A visibly rhythm-bearing free line for SP2's engraved presentation cell. */
const ENGRAVED_LINE = Object.freeze({
  ...scaleInstance([60, 62, 64, 65]),
  id: 'scales/c-major@engraved-rhythm',
  events: [
    { id: 'n1', value: 'quarter', notes: [{ midi: 60, hand: 'right' }] },
    { id: 'n2', value: 'half', notes: [{ midi: 62, hand: 'right' }] },
    { id: 'n3', value: 'eighth', notes: [{ midi: 64, hand: 'right' }] },
    { id: 'n4', value: 'eighth', notes: [{ midi: 65, hand: 'right' }] },
  ],
});

const RECALL_TUPLE = Object.freeze({
  prompt: 'recall', secondary: 'none', timing: 'free', hints: 'none', judging: 'completion',
});
const ENGRAVED_FREE_TUPLE = Object.freeze({
  prompt: 'read', secondary: 'keyboard-strip', notationStyle: 'engraved', timing: 'free', hints: 'none', judging: 'completion',
});
const SINGLE_NOTE_TUPLE = Object.freeze({
  prompt: 'read', secondary: 'staff', notationStyle: 'sequence', timing: 'free', hints: 'none', judging: 'completion',
});

/** A cued rung: the mode that makes tier 3, with a pace gate so the chip exists. */
const CUED_REQUIREMENT = Object.freeze({ mode: 'cued', gates: { pace: { target_bpm: 90 } } });
const FREE_REQUIREMENT = Object.freeze({ mode: 'free', rubric: { criteria: { completeness: 1 } }, passScore: null });

/** The score material a gate level names, and the bars a grown-up wrote down. */
const SCORE_MATERIAL = Object.freeze({
  kind: 'score', source: 'files:docs/sheet-music/four-bars.musicxml', measures: [2, 3],
});

/* -------------------------------------------------------------------------- */
/* The bundle                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The stand-ins, matched on the RESOLVED path of the real module so a rename
 * cannot silently leave the real one in the bundle (it would fail to build, or
 * fail to run, rather than quietly reach for the network).
 */
const STUBS = Object.freeze([
  [/lib\/logging\/Logger\.js$/, `
    const events = (globalThis.__logEvents = []);
    const rec = (level) => (event, data) => { events.push({ level, event, data }); };
    const L = { info: rec('info'), warn: rec('warn'), error: rec('error'), debug: rec('debug'), sampled: rec('debug') };
    L.child = () => L;
    export default () => L;
    export const getLogger = () => L;
  `],
  // The piano, as a real external store. The run subscribes through
  // useSyncExternalStore exactly as it does to the shipped context, so a press
  // pushed from the spec travels the same path a played note does.
  [/PianoKiosk\/PianoMidiContext\.jsx$/, `
    import { useSyncExternalStore } from 'react';
    let notes = new Map();
    const subs = new Set();
    const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
    const snapshot = () => notes;
    export function __setNotes(next) { notes = next; for (const fn of [...subs]) fn(); }
    export const usePianoMidi = () => ({ connected: true });
    export const usePianoMidiNotes = () => ({ activeNotes: useSyncExternalStore(subscribe, snapshot, snapshot) });
  `],
  [/PianoKiosk\/PianoUserContext\.jsx$/, `export const usePianoUser = () => ({ currentUser: 'learner4' });`],
  [/Exercises\/pianoLearningApi\.js$/, `
    export const pianoLearningApi = {
      instance: async () => ({ ok: Boolean(globalThis.__instance), data: globalThis.__instance ?? null }),
      instances: async () => ({ ok: false, data: null }),
      catalog: async () => ({ ok: false, data: null }),
      program: async () => ({ ok: false, data: null }),
    };
  `],
  [/SheetMusic\/useMetronomeClick\.js$/, `export const useMetronomeClick = () => {};`],
  [/lib\/api\.mjs$/, `
    export const DaylightAPIText = async () => {
      if (typeof globalThis.__scoreXml !== 'string') throw new Error('no score');
      return globalThis.__scoreXml;
    };
    export const DaylightAPI = async () => ({});
    export const DaylightMediaPath = (p) => p;
    export const DaylightImagePath = (p) => p;
    export const ContentDisplayUrl = (p) => p;
    export const DaylightHostPath = () => '';
    export const DaylightStatusCheck = async () => ({});
    export const DaylightWebsocketSubscribe = () => {};
    export const DaylightWebsocketUnsubscribe = () => {};
    export const normalizeImageUrl = (u) => u;
  `],
]);

/**
 * The page's whole API, written in the components' own directory so its imports
 * are the imports the components use. Everything it exposes is either a mount,
 * a key press, or a callback recorder — no geometry is computed here, because
 * geometry is what the browser is for.
 */
const ENTRY = `
import { createElement as h, Fragment } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import ExerciseRun from './ExerciseRun.jsx';
import ScorePassage from './ScorePassage.jsx';
import { MusicXmlRenderer } from '../../../../MusicNotation/renderers/MusicXmlRenderer.jsx';
import { loadAskSources } from '../../../ask/askResolution.js';
import { __setNotes } from '../../PianoMidiContext.jsx';

const calls = [];
let root = null;
const host = () => document.querySelector('.piano-game-gate--attempt');
const push = (name, value) => { calls.push({ name, value: value ?? null }); };

/**
 * A DOM node cannot cross the page/spec boundary, so the two callback payloads
 * that carry engraved elements are PROJECTED to the fields being asserted.
 * Nothing is decided here — every number below is the component's own.
 */
const projectExpectation = (e) => ({
  source: e?.source ?? null,
  tempoMap: e?.tempoMap ?? null,
  events: (e?.events ?? []).map((ev) => ({
    onsetQuarter: ev.onsetQuarter,
    spanId: ev.spanId ?? null,
    midis: (ev.notes ?? []).map((n) => n.midi),
  })),
});
const projectLayout = (l) => ({
  width: l?.width ?? null,
  height: l?.height ?? null,
  tempoEntries: l?.tempoEntries ?? [],
  steps: (l?.steps ?? []).map((s) => ({
    measure: s.measure,
    number: s.number,
    onsetQuarter: s.onsetQuarter,
    midis: (s.notes ?? []).map((n) => n.midi),
    engraved: (s.notes ?? []).every((n) => Boolean(n.el)),
  })),
});

window.__stage = {
  calls,
  reset() {
    if (root) { root.unmount(); root = null; }
    calls.length = 0;
    __setNotes(new Map());
    globalThis.__instance = null;
    globalThis.__scoreXml = null;
    if (globalThis.__logEvents) globalThis.__logEvents.length = 0;
  },
  /**
   * The run, where the gate mounts it, with the gate's reserved footer beside it.
   *
   * ExerciseRun resolves nothing for itself any more, so this stands in for
   * AskSession — through the SESSION'S OWN loader (loadAskSources), not a copy
   * of it. The media-tree fetch and the bank call are still in the path; only
   * the component that makes them moved. A scenario names its subject the way a
   * level does (material, or the stubbed bank via instance) and the settled
   * instance/score/requirement are what reach the run.
   */
  async mountRun({ instance = null, scoreXml = null, props = {} }) {
    globalThis.__instance = instance;
    globalThis.__scoreXml = scoreXml;
    const { material = null, requirementOverride = null, ...rest } = props;
    const sources = await loadAskSources({ material, requirementOverride });
    root = createRoot(host());
    flushSync(() => root.render(h(Fragment, null,
      h(ExerciseRun, {
        ...rest,
        instance: sources.instance,
        score: sources.score,
        requirement: sources.requirement,
        onExit: () => push('exit'),
        onPassed: (r) => push('passed', { score: r?.score ?? null }),
        onUnavailable: (reason) => push('unavailable', reason),
      }),
      h('button', { type: 'button', className: 'piano-game-gate__leave' }, 'Leave'),
    )));
  },
  /** The passage alone: what the engraving yields, and how it says it cannot. */
  mountPassage({ musicXml, measures = null }) {
    root = createRoot(host());
    flushSync(() => root.render(h(ScorePassage, {
      musicXml,
      sourceId: 'files:docs/sheet-music/four-bars.musicxml',
      measures,
      onExpectation: (e) => push('expectation', projectExpectation(e)),
      onUnrunnable: (reason) => push('unrunnable', reason),
    })));
  },
  /** The engraver alone: the geometry every score assertion above rests on. */
  mountEngraver({ musicXml }) {
    root = createRoot(host());
    flushSync(() => root.render(h(MusicXmlRenderer, {
      musicXml,
      onLayout: (l) => push('layout', projectLayout(l)),
      onFailed: (info) => push('failed', info?.error ?? 'failed'),
    })));
  },
  /** A key down and up, so the next press of the same pitch is a new onset. */
  async press(midi) {
    await window.__stage.hold([midi]);
    await window.__stage.hold([]);
  },
  /**
   * Keys held together, and then SETTLED, which is not politeness: the
   * assessment runtime publishes its store snapshot on a 50ms throttle and the
   * run reads presses against that published snapshot, so two presses inside
   * one window both see the pre-press state and the second is dropped. See
   * SETTLE in the spec for the measurement.
   */
  async hold(midis) {
    flushSync(() => __setNotes(new Map(midis.map((m) => [m, { velocity: 1 }]))));
    await new Promise((resolve) => setTimeout(resolve, ${SETTLE}));
  },
};
`;

/**
 * A package stylesheet's real path — or a THROW.
 *
 * The first version returned `null` here and let the build carry on with an
 * empty module, which meant that if `abcjs/abcjs-audio.css` ever moved, tier 3
 * would be measured with none of abcjs's own CSS and would stay green. That is
 * the precise class of silent omission this whole harness exists to end, so an
 * unresolvable sheet stops the run and names itself.
 */
function resolvePackageSheet(createRequire, resolveDir, specifier) {
  try { return createRequire(path.join(resolveDir, 'noop.js')).resolve(specifier); }
  catch (error) {
    throw new Error(
      `the component graph imports the stylesheet "${specifier}", which cannot be resolved from `
      + `${resolveDir}. Measuring without it would be measuring a screen the kiosk does not paint. `
      + `(${error?.message ?? error})`,
    );
  }
}

/**
 * Build the page bundle, and hand back the stylesheet list the graph asked for.
 * The two are produced by the same pass on purpose: the sheets compiled are the
 * sheets the components import, and there is no second list to keep true.
 */
async function buildBundle() {
  const { createRequire } = await import('node:module');
  const esbuild = createRequire(path.join(MAIN_FRONTEND, 'package.json'))('esbuild');
  const sheets = [];
  const plugin = {
    name: 'daylight-measure',
    setup(build) {
      build.onResolve({ filter: /\.(scss|css)$/ }, (args) => {
        // Relative and package specifiers both occur (`./Exercises.scss`,
        // `abcjs/abcjs-audio.css`). Resolving the second one as a relative path
        // invents a file that does not exist, which is how the first version of
        // this failed — loudly, which is the right way for it to fail.
        const file = args.path.startsWith('.') || path.isAbsolute(args.path)
          ? path.resolve(args.resolveDir, args.path)
          : resolvePackageSheet(createRequire, args.resolveDir, args.path);
        if (!sheets.includes(file)) sheets.push(file);
        return { path: file, namespace: 'daylight-sheet' };
      });
      build.onLoad({ filter: /.*/, namespace: 'daylight-sheet' }, () => ({ contents: '', loader: 'js' }));
      build.onLoad({ filter: /\.(js|jsx|mjs)$/ }, (args) => {
        for (const [pattern, contents] of STUBS) if (pattern.test(args.path)) return { contents, loader: 'jsx' };
        return null;
      });
    },
  };
  const built = await esbuild.build({
    stdin: { contents: ENTRY, resolveDir: HERE, loader: 'jsx', sourcefile: 'measure-entry.jsx' },
    bundle: true,
    format: 'iife',
    write: false,
    jsx: 'automatic',
    logLevel: 'silent',
    target: 'chrome120',
    loader: { '.jsx': 'jsx', '.js': 'jsx' },
    define: {
      'process.env.NODE_ENV': '"production"',
      'import.meta.env': JSON.stringify({ MODE: 'production', DEV: false, PROD: true }),
    },
    plugins: [plugin],
  });
  return { js: built.outputFiles[0].text, sheets };
}

/**
 * Compile the collected sheets, in cascade order.
 *
 * `PianoApp.scss` first — it declares the `--piano-*` tokens every other sheet
 * reads and owns `.piano-app` / `.piano-game-fullscreen`. `GameGate.scss` last,
 * because that is where it sits in the real bundle and its lateness is a known
 * hazard the gate's own sheet is scoped against. Everything between is the
 * graph's own order.
 *
 * `@font-face` blocks are dropped: their urls have no origin to resolve against
 * in a `setContent` page, and nothing here is measured against a font face.
 */
async function compileSheet(sheets) {
  const sass = await import('sass-embedded');
  const ordered = [
    path.join(FRONTEND, 'src/Apps/PianoApp.scss'),
    ...sheets,
    path.join(HERE, '../Games/GameGate.scss'),
  ];
  const seen = new Set();
  const out = [];
  for (const file of ordered) {
    if (seen.has(file)) continue;
    seen.add(file);
    out.push(file.endsWith('.css')
      ? fs.readFileSync(file, 'utf8')
      : (await sass.compileAsync(file, { loadPaths: [path.dirname(file), FRONTEND] })).css);
  }
  return out.join('\n').replace(/@font-face\s*\{[^}]*\}/g, '');
}

/* -------------------------------------------------------------------------- */
/* The page                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A clean kiosk, every time: the shell the gate mounts into, the compiled
 * stylesheet, and the bundle. Rebuilt per scenario rather than reset, so no
 * engraved SVG or lingering class from one tier can be measured in another.
 */
/**
 * A clean page per scenario, not a clean document.
 *
 * `setContent` alone leaves every previous scenario's heap — two megabytes of
 * engraver per mount — to the same renderer process, and by the twelfth mount
 * the engrave that takes eight seconds on a fresh page had not finished in
 * sixty. A new page costs milliseconds and makes each scenario's timing its own.
 */
async function openStage(css, js) {
  pageErrors = [];
  const previous = page;
  page = await browser.newPage({ deviceScaleFactor: 1 });
  page.on('pageerror', (error) => pageErrors.push(String(error?.stack || error)));
  await previous?.close();
  await page.setViewportSize(KIOSK);
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>
       html, body { margin: 0; padding: 0; }
       ${css}
     </style></head><body>
       <div class="piano-app">
         <header class="piano-chrome" style="height: ${CHROME_HEIGHT}px"></header>
         <div class="piano-game-fullscreen">
           <div class="piano-game-gate piano-game-gate--attempt"></div>
         </div>
       </div>
       <script>
         /* The attempt-evidence POST the run really makes on completion. */
         window.fetch = () => Promise.resolve({
           ok: true, status: 201, json: () => Promise.resolve({ attempt_id: 'measured' }),
         });
       </script>
     </body></html>`,
    { waitUntil: 'load' },
  );
  await page.addScriptTag({ content: js });
  await page.waitForFunction(() => typeof window.__stage?.mountRun === 'function');
}

/** The measurement vocabulary, installed in the page once per scenario. */
const PROBE = `(${function install() {
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const px = (name) => parseFloat(cs.getPropertyValue(name)) || 0;
    // The border box, the content box, and the difference. `.sequence-staff`
    // sets `box-sizing: border-box`, so a size cap written against it governs
    // the BORDER box and `height`/`width` are the tight numbers; `content*` is
    // looser by exactly the card's own chrome. Both are published because which
    // one an assertion should use depends on the element's own box-sizing, and
    // getting that backwards is how a check goes quietly slack.
    const chromeX = px('border-left-width') + px('border-right-width') + px('padding-left') + px('padding-right');
    const chromeY = px('border-top-width') + px('border-bottom-width') + px('padding-top') + px('padding-bottom');
    return {
      top: r.top, bottom: r.bottom, left: r.left, right: r.right,
      width: r.width, height: r.height,
      contentWidth: r.width - chromeX, contentHeight: r.height - chromeY,
      chromeX, chromeY,
      cx: r.left + r.width / 2, cy: r.top + r.height / 2,
      opacity: Number(cs.opacity),
      visibility: cs.visibility,
      background: cs.backgroundColor,
      text: (el.textContent || '').trim(),
      painted: r.width > 0 && r.height > 0 && Number(cs.opacity) > 0 && cs.visibility !== 'hidden',
      reachable: Boolean(hit) && (hit === el || el.contains(hit)),
      lineOffset: el.getAttribute ? el.getAttribute('data-line-offset') : null,
      midi: el.getAttribute ? el.getAttribute('data-midi') : null,
    };
  };
  window.__probe = {
    one: (sel) => { const el = document.querySelector(sel); return el ? rect(el) : null; },
    all: (sel) => [...document.querySelectorAll(sel)].map(rect),
    count: (sel) => document.querySelectorAll(sel).length,
    text: () => document.body.innerText,
    /** Every button the RUN owns, by label — the gate's Leave is not one of them. */
    runButtons: () => [...document.querySelectorAll('.piano-exercise-run button')]
      .map((b) => (b.textContent || '').trim()),
    prop: (sel, name) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).getPropertyValue(name).trim() : null;
    },
  };
}})()`;

/** Is `inner` wholly inside `outer`? Half a pixel of slack for sub-pixel layout. */
const inside = (inner, outer, slack = 0.5) => Boolean(inner) && Boolean(outer)
  && inner.top >= outer.top - slack && inner.bottom <= outer.bottom + slack
  && inner.left >= outer.left - slack && inner.right <= outer.right + slack;

const onCanvas = (box, slack = 0.5) => Boolean(box)
  && box.top >= -slack && box.bottom <= KIOSK.height + slack
  && box.left >= -slack && box.right <= KIOSK.width + slack;

/** A compact, printable description of a box, for failure messages. */
const say = (box) => (box
  ? `${box.width.toFixed(1)}x${box.height.toFixed(1)} at (${box.left.toFixed(1)}, ${box.top.toFixed(1)})`
  : 'absent');

/** Clef glyph codepoints, as `ClefGlyph` writes them. */
const TREBLE_GLYPH = '\u{1D11E}';
const BASS_GLYPH = '\u{1D122}';

/**
 * Staves, counted across every stage that can draw one. Tier 0 must show ZERO
 * of these and every other tier exactly one — and the specific failure this
 * counts against is the one that started the branch: a grand staff drawing an
 * empty bass clef under a treble ask reads as TWO.
 */
const STAFF_SELECTOR = '.sequence-staff, .abcjs-staff, .piano-score-passage .musicxml-renderer__svg';

let browser;
let page;
let css;
let js;
/**
 * Anything the page threw. A component that dies mid-mount renders nothing and
 * every assertion below it then fails as a timeout, which reads as "slow" and is
 * not — so the throw is captured and reported instead of guessed at.
 */
let pageErrors = [];

beforeAll(async () => {
  const bundle = await buildBundle();
  js = bundle.js;
  css = await compileSheet(bundle.sheets);
  // Fails CLOSED. An absent Chromium throws here and errors the whole suite;
  // it never skips, because a measurement nobody made is not a measurement.
  const { chromium } = await import('playwright');
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => { await browser?.close(); });

/** Mount a run and wait for the ready line the given mode promises. */
async function run({ instance = null, scoreXml = null, props = {} }, readyText) {
  await openStage(css, js);
  await page.evaluate(PROBE);
  await page.evaluate((arg) => window.__stage.mountRun(arg), { instance, scoreXml, props });
  await page.waitForFunction(
    (needle) => document.body.innerText.includes(needle),
    readyText,
    { timeout: 30_000 },
  );
  expectNoPageErrors();
}

/** Nothing on this screen may have thrown to get here. */
function expectNoPageErrors() {
  expect(pageErrors, `the page threw while rendering:\n${pageErrors.join('\n')}`).toEqual([]);
}

const FREE_READY = 'Play the first note to begin.';
const CUED_READY = 'Press any key to start.';

const probe = {
  one: (sel) => page.evaluate((s) => window.__probe.one(s), sel),
  all: (sel) => page.evaluate((s) => window.__probe.all(s), sel),
  count: (sel) => page.evaluate((s) => window.__probe.count(s), sel),
  text: () => page.evaluate(() => window.__probe.text()),
  runButtons: () => page.evaluate(() => window.__probe.runButtons()),
  prop: (sel, name) => page.evaluate(([s, n]) => window.__probe.prop(s, n), [sel, name]),
  press: (midi) => page.evaluate((m) => window.__stage.press(m), midi),
  hold: (midis) => page.evaluate((m) => window.__stage.hold(m), midis),
  calls: () => page.evaluate(() => window.__stage.calls),
};

/* -------------------------------------------------------------------------- */

describe('the exercise run, per tier, in a real layout engine at 1280x800', () => {
  it('measures against the staff\'s OWN stylesheet, not just the app shell', () => {
    // The guard for the mistake this harness was built to stop repeating: an
    // earlier tier-2 measurement compiled the shell, the run and the gate and
    // silently left `SvgSequenceStaff.scss` out, so it measured a staff with no
    // paper card, no padding, no border and no `overflow: hidden` — a box the
    // kiosk never draws.
    //
    // EVERY SELECTOR BELOW IS UNIQUE TO THE SHEET IT GUARDS, and that is the
    // whole design of this case. The first version asserted `.sequence-staff`
    // and `.piano-key`, which cannot fail: the first is emitted by
    // `Exercises.scss` and the second by nine sheets including the shell that
    // `compileSheet` force-prepends — so the collection could drop the staff's
    // and the keyboard's sheets entirely and this would stay green, which is
    // exactly the silent omission it exists to catch.
    const OWNED = [
      // SvgSequenceStaff.scss — the paper card, the ink, the cursor lane and the
      // ghost's colours. Nothing else in frontend/src/**/*.scss names these.
      ['.sequence-note-wrong-ghost', 'SvgSequenceStaff.scss', 'the wrong-note ghost would have no colour of its own'],
      ['.sequence-staff__ghost-accidental', 'SvgSequenceStaff.scss', 'the staff\'s own sheet is missing'],
      ['.sequence-staff__cursor', 'SvgSequenceStaff.scss', 'the cursor lane would be invisible'],
      // PianoKeyboard.scss — `.piano-key` alone proves nothing (the shell has it).
      ['.target-dim', 'PianoKeyboard.scss', 'a lit key would be painted like any other'],
      ['.rebuild-bar', 'PianoKeyboard.scss', 'the keyboard\'s own sheet is missing'],
      // Exercises.scss — the run, its stage rows, and the tier-2 size cap.
      ['--staff-aspect', 'Exercises.scss', 'the tier-2 size cap would not exist'],
      // PianoApp.scss — the shell, force-prepended, so this one IS vacuous by
      // construction and is here only to say the compile produced anything.
      ['.piano-game-fullscreen', 'PianoApp.scss', 'nothing would have the kiosk box'],
    ];
    for (const [selector, sheet, consequence] of OWNED) {
      expect(css, `${sheet} was not compiled into the measured stylesheet — ${consequence}`)
        .toContain(selector);
    }
  });

  /* ── Tier 0 — one lit key, and nothing else on the screen ───────────────── */

  it('tier 0 shows a lit key, an ask, and NO staff of any kind', async () => {
    await run({ instance: ONE_KEY, props: { tier: 0, ask: 'Press the lit key.', intent: 'practice', practiceMode: 'free' } }, FREE_READY);

    // A staff here is the whole failure: a four-year-old asked to press one key
    // is being shown notation they cannot read. One would mean the stage table
    // sent tier 0 to `sequence`; two would be the grand staff this redesign
    // replaced.
    expect(await probe.count(STAFF_SELECTOR),
      'tier 0 drew a staff — the lit key is the entire reading task at this rung').toBe(0);

    const stage = await probe.one('.piano-exercise-run__ask');
    const keyboard = await probe.one('.keys-ask__keys .piano-keyboard');
    expect(keyboard, 'no keyboard rendered at all').not.toBeNull();
    expect(inside(keyboard, stage), `the keyboard ${say(keyboard)} is outside its stage row ${say(stage)}`).toBe(true);

    // THE LIT KEY, as a child sees it: a real box, on screen, wearing paint no
    // other key wears. `data-note` is jsdom-visible and proves nothing; the
    // background is what makes it lit.
    const lit = await probe.all('.piano-key.target');
    expect(lit.length, 'exactly one key should be lit for a one-key ask').toBe(1);
    expect(lit[0].painted, `the lit key is not painted: ${say(lit[0])}`).toBe(true);
    expect(lit[0].width).toBeGreaterThan(10);
    expect(onCanvas(lit[0]), `the lit key is off the kiosk canvas: ${say(lit[0])}`).toBe(true);
    expect(lit[0].reachable, 'the lit key is on screen but covered').toBe(true);

    const plain = await probe.all('.piano-key.white:not(.target)');
    expect(plain.length).toBeGreaterThan(0);
    expect(lit[0].background,
      `the lit key is painted exactly like an unlit one (${plain[0].background}) — nothing on this screen says which key to press`)
      .not.toBe(plain[0].background);

    // The ask is READ BEFORE anything is played, and it is the run's heading.
    const heading = await probe.one('.piano-exercise-run__head h1');
    expect(heading.text).toBe('Press the lit key.');
    expect(heading.painted && onCanvas(heading), `the ask line is not legible on canvas: ${say(heading)}`).toBe(true);

    // No button starts this: the piano does.
    expect(await probe.runButtons()).toEqual(['Exit']);
  });

  it('tier 0 tells a child how it went in words, with no percentage on the screen', async () => {
    await run({ instance: ONE_KEY, props: { tier: 0, ask: 'Press the lit key.', intent: 'practice', practiceMode: 'free' } }, FREE_READY);
    // `ordering: 'any'` material is graded by the held matcher: press and hold.
    await probe.hold(ONE_KEY.events[0].notes.map((n) => n.midi));
    // THE VERDICT IS SHOUTED. `.piano-exercise-run__result` uppercases it in CSS
    // (`text-transform`), so the words on the screen are PASSED and the words in
    // the JSX are "Passed" — a jsdom test can only ever see the second. Waiting
    // for the first is the difference between asserting the markup and asserting
    // the screen.
    await page.waitForFunction(() => document.body.innerText.includes('PASSED'));

    const panel = await probe.one('.piano-exercise-run__result');
    expect(panel.painted && onCanvas(panel), `the result panel is not on canvas: ${say(panel)}`).toBe(true);
    expect(panel.text).toContain('You played every note that was asked for.');
    expect(panel.text, 'a percentage reached a tier-0 screen').not.toMatch(/%/);
  });

  /* ── Tier 1 — a dyad, and the small staff that reinforces it ────────────── */

  it('tier 1 draws exactly one staff, on the treble clef, with both noteheads on it', async () => {
    await run({ instance: TREBLE_DYAD, props: { tier: 1, ask: 'Play both lit keys together.', intent: 'practice', practiceMode: 'free' } }, FREE_READY);

    expect(await probe.count(STAFF_SELECTOR), 'tier 1 should reinforce the keys with ONE staff').toBe(1);
    expect(await probe.count('.abcjs-staff'), 'tier 1 mounted the ABC notation stage').toBe(0);

    const staff = await probe.one('.sequence-staff');
    const card = await probe.one('.keys-ask__staff');
    const stage = await probe.one('.piano-exercise-run__ask');
    expect(staff.painted && onCanvas(staff), `the staff is not on canvas: ${say(staff)}`).toBe(true);
    // The card sizes the staff (`max-width: min(100%, 28rem)`) and the staff
    // sizes its BORDER box, so nothing of it — border included — may sit
    // outside the card. No overflow tolerance: this is the assertion that the
    // one-line box-sizing fix bought, and it fails without it.
    expect(staff.chromeX, 'the staff card grew a real box model').toBeLessThanOrEqual(CARD_HAIRLINE);
    expect(inside(staff, card), `the staff ${say(staff)} overflows its card ${say(card)}`).toBe(true);
    expect(inside(await probe.one('.action-staff__staff-area'), stage),
      'the staff\'s ink is drawn outside the stage row that clips it').toBe(true);

    // THE CLEF, AS DRAWN. `ClefGlyph` renders at opacity 0 until its own
    // getBBox() sizes it — so a non-zero opacity here is the proof that the
    // glyph was measured and placed, which is exactly what no jsdom test can
    // establish.
    const clefs = await probe.all('.action-staff__notation-svg > text');
    expect(clefs.length, 'no clef glyph was drawn').toBe(1);
    expect(clefs[0].text, 'a C4+E4 dyad was not engraved on a treble clef').toBe(TREBLE_GLYPH);
    expect(clefs[0].opacity, 'the clef never sized itself — it is invisible on screen').toBe(1);
    expect(inside(clefs[0], staff), `the clef ${say(clefs[0])} is drawn outside the staff ${say(staff)}`).toBe(true);

    const heads = await probe.all('.action-staff__note');
    expect(heads.length, 'a two-note dyad should draw two noteheads').toBe(2);
    for (const head of heads) {
      expect(inside(head, staff),
        `notehead midi ${head.midi} at ${say(head)} is outside the staff ${say(staff)}`).toBe(true);
    }
  });

  it('tier 1 puts a G3+C4 ask on a BASS staff, with both notes on the card', async () => {
    // The task-6 fix, made visual. The staff's own majority rule ties 1-1 here
    // and a tie goes treble, which draws G3 at staff position -5 — below the
    // viewBox and clipped away by the card's `overflow: hidden`. The clef the
    // ask was judged to fit on has to travel with it, and this is where that
    // shows.
    await run({ instance: BASS_DYAD, props: { tier: 1, ask: 'Play both lit keys together.', intent: 'practice', practiceMode: 'free' } }, FREE_READY);

    expect(await probe.count(STAFF_SELECTOR)).toBe(1);
    const staff = await probe.one('.sequence-staff');
    const clefs = await probe.all('.action-staff__notation-svg > text');
    expect(clefs[0].text, 'a G3+C4 ask was drawn on a treble staff — G3 falls off the bottom of the card').toBe(BASS_GLYPH);
    expect(clefs[0].opacity).toBe(1);

    const heads = await probe.all('.action-staff__note');
    expect(heads.map((h) => h.midi).sort()).toEqual(['55', '60']);
    for (const head of heads) {
      expect(inside(head, staff),
        `notehead midi ${head.midi} at ${say(head)} is off the staff card ${say(staff)} — this is the bug this branch opened on`)
        .toBe(true);
      expect(onCanvas(head), `notehead midi ${head.midi} is off the kiosk canvas: ${say(head)}`).toBe(true);
    }
    // The two notes are a fifth apart and must READ as a fifth: different lines.
    expect(Math.abs(heads[0].cy - heads[1].cy),
      'the two noteheads are drawn at the same height — the interval is invisible').toBeGreaterThan(4);
  });

  /* ── Tier 2 — the sequence staff IS the screen ──────────────────────────── */

  it('tier 2 engraves all eight notes on one treble staff, inside the row it was given', async () => {
    await run({ instance: SCALE, props: { tier: 2, ask: 'Play C major, right hand.', intent: 'practice', practiceMode: 'free' } }, FREE_READY);

    expect(await probe.count(STAFF_SELECTOR), 'tier 2 should draw exactly one staff').toBe(1);
    expect(await probe.count('.abcjs-staff')).toBe(0);

    const stage = await probe.one('.piano-exercise-run__stage');
    const container = await probe.one('.piano-exercise-run__sequence');
    const staff = await probe.one('.sequence-staff');

    // THE SIZING CONTRACT (Exercises.scss): the host caps the staff's width at
    // `aspect x row height` on a `container-type: size` wrapper, so the derived
    // height can never exceed the row and be cropped by the card's
    // `overflow: hidden`. No committed test asserted any of this before.
    expect(await probe.prop('.piano-exercise-run__sequence', '--staff-aspect'),
      'the host did not publish the staff aspect the cap is computed from').not.toBe('');
    // The cap governs the BORDER box (`box-sizing: border-box`), so that is the
    // number it must hold for. Asserting `contentHeight` here would be the loose
    // check — slack by exactly the 6px of chrome the card carries, which is the
    // whole of what used to overflow — and it would pass a card that spills.
    expect(staff.height, `the staff ${say(staff)} is taller than its row ${say(container)}`)
      .toBeLessThanOrEqual(container.height + 0.5);
    expect(staff.width).toBeLessThanOrEqual(container.width + 0.5);
    // Nothing may sit proud of the row now — but the card's box model is still
    // pinned, so a card that grew one would be caught here rather than absorbed.
    expect(staff.chromeY, 'the staff card grew a real box model').toBeLessThanOrEqual(CARD_HAIRLINE);
    expect(inside(await probe.one('.action-staff__staff-area'), stage),
      'the staff\'s ink is drawn outside the stage row that clips it').toBe(true);
    expect(onCanvas(staff), `the staff is off the kiosk canvas: ${say(staff)}`).toBe(true);
    // And it is actually a staff, not a sliver: the run gives it the row.
    expect(staff.height).toBeGreaterThan(60);

    const clefs = await probe.all('.action-staff__notation-svg > text');
    expect(clefs[0].text, 'a right-hand C major scale was not engraved on a treble clef').toBe(TREBLE_GLYPH);
    expect(clefs[0].opacity).toBe(1);

    const heads = await probe.all('.action-staff__note');
    expect(heads.map((h) => Number(h.midi)), 'the engraved noteheads are not the ask').toEqual([...SCALE_MIDIS]);
    for (const head of heads) {
      expect(inside(head, staff),
        `notehead midi ${head.midi} at ${say(head)} is outside the staff ${say(staff)}`).toBe(true);
    }
    // Eight notes, left to right, each clear of the last.
    for (let i = 1; i < heads.length; i += 1) {
      expect(heads[i].cx, `notehead ${i} is not to the right of notehead ${i - 1}`).toBeGreaterThan(heads[i - 1].cx);
    }

    // The cursor is a LANE behind the note that is next, and it has to be over
    // the first one before a key is touched.
    const cursor = await probe.one('.sequence-staff__cursor');
    expect(cursor, 'no cursor lane was drawn').not.toBeNull();
    expect(cursor.cx, `the cursor ${say(cursor)} is not over notehead 0 ${say(heads[0])}`)
      .toBeGreaterThan(heads[0].left - cursor.width);
    expect(cursor.cx).toBeLessThan(heads[0].right + cursor.width);
    expect(inside(cursor, staff)).toBe(true);
  });

  it('tier 2 does not crop a SHORT ask, which is where the size cap actually bites', async () => {
    // Two notes make a nearly square viewBox (100 x 112, aspect 0.89). Without
    // the container-query cap the staff would take the row's full width and
    // derive a height of width/aspect — far taller than the row — and the card
    // would clip it. The assertion below is only meaningful if that is true
    // here, so the uncapped height is computed and asserted to overflow first:
    // a vacuous pass is not a pass.
    await run({ instance: SHORT_ASK, props: { tier: 2, ask: 'Play two notes.', intent: 'practice', practiceMode: 'free' } }, FREE_READY);

    const container = await probe.one('.piano-exercise-run__sequence');
    const staff = await probe.one('.sequence-staff');
    const aspect = Number(await probe.prop('.piano-exercise-run__sequence', '--staff-aspect'));
    expect(Number.isFinite(aspect) && aspect > 0, 'the staff aspect was not published').toBe(true);

    const uncapped = container.width / aspect;
    expect(uncapped,
      `this case no longer exercises the cap: a full-width staff would be ${uncapped.toFixed(1)}px tall in a ${container.height.toFixed(1)}px row`)
      .toBeGreaterThan(container.height);

    expect(staff.contentHeight, `the short ask's staff ${say(staff)} is taller than its row ${say(container)} — it is being cropped`)
      .toBeLessThanOrEqual(container.height + 0.5);
    expect(staff.width).toBeLessThan(container.width);

    const heads = await probe.all('.action-staff__note');
    expect(heads.length).toBe(2);
    for (const head of heads) {
      expect(inside(head, staff), `notehead midi ${head.midi} at ${say(head)} is cropped out of ${say(staff)}`).toBe(true);
      expect(onCanvas(head)).toBe(true);
    }
    const clefs = await probe.all('.action-staff__notation-svg > text');
    expect(clefs[0].opacity, 'the clef vanished when the staff was capped').toBe(1);
    expect(inside(clefs[0], staff)).toBe(true);
  });

  it('tier 2 draws a wrong note at ITS OWN height, and moves the cursor on', async () => {
    await run({ instance: SCALE, props: { tier: 2, ask: 'Play C major, right hand.', intent: 'practice', practiceMode: 'free' } }, FREE_READY);

    const before = await probe.all('.action-staff__note');
    await probe.press(60);              // arms the run and grades note one
    // HELD, not pressed-and-released: the ghost is real-time off the currently
    // held set (SvgSequenceStaff's own contract — rule 4, "ghosts clear on
    // key-up"), so it only exists while this key is actually down.
    await probe.hold([61]);             // a semitone under the expected 62

    await page.waitForFunction(() => document.querySelector('.sequence-note-wrong-ghost') !== null);
    const staff = await probe.one('.sequence-staff');
    const ghost = await probe.one('.sequence-note-wrong-ghost');
    expect(ghost.midi).toBe('61');
    expect(ghost.painted, `the wrong-note ghost is not painted: ${say(ghost)}`).toBe(true);
    expect(inside(ghost, staff), `the ghost ${say(ghost)} is drawn off the staff ${say(staff)}`).toBe(true);

    // THE WHOLE POINT OF THE GHOST: it stands at the position of the note that
    // was PLAYED, not at the position of the note that was owed. A child who
    // can only see that they are wrong learns nothing; one who can see they are
    // a step low learns where they are. `data-line-offset` is that contract, and
    // this is the assertion that makes it visible.
    const target = (await probe.all('.action-staff__note'))[1];
    expect(ghost.lineOffset, 'the ghost is drawn at the target\'s staff position, not its own')
      .not.toBe(target.lineOffset);
    expect(Math.abs(ghost.cy - target.cy),
      `the ghost (${ghost.cy.toFixed(1)}) and the note that was owed (${target.cy.toFixed(1)}) are at the same height — the distance a child is meant to read is not on screen`)
      .toBeGreaterThan(2);
    // Side by side, not on top of each other.
    expect(ghost.cx).toBeGreaterThan(target.cx);

    // And the run moved on: the cursor is over note two.
    const cursor = await probe.one('.sequence-staff__cursor');
    const heads = await probe.all('.action-staff__note');
    expect(heads.length, 'the ask changed shape when a wrong note was played').toBe(before.length);
    expect(Math.abs(cursor.cx - heads[1].cx),
      `the cursor ${say(cursor)} did not advance to notehead 1 ${say(heads[1])}`)
      .toBeLessThan(cursor.width);
  });

  it('tier 2 ends on a percentage, where tier 0 ended on words', async () => {
    await run({ instance: SCALE, props: { tier: 2, ask: 'Play C major, right hand.', intent: 'practice', practiceMode: 'free' } }, FREE_READY);
    for (const midi of SCALE_MIDIS) await probe.press(midi);
    // Uppercased on screen — see the tier-0 case for why that is the assertion.
    await page.waitForFunction(() => document.body.innerText.includes('PASSED'));

    const panel = await probe.one('.piano-exercise-run__result');
    expect(panel.painted && onCanvas(panel), `the result panel is not on canvas: ${say(panel)}`).toBe(true);
    expect(panel.text, 'tier 2 gave no score readout').toMatch(/100%/);
    expect(panel.text).toContain('All notes');
  }, 60000);

  /* ── Tier 3 — cued: written rhythm, a count-in, and a beat to hold ──────── */

  it('tier 3 engraves ONE staff, chips the meter and the beat, and starts on any key', async () => {
    await run({
      instance: SCALE,
      props: { tier: 3, ask: 'Play C major on the beat.', intent: 'challenge', requirementOverride: CUED_REQUIREMENT },
    }, CUED_READY);

    // ONE staff. Two is the defect this branch opened on — an empty bass clef
    // engraved under a right-hand ask, which reads to a child as a whole line
    // of music they were not given.
    expect(await probe.count('.abcjs-staff'),
      'the ABC stage engraved a second, empty staff under a one-hand ask').toBe(1);
    expect(await probe.count('.sequence-staff'), 'tier 3 mounted the sequence staff as well').toBe(0);

    const stage = await probe.one('.piano-exercise-run__stage');
    const notation = await probe.one('.abc-renderer svg');
    expect(notation.painted, `the engraving is not painted: ${say(notation)}`).toBe(true);
    expect(inside(notation, stage), `the engraving ${say(notation)} overflows the stage row ${say(stage)}`).toBe(true);
    expect(await probe.count('.abcjs-note'), 'the engraving does not carry the ask').toBe(SCALE_MIDIS.length);

    // Both context chips a cued rung is owed, on screen and legible.
    const chips = await probe.all('.piano-exercise-run__context > *');
    const labels = chips.map((c) => c.text);
    expect(labels, 'the cued rung is missing its meter or its beat').toEqual(
      expect.arrayContaining(['4/4', '90 BPM']),
    );
    for (const chip of chips) {
      expect(chip.painted && onCanvas(chip), `a context chip is not legible on canvas: ${say(chip)}`).toBe(true);
    }

    // Nothing to press but the piano — the ready line says so, and there is no
    // button that could be mistaken for a start.
    expect(await probe.text()).toContain('Press any key to start.');
    expect(await probe.runButtons()).toEqual(['Exit']);
  });

  it('tier 3 puts the count-in over the music the moment a key is touched', async () => {
    await run({
      instance: SCALE,
      props: { tier: 3, ask: 'Play C major on the beat.', intent: 'challenge', requirementOverride: CUED_REQUIREMENT },
    }, CUED_READY);
    expect(await probe.one('.piano-score-countin'), 'the count-in overlay was up before anyone played').toBeNull();

    // Any key at all arms a cued ask — this one is not even in the scale.
    await probe.press(84);
    await page.waitForFunction(() => document.querySelector('.piano-score-countin') !== null);

    const stage = await probe.one('.piano-exercise-run__stage');
    const overlay = await probe.one('.piano-score-countin');
    const beat = await probe.one('.piano-score-countin__beat');
    // The layer is `position: fixed; inset: 0` (PianoApp.scss) — the count-in
    // belongs to the whole screen, not to the notation box. What has to land on
    // the music is the NUMERAL, and it does so by being centred in the viewport.
    expect(overlay.width, 'the count-in layer does not cover the screen').toBe(KIOSK.width);
    expect(overlay.height).toBe(KIOSK.height);
    expect(beat.text, 'the count-in did not start at beat one').toBe('1');
    expect(beat.painted, `the beat number is not painted: ${say(beat)}`).toBe(true);
    expect(inside(beat, stage), `the count-in numeral ${say(beat)} is not over the music ${say(stage)}`).toBe(true);
    expect(beat.height, 'the count-in number is too small to read across a room').toBeGreaterThan(24);
    // And it does not eat the tap it is drawn over: `pointer-events: none`.
    expect(overlay.reachable, 'the count-in layer is swallowing taps meant for the run').toBe(false);
    expect(await probe.text()).toContain('Listen to the count-in.');
  });
});

/* -------------------------------------------------------------------------- */
/* SP2 presentation cells — each proven in the browser that paints the kiosk  */
/* -------------------------------------------------------------------------- */

describe('SP2 presentation cells in real Chromium', () => {
  it('shows a named recall chord from memory without leaking the lit-key answer', async () => {
    await run({
      instance: { ...TREBLE_DYAD, title: 'C major chord', events: [{ id: 'chord', value: 'quarter', notes: [{ midi: 60 }, { midi: 64 }, { midi: 67 }] }] },
      props: {
        tier: 1, ask: 'Play a C major chord.', intent: 'challenge', askTuple: RECALL_TUPLE,
        requirementOverride: FREE_REQUIREMENT,
      },
    }, FREE_READY);

    const recall = await probe.one('[data-testid="piano-recall-stage"]');
    const heading = await probe.one('.piano-exercise-run__head h1');
    expect(heading.text).toBe('Play a C major chord.');
    expect(recall.painted && onCanvas(recall), `the recall card is not visible: ${say(recall)}`).toBe(true);
    expect(recall.text).toContain('From memory');
    expect(await probe.count('.piano-key.target'), 'a recall ask exposed its answer at mount').toBe(0);
    expect(await probe.count('.piano-keyboard'), 'a recall ask mounted a keyboard before its hint').toBe(0);
  });

  it('reveals the after-stall answer on screen before the free-attempt timeout', async () => {
    await run({
      instance: { ...TREBLE_DYAD, title: 'C major chord', events: [{ id: 'chord', value: 'quarter', notes: [{ midi: 60 }, { midi: 64 }, { midi: 67 }] }] },
      props: {
        tier: 1,
        ask: 'Play a C major chord.',
        intent: 'challenge',
        askTuple: { ...RECALL_TUPLE, hints: 'after-stall' },
        requirementOverride: FREE_REQUIREMENT,
      },
    }, FREE_READY);

    expect(await probe.one('[data-testid="piano-recall-hint"]')).toBeNull();
    await probe.press(60);
    await page.waitForFunction(
      () => document.querySelector('[data-testid="piano-recall-hint"]') !== null,
      null,
      { timeout: 15_000 },
    );
    const hint = await probe.one('[data-testid="piano-recall-hint"]');
    expect(hint.painted && onCanvas(hint), `the revealed answer is not visible: ${say(hint)}`).toBe(true);
    expect(await probe.count('.piano-key.target'), 'the hint did not light the chord it reveals').toBe(3);
    expect(await probe.text(), 'the hint arrived only after the attempt had already timed out').not.toContain('Keep working');
  }, 30_000);

  it('engraves a duration-aware line while timing remains free', async () => {
    await run({
      instance: ENGRAVED_LINE,
      props: {
        tier: 2, ask: 'Read the line.', intent: 'challenge', askTuple: ENGRAVED_FREE_TUPLE,
        requirementOverride: FREE_REQUIREMENT,
      },
    }, FREE_READY);
    await page.waitForFunction(() => document.querySelectorAll('.abcjs-note').length === 4);

    expect(await probe.one('.piano-exercise-run')).toMatchObject({ text: expect.stringContaining('Play the first note to begin.') });
    expect(await probe.count('.abcjs-staff'), 'the free engraved line did not render one staff').toBe(1);
    const stage = await probe.one('.piano-exercise-run__stage');
    const notation = await probe.one('.abc-renderer svg');
    expect(notation.painted && inside(notation, stage), `the free engraving overflows its stage: ${say(notation)}`).toBe(true);
    expect(await probe.count('.sequence-staff'), 'the engraved request fell back to the sequence renderer').toBe(0);
    expect(await probe.count('.piano-score-passage'), 'bank material incorrectly entered the score resolver').toBe(0);
  });

  it('renders a one-note reading ask as one compact staff card', async () => {
    await run({
      instance: { ...ONE_KEY, title: 'Middle C', staff: 'treble' },
      props: {
        tier: 2, ask: 'Read this note.', intent: 'challenge', askTuple: SINGLE_NOTE_TUPLE,
        requirementOverride: FREE_REQUIREMENT,
      },
    }, FREE_READY);

    const runBox = await probe.one('.piano-exercise-run');
    const card = await probe.one('.piano-exercise-run__single-note .sequence-staff');
    expect(await probe.count('.action-staff__note'), 'the single-note card did not contain exactly one notehead').toBe(1);
    expect(card.painted && onCanvas(card), `the single-note card is not visible: ${say(card)}`).toBe(true);
    expect(card.width, 'the single-note card expanded into an oversized notation surface').toBeLessThan(runBox.width / 2);
    expect(await probe.count('.piano-keyboard'), 'the reading card exposed a keyboard target').toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* The score stage — REAL OpenSheetMusicDisplay                               */
/* -------------------------------------------------------------------------- */

describe('the score stage, engraved by the real OSMD in Chromium', () => {
  it('engraves the four-bar fixture and reports the geometry the ask is compiled from', async () => {
    // The claim `ExerciseRun.score.test.jsx` cannot make: OSMD cannot engrave
    // under happy-dom (no SVG text metrics — it lands on its own placeholder),
    // so that suite doubles the renderer and states that the real-engraving
    // assertion belongs here. This is it.
    await openStage(css, js);
    await page.evaluate(PROBE);
    await page.evaluate((xml) => window.__stage.mountEngraver({ musicXml: xml }), fourBars);
    await page.waitForFunction(
      () => window.__stage.calls.some((c) => c.name === 'layout' || c.name === 'failed'),
      undefined,
      { timeout: 60_000 },
    );

    const calls = await probe.calls();
    const failed = calls.find((c) => c.name === 'failed');
    expect(failed, `OSMD could not engrave the fixture in this browser: ${failed?.value}`).toBeUndefined();
    const layout = calls.find((c) => c.name === 'layout').value;

    // Onsets and measure indices, from the ENGRAVING — the four bars of two
    // half notes the fixture writes, in the order a child reads them.
    expect(layout.steps.map((s) => s.onsetQuarter)).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
    expect(layout.steps.map((s) => s.measure)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect(layout.steps.flatMap((s) => s.midis),
      'the engraved pitches are not the ones the document writes').toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
    // Every step has a graphical element: without one the cursor has no ink to
    // light and a child is asked to follow a passage with nothing marked.
    expect(layout.steps.every((s) => s.engraved), 'a step engraved without a graphical element').toBe(true);
    // The tempo the passage is counted and graded at, read off the document.
    expect(layout.tempoEntries[0]).toMatchObject({ onsetQuarter: 0, bpm: 80 });

    // And it is REALLY drawn: an engraving with a box, not a placeholder.
    expect(await probe.count('.musicxml-renderer--placeholder')).toBe(0);
    const svg = await probe.one('.musicxml-renderer__svg svg, svg.musicxml-renderer__svg');
    expect(svg, 'no SVG was engraved').not.toBeNull();
    expect(svg.width, `the engraving has no width: ${say(svg)}`).toBeGreaterThan(100);
    expect(svg.height, `the engraving has no height: ${say(svg)}`).toBeGreaterThan(40);
    expectNoPageErrors();
  }, 120000);

  it('compiles the named bars — and only those — into the ask the run is graded on', async () => {
    await openStage(css, js);
    await page.evaluate(PROBE);
    await page.evaluate((xml) => window.__stage.mountPassage({ musicXml: xml, measures: [2, 3] }), fourBars);
    await page.waitForFunction(
      () => window.__stage.calls.some((c) => ['expectation', 'unrunnable'].includes(c.name)),
      undefined,
      { timeout: 60_000 },
    );

    const calls = await probe.calls();
    const dead = calls.find((c) => c.name === 'unrunnable');
    expect(dead, `the passage refused the fixture: ${dead?.value}`).toBeUndefined();
    const expectation = calls.find((c) => c.name === 'expectation').value;

    // Bars 2-3 as a grown-up wrote them: E4 F4 G4 A4, and nothing either side.
    expect(expectation.events.flatMap((e) => e.midis)).toEqual([64, 65, 67, 69]);
    expect(expectation.events.map((e) => e.onsetQuarter)).toEqual([4, 6, 8, 10]);
    // The printed bar numbers converted ONCE, at this boundary: bars 2-3 are
    // engraved measure indices 1-2.
    expect(expectation.events.map((e) => e.spanId)).toEqual(['measure:1', 'measure:1', 'measure:2', 'measure:2']);
    expect(expectation.tempoMap).toEqual([{ onsetQuarter: 0, bpm: 80 }]);
    expectNoPageErrors();
  }, 120000);

  it('says so on screen AND to its host when a document cannot be engraved', async () => {
    // Both halves, in one case, because the jsdom probe that came before this
    // observed the placeholder at a time when the callback did not exist — the
    // placeholder alone leaves a child sitting on "Getting the music ready…"
    // with no way out but Leave, forfeiting the game they earned.
    await openStage(css, js);
    await page.evaluate(PROBE);
    await page.evaluate(() => window.__stage.mountPassage({ musicXml: '<not-a-score>garbage</not-a-score>' }));
    await page.waitForFunction(
      () => window.__stage.calls.some((c) => c.name === 'unrunnable'),
      undefined,
      { timeout: 60_000 },
    );

    expect((await probe.calls()).map((c) => [c.name, c.value]))
      .toContainEqual(['unrunnable', 'engrave-failed']);

    // The callback fires in the same tick as `setFailed(true)`, so the words a
    // child reads land one paint later — which is exactly the ordering the
    // earlier jsdom probe could not see, and the reason both halves are asserted
    // in one case rather than two.
    await page.waitForSelector('.musicxml-renderer--placeholder', { timeout: 20_000 });
    const placeholder = await probe.one('.musicxml-renderer--placeholder');
    expect(placeholder, 'nothing was drawn where the music should be').not.toBeNull();
    // THE WORDS, NOT THE BOX. This scenario mounts the passage bare, so the
    // renderer takes its own `width: 100%` plus the placeholder's 2rem padding
    // under content-box sizing and comes out 64px wider than whatever holds it
    // — an artefact of mounting it with no host, clipped in the run by
    // `.piano-score-passage`'s `overflow: hidden`. The hosted geometry is
    // asserted by the scenario below, which mounts the real run. What has to be
    // true here is that a child is TOLD something, in readable type, where they
    // are looking — rather than left in front of an empty rectangle.
    const words = await probe.one('.musicxml-renderer--placeholder p');
    expect(words, 'the placeholder rendered no message at all').not.toBeNull();
    expect(words.text).toContain('Could not read this score.');
    expect(words.painted, `the placeholder's message is not painted: ${say(words)}`).toBe(true);
    expect(words.height, 'the message is too small to read').toBeGreaterThan(8);
    expect(words.top >= 0 && words.bottom <= KIOSK.height,
      `the message is off the top or bottom of the kiosk canvas: ${say(words)}`).toBe(true);
    expect(words.cx >= 0 && words.cx <= KIOSK.width,
      `the message is centred off the side of the kiosk canvas: ${say(words)}`).toBe(true);
    expectNoPageErrors();
  }, 120000);

  it('mounts the engraved passage as the run\'s stage, inside the row it was given', async () => {
    // The whole path, end to end: a gate level names a score, the media tree
    // serves it, OSMD engraves it, the passage compiles the ask, and the run
    // builds its attempt from that — with nothing about the notation doubled.
    await run({ scoreXml: fourBars, props: { material: SCORE_MATERIAL, tier: 2, ask: 'Play this passage as written.', intent: 'challenge', requirementOverride: { mode: 'free' } } }, FREE_READY);

    const root = await probe.one('.piano-exercise-run');
    expect(await page.evaluate(() => document.querySelector('.piano-exercise-run').dataset.stage)).toBe('score');
    expect(onCanvas(root), `the run overflows the kiosk canvas: ${say(root)}`).toBe(true);

    const stage = await probe.one('.piano-exercise-run__stage');
    const passage = await probe.one('.piano-score-passage');
    expect(inside(passage, stage), `the passage ${say(passage)} overflows the stage row ${say(stage)}`).toBe(true);
    expect(await probe.count('.musicxml-renderer--placeholder')).toBe(0);

    // The cursor lights the FIRST NOTE OF THE PASSAGE in the real engraving —
    // E4, the first note of bar 2 — and not the first note of the document.
    await page.waitForFunction(() => document.querySelectorAll('.piano-note-lit').length > 0, undefined, { timeout: 60_000 });
    const lit = await probe.all('.piano-note-lit');
    expect(lit.length, 'more than one notehead is lit at a single-note step').toBe(1);
    expect(inside(lit[0], passage), `the lit notehead ${say(lit[0])} is outside the passage ${say(passage)}`).toBe(true);

    // Bars outside the passage stay engraved and greyed back, so a child who
    // reads music can still see the run-up.
    expect(await probe.count('.piano-score-passage__dim'),
      'the bars either side of the passage were not greyed back').toBeGreaterThan(0);
    expectNoPageErrors();
  }, 120000);
});
