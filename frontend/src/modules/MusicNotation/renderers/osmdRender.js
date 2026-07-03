// osmdRender — engraves a MusicXML document via OpenSheetMusicDisplay (OSMD)
// and reports the on-screen position of every melody (top-staff) note so the
// Follow cursor / play-along overlay can light notes up.
//
// This is the ONLY file that touches OSMD. The library is imported lazily so
// the kiosk's main bundle doesn't carry the engraving engine until a score
// view actually mounts. Two flows:
//   'wrapped'    — systems wrap to the container width (scroll ↓)
//   'horizontal' — one endless staffline (infinite scroll →)

let osmdModulePromise = null;
function loadOsmd() {
  if (!osmdModulePromise) osmdModulePromise = import('opensheetmusicdisplay');
  return osmdModulePromise;
}

/** MIDI number from OSMD's halfTone (halfTone 48 == C4 == MIDI 60). */
export const midiOfHalfTone = (halfTone) => halfTone + 12;

/**
 * Pick the melody note for one cursor step: top staff only, no rests, no
 * grace notes, no tie continuations (a held note is not a new onset); the
 * highest remaining pitch wins.
 * @param {Array} notes - OSMD Note[] under the cursor
 */
export function pickMelodyNote(notes) {
  let best = null;
  for (const n of notes || []) {
    try {
      if (!n || n.isRest() || n.IsGraceNote) continue;
      const tie = n.NoteTie;
      if (tie && tie.StartNote !== n) continue;
      const staffId = n.ParentStaffEntry?.ParentStaff?.idInMusicSheet ?? 0;
      if (staffId !== 0) continue;
      if (!best || n.halfTone > best.halfTone) best = n;
    } catch {
      // malformed entry — skip it rather than break the whole score
    }
  }
  return best;
}

/**
 * Walk OSMD's cursor start→end and emit one event per melody onset, with the
 * cursor element's real on-screen geometry (px, relative to the host).
 */
export function extractEvents(osmd) {
  const events = [];
  const cursor = osmd.cursor;
  if (!cursor) return events;
  try {
    cursor.show(); // geometry only updates while the cursor is visible
    cursor.reset();
    let guard = 0;
    while (!cursor.Iterator.EndReached && guard++ < 50000) {
      const note = pickMelodyNote(cursor.NotesUnderCursor());
      if (note) {
        const el = cursor.cursorElement;
        events.push({
          midi: midiOfHalfTone(note.halfTone),
          onsetQuarter: cursor.Iterator.currentTimeStamp.RealValue * 4,
          x: el.offsetLeft + el.offsetWidth / 2,
          top: el.offsetTop,
          bottom: el.offsetTop + el.offsetHeight,
        });
      }
      cursor.next();
    }
  } finally {
    try { cursor.reset(); cursor.hide(); } catch { /* already hidden */ }
  }
  events.sort((a, b) => a.onsetQuarter - b.onsetQuarter);
  return events;
}

/**
 * Engrave `xml` into `host` and return layout + melody events.
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
  osmd.Zoom = scale;
  osmd.render();

  const events = extractEvents(osmd);
  const svg = host.querySelector('svg');
  const width = Math.ceil(Number(svg?.getAttribute('width')) || svg?.clientWidth || host.clientWidth || 0);
  const height = Math.ceil(Number(svg?.getAttribute('height')) || svg?.clientHeight || host.clientHeight || 0);
  return { width, height, flow, events };
}

export default osmdRender;
