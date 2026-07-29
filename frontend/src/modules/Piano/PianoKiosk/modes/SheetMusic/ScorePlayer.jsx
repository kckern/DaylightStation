import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { parseMusicXml } from '../../../../MusicNotation/parseMusicXml.js';
import { MusicXmlRenderer } from '../../../../MusicNotation/renderers/MusicXmlRenderer.jsx';
import LiveKeyboard from '../../LiveKeyboard.jsx';
import { usePianoKioskConfig } from '../../PianoConfig.jsx';
import { usePianoMidi } from '../../PianoMidiContext.jsx';
import { usePianoPlayback } from '../../PianoPlaybackContext.jsx';
import { usePianoBreadcrumb } from '../../PianoBreadcrumbContext.jsx';
import useReloadGuard from '../../useReloadGuard.js';
import { buildTempoMap, buildStepTimeline, scaleTimeline } from '../../../../MusicNotation/scoreTimeline.js';
import { useScoreTransport } from '../../score/useScoreTransport.js';
import { tweenScrollTo, cancelScrollTween } from './scrollTween.js';
import { partsOf, buildPlayTimeline } from './playParts.js';
import { staffLabels, defaultActiveParts, expectedMidisAtStep } from './activeParts.js';
import { rangeSteps, clampStepToRange, sectionToRange, homeStep, nudgeRange } from './focusRange.js';
import useFollowTracker from './useFollowTracker.js';
import useMetronomeClick from './useMetronomeClick.js';
import useCountIn from './useCountIn.js';
import { countInPlan } from './countIn.js';
import useScoreTelemetry from './useScoreTelemetry.js';
import useScoreEvaluator from './useScoreEvaluator.js';
import { resolveSheetMusicConfig } from './sheetMusicConfig.js';
import { tallyGrades } from './gradeTally.js';
import { worstSpan } from './worstSpan.js';
import { loadScoreSettings, saveScoreSettings } from './scoreSettings.js';
import { isRisingEdge } from './pedalEdge.js';
import { midiToRecord } from './midiTap.js';
import { record, intern, KIND, startRecorder, stopRecorder } from '../../../../../lib/logging/inputRecorder.js';
import { coalesce } from '../../../../../lib/logging/gestureCoalescer.js';
import { inputTelemetryEnabled, makeInputSender } from '../../../../../lib/logging/inputTelemetryGate.js';
import { keyLabel } from './keyLabel.js';
import ScoreTransportBar from './ScoreTransportBar.jsx';
import ModeSheet, { MODES } from './ModeSheet.jsx';
import NoteHighlightLayer from './NoteHighlightLayer.jsx';
import MeasureGradeLayer from './MeasureGradeLayer.jsx';
import StaffDimLayer from './StaffDimLayer.jsx';
import RunSummary from './RunSummary.jsx';
import CountInOverlay from './CountInOverlay.jsx';
import LearnComplete from './LearnComplete.jsx';
import FocusRangeLayer from './FocusRangeLayer.jsx';
import SelectBanner from './SelectBanner.jsx';
import StuckPrompt from './StuckPrompt.jsx';
import { nearestEvent, SELECT_MAX_DIST } from './nearestEvent.js';
import { titleFromScoreId } from './scoreTitle.js';

// One source of truth for the transport's tick rate: the telemetry's stall rule
// is expressed as a MULTIPLE of it, so the two can never drift apart (audit H1).
const TRANSPORT_TICK_MS = 100;

// How long a guided loop-selection arm survives with no progress before it
// expires (audit H4b).
const SELECT_IDLE_MS = 15000;

// How long Learn's cursor may sit on one both-hands step before the hands split is
// offered on the score (audit H3).
const STUCK_PROMPT_MS = 5000;

// Fixed near-black ink for lit noteheads (wave-2 A): every mode's cursor band
// keeps its own accent colour, but the noteheads themselves always light this
// same near-black so the sheet doesn't take on a per-mode tint. Struck (green
// HIT glow) and pending markers are unaffected — they're separate CSS classes.
export const NOTE_INK = '#23262b';

/**
 * ScorePlayer — interactive engraved score. Four modes:
 *  Learn   — full-hand tracking: the cursor advances only once every active-staff
 *            note of the step is struck; wrong notes flash; struck noteheads light.
 *  Polish  — auto-advances at tempo; the current onset's active-staff
 *            noteheads light up (bouncing ball). It does NOT perform through
 *            the piano — it only lights the notes you should be playing.
 *  Listen  — the kiosk performs the ACTIVE hands through the piano; an inactive
 *            hand is simply muted (one hands model — wave-3 A: no play-along
 *            highlighting, no "your part").
 *  Perform — no awareness; config-defined pedals + tap-to-scroll turn the page.
 *
 * Chrome lives in a pinned bottom {@link ScoreTransportBar}; the top bar shows the
 * breadcrumb (score title). Per-notehead light-up is drawn by {@link NoteHighlightLayer}
 * over the cursor overlay; logs-only timing telemetry flows through
 * {@link useScoreTelemetry}.
 */
export default function ScorePlayer({ score: scoreMeta }) {
  const { subscribe, subscribeRaw, releaseNote, sendNoteAt, sendNoteOffAt, sendPanic } = usePianoMidi();
  const { setPlaying: setGlobalPlaying } = usePianoPlayback();
  const { config } = usePianoKioskConfig();
  const kb = config?.keyboard || { startNote: 21, endNote: 108 };

  // Destructure the (individually memoized) telemetry callbacks rather than
  // holding the returned object: the object identity is fresh every render, and
  // the renderer's engrave effect depends on `onReady` — a churning identity
  // would re-fire onLayout/onReady endlessly (infinite re-engrave loop).
  const { logger, startSession, logLoad, recordFire, recordSchedule, flushPlayback, recordFollowHit, flushFollow, logMeasureGrade, logRunSummary, logFocus, logTranspose, logMode } = useScoreTelemetry({ id: scoreMeta.id, tickMs: TRANSPORT_TICK_MS });

  const parsed = useMemo(() => { try { return parseMusicXml(scoreMeta.musicXml); } catch { return null; } }, [scoreMeta.musicXml]);
  const tempo = parsed?.tempo || 90;
  const meta = useMemo(() => ({
    title: scoreMeta.title || parsed?.title || titleFromScoreId(scoreMeta.id),
    composer: parsed?.composer || null,
    tempo,
    key: keyLabel(parsed?.key?.fifths ?? 0, parsed?.key?.mode),
    time: parsed ? `${parsed.timeSig.beats}/${parsed.timeSig.beatType}` : null,
    measures: parsed?.parts?.[0]?.measures?.length || 0,
  }), [scoreMeta.id, scoreMeta.title, parsed, tempo]);

  // Resolved sheetmusic config (defaults filled). Hoisted above the mode state so
  // the initial mode can come from `defaultMode` — the ladder starts at Listen.
  const smCfg = useMemo(() => resolveSheetMusicConfig(config?.sheetmusic), [config]);
  const VALID_MODES = ['listen', 'learn', 'polish', 'perform'];
  // Per-score practice settings restored device-locally (mode/tempo/hands), so a
  // walk-up user finds the piece the way they left it (Task 2.5). The practice
  // LOOP is excluded on purpose — see scoreSettings.js (audit M1).
  const restored = useMemo(() => loadScoreSettings(scoreMeta.id), [scoreMeta.id]);

  const [layout, setLayout] = useState({ events: [], notes: [], steps: [], measures: [], tempoEntries: [], width: 0, height: 0, flow: null, scale: null, transpose: null });
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState(() => {
    const m = restored.mode;
    return VALID_MODES.includes(m) ? m : (VALID_MODES.includes(smCfg.defaultMode) ? smCfg.defaultMode : 'learn');
  });
  // The mode picker now lives in the header (wave-2 B): the title crumb stays
  // put, and a second crumb — the current mode's icon + label — opens ModeSheet.
  const [modeSheetOpen, setModeSheetOpen] = useState(false);
  const openModeSheet = useCallback(() => setModeSheetOpen(true), []);
  const modeMeta = MODES.find((m) => m.id === mode) || MODES[0];
  usePianoBreadcrumb(useMemo(() => [
    { label: meta.title, image: scoreMeta.splashImage || null },
    { label: modeMeta.label, icon: modeMeta.icon, onClick: openModeSheet },
  ], [meta.title, scoreMeta.splashImage, modeMeta, openModeSheet]));
  // Listen/Learn/Polish practice range (measure INDICES) | null = whole piece.
  // Practice loops are per-session by design — never restored (audit M1).
  const [focus, setFocus] = useState(null);
  // Is the loop ON (wave-2: loop is a direct toggle, separate from whether a
  // range exists — audit L2 follow-up)? A defined range keeps showing its
  // brackets even when looping is off (FocusRangeLayer reads `focus`, not the
  // gated `range` below); only the wrap/clamp/home-step machinery cares.
  // Defaults true so picking/selecting a range loops it immediately, same as
  // before this control existed. A fresh session never restores this either —
  // it rides the same per-session discipline as `focus` (audit M1).
  const [loopOn, setLoopOn] = useState(true);
  const loopOnRef = useRef(loopOn); loopOnRef.current = loopOn;
  // Guided measure-selection state machine (Loop → Select measures…):
  //   null | { stage: 'first' } | { stage: 'last', inMeasure } (audit J5/M3)
  const [selecting, setSelecting] = useState(null);
  const [selectRejects, setSelectRejects] = useState(0);
  const [clickOn, setClickOn] = useState(() => restored.clickOn !== false); // Polish metronome — on unless turned off
  // Learn free-running metronome — explicit opt-in per session, NEVER persisted:
  // a walk-up user must not inherit a ticking room (audit M2).
  const [learnClick, setLearnClick] = useState(false);
  const [flow, setFlow] = useState('wrapped');
  const [perfPage, setPerfPage] = useState({ page: 1, pages: 1 }); // Perform page indicator (1-based)
  const [scale, setScale] = useState(1);
  const [transpose, setTranspose] = useState(0); // Listen key transpose (semitones)
  const [tempoMult, setTempoMult] = useState(() => { // Listen/Polish tempo: 1 = written, 0.5 = half
    const t = Number(restored.tempoMult);
    return Number.isFinite(t) && t >= 0.25 && t <= 2 ? t : 1;
  });
  const [wrong, setWrong] = useState(false);
  const [struck, setStruck] = useState(() => new Set());
  // Keyboard visibility is AUTO per mode (Learn/Polish shown; Perform hidden; Listen
  // shown only when the user plays a part), with a remembered per-mode manual
  // override (audit M2). kbTick just forces a re-render when the override changes.
  const kbOverrideRef = useRef({}); // mode → explicit user choice (true/false)
  const [kbTick, setKbTick] = useState(0);
  const [grades, setGrades] = useState({}); // measure INDEX → grade result (Polish scoring)
  // Every loop wrap is an end-of-measure for grading purposes, even when the loop
  // is one measure long and the measure index never changes (audit: Polish).
  const [loopWraps, setLoopWraps] = useState(0);
  const gradesRef = useRef(grades); gradesRef.current = grades; // latest grades for the run-summary log (onSilentStop closure)
  const [summaryOpen, setSummaryOpen] = useState(false); // Polish run summary panel
  // Is a RUN active? True from the moment playback starts until it is paused,
  // stopped, or finishes. Deliberately NOT `transport.playing`: a Polish loop
  // pinned to the FINAL measure restarts through onDone's one-beat dwell (the
  // zero-span guard), and across that dwell the transport completes inside play()'s
  // immediate tick, so `playing` never commits true. An evaluator gated on
  // `playing` therefore never subscribed at all — the probe played six correct
  // passes over a tail-measure loop and got zero grades and zero stops (Task 19).
  // It must go false on every genuine end-of-run, or the evaluator grades measures
  // the cursor merely passes over (the phantom grades e501ff6fd fixed).
  const [runActive, setRunActive] = useState(false);
  const scrollRef = useRef(null);
  const cursorRef = useRef(null);
  const prevTopRef = useRef(null);
  const wrongTimer = useRef(null);
  const stepRef = useRef(0);
  stepRef.current = step;
  const stepStartRef = useRef(0); // wall time the current step began (Polish drift proxy)
  // What CAUSED the next focus change, so score.focus.set is attributable. The
  // two-tap flow, the ±1 nudge and a section pick all commit the same event
  // shape; without this the log cannot tell them apart (audit T1).
  const focusOriginRef = useRef('restore');

  const events = layout.events;
  const steps = layout.steps;
  const current = events[step] || null;
  const onLayout = useCallback((res) => { setLayout(res); }, []);

  // Overlay geometry must match what's on screen: after a zoom/flow/transpose
  // change the sheet repaints immediately but extraction may be deferred
  // (holdExtraction) — until onLayout catches up, cursor/notehead coords belong to
  // the OLD engrave and must not be drawn. A TRANSPOSE counts as much as the other
  // two: it re-engraves in a new KEY, so a resume taken before the new geometry
  // lands performs the old key against the new sheet (audit H2). Null/undefined
  // layout.flow/scale/transpose (pre-first-layout) are treated as fresh so the very
  // first paint isn't hidden.
  const layoutFresh = (!layout.flow || layout.flow === flow)
    && (layout.scale == null || layout.scale === scale)
    && (layout.transpose == null || layout.transpose === transpose);

  // ── Focus range (practice a section / custom loop) ────────────────────────────
  // Sections come from rehearsal marks (measure NUMBERS); `layout.measures` maps
  // NUMBERS↔INDICES and INDICES↔step spans. A `focus` resolves to a step span
  // [lo, hi]; the follow tracker loops within it and taps/seeks clamp into it.
  // Listen participates too (hear the passage, then drill it — audit L6); only
  // Perform (music-stand mode) ignores the loop.
  const sections = useMemo(() => parsed?.sections || [], [parsed]);
  const range = useMemo(
    () => (focus && loopOn && mode !== 'perform' && layout.measures ? rangeSteps(layout.measures, focus) : null),
    [focus, loopOn, mode, layout.measures],
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
  // Memoized so the memoized transport bar can bail across a step advance (a fresh
  // array each render would defeat React.memo on ScoreViewControls). Keyed to the
  // staff signature + labels, which only change on re-engrave.
  const barParts = useMemo(
    () => parts.map((p, i) => ({ staff: p.staff, label: partLabels[i] })),
    [parts, staffSig], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Active staves: the single "which hands am I responsible for" model, shared by
  // EVERY mode (wave-3 A — the old Listen-only myStaves claim set is retired).
  // Learn/Polish practice the active staves; Listen performs them through the
  // piano — an inactive staff is simply muted (no play-along highlighting).
  // Restored per score; the effect below preserves any staff present in `prev`
  // (so seeding it restores the choice), and defaults a fresh staff on.
  const [activeParts, setActiveParts] = useState(() => (
    restored.activeParts && typeof restored.activeParts === 'object' ? restored.activeParts : {}
  ));
  useEffect(() => {
    setActiveParts((prev) => {
      const dflt = defaultActiveParts(layout.notes);
      return Object.fromEntries(parts.map((p) => [p.staff, p.staff in prev ? prev[p.staff] : (dflt[p.staff] ?? true)]));
    });
  }, [staffSig]); // eslint-disable-line react-hooks/exhaustive-deps

  // Roles feed Listen's audio timeline (buildPlayTimeline's isAudible checks
  // === 'play'): an active staff plays, an inactive one mutes — the single source
  // for Listen roles (audit J4), now the SAME source Learn/Polish practice from.
  const roles = useMemo(
    () => Object.fromEntries(parts.map((p) => [p.staff, activeParts[p.staff] ? 'play' : 'mute'])),
    [parts, activeParts],
  );

  // Keyboard: auto per mode, with a remembered per-mode manual override (M2). Listen
  // defaults hidden — the kiosk performs, so there is nothing "yours" to play along
  // with — but the View-sheet toggle still overrides. kbTick forces a read of the
  // override ref after a toggle.
  const AUTO_KB = { learn: true, polish: true, perform: false, listen: false };
  const autoKb = AUTO_KB[mode] ?? true;
  const keyboardVisible = kbOverrideRef.current[mode] ?? autoKb; // eslint-disable-line no-unused-expressions
  void kbTick; // keyboardVisible re-reads the override ref whenever kbTick bumps

  // Listen performs the ACTIVE staves; an inactive staff is engraved but simply
  // muted — never sent to the piano, and no longer highlighted as "yours" (wave-3
  // A retires the play-along model). Tempo-scaled by the user's multiplier (faster
  // tempo → shorter durations → factor 1/tempoMult). Other modes keep their silent
  // step timeline. Polish is scaled too so its tempo control tracks the same knob.
  const playTimeline = useMemo(
    () => (mode === 'listen'
      ? scaleTimeline(buildPlayTimeline(events, layout.notes, tempoMap, roles), 1 / tempoMult)
      : scaleTimeline(stepTimeline, 1 / tempoMult)),
    [mode, events, layout.notes, tempoMap, roles, stepTimeline, tempoMult],
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

  // Scheduled sends already handed to the MIDI service can't be recalled
  // (MIDIOutput.clear() is unreliable on this WebView) — flush twice: now for
  // everything sounding, and once more after the lookahead window for note-ons
  // that dispatch after the first flush. All pending timestamps are <=
  // pause-time + lookahead, so the delayed panic covers the whole tail.
  const flushTimerRef = useRef(null);
  // Pending zero-span loop-wrap restart (see onDone) — cleared by every playback
  // disruption so a stale dwell can't restart the transport under the user.
  // NOTE: disruptions must clear UNCONDITIONALLY (before any `playing` check) —
  // during the dwell nothing is playing, so a playing-gated clear never runs.
  const wrapTimerRef = useRef(null);
  const clearWrapDwell = useCallback(() => { clearTimeout(wrapTimerRef.current); }, []);
  const silenceScheduled = useCallback(() => {
    silence();
    clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => sendPanic?.(), (transportRef.current?.lookaheadMs ?? 400) + 60);
  }, [silence, sendPanic]);
  // No standalone clearTimeout-on-unmount here: the single unmount teardown below
  // calls silenceScheduled(), and its delayed panic is DESIRED to fire after we're
  // gone (note-ons already dispatched to the MIDI service, up to lookaheadMs in the
  // future, would otherwise drone with no note-off). sendPanic comes from the MIDI
  // context, which outlives this component, so that post-unmount timer is safe.

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
    tickMs: TRANSPORT_TICK_MS,
    // AUDIO PLANE — runs up to lookaheadMs ahead; must touch NO React state
    // beyond the sounding ledger (used only for flush bookkeeping). Sends carry
    // the transport's wall timestamp so the MIDI service dispatches on time even
    // if this tick woke late. These do NOT light the keyboard — machine playback
    // was never human input; noteheads still light via `struck` at due time.
    onSchedule: (e, atWall, leadMs) => {
      if (e.type === 'note_on') {
        sendNoteAt?.(e.note, e.velocity ?? 80, atWall);
        soundingRef.current.add(e.note);
      } else {
        sendNoteOffAt?.(e.note, atWall);
        soundingRef.current.delete(e.note);
      }
      pendingPlaybackRef.current = true;
      recordSchedule(e, leadMs);
    },
    // VISUAL PLANE — fires at musical due time; allowed to be late (just a late
    // frame). Advances the cursor and lights struck noteheads; no MIDI here.
    onEvent: (e, dueWall) => {
      if (e.kind === 'step' || e.type == null) {
        // Focus loop (at tempo): once the cursor passes the range out-point, wrap
        // back to the in-point so a practice range repeats. Seek positions come from
        // the unscaled stepTimeline; scale to match the tempo-scaled playTimeline.
        const r = rangeRef.current;
        if (r && e.index > r[1]) {
          transportRef.current?.seek((stepTimeline[r[0]]?.t ?? 0) / tempoMult);
          setStep(r[0]);
          setStruck(() => new Set());
          setLoopWraps((n) => n + 1);
          // The wrap-seek jumps idxRef past the skipped tail's note_offs — in
          // Listen (the only mode that sends audio) flush so they don't drone.
          if (mode === 'listen') silenceScheduled();
          return;
        }
        stepStartRef.current = dueWall; // musical step start (audit T4) — not commit time
        setStep(e.index);
        setStruck(() => new Set()); // new step starts dark; notes light as they sound
        return;
      }
      if (e.type === 'note_on') {
        setStruck((prev) => { const n = new Set(prev); n.add(e.note); return n; }); // bouncing-ball light-up
      }
    },
    // Polish has no note events (silent step timeline), so onSchedule never runs
    // there — mark a run pending here too, so the unmount-flush guard still emits
    // a Polish run's stats when the view is left mid-run.
    // recordFire takes the EFFECTIVE tempo: playTimeline is scaled by
    // 1/tempoMult, so at 0.5x the beat is twice as long and the stall budget
    // (a fraction of a beat) must grow with it. Passing the written bpm made
    // the budget half as tight as the music warranted at 0.5x and 25% too
    // loose at 1.25x — and `stalls` ships at info level in score.playback.stats.
    onFire: (ev, driftMs, gapMs) => { pendingPlaybackRef.current = true; recordFire(ev, driftMs, gapMs, (tempoMap[0]?.bpm || 90) * tempoMult); },
    onDone: () => {
      // A loop that contains the FINAL step never sees a step past its out-point,
      // so the onEvent wrap can't fire — the run completes instead. Wrap here:
      // restart from the in-point INSTEAD of finishing (audit L6). Safe to do
      // synchronously: the transport resets itself BEFORE invoking onDone, and
      // play() re-anchors + re-arms its timer (setPlaying(true) wins the batch).
      // With a loop active, a Polish run loops until the user pauses or the
      // silent-stop fires — the summary still arrives via that path.
      const r = rangeRef.current;
      if (r && (mode === 'listen' || mode === 'polish')) {
        if (mode === 'listen') silenceScheduled(); // skipped tail note_offs must not drone
        const tIn = (stepTimeline[r[0]]?.t ?? 0) / tempoMult;
        const restart = () => {
          transportRef.current?.seek(tIn);
          setStep(r[0]);
          setStruck(() => new Set());
          setLoopWraps((n) => n + 1);
          setRunActive(true); // the run continues through the wrap (see runActive)
          transportRef.current?.play();
        };
        // Zero-span guard: when the in-point IS the final timeline event (a
        // single-step final measure in Polish — its step timeline ends at the
        // last ONSET), a synchronous restart would re-complete inside play()'s
        // immediate tick → onDone again, an unbounded recursion. Dwell one beat
        // at the practice tempo before restarting instead. Every playback
        // disruption (play/pause, mode change, reset, tap-seek) clears the timer.
        const endT = playTimeline[playTimeline.length - 1]?.t ?? 0;
        if (tIn >= endT) {
          clearWrapDwell();
          wrapTimerRef.current = setTimeout(restart, 60000 / (tempoMap[0]?.bpm || 90) / tempoMult);
        } else {
          restart();
        }
        logger.info('score.transport.loop-wrap', { mode, inStep: r[0], dwell: tIn >= endT });
        return;
      }
      if (mode === 'listen') silenceScheduled();
      flushPlaybackNow();
      // A Polish run that plays to the end must grade its final measure and show
      // the summary — the reward for finishing, not only for giving up (audit H1).
      // The evaluator cannot name the measure the run ended on: the final step's
      // setStep has not committed (and the cursor goes home below), so it still
      // reads the second-to-last one. Derive it here — a completed run ended on
      // the LAST step, whatever measure that step belongs to.
      if (mode === 'polish') {
        const endMeasure = steps[events.length - 1]?.measure;
        openRunSummaryRef.current?.(finalizeRef.current?.(endMeasure));
      }
      setRunActive(false); // done WITHOUT a loop = a genuine end of run (see runActive)
      logger.info('score.transport.done', { mode, steps: events.length });
      // The run is OVER — put the cursor back where a run starts (the loop
      // in-point when one is active, else the top). Without this, `step` stays
      // parked on the final step while the transport has already rewound, so the
      // next Play seeks to the end and plays ~1.6s of the last measure. Users hit
      // that fourteen times in one session (audit H2). Mirrors what reset() does.
      const home = homeStep(rangeRef.current);
      setStep(home);
      setStruck(() => new Set());
      if (home === 0) scrollRef.current?.scrollTo({ top: 0, left: 0 });
    },
  });
  const transportRef = useRef(null); transportRef.current = transport; // read latest transport inside the tick closure

  // A pause taken purely to rebuild the timeline or re-engrave is not a user
  // decision — remember where we were and resume there once the layout is fresh.
  // Both the Listen part-change (audit H5) and the zoom/flow/transpose pause
  // (audit M3) go through this; without it, choosing a part reads as "this button
  // breaks the song" and a zoom costs the user their place.
  const resumeAfterRef = useRef(null);
  const [resumeTick, setResumeTick] = useState(0);

  // Count-in: one measure of click before a run where the user is expected to play
  // (Polish always; Listen when they've claimed a part — wired in a later task). It
  // must be audible BEFORE the transport is graded (audit J1). onGo seeks to the
  // current cursor and starts playback; a tap on the score cancels it.
  const countIn = useCountIn({
    onGo: () => {
      // Play always starts INSIDE an active loop (audit L6) — clamp a cursor
      // left outside the range to its in-point before seeking.
      const startStep = rangeRef.current ? clampStepToRange(stepRef.current, rangeRef.current) : stepRef.current;
      if (startStep !== stepRef.current) setStep(startStep);
      transportRef.current?.seek((stepTimeline[startStep]?.t ?? 0) / tempoMult);
      setRunActive(true);
      transportRef.current?.play();
      logger.info('score.countin.go', { step: startStep, mode });
    },
  });
  // The run button reads "playing" during the count-in too, so a second tap can
  // abort it (via onScoreClick) and the bar shows ⏸ rather than a dead ▶.
  const running = transport.playing || countIn.active;

  // Metronome click (audit M1/M2/M4). Two modes, one bar button:
  //  Polish — `clickOn` (persisted) ARMS a reference beat that sounds only while
  //           the transport actually runs (the count-in supplies its own blips).
  //  Learn  — `learnClick` (session-local) IS the metronome: toggling ON starts a
  //           free-running practice beat immediately. Leaving Learn silences it
  //           (enabled goes false → the hook's cleanup stops the scheduler).
  // It NEVER gates or advances the cursor. Ticks at the practice tempo.
  const clickActive = mode === 'learn' ? learnClick : clickOn;
  // The hook gets the EXACT product — the Polish transport runs at exactly
  // bpm × tempoMult (playTimeline scales by 1/tempoMult), so rounding here would
  // drift the click against the graded run (63 × 0.5 → 32 vs 31.5 = a full beat
  // every ~64). Round only the bar's readout.
  const clickBpmExact = (tempoMap[0]?.bpm || 90) * tempoMult;
  useMetronomeClick({
    enabled: (mode === 'polish' && clickOn && transport.playing) || (mode === 'learn' && learnClick),
    bpm: clickBpmExact,
  });

  const flashWrong = useCallback(() => {
    setWrong(true);
    clearTimeout(wrongTimer.current);
    wrongTimer.current = setTimeout(() => setWrong(false), 280);
  }, []);
  useEffect(() => () => clearTimeout(wrongTimer.current), []);

  useReloadGuard(running);
  useEffect(() => { setGlobalPlaying(running); return () => setGlobalPlaying(false); }, [running, setGlobalPlaying]);

  // Persist practice settings per score (device-local) whenever they change, so the
  // piece reopens the way it was left (Task 2.5). Writes are tiny; cost is trivial.
  useEffect(() => {
    saveScoreSettings(scoreMeta.id, { mode, tempoMult, activeParts, clickOn });
  }, [scoreMeta.id, mode, tempoMult, activeParts, clickOn]);

  // A range references measure indices; drop it if the engraved score has fewer
  // measures than it expects (a re-engrave can shrink the measure list).
  useEffect(() => {
    const n = layout.measures?.length;
    if (!focus || !n) return;
    if (focus.inMeasure > n - 1 || focus.outMeasure > n - 1) setFocus(null);
  }, [layout.measures]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Polish scoring (at-tempo, per-measure grade) ──────────────────────────────
  // The cursor advances on the silent step timeline (no note_on for your parts);
  // MIDI hits are graded per measure. Timing drift is proxied by "ms after this
  // step's beat began" (stepStartRef) — a coarse but honest at-tempo lateness read.
  const resolvedScoringCfg = smCfg.scoring;
  const currentMeasure = layout.steps?.[step]?.measure ?? 0;
  // stepStartRef is stamped in the transport's onEvent (musical due time), not
  // here — a commit-time stamp would fold render lateness into the drift proxy.
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
  // Open the run summary + log the aggregate, using the shared tally (so the log
  // and the panel headline can't drift). Used by BOTH the silent-stop and the
  // completion path.
  const openRunSummary = useCallback((extra) => {
    setSummaryOpen(true);
    // `extra` is the grade — or grades, since finalize can close out two measures
    // at a completion — produced in THIS tick. gradesRef.current is a render-time
    // snapshot and does not include them yet, so a summary opened in the same tick
    // would under-count.
    const fresh = (Array.isArray(extra) ? extra : [extra]).filter(Boolean);
    const all = fresh.length
      ? { ...gradesRef.current, ...Object.fromEntries(fresh.map((g) => [g.measure, g])) }
      : gradesRef.current;
    const t = tallyGrades(all);
    logRunSummary({ greens: t.green, yellows: t.yellow, reds: t.red, overall: t.overall });
  }, [logRunSummary]);
  // `g` is the measure whose silence tripped the stop, handed over by the
  // evaluator: it was graded in THIS tick, so gradesRef does not have it yet and
  // the summary would report one red fewer than the run actually earned.
  const onSilentStop = useCallback((g) => {
    transport.pause();
    setRunActive(false);
    logger.info('score.polish.silent-stop', {});
    openRunSummary(g);
  }, [transport, logger, openRunSummary]);

  const evaluator = useScoreEvaluator({
    enabled: mode === 'polish' && runActive, // grade only inside a real run (Task 19)
    boundary: loopWraps,
    cfg: resolvedScoringCfg,
    subscribe,
    currentMeasure,
    expectedForMeasure,
    driftForNote,
    onMeasureGrade,
    onSilentStop,
  });
  // onDone (below, in the transport) fires before this component re-renders, and
  // the transport is defined above the evaluator — read finalize through a ref.
  const finalizeRef = useRef(null); finalizeRef.current = evaluator.finalize;
  const openRunSummaryRef = useRef(openRunSummary); openRunSummaryRef.current = openRunSummary;

  // Clear grades + summary when the score document changes or scoring is turned off.
  useEffect(() => { setGrades({}); setSummaryOpen(false); setLearnDone(false); }, [scoreMeta.musicXml]);

  // ── Learn mode: full-hand tracker (all active-staff notes → advance) ──────────
  const lastAdvanceRef = useRef(0);
  const followHitsRef = useRef(0);
  const followWrongsRef = useRef(0);
  // Stamp the reference point when Learn is ENTERED. Left at 0, the first hit
  // computes an interval of 0 and poisons the run's stats (audit M5a): seven of
  // 31 field records were this artifact, and one whole score.follow.stats record
  // inherited it as a fabricated "100% rushing".
  useEffect(() => { if (mode === 'learn') lastAdvanceRef.current = performance.now(); }, [mode]);
  const onFollowHit = useCallback((note) => {
    setStruck((prev) => { const n = new Set(prev); n.add(note); return n; });
    followHitsRef.current += 1;
    if (!lastAdvanceRef.current) return; // no reference point yet — don't invent one
    recordFollowHit({ step: stepRef.current, note, sinceAdvanceMs: performance.now() - lastAdvanceRef.current });
  }, [recordFollowHit]);
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
  // End of piece in Learn: show the completion card (audit M5). Follow-timing stats
  // still flush when the user leaves Learn / on unmount, so no flush is needed here.
  const [learnDone, setLearnDone] = useState(false);
  const onFollowComplete = useCallback(() => { setLearnDone(true); logger.info('score.learn.complete', {}); }, [logger]);
  useFollowTracker({
    enabled: mode === 'learn',
    steps,
    activeParts,
    step,
    subscribe,
    onStep: onFollowStep,
    onHit: onFollowHit,
    onWrong: onFollowWrong,
    onComplete: onFollowComplete,
    range, // wrap advancement within the practice range (null → linear)
  });

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
    if (!layoutFresh) return;
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
  }, [step, flow, mode, current, layoutFresh]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => cancelScrollTween(scrollRef.current), []);

  // Resume a rebuild-pause once the engraving matches the current flow/scale.
  // For a part change `layoutFresh` is already true, so this fires on the very
  // next commit (the music barely hiccups); for a zoom/flow change it waits for
  // the re-engrave. Deliberately bypasses toggleRun so no count-in fires — the
  // user never asked to start a run, they asked to change a setting.
  // `resumeTick` is the TRIGGER (a part change moves neither layoutFresh nor
  // stepTimeline, so nothing else would re-run this effect); `layoutFresh` is the
  // GATE. Both are required.
  useEffect(() => {
    const pending = resumeAfterRef.current;
    if (!pending || !layoutFresh || !events.length) return;
    resumeAfterRef.current = null;
    // Same contract toggleRun documents for its resume: pauseForRebuild armed a
    // delayed panic, and it would otherwise fire ~lookahead+60ms INTO the music we
    // are about to restart and cut whatever is sounding. This is now the second
    // resume entry point, so it needs the same cancel.
    clearTimeout(flushTimerRef.current);
    const target = rangeRef.current ? clampStepToRange(pending.step, rangeRef.current) : pending.step;
    setStep(target);
    setStruck(() => new Set());
    transportRef.current?.seek((stepTimeline[target]?.t ?? 0) / tempoMult);
    setRunActive(true);
    transportRef.current?.play();
    logger.info('score.transport.resume', { step: target });
  }, [resumeTick, layoutFresh, events.length, stepTimeline, tempoMult, logger]);

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

  // UI-intent + input→paint tap. Records the intent immediately (tagged with the
  // current cursor step) and, on the next frame, the input→paint latency for the
  // same control. intern caches the control name, so repeated calls are cheap.
  const tapIntent = useCallback((name) => {
    const id = intern(name);
    record(KIND.UI_INTENT, id, 0, stepRef.current ?? 0, 0);
    const t0 = performance.now();
    requestAnimationFrame(() => record(KIND.TAP, id, Math.round(performance.now() - t0), 0, 0));
  }, []);

  // Scroll the score by ~0.85 of a viewport (forward or back) along the flow axis.
  const pageBy = useCallback((dir) => {
    const el = scrollRef.current;
    if (!el) return;
    const horiz = flow === 'horizontal';
    const amount = (horiz ? el.clientWidth : el.clientHeight) * 0.85 * (dir === 'back' ? -1 : 1);
    el.scrollBy({ [horiz ? 'left' : 'top']: amount, behavior: 'smooth' });
    logger.info('score.perform.pageturn', { dir });
    tapIntent('pageturn');
  }, [flow, logger, tapIntent]);

  // Raw-input telemetry: mirror every raw MIDI message into the zero-alloc input
  // recorder ring buffer (notes, sustain, CC), tagged with the current cursor
  // step. Always on — recording is cheap and shipping is gated elsewhere
  // (startRecorder/drain). emitRaw wraps the bytes as { data: <byteArray>, time },
  // so the callback reads evt?.data (NOT a bare byte array).
  useEffect(() => {
    const off = subscribeRaw((evt) => {
      // emitRaw wraps the bytes: listeners receive { data: <byteArray>, time }.
      const r = midiToRecord(evt?.data);
      if (r) record(r.kind, r.a, r.b, stepRef.current ?? 0, 0);
    });
    return off;
  }, [subscribeRaw]);

  // Touch-gesture telemetry: capture pointer gestures over the scroll surface into
  // the recorder ring, coalesced to ≤1 sample/frame (gesture SHAPE, not every
  // event). Listeners are PASSIVE — a non-passive touch listener blocks scroll
  // compositing and would itself cause the jank we're measuring. Always on;
  // shipping is gated in the recorder lifecycle (Task 13).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    let samples = [];
    let active = false; // true only between pointerdown and its up/cancel
    const onDown = (e) => {
      active = true;
      samples = [];
      record(KIND.TOUCH_START, e.clientX | 0, e.clientY | 0, 0, 0);
    };
    const onMove = (e) => {
      if (!active) return; // ignore hover/stray moves between gestures (hover-capable pointers)
      samples.push({ t: performance.now(), x: e.clientX | 0, y: e.clientY | 0 });
    };
    // Shared flush for BOTH pointerup and pointercancel: a native touch-scroll ends
    // with pointercancel (NOT pointerup), so without this a scroll would record only
    // a TOUCH_START and leak its samples into the next gesture.
    const flush = (e) => {
      if (!active) return;
      active = false;
      // Slot c carries the sample's ORIGINAL time (ms, page-relative). record()
      // stamps its own `t` at replay time, so without this the whole gesture would
      // collapse onto the flush timestamp and lose its time axis.
      for (const s of coalesce(samples, { frameMs: 16 })) record(KIND.TOUCH_MOVE, s.x | 0, s.y | 0, Math.round(s.t), 0);
      samples = [];
      record(KIND.TOUCH_END, e.clientX | 0, e.clientY | 0, 0, 0);
    };
    el.addEventListener('pointerdown', onDown, { passive: true });
    el.addEventListener('pointermove', onMove, { passive: true });
    el.addEventListener('pointerup', flush, { passive: true });
    el.addEventListener('pointercancel', flush, { passive: true });
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', flush);
      el.removeEventListener('pointercancel', flush);
    };
  }, []);

  // ── Input-telemetry recorder lifecycle (config-gated shipping) ────────────────
  // The ring records unconditionally (above); this only controls DRAINING it to the
  // backend. start/stop are shared by the config-gated auto lifecycle and the
  // window.__INPUT_REC__ kill switch, so the manual lever and the config path use
  // the same one-event-per-batch sender.
  const inputSessionRef = useRef(null);
  const startInputRec = useCallback(() => {
    const session = new Date().toISOString();
    inputSessionRef.current = session;
    startRecorder({ session, score: scoreMeta.id, ctx: { user: config?.user?.id }, send: makeInputSender('piano-sheetmusic'), flushMs: 1000 });
  }, [scoreMeta.id, config]);
  const stopInputRec = useCallback(() => { stopRecorder(); inputSessionRef.current = null; }, []);

  // Kill switch: a deploy-free off/on lever, installed regardless of config so the
  // recorder can be started/stopped from the console even when shipping is off.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__INPUT_REC__ = {
      start: startInputRec,
      stop: stopInputRec,
      status: () => ({ enabled: inputSessionRef.current != null, session: inputSessionRef.current }),
    };
    return () => { if (window.__INPUT_REC__) window.__INPUT_REC__ = undefined; };
  }, [startInputRec, stopInputRec]);

  // Config-gated auto lifecycle: ship input telemetry for this score only when the
  // household config opts in. Re-arms on a score change; stops on unmount/disable.
  useEffect(() => {
    if (!inputTelemetryEnabled(config, 'sheetmusic')) return undefined;
    startInputRec();
    return () => stopInputRec();
  }, [scoreMeta.id, config, startInputRec, stopInputRec]);

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
    // A tap during the count-in aborts it (a change of mind before the run starts).
    if (countIn.active) { countIn.cancel(); logger.info('score.countin.cancel', { via: 'tap' }); return; }
    setLearnDone(false); // any tap-to-seek re-opens practice — close the completion card
    if (mode === 'perform') {
      const r = el.getBoundingClientRect();
      const dy = e.clientY - (r.top + el.clientHeight / 2);
      const dx = e.clientX - (r.left + el.clientWidth / 2);
      el.scrollBy(flow === 'horizontal' ? { left: dx, behavior: 'smooth' } : { top: dy, behavior: 'smooth' });
      // Perform's tap-scroll was unlogged, so a silent music-stand session read as
      // abandonment: the audit first concluded Perform was "entered twice and
      // abandoned" when it had been entered five times, once for 15m50s (T1).
      logger.info('score.perform.tapscroll', { axis: flow === 'horizontal' ? 'x' : 'y' });
      tapIntent('perform-scroll');
      return;
    }
    if (!rdr || !events.length) return;
    const r = rdr.getBoundingClientRect();
    // Guided loop selection (Listen/Learn/Polish): first tap sets the pending in-measure
    // (a bracket appears + the banner asks for the last), the second sets the
    // out-measure → an ordered { inMeasure, outMeasure } custom range. Selection taps
    // set the range instead of seeking (audit J5/M3), and require the tap to be
    // NEAR a note (audit L3) — a margin tap is ignored, not committed.
    if (selecting) {
      const si = nearestEvent(events, e.clientX - r.left, e.clientY - r.top, SELECT_MAX_DIST * scale);
      if (si < 0) { setSelectRejects((n) => n + 1); return; } // too far — say so, don't swallow it
      setSelectRejects(0);
      const mi = measureIndexOfStep(si);
      if (selecting.stage === 'first') {
        setSelecting({ stage: 'last', inMeasure: mi });
        logger.info('score.focus.arm', { inMeasure: mi });
      } else {
        const inMeasure = Math.min(selecting.inMeasure, mi);
        const outMeasure = Math.max(selecting.inMeasure, mi);
        setSelecting(null);
        focusOriginRef.current = 'select';
        setFocus({ kind: 'custom', inMeasure, outMeasure });
        setLoopOn(true); // a freshly-picked range always starts looping (audit L2 follow-up)
      }
      return;
    }
    const i = nearestEvent(events, e.clientX - r.left, e.clientY - r.top);
    if (i < 0) return;
    // Normal seek. When a practice range is active, clamp the target into it.
    resumeAfterRef.current = null; // a tap-seek supersedes a pending rebuild-resume
    clearWrapDwell(); // a tap-seek overrides a pending loop-wrap dwell
    const target = range ? clampStepToRange(i, range) : i;
    // Tap-to-seek is the primary navigation gesture and emitted nothing, so every
    // `play {step: N}` with an unexplained N was a seek nobody could see (T1).
    logger.info('score.seek.tap', { from: stepRef.current, to: target, mode });
    tapIntent('seek');
    setStep(target);
    setStruck(() => new Set());
    lastAdvanceRef.current = performance.now();
    // Seek jumps idxRef past pending note_offs — flush sounding notes first
    // (Listen mode) so a skipped-over note doesn't drone on the piano.
    // NOTE: unlike pause→resume, we deliberately do NOT clear the delayed panic
    // here — the transport keeps playing, so the panic still needs to fire to
    // kill pre-seek queued note-ons whose note-offs the jump skipped. Accepted
    // minor limitation: it can also clip a post-seek note once at the +lookahead
    // mark; a one-time clip is preferable to stranding a pre-seek note (drone).
    if (mode === 'listen') silenceScheduled();
    // Transport timeline is tempo-scaled (playTimeline uses factor 1/tempoMult);
    // seek positions come from the unscaled stepTimeline, so scale to match.
    transport.seek((stepTimeline[target]?.t ?? 0) / tempoMult);
  }, [mode, flow, events, transport, stepTimeline, silenceScheduled, tempoMult, selecting, range, measureIndexOfStep, logger, countIn, scale, clearWrapDwell, tapIntent]);

  // Single unmount teardown: immediate silence + one delayed panic (see the
  // silenceScheduled note above), plus any pending loop-wrap dwell — a restart
  // after unmount would replay into a dead view. One effect → order-independent
  // by construction.
  useEffect(() => () => { clearWrapDwell(); silenceScheduled(); }, [clearWrapDwell, silenceScheduled]);

  // ── Focus range: selection + custom-loop taps ─────────────────────────────────
  // When a practice range is (re)selected, jump the cursor to its in-point and log.
  useEffect(() => {
    clearWrapDwell(); // a loop change (set/clear/nudge) invalidates a pending dwell
    if (!focus) return;
    const r = layout.measures ? rangeSteps(layout.measures, focus) : null;
    if (!r) return;
    setStep(r[0]);
    setStruck(() => new Set());
    lastAdvanceRef.current = performance.now();
    logFocus({ kind: focus.kind, inMeasure: focus.inMeasure, outMeasure: focus.outMeasure, origin: focusOriginRef.current });
    focusOriginRef.current = 'restore';
    tapIntent('focus');
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPickSection = useCallback((section) => {
    const r = layout.measures ? sectionToRange(section, layout.measures) : null;
    if (!r) return;
    setSelecting(null);
    focusOriginRef.current = 'section';
    setFocus({ kind: 'section', label: section.label, ...r });
    setLoopOn(true); // a freshly-picked range always starts looping (audit L2 follow-up)
  }, [layout.measures]);

  // Begin the guided two-tap measure selection (from Loop → Select measures…).
  const onStartSelect = useCallback(() => {
    setSelecting({ stage: 'first' });
    setSelectRejects(0);
    logger.info('score.focus.select-start', {});
  }, [logger]);

  // Arming must not outlive the user's intent. `selecting` gates the seek branch
  // of onScoreClick, so a forgotten arm silently disables tap-to-seek — one user
  // armed, played for 30s, tapped to seek and got a 10-measure loop (audit H4b).
  useEffect(() => {
    if (!selecting) return undefined;
    const t = setTimeout(() => {
      setSelecting(null);
      logger.info('score.focus.select-timeout', { stage: selecting.stage });
    }, SELECT_IDLE_MS);
    return () => clearTimeout(t);
  }, [selecting, logger]);
  const onCancelSelect = useCallback(() => setSelecting(null), []);

  const onClearFocus = useCallback(() => {
    setSelecting(null);
    setFocus(null);
    logger.info('score.focus.clear', {});
  }, [logger]);
  // Nudge one loop endpoint by ±1 measure (audit L2). Pure clamped math in
  // nudgeRange; a real change flows through the focus effect above, which jumps
  // the cursor to the (possibly new) in-point and logs — desired: the loop
  // re-seeks its start when an endpoint moves. A clamped no-op returns the same
  // object, so setFocus bails without re-rendering.
  const onNudge = useCallback((edge, delta) => {
    focusOriginRef.current = 'nudge';
    setFocus((f) => nudgeRange(f, edge, delta, layout.measures?.length || 0));
  }, [layout.measures]);
  // Scope label for the Loop control: a section's label or a 1-based measure span
  // (indices are 0-based internally); empty when no loop is active.
  const scopeLabel = focus
    ? (focus.label || `m${focus.inMeasure + 1}–m${focus.outMeasure + 1}`)
    : '';

  // ── Bar handlers ──────────────────────────────────────────────────────────────
  const onMode = useCallback((id) => {
    if (id === mode) return;
    resumeAfterRef.current = null; // a mode change supersedes a pending rebuild-resume
    countIn.cancel();            // a mode change aborts a pending count-in
    setLearnDone(false);         // the Learn completion card belongs to Learn only
    flushPlaybackNow();          // leaving a Polish/Listen run
    if (mode === 'learn') flushFollowNow();
    clearWrapDwell();            // a pending loop-wrap dwell dies with the run
    transport.stop();
    setRunActive(false);         // …and so does the run itself (see runActive)
    silenceScheduled();
    setStruck(() => new Set());
    // The loop follows Listen↔Learn↔Polish (hear it, drill it, prove it — audit
    // L6/J3); only Perform (music-stand mode) releases it. Loop-arming always resets.
    if (id === 'perform') setFocus(null);
    setSelecting(null);
    // Leaving Polish: drop the run summary + grades (they belong to that run).
    setSummaryOpen(false); setGrades({});
    // Learn is a from-the-top (or from-the-loop) exercise: entering it should not
    // strand the user wherever the Listen playhead stopped (audit H3.3) — one
    // field session entered Learn at step 32, mid-piece, with nothing on screen
    // to explain why the cursor was there.
    // NOTE: lastAdvanceRef is deliberately NOT stamped here. The mode effect
    // (`if (mode === 'learn') lastAdvanceRef.current = performance.now()`) runs
    // after this handler's state commits, so its stamp would overwrite one taken
    // here anyway — and a post-commit stamp is the more honest reference point
    // for Learn's pacing telemetry (audit M5a).
    if (id === 'learn') {
      const home = homeStep(rangeRef.current);
      setStep(home);
      if (home === 0) scrollRef.current?.scrollTo({ top: 0, left: 0 });
    }
    setMode(id); // keyboard visibility follows the new mode automatically (M2)
    logMode({ mode: id });
    tapIntent('mode');
  }, [mode, flushPlaybackNow, flushFollowNow, transport, silenceScheduled, logMode, countIn, clearWrapDwell, tapIntent]);

  // Listen tempo: clamp to a sane playable range (0.25×–2×). Timeline rescales via
  // the playTimeline memo; the transport reads the new timings on its next tick.
  const onTempo = useCallback((v) => {
    const n = Number(v);
    setTempoMult(Number.isFinite(n) ? Math.min(2, Math.max(0.25, n)) : 1);
  }, []);

  // A zoom / flow / transpose change re-engraves, and while the transport is running
  // the geometry extraction is DEFERRED (holdExtraction) — so the sheet would repaint
  // in the new key/size while the audio kept playing the stale one and the cursor
  // vanished (audit H2). Pause + flush first so sound and sheet never diverge.
  // Same shape for a Listen part change, which rebuilds the note timeline. Neither
  // is a stop request, so both arm the resume (see the resume effect above).
  const pauseForRebuild = useCallback((reason) => {
    clearWrapDwell(); // BEFORE the playing check — during the dwell nothing plays
    if (!transportRef.current?.playing) return;
    transport.pause();
    // The evaluator must not stay armed across the rebuild gap: the cursor can be
    // moved (tap-seek) while nothing is playing, and an armed evaluator would read
    // that as an end-of-measure. The resume re-arms it (see runActive).
    setRunActive(false);
    silenceScheduled();
    flushPlaybackNow();
    resumeAfterRef.current = { step: stepRef.current };
    setResumeTick((t) => t + 1);
    logger.info('score.viewchange.pause', { reason, step: stepRef.current });
  }, [clearWrapDwell, transport, silenceScheduled, flushPlaybackNow, logger]);

  const pauseForViewChange = useCallback(() => pauseForRebuild('view'), [pauseForRebuild]);

  // Listen key transpose: clamp to ±7 semitones (one fifth either way). The renderer
  // re-engraves in the new key and re-extracts pitches, so both the notation and the
  // performed/highlighted notes move together.
  const onTranspose = useCallback((v) => {
    pauseForViewChange();
    const n = Math.round(Number(v));
    const clamped = Number.isFinite(n) ? Math.min(7, Math.max(-7, n)) : 0;
    setTranspose(clamped);
    logTranspose({ semitones: clamped });
    tapIntent('transpose');
  }, [logTranspose, pauseForViewChange, tapIntent]);

  // Zoom (Size) — pause a running transport before the re-engrave (H2).
  const onScaleStep = useCallback((v) => { pauseForViewChange(); setScale(v); }, [pauseForViewChange]);

  const reset = useCallback(() => {
    resumeAfterRef.current = null; // Restart supersedes a pending rebuild-resume
    setSelecting(null);     // Restart means the user is done arming a loop
    countIn.cancel();       // reset aborts a pending count-in
    clearWrapDwell();       // …and any pending loop-wrap dwell
    setLearnDone(false);    // fresh pass — close the completion card
    transport.stop();
    setRunActive(false);    // Restart ends the current run (see runActive)
    if (mode === 'listen') silenceScheduled();
    flushPlaybackNow();
    const home = homeStep(rangeRef.current); // loop in-point when a loop is active (audit L5)
    // Restart emitted nothing at all, so the most-pressed control in the mode was
    // only inferable from a statistical artifact in the stats records (audit T1).
    logger.info('score.transport.restart', { from: stepRef.current, to: home, mode });
    tapIntent('restart');
    setStep(home);
    setStruck(() => new Set());
    setGrades({});          // a fresh run clears the previous grades…
    setSummaryOpen(false);  // …and closes any open summary
    // The auto-follow effect scrolls to the new step; only a true top-of-piece
    // reset should force-scroll to the origin.
    if (home === 0) scrollRef.current?.scrollTo({ top: 0, left: 0 });
  }, [transport, mode, silenceScheduled, flushPlaybackNow, countIn, clearWrapDwell, logger, tapIntent]);

  // Run summary Replay: reset the run (clears grades + closes the panel).
  const onReplaySummary = useCallback(() => { reset(); }, [reset]);
  const onCloseSummary = useCallback(() => setSummaryOpen(false), []);

  // Learn completion card actions: another pass (reset, stay in Learn) or move up
  // the ladder to Polish (any practice range carries via J3).
  const onLearnReplay = useCallback(() => { setLearnDone(false); setStep(0); setStruck(() => new Set()); scrollRef.current?.scrollTo({ top: 0, left: 0 }); }, []);
  const onLearnPolish = useCallback(() => { setLearnDone(false); onMode('polish'); }, [onMode]);

  // Run summary "Drill worst section": set the practice range to the heaviest
  // trouble span and drop into Learn to work it slowly (audit J6). Switch mode
  // FIRST (learn↔polish keeps focus per J3), then set the range so it survives.
  const onDrillWorst = useCallback(() => {
    const span = worstSpan(gradesRef.current);
    if (!span) return;
    setSummaryOpen(false);
    onMode('learn');
    focusOriginRef.current = 'drill';
    setFocus({ kind: 'custom', ...span });
    setLoopOn(true); // a freshly-picked range always starts looping (audit L2 follow-up) — drilling the worst section must loop it even if a prior loop was toggled off
    logger.info('score.drill.worst', span);
  }, [onMode, logger]);
  // The Drill button only makes sense when there's a trouble span to drill.
  const drillable = useMemo(() => worstSpan(grades) != null, [grades]);

  // Stable toggles for the transport bar. Passing fresh inline arrows here would
  // defeat React.memo on the bar's expensive body (parts/chips/popovers), so the
  // whole bar would reconcile on every cursor-step advance. Functional updaters →
  // empty deps → stable identity → the memoized body bails per step.
  const onToggleFlow = useCallback(() => { pauseForViewChange(); setFlow((f) => (f === 'wrapped' ? 'horizontal' : 'wrapped')); }, [pauseForViewChange]);
  const onToggleKeyboard = useCallback(() => {
    kbOverrideRef.current[mode] = !keyboardVisible; // remember the explicit choice for THIS mode
    setKbTick((t) => t + 1);
  }, [mode, keyboardVisible]);
  const onToggleClick = useCallback(() => {
    if (mode === 'learn') setLearnClick((v) => !v); // free-run, session-local
    else setClickOn((v) => !v); // Polish arm state, persisted
  }, [mode]);
  // Flip looping on/off IN PLACE — the range stays defined (its brackets keep
  // showing) but wrap/clamp/home-step stop treating it as a boundary. Stable
  // identity (empty deps via loopOnRef, mirroring stepRef) so the memoized bar
  // doesn't reconcile on a cursor advance.
  const onToggleLoop = useCallback(() => {
    const next = !loopOnRef.current;
    setLoopOn(next);
    logger.info('score.loop.toggle', { on: next });
  }, [logger]);

  const toggleRun = useCallback(() => {
    resumeAfterRef.current = null; // an explicit play/pause supersedes a pending rebuild-resume
    setSelecting(null); // starting/stopping a run means the user is done arming a loop
    clearWrapDwell(); // a manual play/pause overrides a pending loop-wrap dwell
    // A second tap during the count-in aborts it (never reaches the transport).
    if (countIn.active) { countIn.cancel(); logger.info('score.countin.cancel', { via: 'toggle' }); return; }
    if (transport.playing) {
      // A paused Polish run is still a run: grade what was played and show the
      // summary. Without this a user who works a passage and stops gets nothing
      // at all — no grade, no summary, no reason to come back (audit: Polish).
      // MUST run before transport.pause(): the evaluator's `enabled` is derived
      // from transport.playing, and finalize early-returns once it goes false.
      if (mode === 'polish') openRunSummaryRef.current?.(finalizeRef.current?.());
      transport.pause();
      setRunActive(false);
      if (mode === 'listen') silenceScheduled();
      flushPlaybackNow();
      logger.info('score.transport.pause', { step: stepRef.current });
      tapIntent('transport-pause');
    } else {
      // A quick pause→resume must cancel the pending delayed panic — otherwise it
      // fires ~lookahead+60ms INTO the resumed run and cuts whatever's sounding.
      // (toggleRun is the only resume entry point; reset()/onDone stop the
      // transport first, so their pending panic is harmless.)
      clearTimeout(flushTimerRef.current);
      // Count the user in when they're expected to PLAY: Polish always (the beat is
      // graded — audit J1). Listen never counts in (wave-3 A: the kiosk performs the
      // active hands — it's a jukebox, not a play-along) — onGo starts the transport;
      // Listen always plays immediately.
      const countUserIn = mode === 'polish';
      if (countUserIn) {
        // Log the PLAN, not the meter: at fast tempi the pulse coarsens and the
        // count-in may run extra bars, so the time signature no longer tells a log
        // reader how many clicks were heard or how long the wait was. `bpm` and
        // `tempoMult` come AFTER the spread — the plan has no such keys today, and
        // this keeps it that way if it ever grows them.
        const plan = countInPlan({ beats: parsed?.timeSig?.beats, bpm: tempoMap[0]?.bpm, tempoMult });
        countIn.start(plan);
        logger.info('score.countin.start', { mode, ...plan, bpm: tempoMap[0]?.bpm, tempoMult });
      } else {
        // Play always starts INSIDE an active loop (audit L6) — clamp a cursor
        // left outside the range to its in-point before seeking.
        const startStep = rangeRef.current ? clampStepToRange(stepRef.current, rangeRef.current) : stepRef.current;
        if (startStep !== stepRef.current) setStep(startStep);
        transport.seek((stepTimeline[startStep]?.t ?? 0) / tempoMult);
        setRunActive(true);
        transport.play();
        logger.info('score.transport.play', { step: startStep, mode, bpm: tempoMap[0]?.bpm, tempoMult });
        tapIntent('transport-play');
      }
    }
    // NOTE: reads the live cursor via `stepRef.current` (mirrors `step`), NOT the
    // `step` closure — so `step` is deliberately OUT of the dep array.
  }, [countIn, transport, mode, silenceScheduled, flushPlaybackNow, logger, stepTimeline, tempoMap, tempoMult, parsed, clearWrapDwell, tapIntent]);

  // Toggle a staff's active state — the chip fallback for >2 staves. One branch,
  // every mode (wave-3 A): Learn/Polish need ≥1 active staff or the all-notes rule
  // can never be satisfied (the cursor would deadlock); Listen needs ≥1 too, or the
  // kiosk would have nothing left to perform / resume into. Refuse to turn off the
  // last active staff.
  const onCyclePart = useCallback((staff) => {
    const activeCount = parts.reduce((c, p) => c + (activeParts[p.staff] ? 1 : 0), 0);
    if (activeParts[staff] && activeCount <= 1) return; // keep the last staff on
    if (mode === 'listen') {
      // Changing the active-part map mid-flight invalidates the Listen note
      // timeline — pause, flush, and silence so a stale schedule doesn't drone,
      // then resume where we were (audit H5: the music dying on the spot read as
      // a broken button).
      pauseForRebuild('part');
      silenceScheduled(); // also flush when nothing was playing (a stale schedule may still be queued)
    }
    setActiveParts((a) => ({ ...a, [staff]: !a[staff] }));
    logger.info('score.active-part', { staff, on: !activeParts[staff] });
    tapIntent('active-part');
  }, [mode, pauseForRebuild, silenceScheduled, logger, activeParts, parts, tapIntent]);

  // Grand-staff (2 staves) fast path: a single segmented control instead of chips.
  // One variant, every mode (wave-3 A) — value + handler map to activeParts alone.
  // Staff 0 = RH, 1 = LH (activeParts.js convention).
  const grandStaff = parts.length === 2;
  const handsValue = activeParts[0] && activeParts[1] ? 'both' : activeParts[0] ? 'rh' : 'lh';
  const onHandsChange = useCallback((v) => {
    // Both/RH/LH → which staves are active. Always ≥1 active (never deadlocks).
    setActiveParts({ 0: v !== 'lh', 1: v !== 'rh' });
    if (mode === 'listen') {
      // A hand change mid-flight invalidates the Listen note timeline — pause,
      // flush, and silence so a stale schedule doesn't drone, then resume where we
      // were (audit H5: the music dying on the spot read as a broken button).
      pauseForRebuild('part');
      silenceScheduled();
    }
    logger.info('score.hands', { value: v });
    tapIntent('hands');
  }, [mode, pauseForRebuild, silenceScheduled, logger, tapIntent]);

  // Surface the hands split after the cursor has sat on one multi-note step for a
  // while. Only when a split would actually help: a grand staff, both hands
  // active, and this step genuinely needs both.
  const [stuckOpen, setStuckOpen] = useState(false);
  const stuckDismissedRef = useRef(false);
  useEffect(() => { setStuckOpen(false); }, [step, mode]);
  useEffect(() => {
    if (mode !== 'learn' || stuckDismissedRef.current) return undefined;
    const staves = new Set((steps[step]?.notes || []).filter((n) => activeParts[n.staff]).map((n) => n.staff));
    if (!grandStaff || staves.size < 2) return undefined;
    const t = setTimeout(() => {
      setStuckOpen(true);
      logger.info('score.learn.stuck-prompt', { step, staves: staves.size });
    }, STUCK_PROMPT_MS);
    return () => clearTimeout(t);
  }, [mode, step, steps, activeParts, grandStaff, logger]);

  const onStuckPick = useCallback((v) => {
    setStuckOpen(false);
    onHandsChange(v);
    logger.info('score.learn.stuck-resolved', { value: v });
  }, [onHandsChange, logger]);
  const onStuckDismiss = useCallback(() => {
    setStuckOpen(false);
    stuckDismissedRef.current = true; // asked and answered — don't nag for the rest of the session
    logger.info('score.learn.stuck-dismissed', {});
  }, [logger]);

  // ── Load timing (best-effort) ───────────────────────────────────────────────
  // Measured: fetch ms (from SheetMusic.jsx via score.fetchMs) + open→ready total
  // here. Fires once per document (re-engraves from zoom/flow don't re-log).
  const openTsRef = useRef(performance.now());
  const readySentRef = useRef(false);
  const firstSessionRef = useRef(true);
  // Splash: the sidecar scan covers the stage until the engraving is ready (onReady),
  // so the user sees the score's artwork instead of a blank paper during the ~1-2s engrave.
  const [engraveReady, setEngraveReady] = useState(false);
  // A new score opens in its written key (mirror the other per-score resets).
  useEffect(() => {
    openTsRef.current = performance.now(); readySentRef.current = false; setEngraveReady(false); setTranspose(0);
    // Open a fresh per-run session log for this document (bounds the JSONL file);
    // all subsequent events (load / follow / polish / focus / mode / transpose) land in it.
    // The sessionLog child logger already opened a session file at mount
    // (Logger.js:218), so opening another here would strand the first as a
    // 416-byte orphan — seven of them are in the field log directory (audit L1).
    // Only a SUBSEQUENT document needs a fresh file.
    if (firstSessionRef.current) firstSessionRef.current = false;
    else startSession(scoreMeta.id);
    // A new document resets the practice range (measure indices don't carry over).
    setFocus(null);
    setSelecting(null);
  }, [scoreMeta.musicXml]); // eslint-disable-line react-hooks/exhaustive-deps
  const onReady = useCallback(() => {
    setEngraveReady(true); // lift the splash — the sheet is engraved
    if (readySentRef.current) return;
    readySentRef.current = true;
    logLoad({
      fetchMs: Math.round(scoreMeta.fetchMs || 0),
      openToReadyMs: Math.round(performance.now() - openTsRef.current),
    });
  }, [logLoad, scoreMeta.fetchMs]);

  // The band keeps its mode colour; lit NOTEHEADS get a fixed near-black ink
  // (wave-2 A): visibly "current", nothing louder.
  const cursorColor = mode === 'learn' ? '#2ec46f' : mode === 'listen' ? '#e8a33d' : '#6cf';

  // Teleport (don't sweep diagonally) when the cursor crosses to a new system.
  const jump = current != null && prevTopRef.current != null && Math.abs(current.top - prevTopRef.current) > 1;
  useEffect(() => { prevTopRef.current = current?.top ?? null; }, [current]);

  // Keyboard target set: Listen → none (the kiosk performs the active hands —
  // wave-3 A retires play-along targets; nothing is "yours"). Polish → the
  // bouncing-ball expected notes (an auto demo, fine to show). Learn → NOTHING
  // until a wrong attempt reveals it (reading-first; see revealKeys). Perform →
  // no keyboard (hidden entirely).
  const targetNotes = mode === 'polish'
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

  // Per-step cursor boxes (same offset-space as the cursor). Shared geometry for
  // BOTH the measure-grade wash (Polish) and the focus-range brackets (Learn/Polish),
  // so it's computed whenever either could draw.
  const showGrades = mode === 'polish';
  const showFocusLayer = mode === 'learn' || mode === 'polish';
  const stepBoxes = useMemo(
    () => ((showGrades || showFocusLayer) ? events.map((e) => ({ x: e.x, top: e.top, bottom: e.bottom })) : []),
    [showGrades, showFocusLayer, events],
  );

  // Staves the user has deselected — dimmed in every interactive mode (wave-3 A).
  const dimmedStaves = useMemo(
    () => parts.filter((p) => !activeParts[p.staff]).map((p) => p.staff),
    [parts, activeParts],
  );

  return (
    <div className="piano-score-player">
      {scoreMeta.splashImage && !engraveReady && (
        <div className="piano-score-splash piano-score-splash--overlay" aria-hidden="true">
          <img className="piano-score-splash__img" src={scoreMeta.splashImage} alt="" decoding="async" />
        </div>
      )}
      <div className={`piano-score-player__scroll piano-score-player__scroll--${flow}`} ref={scrollRef} onClick={onScoreClick}>
        <MusicXmlRenderer score={parsed} musicXml={scoreMeta.musicXml} flow={flow} scale={scale} transpose={transpose} onLayout={onLayout} onReady={onReady} holdExtraction={running}>
          {mode !== 'perform' && layoutFresh && (
            <StaffDimLayer
              staffBoxes={layout.staffBoxes}
              dimmed={dimmedStaves}
            />
          )}
          {mode !== 'perform' && current && layoutFresh && (
            <div
              ref={cursorRef}
              className={`piano-score-cursor${wrong ? ' is-wrong' : ''}${jump ? ' is-jump' : ''}`}
              style={{
                transform: `translate3d(${current.x - 9 * scale}px, ${current.top}px, 0)`,
                width: Math.round(18 * scale),
                height: Math.max(40 * scale, current.bottom - current.top),
                '--cursor-color': cursorColor,
              }}
            />
          )}
          {showGrades && layoutFresh && (
            <MeasureGradeLayer
              measures={layout.measures}
              stepBoxes={stepBoxes}
              grades={grades}
            />
          )}
          {showFocusLayer && layoutFresh && ((!selecting && focus) || selecting?.stage === 'last') && (
            <FocusRangeLayer
              measures={layout.measures}
              stepBoxes={stepBoxes}
              range={!selecting && focus ? { inMeasure: focus.inMeasure, outMeasure: focus.outMeasure } : null}
              pending={selecting?.stage === 'last' ? selecting.inMeasure : null}
            />
          )}
          {mode !== 'perform' && layoutFresh && (
            <NoteHighlightLayer
              step={steps[step]}
              activeParts={activeParts}
              struck={litNotes}
              accent={NOTE_INK}
              showPending={mode === 'learn'}
            />
          )}
        </MusicXmlRenderer>
        <CountInOverlay active={countIn.active} beat={countIn.beat} />
        <SelectBanner stage={selecting?.stage} rejects={selectRejects} onCancel={onCancelSelect} />
        <StuckPrompt open={stuckOpen && mode === 'learn'} onPick={onStuckPick} onDismiss={onStuckDismiss} />
      </div>

      {keyboardVisible && (
        <div className="piano-score-player__keys">
          <LiveKeyboard
            targetNotes={targetNotes}
            dimTarget={mode === 'learn'}
            startNote={kb.startNote}
            endNote={kb.endNote}
          />
        </div>
      )}

      <ModeSheet
        open={modeSheetOpen}
        onClose={() => setModeSheetOpen(false)}
        mode={mode}
        onPick={onMode}
      />

      <ScoreTransportBar
        mode={mode}
        running={running}
        onToggleRun={toggleRun}
        onReset={reset}
        ready={events.length > 0 && layoutFresh}
        canRestart={running || step > 0 || Object.keys(grades).length > 0}
        step={step}
        total={events.length}
        measure={(layout.steps?.[step]?.measure ?? 0) + 1}
        measureTotal={layout.measures?.length ?? 0}
        page={perfPage.page}
        pages={perfPage.pages}
        flow={flow}
        onToggleFlow={onToggleFlow}
        scale={scale}
        onScale={onScaleStep}
        tempoMult={tempoMult}
        onTempo={onTempo}
        transpose={transpose}
        onTranspose={onTranspose}
        parts={barParts}
        activeParts={activeParts}
        onCyclePart={onCyclePart}
        grandStaff={grandStaff}
        handsValue={handsValue}
        onHandsChange={onHandsChange}
        sections={sections}
        loopActive={!!focus}
        loopEnabled={loopOn}
        scopeLabel={scopeLabel}
        onPickSection={onPickSection}
        onStartSelect={onStartSelect}
        onClearFocus={onClearFocus}
        onNudge={onNudge}
        onToggleLoop={onToggleLoop}
        keyboardVisible={keyboardVisible}
        onToggleKeyboard={onToggleKeyboard}
        clickActive={clickActive}
        bpm={Math.round(clickBpmExact)}
        baseBpm={Math.round(tempoMap[0]?.bpm || 90)}
        onToggleClick={onToggleClick}
        keyFifths={parsed?.key?.fifths}
        keyMode={parsed?.key?.mode}
      />

      {mode === 'polish' && (
        <RunSummary
          open={summaryOpen}
          grades={grades}
          measures={layout.measures}
          onClose={onCloseSummary}
          onReplay={onReplaySummary}
          drillable={drillable}
          onDrill={onDrillWorst}
        />
      )}

      {mode === 'learn' && (
        <LearnComplete open={learnDone} onReplay={onLearnReplay} onPolish={onLearnPolish} />
      )}
    </div>
  );
}
