// percussion — GM drum constants, metronome event builder, and drum/groove
// heuristics for the Producer. Pure, no DOM, no timers.
//
// metronomeEvents feeds the transport (count-ins, blank-page recording) with
// the same { t, type, note, velocity, channel } event shape loopScheduler
// emits, so the transport can merge a click stream with loop streams.
// isDrumTrack + detectFeel serve the midi-ingest CLI's track labeling.

/**
 * General MIDI percussion pitches for the drum pieces the Producer ships.
 *
 * KEEP IN SYNC: frontend/src/modules/Piano/PianoKiosk/producer/presetManifest.js
 * derives its DRUM_NOTES from this map (sorted values) via a relative import —
 * plain node runs the fetch script, so the '@shared-music' alias is not usable
 * there. If you add/remove a piece here, re-run
 * frontend/scripts/fetch-webaudiofont-presets.mjs so the preset files exist.
 * @type {Readonly<Record<string, number>>}
 */
export const GM_DRUM = Object.freeze({
  kick: 36,
  snare: 38,
  hatClosed: 42,
  hatOpen: 46,
  crash: 49,
  ride: 51,
  tomLo: 45,
  tomMid: 47,
  tomHi: 50,
});

/** Fixed click length: each metronome hit's note_off lands this many ms after its note_on. */
const METRONOME_HIT_MS = 30;

/** Sanitize a MIDI channel to an integer 0..15 (same rule as loopScheduler's
 * private helper, duplicated so both event producers clamp identically). */
function sanitizeChannel(channel) {
  const n = Math.floor(Number(channel));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(15, n);
}

/**
 * Build metronome click events: one hit per beat, beat 1 of each bar accented
 * (higher velocity, optionally a different note). Times in ms from 0.
 *
 * @param {number} bars number of bars to click; ≤ 0 → []. Fractional bars
 *   floor to whole bars, so bars < 1 also yields [].
 * @param {object} opts
 * @param {number} opts.bpm tempo (quarter-note BPM)
 * @param {[number, number]} [opts.timeSig=[4,4]] beats per bar / beat unit —
 *   NOTE: array form, not loopScheduler's {beats, beatType} object
 * @param {number} [opts.channel=9] MIDI channel (9 = GM drums), sanitized to 0..15
 * @param {number} [opts.accentNote=GM_DRUM.hatClosed] pitch for beat 1
 * @param {number} [opts.tickNote=GM_DRUM.hatClosed] pitch for other beats
 * @param {number} [opts.accentVelocity=110]
 * @param {number} [opts.tickVelocity=70]
 * @returns {Array<{t:number,type:'note_on'|'note_off',note:number,velocity:number,channel:number}>}
 *   sorted by t; same event shape as loopScheduler's loopToEvents
 * @throws {TypeError} when bpm is not a finite positive number, or timeSig is
 *   not a 2-element array of finite positive numbers (a short array like [4]
 *   would otherwise produce NaN timestamps that poison the transport's merged
 *   stream; the {beats, beatType} object form is rejected loudly for the same
 *   reason)
 */
export function metronomeEvents(bars, opts = {}) {
  const {
    bpm,
    timeSig = [4, 4],
    channel = 9,
    accentNote = GM_DRUM.hatClosed,
    tickNote = GM_DRUM.hatClosed,
    accentVelocity = 110,
    tickVelocity = 70,
  } = opts;
  if (typeof bpm !== 'number' || !Number.isFinite(bpm) || bpm <= 0) {
    throw new TypeError(`metronomeEvents: bpm must be a finite positive number (got ${bpm})`);
  }
  if (
    !Array.isArray(timeSig) || timeSig.length !== 2
    || !timeSig.every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0)
  ) {
    throw new TypeError(
      `metronomeEvents: timeSig must be a 2-element array of finite positive numbers, e.g. [4, 4] (got ${JSON.stringify(timeSig)})`,
    );
  }
  if (!(bars > 0)) return [];

  const [beatsPerBar, beatUnit] = timeSig;
  const ch = sanitizeChannel(channel);
  const beatMs = (60000 / bpm) * (4 / beatUnit);
  const events = [];
  const totalBeats = Math.floor(bars) * beatsPerBar;
  for (let beat = 0; beat < totalBeats; beat += 1) {
    const accent = beat % beatsPerBar === 0;
    const t = beat * beatMs;
    const note = accent ? accentNote : tickNote;
    events.push({ t, type: 'note_on', note, velocity: accent ? accentVelocity : tickVelocity, channel: ch });
    events.push({ t: t + METRONOME_HIT_MS, type: 'note_off', note, velocity: 0, channel: ch });
  }
  return events.sort((a, b) => a.t - b.t);
}

// GM_DRUM pitches as a Set, for coverage counting.
const GM_DRUM_PITCHES = new Set(Object.values(GM_DRUM));

/**
 * Heuristic: is this MIDI track a drum track?
 *
 * `channel === 9` is the primary signal — GM reserves channel 9 (0-based) for
 * percussion, and well-formed files always mark drums that way. The fallback
 * for channel-less or misfiled tracks is a simple coverage ratio: ≥ 60% of the
 * track's note events landing exactly on GM_DRUM pitches reads as drums.
 *
 * FALSE-POSITIVE RISK (documented, accepted): bass lines live in the same
 * 36–51 pitch region, so a bass part that hammers E1/D2/A1 (36/38/45 — kick,
 * snare, tomLo) can approach the threshold. The 60% bar plus the exact-pitch
 * requirement (passing tones like 40/41/43 count against coverage) keeps
 * realistic walking bass below it, but a two-note root-fifth bass ostinato on
 * 36/43 would score 50%... on 36 alone, 100%. Channel 9 remains authoritative;
 * the ingest CLI should treat a coverage-only positive as a suggestion.
 *
 * @param {{channel?: number, notes?: Array<number|{midi:number}>}} track
 *   notes as raw MIDI pitches or ingest-shaped { midi } objects
 * @returns {boolean}
 */
export function isDrumTrack({ channel, notes } = {}) {
  if (channel === 9) return true;
  if (!Array.isArray(notes) || notes.length === 0) return false;
  let inSet = 0;
  for (const n of notes) {
    const pitch = typeof n === 'number' ? n : n?.midi;
    if (GM_DRUM_PITCHES.has(pitch)) inSet += 1;
  }
  return inSet / notes.length >= 0.6;
}

/**
 * Label a groove 'straight' or 'swing' from note-onset tick positions.
 *
 * Grid analysis, with ticksPer8th = ppq / 2 and tol = 20% of an 8th:
 * - Each onset is reduced to its position within the quarter-note grid,
 *   posInQuarter = onset mod ppq.
 * - ON-BEAT window: posInQuarter within tol of a quarter grid line
 *   (pos ≤ tol or pos ≥ ppq − tol). On-beat onsets carry no feel evidence.
 * - Everything else is an OFFBEAT-REGION onset.
 * - SWUNG window: displaced from the straight offbeat (ppq/2) by more than
 *   tol toward the triplet point (2·ppq/3), i.e.
 *   ppq/2 + tol < posInQuarter ≤ 2·ppq/3 + tol.
 *   (ppq 480: straight offbeat 240, tol 48 → swung window (288, 368], with
 *   the triplet point 320 at its center.)
 * - Verdict: ≥ 50% of offbeat-region onsets in the swung window → 'swing'.
 * - Fewer than 2 offbeat-region onsets → 'straight' (not enough evidence).
 *
 * Honest-and-simple by design: this labels library grooves for browsing, it
 * is not a jazz-theorist microtiming analysis.
 *
 * @param {number[]} onsets note-start positions in ticks
 * @param {number} ppq ticks per quarter note
 * @returns {'straight'|'swing'}
 * @throws {TypeError} when onsets is not an array or ppq is not finite positive
 */
export function detectFeel(onsets, ppq) {
  if (!Array.isArray(onsets)) {
    throw new TypeError('detectFeel: onsets must be an array of tick positions');
  }
  if (typeof ppq !== 'number' || !Number.isFinite(ppq) || ppq <= 0) {
    throw new TypeError(`detectFeel: ppq must be a finite positive number (got ${ppq})`);
  }
  const tol = 0.2 * (ppq / 2);
  const straightOffbeat = ppq / 2;
  const tripletPoint = (2 * ppq) / 3;

  let offbeatCount = 0;
  let swungCount = 0;
  for (const onset of onsets) {
    const pos = ((onset % ppq) + ppq) % ppq;
    if (pos <= tol || pos >= ppq - tol) continue; // on-beat: no evidence
    offbeatCount += 1;
    if (pos > straightOffbeat + tol && pos <= tripletPoint + tol) swungCount += 1;
  }
  if (offbeatCount < 2) return 'straight';
  return swungCount / offbeatCount >= 0.5 ? 'swing' : 'straight';
}

export default { GM_DRUM, metronomeEvents, isDrumTrack, detectFeel };
