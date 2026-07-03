// osmdRender — engraves a MusicXML document via OpenSheetMusicDisplay (OSMD)
// and reports the on-screen position of every melody (top-staff) note so the
// Follow cursor / play-along overlay can light notes up.
//
// This is the ONLY file that touches OSMD. The library is imported lazily so
// the kiosk's main bundle doesn't carry the engraving engine until a score
// view actually mounts. Two flows:
//   'wrapped'    — systems wrap to the container width (scroll ↓)
//   'horizontal' — one endless staffline (infinite scroll →)

import getLogger from '../../../lib/logging/Logger.js';
let _logger; function logger() { if (!_logger) _logger = getLogger().child({ component: 'osmd-render' }); return _logger; }

let osmdModulePromise = null;
function loadOsmd() {
  if (!osmdModulePromise) osmdModulePromise = import('opensheetmusicdisplay');
  return osmdModulePromise;
}

/** MIDI number from OSMD's halfTone (halfTone 48 == C4 == MIDI 60). */
export const midiOfHalfTone = (halfTone) => halfTone + 12;

/** Real new onsets under the cursor: no rests, no grace notes, no tie continuations. */
export function collectOnsetNotes(notes) {
  const out = [];
  for (const n of notes || []) {
    try {
      if (!n || n.isRest() || n.IsGraceNote) continue;
      const tie = n.NoteTie;
      if (tie && tie.StartNote !== n) continue;
      out.push(n);
    } catch {
      // malformed entry — skip it rather than break the whole score
    }
  }
  return out;
}

/**
 * Pick the melody note for one cursor step: top staff only, no rests, no
 * grace notes, no tie continuations (a held note is not a new onset); the
 * highest remaining pitch wins.
 * @param {Array} notes - OSMD Note[] under the cursor
 */
export function pickMelodyNote(notes) {
  let best = null;
  for (const n of collectOnsetNotes(notes)) {
    const staffId = n.ParentStaffEntry?.ParentStaff?.idInMusicSheet ?? 0;
    if (staffId !== 0) continue;
    if (!best || n.halfTone > best.halfTone) best = n;
  }
  return best;
}

/**
 * Group flat onset records (one per note, all staves) into cursor steps keyed by
 * onsetQuarter. Each step carries every note sounding at that onset with its box,
 * so the light-up overlay and the active-parts tracker can work per staff.
 */
export function buildSteps(recs) {
  const byQuarter = new Map();
  for (const r of recs || []) {
    if (!byQuarter.has(r.onsetQuarter)) byQuarter.set(r.onsetQuarter, { onsetQuarter: r.onsetQuarter, notes: [] });
    byQuarter.get(r.onsetQuarter).notes.push({ midi: r.midi, staff: r.staff, x: r.x, top: r.top, bottom: r.bottom, width: r.width });
  }
  return [...byQuarter.values()].sort((a, b) => a.onsetQuarter - b.onsetQuarter);
}

/**
 * On-screen box of a note's notehead, in the same offset-space as the cursor
 * (measured relative to opRect = the cursor's offsetParent rect). Returns null if
 * the graphical note or its SVG element is unavailable / not laid out, so the
 * caller falls back to the cursor-band box.
 * @param {object} osmd
 * @param {object} n - OSMD Note
 * @param {DOMRect|null} opRect - bounding rect of the cursor element's offsetParent
 * @returns {{x:number,top:number,bottom:number,width:number}|null}
 */
function noteheadBox(osmd, n, opRect) {
  if (!opRect) return null;
  try {
    const g = osmd?.EngravingRules?.GNote?.(n);
    const el = g?.getSVGGElement?.();
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r || (!r.width && !r.height)) return null; // not rendered
    return {
      x: r.left - opRect.left + r.width / 2, // center-x, offset-space
      top: r.top - opRect.top,
      bottom: r.bottom - opRect.top,
      width: r.width,
    };
  } catch {
    return null; // malformed / unsupported — fall back
  }
}

/**
 * Walk OSMD's cursor start→end. Emits, from one pass (so repeats and tempo
 * stay aligned with the visual cursor):
 *  events       — one per melody onset (cursor steps), with `midis` (every
 *                 pitch sounding at that onset, both staves) + geometry
 *  notes        — every onset on every staff with duration, for playback
 *  tempoEntries — [{onsetQuarter, bpm}] wherever the iterator's bpm changes
 *  steps        — one per onset, carrying EVERY note sounding across ALL
 *                 staves with its on-screen notehead box (for the light-up
 *                 overlay + full-hand follow tracker)
 */
export function extractEvents(osmd) {
  const events = [], notes = [], tempoEntries = [], onsetRecords = [];
  const cursor = osmd.cursor;
  if (!cursor) return { events, notes, tempoEntries, steps: [] };
  let lastBpm = null;
  let graphicalHits = 0, fallbackHits = 0;
  try {
    cursor.show(); // geometry only updates while the cursor is visible
    cursor.reset();
    let guard = 0;
    while (!cursor.Iterator.EndReached && guard++ < 50000) {
      const onsetQuarter = cursor.Iterator.currentTimeStamp.RealValue * 4;
      const bpm = cursor.Iterator.CurrentBpm;
      if (Number.isFinite(bpm) && bpm > 0 && bpm !== lastBpm) {
        tempoEntries.push({ onsetQuarter, bpm });
        lastBpm = bpm;
      }
      const onset = collectOnsetNotes(cursor.NotesUnderCursor());
      const el = cursor.cursorElement;
      const opRect = el?.offsetParent?.getBoundingClientRect?.() || null;
      // Fallback box (cursor element) reused for any note lacking graphical geometry.
      const fallbackBox = el ? {
        x: el.offsetLeft + el.offsetWidth / 2,
        top: el.offsetTop,
        bottom: el.offsetTop + el.offsetHeight,
        width: el.offsetWidth,
      } : { x: 0, top: 0, bottom: 0, width: 0 };
      for (const n of onset) {
        const staff = n.ParentStaffEntry?.ParentStaff?.idInMusicSheet ?? 0;
        notes.push({
          midi: midiOfHalfTone(n.halfTone),
          staff,
          onsetQuarter,
          durationQuarters: (n.Length?.RealValue ?? 0) * 4,
        });
        const gbox = noteheadBox(osmd, n, opRect);
        if (gbox) graphicalHits++; else fallbackHits++;
        const box = gbox || fallbackBox;
        onsetRecords.push({
          onsetQuarter,
          midi: midiOfHalfTone(n.halfTone),
          staff,
          x: box.x,
          top: box.top,
          bottom: box.bottom,
          width: box.width,
        });
      }
      const melody = pickMelodyNote(onset);
      if (melody) {
        events.push({
          midi: midiOfHalfTone(melody.halfTone),
          midis: onset.map((n) => midiOfHalfTone(n.halfTone)),
          onsetQuarter,
          x: fallbackBox.x,
          top: fallbackBox.top,
          bottom: fallbackBox.bottom,
        });
      }
      cursor.next();
    }
  } finally {
    try { cursor.reset(); cursor.hide(); } catch { /* already hidden */ }
  }
  logger().debug('notation.geometry', { total: graphicalHits + fallbackHits, graphical: graphicalHits, fallback: fallbackHits });
  events.sort((a, b) => a.onsetQuarter - b.onsetQuarter);
  const steps = buildSteps(onsetRecords);
  return { events, notes, tempoEntries, steps };
}

/**
 * Cooperative time-slicer: process indices [0,total) in slices of `sliceSize`,
 * yielding (via `yieldFn`) between slices so the main thread stays responsive.
 * Reports fractional progress after each slice; `shouldAbort()` (checked before
 * each slice) stops early and resolves false.
 */
export async function runSliced(total, sliceSize, doSlice, yieldFn, onProgress, shouldAbort = () => false) {
  let i = 0;
  while (i < total) {
    if (shouldAbort()) return false;
    const end = Math.min(total, i + sliceSize);
    for (; i < end; i++) doSlice(i);
    onProgress?.(total ? i / total : 1);
    if (i < total) await new Promise((r) => yieldFn(r));
  }
  onProgress?.(1);
  return true;
}

/** Default yield: idle callback when available, else a macrotask. */
export function scheduleYield(cb) {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => cb(), { timeout: 50 });
  else setTimeout(cb, 0);
}

/**
 * Engrave (PAINT) `xml` into `host` up to and including `osmd.render()` — the
 * fast part the React wrapper reveals first. Does NOT extract events/geometry;
 * that expensive cursor walk is run separately (sliced) in Task 8 so the main
 * thread breathes. Loads OSMD lazily, builds the instance with the SAME options
 * osmdRender has always used, sets EngravingRules, loads the XML, honors
 * shouldAbort, applies width/zoom, and renders.
 * @param {HTMLElement} host
 * @param {string} xml - raw MusicXML
 * @param {{ width?:number, flow?:'wrapped'|'horizontal', scale?:number,
 *           shouldAbort?:() => boolean }} [opts]
 *   shouldAbort is checked after each await so a stale render never clobbers
 *   a newer one's DOM.
 * @returns {Promise<{osmd:object,width:number,height:number,flow:string}|null>}
 *   null when aborted.
 */
export async function osmdEngrave(host, xml, opts = {}) {
  const { OpenSheetMusicDisplay } = await loadOsmd();
  const abort = opts.shouldAbort || (() => false);
  if (abort()) return null;

  const flow = opts.flow === 'horizontal' ? 'horizontal' : 'wrapped';
  const scale = Math.max(0.5, Math.min(2.5, opts.scale || 1));
  if (opts.width) host.style.width = `${opts.width}px`;
  host.innerHTML = '';

  const osmd = new OpenSheetMusicDisplay(host, {
    backend: 'svg',
    autoResize: false, // the React wrapper owns resize handling
    drawTitle: false, // ScorePlayer renders its own title/metadata block
    drawSubtitle: false,
    drawComposer: false,
    drawLyricist: false,
    drawPartNames: false,
    // Tempo lives in ScorePlayer's metadata header, and OSMD's in-score
    // metronome marks collide with chords/measure numbers (2026-07-02 audit E1).
    drawMetronomeMarks: false,
    followCursor: false,
    renderSingleHorizontalStaffline: flow === 'horizontal',
  });
  // Mid-system measure numbers pile onto tight chords; system-start only.
  osmd.EngravingRules.RenderMeasureNumbersOnlyAtSystemStart = true;
  await osmd.load(xml);
  if (abort()) return null;

  if (opts.width) host.style.width = `${opts.width}px`;
  osmd.Zoom = scale;
  osmd.render();

  const svg = host.querySelector('svg');
  const width = Math.ceil(Number(svg?.getAttribute('width')) || svg?.clientWidth || host.clientWidth || 0);
  const height = Math.ceil(Number(svg?.getAttribute('height')) || svg?.clientHeight || host.clientHeight || 0);
  return { osmd, width, height, flow };
}

/**
 * Engrave `xml` into `host` and return layout + melody events.
 *
 * Thin composition of {@link osmdEngrave} (paint) followed by a synchronous
 * full {@link extractEvents} — public shape/options are UNCHANGED from before
 * the engrave/extract split. Task 8's React wrapper calls osmdEngrave + a sliced
 * extract instead; this remains for callers that want the whole blocking pass.
 * @param {HTMLElement} host
 * @param {string} xml - raw MusicXML
 * @param {{ width?:number, flow?:'wrapped'|'horizontal', scale?:number,
 *           shouldAbort?:() => boolean }} [opts]
 *   shouldAbort is checked after each await so a stale render never clobbers
 *   a newer one's DOM.
 * @returns {Promise<{width:number,height:number,flow:string,events:Array}|null>}
 *   null when aborted.
 */
export async function osmdRender(host, xml, opts = {}) {
  const engraved = await osmdEngrave(host, xml, opts);
  if (!engraved) return null; // aborted
  const { osmd, width, height, flow } = engraved;
  const { events, notes, tempoEntries, steps } = extractEvents(osmd);
  return { width, height, flow, events, notes, tempoEntries, steps, osmd };
}

/**
 * Re-render an ALREADY-loaded OSMD instance (zoom / resize) and re-extract the
 * layout. Skips the expensive `osmd.load(xml)` MusicXML parse — an order of
 * magnitude cheaper on the tablet than a full osmdRender. Audit F1.
 * @param {import('opensheetmusicdisplay').OpenSheetMusicDisplay} osmd
 * @param {HTMLElement} host
 * @param {{ width?:number, flow?:string, scale?:number }} [opts]
 */
export function osmdReRender(osmd, host, opts = {}) {
  const scale = Math.max(0.5, Math.min(2.5, opts.scale || 1));
  if (opts.width) host.style.width = `${opts.width}px`;
  osmd.Zoom = scale;
  osmd.render();

  const { events, notes, tempoEntries, steps } = extractEvents(osmd);
  const svg = host.querySelector('svg');
  const width = Math.ceil(Number(svg?.getAttribute('width')) || svg?.clientWidth || host.clientWidth || 0);
  const height = Math.ceil(Number(svg?.getAttribute('height')) || svg?.clientHeight || host.clientHeight || 0);
  return { width, height, flow: opts.flow, events, notes, tempoEntries, steps, osmd };
}

export default osmdRender;
