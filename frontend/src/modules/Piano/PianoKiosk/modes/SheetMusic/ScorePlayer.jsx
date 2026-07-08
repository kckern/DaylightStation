import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { parseMusicXml } from '../../../../MusicNotation/parseMusicXml.js';
import { MusicXmlRenderer } from '../../../../MusicNotation/renderers/MusicXmlRenderer.jsx';
import { PianoKeyboard } from '../../../components/PianoKeyboard.jsx';
import { usePianoKioskConfig } from '../../PianoConfig.jsx';
import { usePianoMidi } from '../../PianoMidiContext.jsx';
import { usePianoPlayback } from '../../PianoPlaybackContext.jsx';
import { usePianoBreadcrumb } from '../../PianoBreadcrumbContext.jsx';
import useReloadGuard from '../../useReloadGuard.js';
import { buildTempoMap, buildStepTimeline, scaleTimeline } from '../../../../MusicNotation/scoreTimeline.js';
import { useScoreTransport } from './useScoreTransport.js';
import { tweenScrollTo, cancelScrollTween } from './scrollTween.js';
import { partsOf, cyclePart, buildPlayTimeline, youMidisAt, allPlayRoles } from './playParts.js';
import { staffLabels, defaultActiveParts, expectedMidisAtStep } from './activeParts.js';
import { rangeSteps, clampStepToRange, sectionToRange } from './focusRange.js';
import useFollowTracker from './useFollowTracker.js';
import useMetronomeClick from './useMetronomeClick.js';
import { playClick } from './click.js';
import useScoreTelemetry from './useScoreTelemetry.js';
import useScoreEvaluator from './useScoreEvaluator.js';
import { resolveSheetMusicConfig } from './sheetMusicConfig.js';
import { isRisingEdge } from './pedalEdge.js';
import ScoreTransportBar from './ScoreTransportBar.jsx';
import NoteHighlightLayer from './NoteHighlightLayer.jsx';
import MeasureGradeLayer from './MeasureGradeLayer.jsx';
import RunSummary from './RunSummary.jsx';

const KEY_NAMES = { '-7': 'Cb', '-6': 'Gb', '-5': 'Db', '-4': 'Ab', '-3': 'Eb', '-2': 'Bb', '-1': 'F', 0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#' };

/** Nearest melody event to a click at renderer-local (x, y). */
function nearestEvent(events, x, y) {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const midY = (e.top + e.bottom) / 2;
    const d = Math.hypot(x - e.x, (y - midY) * 0.45); // weight y less — x dominates within a system
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/**
 * ScorePlayer — interactive engraved score. Four modes:
 *  Learn   — full-hand tracking: the cursor advances only once every active-staff
 *            note of the step is struck; wrong notes flash; struck noteheads light.
 *  Polish  — auto-advances at tempo; the current onset's active-staff
 *            noteheads light up (bouncing ball). It does NOT perform through
 *            the piano — it only lights the notes you should be playing.
 *  Listen  — the kiosk performs 'play' parts through the piano; 'you' parts are
 *            highlighted (never sent); 'mute' parts are silent.
 *  Perform — no awareness; config-defined pedals + tap-to-scroll turn the page.
 *
 * Chrome lives in a pinned bottom {@link ScoreTransportBar}; the top bar shows the
 * breadcrumb (score title). Per-notehead light-up is drawn by {@link NoteHighlightLayer}
 * over the cursor overlay; logs-only timing telemetry flows through
 * {@link useScoreTelemetry}.
 */
export default function ScorePlayer({ score: scoreMeta }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-score-player' }), []);
  const { activeNotes, subscribe, subscribeRaw, pressNote, releaseNote, sendPanic } = usePianoMidi();
  const { setPlaying: setGlobalPlaying } = usePianoPlayback();
  const { config } = usePianoKioskConfig();
  const kb = config?.keyboard || { startNote: 21, endNote: 108 };

  // Destructure the (individually memoized) telemetry callbacks rather than
  // holding the returned object: the object identity is fresh every render, and
  // the renderer's engrave effect depends on `onReady` — a churning identity
  // would re-fire onLayout/onReady endlessly (infinite re-engrave loop).
  const { startSession, logLoad, recordFire, flushPlayback, recordFollowHit, flushFollow, logMeasureGrade, logRunSummary, logFocus, logTranspose, logMode } = useScoreTelemetry({ id: scoreMeta.id });

  const parsed = useMemo(() => { try { return parseMusicXml(scoreMeta.musicXml); } catch { return null; } }, [scoreMeta.musicXml]);
  const tempo = parsed?.tempo || 90;
  const meta = useMemo(() => ({
    title: scoreMeta.title || parsed?.title || 'Score',
    composer: parsed?.composer || null,
    tempo,
    key: KEY_NAMES[parsed?.key?.fifths ?? 0] ? `${KEY_NAMES[parsed.key.fifths]} major` : null,
    time: parsed ? `${parsed.timeSig.beats}/${parsed.timeSig.beatType}` : null,
    measures: parsed?.parts?.[0]?.measures?.length || 0,
  }), [scoreMeta.title, parsed, tempo]);

  usePianoBreadcrumb(useMemo(() => [{ label: meta.title }], [meta.title]));

  const [layout, setLayout] = useState({ events: [], notes: [], steps: [], measures: [], tempoEntries: [], width: 0, height: 0, flow: null });
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState('learn');
  const [focus, setFocus] = useState(null); // Learn practice range: { kind, label?, inMeasure, outMeasure } (measure INDICES) | null = whole piece
  const [loopArm, setLoopArm] = useState(false); // custom tap-range state machine armed
  const loopInRef = useRef(null); // pending in-measure index while arming (first tap)
  const [clickOn, setClickOn] = useState(false); // metronome-click toggle (separate from mode; scheduler wired later)
  const [flow, setFlow] = useState('wrapped');
  const [perfPage, setPerfPage] = useState({ page: 1, pages: 1 }); // Perform page indicator (1-based)
  const [scale, setScale] = useState(1);
  const [transpose, setTranspose] = useState(0); // Listen key transpose (semitones)
  const [tempoMult, setTempoMult] = useState(1); // Listen tempo: 1 = written, 1.5 = 50% faster, 0.5 = half
  const [playAlong, setPlayAlong] = useState(false); // Listen: light up your correctly-struck notes (non-gating)
  const [wrong, setWrong] = useState(false);
  const [struck, setStruck] = useState(() => new Set());
  const [keyboardVisible, setKeyboardVisible] = useState(true); // default mode is learn → shown
  const [scoringOn, setScoringOn] = useState(true); // Polish: grade measures red/yellow/green
  const [grades, setGrades] = useState({}); // measure INDEX → grade result (Polish scoring)
  const gradesRef = useRef(grades); gradesRef.current = grades; // latest grades for the run-summary log (onSilentStop closure)
  const [summaryOpen, setSummaryOpen] = useState(false); // Polish run summary panel
  const scrollRef = useRef(null);
  const cursorRef = useRef(null);
  const prevTopRef = useRef(null);
  const wrongTimer = useRef(null);
  const stepRef = useRef(0);
  stepRef.current = step;
  const stepStartRef = useRef(0); // wall time the current step began (Polish drift proxy)

  const events = layout.events;
  const steps = layout.steps;
  const current = events[step] || null;
  const onLayout = useCallback((res) => { setLayout(res); }, []);

  // ── Learn focus range (practice a section / custom loop) ──────────────────────
  // Sections come from rehearsal marks (measure NUMBERS); `layout.measures` maps
  // NUMBERS↔INDICES and INDICES↔step spans. A `focus` resolves to a step span
  // [lo, hi]; the follow tracker loops within it and taps/seeks clamp into it.
  // Learn-only for now (Polish reuses this in a later task).
  const sections = parsed?.sections || [];
  const range = useMemo(
    () => (focus && (mode === 'learn' || mode === 'polish') && layout.measures ? rangeSteps(layout.measures, focus) : null),
    [focus, mode, layout.measures],
  );
  const rangeRef = useRef(range); rangeRef.current = range; // read latest range inside the transport tick
  // Array position (== measure INDEX) whose step run contains `i`. Used to turn a
  // tapped note (step index) into a measure index for the custom loop brackets.
  const measureIndexOfStep = useCallback((i) => {
    const ms = layout.measures || [];
    const idx = ms.findIndex((m) => i >= m.firstStep && i <= m.lastStep);
    return idx < 0 ? 0 : idx;
  }, [layout.measures]);

  // Tempo map (mid-piece changes included) drives the Polish transport; the
  // opening tempo also feeds the metadata popover. Falls back to the parsed
  // opening tempo before layout has reported OSMD's tempo entries.
  const tempoMap = useMemo(
    () => buildTempoMap(layout.tempoEntries, parsed?.tempo || 90),
    [layout.tempoEntries, parsed],
  );
  const stepTimeline = useMemo(() => buildStepTimeline(events, tempoMap), [events, tempoMap]);

  // Parts (one per staff). Roles (Listen mode) and active-parts (Learn/Polish
  // on/off) are BOTH keyed to the staff SET (a stable signature), not the parts
  // array identity — otherwise every re-engrave (zoom / flow / resize gives
  // layout.notes a fresh reference) would wipe the user's picks. Persisting
  // staves keep their choice; new staves default (play / on).
  const parts = useMemo(() => partsOf(layout.notes), [layout.notes]);
  const staffSig = parts.map((p) => p.staff).join(',');
  const partLabels = staffLabels(parts.map((p) => p.staff));
  const barParts = parts.map((p, i) => ({ staff: p.staff, label: partLabels[i] }));

  const [roles, setRoles] = useState({});
  const [activeParts, setActiveParts] = useState({});
  useEffect(() => {
    setRoles((prev) => Object.fromEntries(parts.map((p) => [p.staff, prev[p.staff] || 'play'])));
    setActiveParts((prev) => {
      const dflt = defaultActiveParts(layout.notes);
      return Object.fromEntries(parts.map((p) => [p.staff, p.staff in prev ? prev[p.staff] : (dflt[p.staff] ?? true)]));
    });
  }, [staffSig]); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen is a jukebox: the kiosk performs EVERY part (allPlayRoles), tempo-scaled
  // by the user's multiplier (faster tempo → shorter durations → factor 1/tempoMult).
  // Other modes keep their silent step timeline. Polish is scaled too so its tempo
  // control (later task) tracks the same knob without further plumbing.
  const listenRoles = useMemo(() => allPlayRoles(parts), [parts]);
  const playTimeline = useMemo(
    () => (mode === 'listen'
      ? scaleTimeline(buildPlayTimeline(events, layout.notes, tempoMap, listenRoles), 1 / tempoMult)
      : scaleTimeline(stepTimeline, 1 / tempoMult)),
    [mode, events, layout.notes, tempoMap, listenRoles, stepTimeline, tempoMult],
  );

  const soundingRef = useRef(new Set());
  const silence = useCallback(() => {
    // Nothing the kiosk sent is sounding — don't broadcast a panic that would
    // cut off notes the player is holding on the piano (e.g. switching out of Learn).
    if (!soundingRef.current.size) return;
    soundingRef.current.forEach((n) => { try { releaseNote?.(n); } catch { /* port gone */ } });
    soundingRef.current.clear();
    // BLE one-turn-late bug can swallow a lone terminal note-off — panic (CC123)
    // goes through the flushed path (contract established by the Producer transport).
    sendPanic?.();
  }, [releaseNote, sendPanic]);

  // Flush playback telemetry only when a Polish/Listen run actually produced fires.
  // `pendingPlaybackRef` tracks whether a run has emitted fires since the last flush,
  // so the unmount flush doesn't double-emit a summary the pause/stop/done path
  // already flushed (and so an already-empty run doesn't emit an empty stats line).
  const pendingPlaybackRef = useRef(false);
  const flushPlaybackNow = useCallback(() => {
    if (mode === 'polish' || mode === 'listen') { flushPlayback(mode); pendingPlaybackRef.current = false; }
  }, [mode, flushPlayback]);

  const transport = useScoreTransport({
    timeline: mode === 'polish' || mode === 'listen' ? playTimeline : [],
    onEvent: (e) => {
      if (e.kind === 'step' || e.type == null) {
        // Focus loop (at tempo): once the cursor passes the range out-point, wrap
        // back to the in-point so a practice range repeats. Seek positions come from
        // the unscaled stepTimeline; scale to match the tempo-scaled playTimeline.
        const r = rangeRef.current;
        if (r && e.index > r[1]) {
          transportRef.current?.seek((stepTimeline[r[0]]?.t ?? 0) / tempoMult);
          setStep(r[0]);
          setStruck(() => new Set());
          return;
        }
        setStep(e.index);
        setStruck(() => new Set()); // new step starts dark; notes light as they sound
        return;
      }
      if (e.type === 'note_on') {
        pressNote?.(e.note, e.velocity ?? 80);
        soundingRef.current.add(e.note);
        setStruck((prev) => { const n = new Set(prev); n.add(e.note); return n; }); // bouncing-ball light-up
      } else {
        releaseNote?.(e.note);
        soundingRef.current.delete(e.note);
      }
    },
    onFire: (ev, driftMs, gapMs) => { pendingPlaybackRef.current = true; recordFire(ev, driftMs, gapMs, tempoMap[0]?.bpm); },
    onDone: () => { if (mode === 'listen') silence(); flushPlaybackNow(); logger.info('score.transport.done', { mode, steps: events.length }); },
  });
  const running = transport.playing;
  const transportRef = useRef(null); transportRef.current = transport; // read latest transport inside the tick closure

  // Metronome click (reference-only). Ticks in Learn at the piece's opening tempo
  // and in Listen at the user-scaled tempo. It only plays a blip — it NEVER gates
  // or advances the follow tracker/cursor (those are driven independently). Perform
  // and Polish get no click from this toggle.
  const clickBpm = (tempoMap[0]?.bpm || 90) * (mode === 'listen' ? tempoMult : 1);
  useMetronomeClick({
    enabled: clickOn && (mode === 'learn' || mode === 'listen'),
    bpm: clickBpm,
    onTick: playClick,
  });

  const flashWrong = useCallback(() => {
    setWrong(true);
    clearTimeout(wrongTimer.current);
    wrongTimer.current = setTimeout(() => setWrong(false), 280);
  }, []);
  useEffect(() => () => clearTimeout(wrongTimer.current), []);

  useReloadGuard(running);
  useEffect(() => { setGlobalPlaying(running); return () => setGlobalPlaying(false); }, [running, setGlobalPlaying]);

  // ── Polish scoring (at-tempo, per-measure grade) ──────────────────────────────
  // The cursor advances on the silent step timeline (no note_on for your parts);
  // MIDI hits are graded per measure. Timing drift is proxied by "ms after this
  // step's beat began" (stepStartRef) — a coarse but honest at-tempo lateness read.
  const smCfg = useMemo(() => resolveSheetMusicConfig(config?.sheetmusic), [config]);
  const resolvedScoringCfg = smCfg.scoring;
  const currentMeasure = layout.steps?.[step]?.measure ?? 0;
  useEffect(() => { stepStartRef.current = performance.now(); }, [step]);
  const driftForNote = useCallback(() => performance.now() - stepStartRef.current, []);
  const expectedForMeasure = useCallback((m) => {
    const meas = layout.measures?.[m];
    if (!meas) return [];
    const set = new Set();
    for (let i = meas.firstStep; i <= meas.lastStep; i++) {
      for (const midi of expectedMidisAtStep(layout.steps?.[i], activeParts)) set.add(midi);
    }
    return [...set];
  }, [layout.measures, layout.steps, activeParts]);

  const onMeasureGrade = useCallback((g) => {
    setGrades((prev) => ({ ...prev, [g.measure]: g }));
    logMeasureGrade({ measure: g.measure, grade: g.grade, noteScore: g.noteScore, timingScore: g.timingScore });
  }, [logMeasureGrade]);
  const onSilentStop = useCallback(() => {
    transport.pause();
    setSummaryOpen(true);
    logger.info('score.polish.silent-stop', {});
    // Run summary opens → log the aggregate (same tallying rule as RunSummary:
    // greens win ties, then reds over yellows for the overall read).
    const counts = { green: 0, yellow: 0, red: 0 };
    for (const g of Object.values(gradesRef.current)) {
      if (g?.grade && counts[g.grade] != null) counts[g.grade] += 1;
    }
    const overall = counts.green >= counts.yellow && counts.green >= counts.red
      ? 'green'
      : counts.red >= counts.yellow ? 'red' : 'yellow';
    logRunSummary({ greens: counts.green, yellows: counts.yellow, reds: counts.red, overall });
  }, [transport, logger, logRunSummary]);

  useScoreEvaluator({
    enabled: mode === 'polish' && scoringOn && running, // only while actually playing
    cfg: resolvedScoringCfg,
    subscribe,
    currentMeasure,
    expectedForMeasure,
    driftForNote,
    onMeasureGrade,
    onSilentStop,
  });

  // Clear grades + summary when the score document changes or scoring is turned off.
  useEffect(() => { setGrades({}); setSummaryOpen(false); }, [scoreMeta.musicXml]);
  useEffect(() => { if (!scoringOn) { setGrades({}); setSummaryOpen(false); } }, [scoringOn]);

  // ── Learn mode: full-hand tracker (all active-staff notes → advance) ──────────
  const lastAdvanceRef = useRef(0);
  const followHitsRef = useRef(0);
  const followWrongsRef = useRef(0);
  const onFollowHit = useCallback((note) => {
    setStruck((prev) => { const n = new Set(prev); n.add(note); return n; });
    followHitsRef.current += 1;
    const s = stepRef.current;
    const base = stepTimeline[s]?.t ?? 0;
    const expectedMs = (stepTimeline[s + 1]?.t ?? base) - base; // nominal duration of this step
    const actualMs = performance.now() - (lastAdvanceRef.current || performance.now());
    recordFollowHit({ step: s, note, expectedMs, actualMs });
  }, [stepTimeline, recordFollowHit]);
  const onFollowStep = useCallback((next) => {
    setStep(next);
    setStruck(() => new Set());
    lastAdvanceRef.current = performance.now();
  }, []);
  // Learn mode optimizes for READING the score, so the keyboard must not spoil
  // which key to press. Reveal the target key(s) only AFTER a wrong attempt at the
  // current step (and then only in a dim "half shade" — see targetNotes/dimTarget
  // below). Resets on every step change so the next note starts un-spoiled.
  const [revealKeys, setRevealKeys] = useState(false);
  useEffect(() => { setRevealKeys(false); }, [step]);
  const onFollowWrong = useCallback(() => { flashWrong(); setRevealKeys(true); followWrongsRef.current += 1; }, [flashWrong]);
  useFollowTracker({
    enabled: mode === 'learn',
    steps,
    activeParts,
    step,
    subscribe,
    onStep: onFollowStep,
    onHit: onFollowHit,
    onWrong: onFollowWrong,
    range, // wrap advancement within the practice range (null → linear)
  });

  // ── Listen play-along: non-gating light-up ────────────────────────────────────
  // Optional in Listen only. A struck note that matches the CURRENT step's expected
  // active-staff midis lights green (adds to `struck`). It NEVER advances or blocks —
  // the transport clock alone drives the cursor. Subscribes once per enabled change;
  // step/steps/activeParts read from refs (ref pattern, like useFollowTracker). The
  // transport's per-step `struck` reset already clears these additions each step.
  const stepsRef = useRef(steps); stepsRef.current = steps;
  const activePartsRef = useRef(activeParts); activePartsRef.current = activeParts;
  useEffect(() => {
    if (!(mode === 'listen' && playAlong) || !subscribe) return undefined;
    logger.debug('score.listen.playalong', { on: true });
    return subscribe((evt) => {
      if (!evt || evt.type !== 'note_on' || !evt.velocity) return;
      const expected = expectedMidisAtStep(stepsRef.current?.[stepRef.current], activePartsRef.current || {});
      if (expected.has(evt.note)) {
        setStruck((prev) => { const n = new Set(prev); n.add(evt.note); return n; });
      }
    });
  }, [mode, playAlong, subscribe, logger]);

  // Flush follow-timing stats when leaving Learn (and on unmount if still in it).
  const flushFollowNow = useCallback(() => {
    if (followHitsRef.current || followWrongsRef.current) {
      flushFollow(followHitsRef.current, followWrongsRef.current);
      followHitsRef.current = 0; followWrongsRef.current = 0;
    }
  }, [flushFollow]);
  const flushFollowRef = useRef(flushFollowNow); flushFollowRef.current = flushFollowNow;
  useEffect(() => () => flushFollowRef.current(), []);

  // Leaving the view mid Polish/Listen run cancels the rAF without an onDone, so
  // the playback summary would never emit. Flush once on unmount if a run is still
  // pending (guarded so it never double-emits with the pause/stop/done flush).
  const flushPlaybackRef = useRef(flushPlaybackNow); flushPlaybackRef.current = flushPlaybackNow;
  useEffect(() => () => { if (pendingPlaybackRef.current) flushPlaybackRef.current(); }, []);

  // Auto-follow the cursor: retargetable tween on the scroll container only
  // (native smooth scrollIntoView self-cancels at per-note cadence and drags
  // ancestor scrollers with it). Skipped while the reported layout belongs to
  // the other flow (mid re-engrave — coordinates would be stale).
  useEffect(() => {
    if (mode === 'perform' || !current) return;
    if (layout.flow && layout.flow !== flow) return;
    const el = scrollRef.current;
    const rdr = el?.querySelector('.musicxml-renderer');
    if (!el || !rdr) return;
    const elRect = el.getBoundingClientRect();
    const rdrRect = rdr.getBoundingClientRect();
    const rdrLeft = rdrRect.left - elRect.left + el.scrollLeft;
    const rdrTop = rdrRect.top - elRect.top + el.scrollTop;
    if (flow === 'horizontal') {
      tweenScrollTo(el, { left: rdrLeft + current.x - el.clientWidth / 2 });
    } else {
      const mid = rdrTop + (current.top + current.bottom) / 2;
      const targetTop = mid - el.clientHeight / 2;
      // Re-center only when the cursor drifts out of the comfortable band —
      // avoids a vertical micro-scroll on every step within a system.
      if (Math.abs(targetTop - el.scrollTop) > el.clientHeight * 0.18) tweenScrollTo(el, { top: targetTop });
    }
  }, [step, flow, mode, current, layout.flow]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => cancelScrollTween(scrollRef.current), []);

  // Perform page indicator — a rough page = floor(scrollPos / viewport) + 1 over
  // the current flow's axis. Recomputed on scroll + resize while in Perform.
  const { advancePedalCC, backPedalCC } = smCfg.perform;
  const computePerfPage = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const horiz = flow === 'horizontal';
    const viewport = horiz ? el.clientWidth : el.clientHeight;
    if (!viewport) return;
    const pos = horiz ? el.scrollLeft : el.scrollTop;
    const contentSize = horiz ? el.scrollWidth : el.scrollHeight;
    setPerfPage({ page: Math.floor(pos / viewport) + 1, pages: Math.max(1, Math.ceil(contentSize / viewport)) });
  }, [flow]);

  // Scroll the score by ~0.85 of a viewport (forward or back) along the flow axis.
  const pageBy = useCallback((dir) => {
    const el = scrollRef.current;
    if (!el) return;
    const horiz = flow === 'horizontal';
    const amount = (horiz ? el.clientWidth : el.clientHeight) * 0.85 * (dir === 'back' ? -1 : 1);
    el.scrollBy({ [horiz ? 'left' : 'top']: amount, behavior: 'smooth' });
    logger.info('score.perform.pageturn', { dir });
  }, [flow, logger]);

  // Perform mode: config-defined pedals turn the page — advancePedalCC forward,
  // backPedalCC back — rising edge ONLY, since continuous/half pedals stream many
  // CC values per physical press. Also tracks the page indicator on scroll/resize.
  useEffect(() => {
    if (mode !== 'perform') return undefined;
    computePerfPage();
    const el = scrollRef.current;
    const onScroll = () => computePerfPage();
    el?.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', computePerfPage);
    const prev = {}; // controller number → last seen CC value
    const unsub = subscribeRaw(({ data }) => {
      if (!data || data.length < 3) return;
      if ((data[0] & 0xf0) !== 0xb0) return; // control-change only
      const cc = data[1];
      const value = data[2];
      if (cc !== advancePedalCC && cc !== backPedalCC) return;
      const rising = isRisingEdge(prev[cc] ?? 0, value);
      prev[cc] = value;
      if (!rising) return;
      pageBy(cc === backPedalCC ? 'back' : 'fwd');
    });
    return () => {
      el?.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', computePerfPage);
      unsub?.();
    };
  }, [mode, subscribeRaw, advancePedalCC, backPedalCC, computePerfPage, pageBy]);

  // Tap: Learn/Polish → move the cursor to the nearest note; Perform → scroll it into view.
  const onScoreClick = useCallback((e) => {
    const el = scrollRef.current;
    const rdr = el?.querySelector('.musicxml-renderer');
    if (!el) return;
    if (mode === 'perform') {
      const r = el.getBoundingClientRect();
      const dy = e.clientY - (r.top + el.clientHeight / 2);
      const dx = e.clientX - (r.left + el.clientWidth / 2);
      el.scrollBy(flow === 'horizontal' ? { left: dx, behavior: 'smooth' } : { top: dy, behavior: 'smooth' });
      return;
    }
    if (!rdr || !events.length) return;
    const r = rdr.getBoundingClientRect();
    const i = nearestEvent(events, e.clientX - r.left, e.clientY - r.top);
    if (i < 0) return;
    // Custom-loop arming (Learn): the first tap sets the pending in-measure, the
    // second sets the out-measure → a { inMeasure, outMeasure } range (ordered
    // low→high). Arming taps set the bracket instead of seeking.
    if (loopArm && mode === 'learn') {
      const mi = measureIndexOfStep(i);
      if (loopInRef.current == null) {
        loopInRef.current = mi;
        logger.info('score.focus.arm', { inMeasure: mi });
      } else {
        const inMeasure = Math.min(loopInRef.current, mi);
        const outMeasure = Math.max(loopInRef.current, mi);
        loopInRef.current = null;
        setLoopArm(false);
        setFocus({ kind: 'custom', inMeasure, outMeasure });
      }
      return;
    }
    // Normal seek. When a practice range is active, clamp the target into it.
    const target = range ? clampStepToRange(i, range) : i;
    setStep(target);
    setStruck(() => new Set());
    lastAdvanceRef.current = performance.now();
    // Seek jumps idxRef past pending note_offs — flush sounding notes first
    // (Listen mode) so a skipped-over note doesn't drone on the piano.
    if (mode === 'listen') silence();
    // Transport timeline is tempo-scaled (playTimeline uses factor 1/tempoMult);
    // seek positions come from the unscaled stepTimeline, so scale to match.
    transport.seek((stepTimeline[target]?.t ?? 0) / tempoMult);
  }, [mode, flow, events, transport, stepTimeline, silence, tempoMult, loopArm, range, measureIndexOfStep, logger]);

  useEffect(() => () => silence(), [silence]);

  // ── Focus range: selection + custom-loop taps ─────────────────────────────────
  // When a practice range is (re)selected, jump the cursor to its in-point and log.
  useEffect(() => {
    if (!focus) return;
    const r = layout.measures ? rangeSteps(layout.measures, focus) : null;
    if (!r) return;
    setStep(r[0]);
    setStruck(() => new Set());
    lastAdvanceRef.current = performance.now();
    logFocus({ kind: focus.kind, inMeasure: focus.inMeasure, outMeasure: focus.outMeasure });
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPickSection = useCallback((section) => {
    const r = layout.measures ? sectionToRange(section, layout.measures) : null;
    if (!r) return;
    setLoopArm(false); loopInRef.current = null;
    setFocus({ kind: 'section', label: section.label, ...r });
  }, [layout.measures]);

  // Toggle the custom-range tap state machine. Re-arming clears any pending first tap.
  const onArmLoop = useCallback(() => {
    loopInRef.current = null;
    setLoopArm((v) => !v);
  }, []);

  const onClearFocus = useCallback(() => {
    setLoopArm(false); loopInRef.current = null;
    setFocus(null);
    logger.info('score.focus.clear', {});
  }, [logger]);

  // ── Bar handlers ──────────────────────────────────────────────────────────────
  const onMode = useCallback((id) => {
    if (id === mode) return;
    flushPlaybackNow();          // leaving a Polish/Listen run
    if (mode === 'learn') flushFollowNow();
    transport.stop();
    silence();
    setStruck(() => new Set());
    // Focus is a Learn + Polish practice affordance — release it on any mode change
    // so the range never bleeds into Listen/Perform (and starts clean on re-entry).
    setFocus(null); setLoopArm(false); loopInRef.current = null;
    // Leaving Polish: drop the run summary + grades (they belong to that run).
    setSummaryOpen(false); setGrades({});
    setKeyboardVisible(id !== 'perform');
    setMode(id);
    logMode({ mode: id });
  }, [mode, flushPlaybackNow, flushFollowNow, transport, silence, logMode]);

  // Listen tempo: clamp to a sane playable range (0.25×–2×). Timeline rescales via
  // the playTimeline memo; the transport reads the new timings on its next tick.
  const onTempo = useCallback((v) => {
    const n = Number(v);
    setTempoMult(Number.isFinite(n) ? Math.min(2, Math.max(0.25, n)) : 1);
  }, []);

  // Listen key transpose: clamp to ±7 semitones (one fifth either way). The renderer
  // re-engraves in the new key and re-extracts pitches, so both the notation and the
  // performed/highlighted notes move together.
  const onTranspose = useCallback((v) => {
    const n = Math.round(Number(v));
    const clamped = Number.isFinite(n) ? Math.min(7, Math.max(-7, n)) : 0;
    setTranspose(clamped);
    logTranspose({ semitones: clamped });
  }, [logTranspose]);

  const reset = useCallback(() => {
    transport.stop();
    if (mode === 'listen') silence();
    flushPlaybackNow();
    setStep(0);
    setStruck(() => new Set());
    setGrades({});          // a fresh run clears the previous grades…
    setSummaryOpen(false);  // …and closes any open summary
    scrollRef.current?.scrollTo({ top: 0, left: 0 });
  }, [transport, mode, silence, flushPlaybackNow]);

  // Run summary Replay: reset the run (clears grades + closes the panel).
  const onReplaySummary = useCallback(() => { reset(); }, [reset]);
  const onCloseSummary = useCallback(() => setSummaryOpen(false), []);

  const toggleRun = useCallback(() => {
    if (running) {
      transport.pause();
      if (mode === 'listen') silence();
      flushPlaybackNow();
      logger.info('score.transport.pause', { step });
    } else {
      transport.seek((stepTimeline[stepRef.current]?.t ?? 0) / tempoMult);
      transport.play();
      logger.info('score.transport.play', { step, mode, bpm: tempoMap[0]?.bpm, tempoMult });
    }
  }, [running, transport, mode, silence, flushPlaybackNow, logger, step, stepTimeline, tempoMap, tempoMult]);

  const onCyclePart = useCallback((staff) => {
    if (mode === 'listen') {
      const role = roles[staff] || 'play';
      const next = cyclePart(role);
      setRoles((r) => ({ ...r, [staff]: next }));
      if (running) { transport.pause(); flushPlaybackNow(); }
      silence(); // role change invalidates the note timeline mid-flight
      logger.info('score.listen.part', { staff, role: next });
    } else {
      // Learn needs ≥1 active staff or the all-notes rule can never be satisfied
      // (the cursor would deadlock). Refuse to turn off the last active staff.
      const activeCount = parts.reduce((c, p) => c + (activeParts[p.staff] ? 1 : 0), 0);
      if (activeParts[staff] && activeCount <= 1) return; // keep the last staff on
      setActiveParts((a) => ({ ...a, [staff]: !a[staff] }));
      logger.info('score.active-part', { staff, on: !activeParts[staff] });
    }
  }, [mode, roles, running, transport, flushPlaybackNow, silence, logger, activeParts, parts]);

  // ── Load timing (best-effort) ───────────────────────────────────────────────
  // Measured: fetch ms (from SheetMusic.jsx via score.fetchMs) + open→ready total
  // here. Fires once per document (re-engraves from zoom/flow don't re-log).
  const openTsRef = useRef(performance.now());
  const readySentRef = useRef(false);
  // A new score opens in its written key (mirror the other per-score resets).
  useEffect(() => {
    openTsRef.current = performance.now(); readySentRef.current = false; setTranspose(0);
    // Open a fresh per-run session log for this document (bounds the JSONL file);
    // all subsequent events (load / follow / polish / focus / mode / transpose) land in it.
    startSession(scoreMeta.id);
    // A new document resets the practice range (measure indices don't carry over).
    setFocus(null); setLoopArm(false); loopInRef.current = null;
  }, [scoreMeta.musicXml]); // eslint-disable-line react-hooks/exhaustive-deps
  const onReady = useCallback(() => {
    if (readySentRef.current) return;
    readySentRef.current = true;
    logLoad({
      fetchMs: Math.round(scoreMeta.fetchMs || 0),
      openToReadyMs: Math.round(performance.now() - openTsRef.current),
    });
  }, [logLoad, scoreMeta.fetchMs]);

  const cursorColor = mode === 'learn' ? '#2ec46f' : mode === 'listen' ? '#e8a33d' : '#6cf';

  // Teleport (don't sweep diagonally) when the cursor crosses to a new system.
  const jump = current != null && prevTopRef.current != null && Math.abs(current.top - prevTopRef.current) > 1;
  useEffect(() => { prevTopRef.current = current?.top ?? null; }, [current]);

  // Keyboard target set: Listen → your ('you') part pitches at this onset; other
  // interactive modes → the active-staff expected midis at this step.
  // Listen → your ('you') part pitches (playalong reference). Polish → the bouncing-
  // ball expected notes (an auto demo, fine to show). Learn → NOTHING until a wrong
  // attempt reveals it (reading-first; see revealKeys). Perform → no keyboard.
  const targetNotes = mode === 'listen' && current
    ? youMidisAt(layout.notes, roles, current.onsetQuarter)
    : mode === 'polish'
      ? expectedMidisAtStep(steps[step], activeParts)
      : mode === 'learn' && revealKeys
        ? expectedMidisAtStep(steps[step], activeParts)
        : null;

  // Lit (green "hit") noteheads. Learn/Listen fill `struck` as notes are struck /
  // sounded (unchanged). Polish has no note_on transport events, so nothing
  // would ever light — instead light every active-staff note at the current onset
  // (the bouncing ball), recomputed as `step` advances. expectedMidisAtStep
  // tolerates an undefined step.
  const litNotes = mode === 'polish'
    ? expectedMidisAtStep(steps[step], activeParts)
    : struck;

  // Per-step cursor boxes (same offset-space as the cursor) → measure-grade geometry.
  // Events are parallel to steps by index; MeasureGradeLayer reads x/top/bottom.
  const showGrades = mode === 'polish' && scoringOn;
  const stepBoxes = useMemo(
    () => (showGrades ? events.map((e) => ({ x: e.x, top: e.top, bottom: e.bottom })) : []),
    [showGrades, events],
  );

  return (
    <div className="piano-score-player">
      <div className={`piano-score-player__scroll piano-score-player__scroll--${flow}`} ref={scrollRef} onClick={onScoreClick}>
        <MusicXmlRenderer score={parsed} musicXml={scoreMeta.musicXml} flow={flow} scale={scale} transpose={transpose} onLayout={onLayout} onReady={onReady}>
          {mode !== 'perform' && current && (
            <div
              ref={cursorRef}
              className={`piano-score-cursor${wrong ? ' is-wrong' : ''}${jump ? ' is-jump' : ''}`}
              style={{
                left: current.x - 9 * scale,
                top: current.top,
                width: Math.round(18 * scale),
                height: Math.max(40 * scale, current.bottom - current.top),
                '--cursor-color': cursorColor,
              }}
            />
          )}
          {showGrades && (
            <MeasureGradeLayer
              measures={layout.measures}
              stepBoxes={stepBoxes}
              grades={grades}
            />
          )}
          {mode !== 'perform' && (
            <NoteHighlightLayer
              step={steps[step]}
              activeParts={activeParts}
              struck={litNotes}
              accent={cursorColor}
            />
          )}
        </MusicXmlRenderer>
      </div>

      {keyboardVisible && (
        <div className="piano-score-player__keys">
          <PianoKeyboard
            activeNotes={activeNotes}
            targetNotes={targetNotes}
            dimTarget={mode === 'learn'}
            startNote={kb.startNote}
            endNote={kb.endNote}
          />
        </div>
      )}

      <ScoreTransportBar
        mode={mode}
        onMode={onMode}
        running={running}
        onToggleRun={toggleRun}
        onReset={reset}
        step={step}
        total={events.length}
        page={perfPage.page}
        pages={perfPage.pages}
        flow={flow}
        onToggleFlow={() => setFlow((f) => (f === 'wrapped' ? 'horizontal' : 'wrapped'))}
        scale={scale}
        onScale={setScale}
        tempoMult={tempoMult}
        onTempo={onTempo}
        transpose={transpose}
        onTranspose={onTranspose}
        playAlong={playAlong}
        onTogglePlayAlong={() => setPlayAlong((v) => !v)}
        parts={barParts}
        activeParts={activeParts}
        roles={roles}
        onCyclePart={onCyclePart}
        sections={sections}
        focus={focus}
        loopArm={loopArm}
        onPickSection={onPickSection}
        onArmLoop={onArmLoop}
        onClearFocus={onClearFocus}
        keyboardVisible={keyboardVisible}
        onToggleKeyboard={() => setKeyboardVisible((v) => !v)}
        clickOn={clickOn}
        onToggleClick={() => setClickOn((v) => !v)}
        scoringOn={scoringOn}
        onToggleScoring={() => setScoringOn((v) => !v)}
        meta={meta}
      />

      {mode === 'polish' && scoringOn && (
        <RunSummary
          open={summaryOpen}
          grades={grades}
          measures={layout.measures}
          onClose={onCloseSummary}
          onReplay={onReplaySummary}
        />
      )}
    </div>
  );
}
