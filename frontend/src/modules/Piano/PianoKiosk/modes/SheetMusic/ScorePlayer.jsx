import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { parseMusicXml } from '../../../../MusicNotation/parseMusicXml.js';
import { MusicXmlRenderer } from '../../../../MusicNotation/renderers/MusicXmlRenderer.jsx';
import LiveKeyboard from '../../LiveKeyboard.jsx';
import { usePianoKioskConfig } from '../../PianoConfig.jsx';
import { usePianoPreferences } from '../../usePianoPreferences.js';
import { usePianoMidi } from '../../PianoMidiContext.jsx';
import { usePianoPlayback } from '../../PianoPlaybackContext.jsx';
import { usePianoBreadcrumb } from '../../PianoBreadcrumbContext.jsx';
import useReloadGuard from '../../useReloadGuard.js';
import { buildTempoMap, buildStepTimeline, scaleTimeline } from '../../../../MusicNotation/scoreTimeline.js';
import { useScoreTransport } from '../../score/useScoreTransport.js';
import { tweenScrollTo, cancelScrollTween } from './scrollTween.js';
import { partsOf, buildPlayTimeline } from './playParts.js';
import { staffLabels, defaultActiveParts, expectedMidisAtStep } from './activeParts.js';
import { rangeSteps, clampStepToRange, sectionToRange, homeStep } from './focusRange.js';
import useFollowTracker from './useFollowTracker.js';
import useMetronomeClick from './useMetronomeClick.js';
import useCountIn from './useCountIn.js';
import { countInPlan } from './countIn.js';
import useScoreTelemetry from './useScoreTelemetry.js';
import useScoreEvaluator from './useScoreEvaluator.js';
import usePracticeRecord from './usePracticeRecord.js';
import { bucketOf } from './practiceKey.js';
import { pickLearnRange } from './learnRange.js';
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
import RangeHandleLayer from './RangeHandleLayer.jsx';
import LearnInkLayer from './LearnInkLayer.jsx';
import { soundingFifths } from '../../../../MusicNotation/model/spellMidi.js';
import SelectBanner from './SelectBanner.jsx';
import StuckPrompt from './StuckPrompt.jsx';
import { nearestEvent } from './nearestEvent.js';
import { measureAtPoint } from './measureAtPoint.js';
import { titleFromScoreId } from './scoreTitle.js';

// One source of truth for the transport's tick rate: the telemetry's stall rule
// is expressed as a MULTIPLE of it, so the two can never drift apart (audit H1).
const TRANSPORT_TICK_MS = 100;

// How long an armed loop endpoint survives with no progress before it expires
// (audit H4b): an arm gates the seek branch of onScoreClick, so a forgotten one
// silently disables tap-to-seek.
const SELECT_IDLE_MS = 15000;

// How long Learn's cursor may sit on one both-hands step before the hands split is
// offered on the score (audit H3).
const STUCK_PROMPT_MS = 5000;

// How long a wet-ink mark lives, per kind (wave-3 D). A wrong note lingers long
// enough to be READ against the note that was expected; a hit is a flash, not a
// record; the machine rows' neutral trace sits between the two.
const INK_TTL = { wrong: 900, hit: 350, neutral: 500 };

// Consecutive wrongs on ONE step before Learn reveals the keyboard hint (wave-3 D).
// The reveal is STUCK SUPPORT, not punishment: spoiling the keys on the first
// fumble hands the answer over the instant the reading gets hard, which is the
// exact moment reading is being trained. Three says "you are actually stuck".
const REVEAL_WRONG_STREAK = 3;

// Fixed near-black ink for lit noteheads (wave-2 A): every mode's cursor band
// keeps its own accent colour, but the noteheads themselves always light this
// same near-black so the sheet doesn't take on a per-mode tint. Struck (green
// HIT glow) and pending markers are unaffected — they're separate CSS classes.
export const NOTE_INK = '#23262b';

// A stable empty array for the section-mark prop: a fresh `[]` literal is a new
// identity on every render, which would re-render FocusRangeLayer (and defeat any
// future memoisation of it) on every transport tick just to draw no ticks.
const NO_MARKS = [];

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
  // Hand preference (wave-3 E): user → household → 'both'. usePianoPreferences
  // no-ops (empty prefs, loaded immediately) for guests — getPref then always
  // falls through to the household default, which is exactly the desired
  // behavior for a walk-up guest session. `loaded` gates the seeding effect
  // below: the prefs GET is a fresh round-trip on every user switch, and OSMD
  // engraving is pure client-side after mount — a fast score can report notes
  // before prefs resolve, so the seed must wait or it latches the household
  // default before the real per-user choice ever arrives (review fix round 1).
  const { getPref, loaded: prefsLoaded } = usePianoPreferences();

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

  // ── Practice record (wave-3 C) ────────────────────────────────────────────────
  // fingerprint identifies THIS engraving (measure count + XML byte length) so a
  // record from a stale engraving (a re-transcription that moved measures) is
  // never misapplied against the current one — see usePracticeRecord's fpMatches
  // guard. Guest/no-user runs history-less (the hook no-ops reads and writes).
  const fingerprint = useMemo(
    () => ({ measureCount: meta.measures, xmlBytes: scoreMeta.musicXml?.length || 0 }),
    [meta.measures, scoreMeta.musicXml],
  );
  const { record: practice, loaded: practiceLoaded, recordCycle, recordTierBest } = usePracticeRecord({ scoreId: scoreMeta.id, fingerprint });
  void recordTierBest;

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
  // range exists — audit L2 follow-up)? A defined range keeps showing its tint
  // and its handles even when looping is off (both layers read `focus`, not the
  // gated `range` below); only the wrap/clamp/home-step machinery cares.
  // Defaults FALSE (wave-3 B): a fresh session has no range at all, and the
  // endpoint flow starts loop-off — an endpoint tap plants a range without
  // committing the user to looping it (§F). The Learn landing and Drill-worst
  // set it explicitly, because those hand over a range that IS the exercise.
  // Never restored: it rides the same per-session discipline as `focus` (M1).
  const [loopOn, setLoopOn] = useState(false);
  const loopOnRef = useRef(loopOn); loopOnRef.current = loopOn;
  // Which loop endpoint is armed for the next tap on the score (wave-3 F):
  //   null | 'in' | 'out'. One tap sets one endpoint — there is no half-marked
  //   intermediate state (the retired two-tap flow's `selecting` stage machine).
  const [arming, setArming] = useState(null);
  const [armRejects, setArmRejects] = useState(0);
  // Which endpoint handle is being DRAGGED right now (wave-3 F): null | 'in' |
  // 'out'. Only chrome depends on it — the section ticks a drag would snap to —
  // so it is deliberately not a ref: the ticks have to appear as the drag starts.
  const [draggingEdge, setDraggingEdge] = useState(null);
  const [clickOn, setClickOn] = useState(() => restored.clickOn !== false); // Polish metronome — on unless turned off
  // Learn free-running metronome — explicit opt-in per session, NEVER persisted:
  // a walk-up user must not inherit a ticking room (audit M2).
  const [learnClick, setLearnClick] = useState(false);
  // Listen free-running metronome — session-local, mirrors learnClick: explicit
  // opt-in per session, NEVER persisted (wave-3 G, audit M2 discipline).
  const [listenClick, setListenClick] = useState(false);
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
  // What CAUSED the next focus change, so score.focus.set is attributable. An
  // armed endpoint tap, a handle drag, the Learn landing and Drill-worst all
  // commit the same event shape; without this the log cannot tell them apart
  // (audit T1). Origins: 'auto' | 'handle-tap' | 'drag' | 'drill' | 'restore'.
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
  // Loop/focus is LEARN-ONLY state (wave-3 §0): Listen is a jukebox and Polish
  // grades whole-piece runs, so neither keeps a range — entering them clears it.
  // The mode check here is belt and braces for that clear.
  const sections = useMemo(() => parsed?.sections || [], [parsed]);
  const range = useMemo(
    () => (focus && loopOn && mode === 'learn' && layout.measures ? rangeSteps(layout.measures, focus) : null),
    [focus, loopOn, mode, layout.measures],
  );
  const rangeRef = useRef(range); rangeRef.current = range; // read latest range inside the transport tick
  const focusRef = useRef(focus); focusRef.current = focus; // read latest focus (measure indices) inside onFollowWrap

  // ── The Learn state matrix (wave-3 §B) ───────────────────────────────────────
  // Learn is three states, not one:
  //   1. no range         → machineLearn: the kiosk performs the active hands on
  //                         the transport (Play live), nothing is gated on input.
  //   2. range + loop ON  → learnGate: the follow tracker drives the cursor, the
  //                         kiosk stays silent, and Play is locked.
  //   3. range + loop OFF → machineLearn again, over the WHOLE piece; the range
  //                         brackets stay on screen but nothing wraps.
  // `learnGate` keys off `focus`, NOT `range`: `range` is the already-gated step
  // span (null the moment looping is off), which would collapse rows 2 and 3.
  const learnGate = mode === 'learn' && !!focus && loopOn;
  const machineLearn = mode === 'learn' && !learnGate;
  // The audio plane's one predicate: who actually sends notes to the piano. Every
  // flush/panic guard reads THIS, never a literal mode check (wave-3 §0).
  const sendsAudio = mode === 'listen' || machineLearn;
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
  // Grand-staff (2 staves) signal — hoisted above the Learn-cycle callbacks
  // (which read it via bucketOf) so its declaration precedes every use; the
  // Hands control further down reads this same binding.
  const grandStaff = parts.length === 2;
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

  // Listen — and Learn's machine states (wave-3 §B) — perform the ACTIVE staves;
  // an inactive staff is engraved but simply muted — never sent to the piano, and
  // no longer highlighted as "yours" (wave-3 A retires the play-along model).
  // Tempo-scaled by the user's multiplier (faster tempo → shorter durations →
  // factor 1/tempoMult). Polish (and Learn's gate) keep the silent step timeline;
  // Polish is scaled too so its tempo control tracks the same knob.
  const playTimeline = useMemo(
    () => (mode === 'listen' || machineLearn
      ? scaleTimeline(buildPlayTimeline(events, layout.notes, tempoMap, roles), 1 / tempoMult)
      : scaleTimeline(stepTimeline, 1 / tempoMult)),
    [mode, machineLearn, events, layout.notes, tempoMap, roles, stepTimeline, tempoMult],
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

  // Flush playback telemetry only when a transport run actually produced fires:
  // Polish (silent step timeline, still a run) or anything on the audio plane
  // (Listen + Learn's machine states — wave-3 §B).
  // `pendingPlaybackRef` tracks whether a run has emitted fires since the last flush,
  // so the unmount flush doesn't double-emit a summary the pause/stop/done path
  // already flushed (and so an already-empty run doesn't emit an empty stats line).
  const pendingPlaybackRef = useRef(false);
  const flushPlaybackNow = useCallback(() => {
    if (mode === 'polish' || sendsAudio) { flushPlayback(mode); pendingPlaybackRef.current = false; }
  }, [mode, sendsAudio, flushPlayback]);

  const transport = useScoreTransport({
    // Polish runs the silent step timeline; Listen and Learn's machine states run
    // the note timeline; Learn's gate has no transport at all (the tracker drives).
    timeline: mode === 'polish' || sendsAudio ? playTimeline : [],
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
          // The wrap-seek jumps idxRef past the skipped tail's note_offs — on the
          // audio plane (sendsAudio) flush so they don't drone.
          if (sendsAudio) silenceScheduled();
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
        if (sendsAudio) silenceScheduled(); // skipped tail note_offs must not drone
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
      if (sendsAudio) silenceScheduled();
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

  // A move between rows of the Learn matrix (wave-3 §B) is never a play request:
  // stop whatever was running, kill any pending count-in/dwell/rebuild-resume, and
  // silence the piano — but NEVER start anything. Used by the loop toggle, a range
  // clear, and the focus-set effect, so all three land in a known-quiet state.
  const stopForMatrixChange = useCallback(() => {
    countIn.cancel();
    clearWrapDwell();
    resumeAfterRef.current = null;
    // Did this component actually put anything on the audio plane? Only then can
    // note-ons already be dispatched into the lookahead window, and only then may
    // we arm the DELAYED panic. silenceScheduled() is NOT safe on a silent kiosk:
    // silence() self-guards on the sounding ledger, but the delayed sendPanic
    // timer is armed unconditionally — and a stray CC123 in Learn's gate cuts off
    // notes the PLAYER is holding down (the contract silence() states above). A
    // quiet matrix change therefore takes the self-guarding silence() and nothing
    // else. Two ways to be loud: notes on the ledger (every scheduled note_on
    // lands there the moment it is dispatched, lookahead included — so this also
    // covers a range ARMED mid-performance, where the effect that runs the change
    // already sees the post-change `sendsAudio`), or an audio-plane run that was
    // still going when this was called.
    const hadSound = soundingRef.current.size > 0;
    const wasPlaying = !!transportRef.current?.playing;
    if (wasPlaying) transportRef.current.pause();
    setRunActive(false);
    if (hadSound || (sendsAudio && wasPlaying)) silenceScheduled(); else silence();
  }, [countIn, clearWrapDwell, sendsAudio, silence, silenceScheduled]);

  // Metronome click (audit M1/M2/M4; wave-3 G). Three modes, one bar button:
  //  Polish — `clickOn` (persisted) ARMS a reference beat that sounds only while
  //           the transport actually runs (the count-in supplies its own blips).
  //  Learn  — `learnClick` (session-local) IS the metronome: toggling ON starts a
  //           free-running practice beat immediately. Leaving Learn silences it
  //           (enabled goes false → the hook's cleanup stops the scheduler).
  //  Listen — `listenClick` (session-local, mirrors learnClick) is the SAME
  //           free-running beat as Learn's, but only offered when the tempo map
  //           has a single entry — a mid-piece tempo change has no one BPM for a
  //           free-running click to lock to, so the button gates in place.
  // It NEVER gates or advances the cursor. Ticks at the practice tempo.
  const clickAllowed = tempoMap.length === 1;
  const clickActive = mode === 'learn' ? learnClick : mode === 'listen' ? listenClick : clickOn;
  // The hook gets the EXACT product — the Polish transport runs at exactly
  // bpm × tempoMult (playTimeline scales by 1/tempoMult), so rounding here would
  // drift the click against the graded run (63 × 0.5 → 32 vs 31.5 = a full beat
  // every ~64). Round only the bar's readout.
  const clickBpmExact = (tempoMap[0]?.bpm || 90) * tempoMult;
  useMetronomeClick({
    enabled: (mode === 'polish' && clickOn && transport.playing)
      || (mode === 'learn' && learnClick)
      || (mode === 'listen' && listenClick && clickAllowed),
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

  // ── Learn wet ink (wave-3 D) ──────────────────────────────────────────────────
  // Every note the user plays in Learn leaves a short-lived mark on the staff at
  // the cursor column — red at the PLAYED pitch when it was wrong (so "no" also
  // answers "then what did I play?"), a green flash on a hit, muted grey in the
  // machine rows where nothing is gated. LearnInkLayer is pure; the lifecycle
  // (append + timed removal) lives here.
  //
  // These callbacks run from a MIDI subscription, so every score-derived value
  // they read comes from a ref mirror, not the render closure: the subscription is
  // deliberately NOT re-established per re-engrave (a fresh `events` identity
  // arrives on every zoom/flow/transpose), so a closure read would go stale the
  // first time the sheet re-engraved.
  const [inks, setInks] = useState([]);
  const inkSeqRef = useRef(0);
  const inkTimersRef = useRef(new Map());
  const eventsRef = useRef(events); eventsRef.current = events;
  const layoutRef = useRef(layout); layoutRef.current = layout;
  const stepsRef = useRef(steps); stepsRef.current = steps;
  const activePartsRef = useRef(activeParts); activePartsRef.current = activeParts;
  // Drop every pending expiry AND the marks themselves — used on a document
  // change and a mode change, where the geometry the marks were placed against is
  // about to be replaced (or hidden). Without clearing the timers too, a stale
  // expiry would fire against the new document's ink list.
  const clearInks = useCallback(() => {
    inkTimersRef.current.forEach(clearTimeout);
    inkTimersRef.current.clear();
    setInks([]);
  }, []);
  const pushInk = useCallback((midi, kind) => {
    const cur = eventsRef.current?.[stepRef.current];
    const boxes = layoutRef.current?.staffBoxes || [];
    if (!cur || !boxes.length) return; // no cursor column / no geometry — nothing to draw on
    // Which staff does this mark belong to? One active hand answers itself. With
    // both hands active the honest guess is the staff of the NEAREST expected
    // pitch at this step — a fumbled left-hand note inks on the left-hand staff.
    const active = activePartsRef.current || {};
    const activeStaves = Object.keys(active).filter((s) => active[s]).map(Number);
    let staff = activeStaves.length === 1 ? activeStaves[0] : 0;
    if (activeStaves.length > 1) {
      let best = Infinity;
      for (const n of stepsRef.current?.[stepRef.current]?.notes || []) {
        if (!active[n.staff]) continue;
        const d = Math.abs(n.midi - midi);
        if (d < best) { best = d; staff = n.staff; }
      }
    }
    // Which SYSTEM is the cursor on? The cursor box spans the whole grand staff,
    // so its vertical midpoint lands inside one system's band; fall back to the
    // first box carrying this staff (single-system scores, degenerate geometry).
    const mid = (cur.top + cur.bottom) / 2;
    const sys = boxes.find((b) => mid >= b.top - b.lineSpacing * 3 && mid <= b.top + b.lineSpacing * 7)?.system
      ?? boxes.find((b) => b.staff === staff)?.system ?? 0;
    const id = ++inkSeqRef.current;
    setInks((prev) => [...prev, { id, midi, staff, system: sys, x: cur.x, kind }]);
    const t = setTimeout(() => {
      inkTimersRef.current.delete(id);
      setInks((prev) => prev.filter((i) => i.id !== id));
    }, INK_TTL[kind] ?? 600);
    inkTimersRef.current.set(id, t);
  }, []);
  useEffect(() => () => { inkTimersRef.current.forEach(clearTimeout); }, []);
  // 0-based staff id → clef. `parsed.parts[0].clefs` is keyed by the 1-based
  // MusicXML staff NUMBER, while every geometry/activeParts id in this component
  // is 0-based (activeParts.js convention) — shift once here rather than at each
  // read site.
  const inkClefs = useMemo(() => {
    const c = parsed?.parts?.[0]?.clefs || {};
    return Object.fromEntries(Object.entries(c).map(([n, v]) => [Number(n) - 1, v]));
  }, [parsed]);
  // Ink is spelled in the SOUNDING key: on a C-major piece transposed +2, a played
  // D5 must land on the D-major grid the player is hearing, not the written one.
  const inkFifths = useMemo(
    () => soundingFifths(parsed?.key?.fifths ?? 0, transpose),
    [parsed, transpose],
  );

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
    pushInk(note, 'hit');
    // A hit means the reading landed — the "is this player stuck?" evidence resets
    // even mid-chord, so three wrongs SPREAD across a chord's right notes never
    // add up to a reveal (only three genuinely consecutive misses do).
    wrongStreakRef.current = 0;
    followHitsRef.current += 1;
    if (!lastAdvanceRef.current) return; // no reference point yet — don't invent one
    recordFollowHit({ step: stepRef.current, note, sinceAdvanceMs: performance.now() - lastAdvanceRef.current });
  }, [recordFollowHit, pushInk]);
  const onFollowStep = useCallback((next) => {
    setStep(next);
    setStruck(() => new Set());
    lastAdvanceRef.current = performance.now();
  }, []);
  // Learn mode optimizes for READING the score, so the keyboard must not spoil
  // which key to press. The reveal is on a BUDGET (wave-3 D): it arms only after
  // REVEAL_WRONG_STREAK consecutive wrongs on the SAME step, and then only in a dim
  // "half shade" (see targetNotes/dimTarget below). One wrong note now gets the wet
  // ink instead — which shows what was played without giving away what to play.
  // Both the streak and the reveal reset on every step change, so the next note
  // starts un-spoiled and un-penalised.
  const [revealKeys, setRevealKeys] = useState(false);
  const wrongStreakRef = useRef(0);
  useEffect(() => { setRevealKeys(false); wrongStreakRef.current = 0; }, [step]);

  // ── Learn cycle bookkeeping (wave-3 C) ────────────────────────────────────────
  // One completed, non-voided gate loop (in→out→wrap) is an "attempt" for every
  // measure it spans; a measure "passes" the cycle if no wrong note landed in it.
  // cycleWrongsRef accumulates measure indices touched by a wrong note THIS cycle;
  // cycleVoidRef marks the cycle as unusable (a disruption mid-pass — the loop was
  // never actually run clean start-to-finish). Both are consumed and reset the
  // instant a wrap fires (onFollowWrap below), or discarded outright on mode exit.
  const cycleWrongsRef = useRef(new Set());
  const cycleVoidRef = useRef(false);
  const voidCycle = useCallback(() => { cycleVoidRef.current = true; }, []);

  const onFollowWrong = useCallback((midi) => {
    flashWrong();
    pushInk(midi, 'wrong'); // the played pitch, in red, on the staff (wave-3 D)
    followWrongsRef.current += 1;
    cycleWrongsRef.current.add(measureIndexOfStep(stepRef.current));
    // The reveal is on a budget — see REVEAL_WRONG_STREAK. It never disarms until
    // the step changes: once help has been offered, taking it back mid-struggle
    // would be worse than never offering it.
    wrongStreakRef.current += 1;
    if (wrongStreakRef.current >= REVEAL_WRONG_STREAK) setRevealKeys(true);
  }, [flashWrong, pushInk, measureIndexOfStep]);
  // End of piece in Learn: show the completion card (audit M5). Follow-timing stats
  // still flush when the user leaves Learn / on unmount, so no flush is needed here.
  const [learnDone, setLearnDone] = useState(false);
  const onFollowComplete = useCallback(() => { setLearnDone(true); logger.info('score.learn.complete', {}); }, [logger]);

  // Fires the instant the tracker wraps the range's out-point back to its
  // in-point — one full, uninterrupted pass. A voided cycle (any disruption since
  // the last wrap — tap-seek, hand/part change, range change, transpose, or a
  // mode exit) is discarded, not recorded: it never ran the loop clean.
  const onFollowWrap = useCallback(() => {
    const f = focusRef.current;
    const voided = cycleVoidRef.current;
    const wrongs = cycleWrongsRef.current;
    cycleVoidRef.current = false;
    cycleWrongsRef.current = new Set();
    if (voided || !f) return;
    const indices = [];
    for (let m = f.inMeasure; m <= f.outMeasure; m++) indices.push(m);
    recordCycle({ measureIndices: indices, wrongMeasures: wrongs, bucket: bucketOf(grandStaff, activeParts) });
    logger.info('score.learn.cycle', { in: f.inMeasure, out: f.outMeasure, wrongs: wrongs.size });
  }, [recordCycle, grandStaff, activeParts, logger]);

  useFollowTracker({
    // Learn's GATE only (range + loop on — wave-3 §B): the machine states run the
    // transport instead, and must not gate the cursor on what the user plays.
    enabled: learnGate,
    steps,
    activeParts,
    step,
    subscribe,
    onStep: onFollowStep,
    onHit: onFollowHit,
    onWrong: onFollowWrong,
    onComplete: onFollowComplete,
    onWrap: onFollowWrap,
    range, // wrap advancement within the practice range (null → linear)
  });

  // Machine rows of the Learn matrix (wave-3 §B rows 1/3): nothing is gated, so
  // there is no right or wrong note to report — but playing along with the kiosk
  // should still leave a trace. Ink every note_on NEUTRALLY: never red, never a
  // shake, never a reveal. This is the ONLY subscription these rows make.
  useEffect(() => {
    if (!machineLearn || !subscribe) return undefined;
    return subscribe((evt) => {
      if (!evt || evt.type !== 'note_on' || !evt.velocity) return;
      pushInk(evt.note, 'neutral');
    });
  }, [machineLearn, subscribe, pushInk]);

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

  // ── Armed loop endpoints (wave-3 F) ───────────────────────────────────────────
  // Arm an edge from the bar's LoopGroup (or, from Task 21, a handle tap): the
  // NEXT tap on the score names the measure for that edge. Arming is a mode, not
  // a wizard — one tap, one endpoint, and the arm expires on its own (below).
  const onArm = useCallback((edge) => {
    setArming(edge);
    setArmRejects(0);
    logger.info('score.loop.arm', { edge });
  }, [logger]);

  // Section boundaries (measure INDICES) an endpoint snaps to. Rehearsal marks are
  // the musician's landmarks: a coarse tap one measure off one almost always means
  // the mark, and an off-by-one loop is a worse outcome than a snap the user can
  // see and re-tap. Both ends of every section count (a section's last measure is
  // as real a boundary as its first).
  const sectionBounds = useMemo(() => {
    const ms = layout.measures || [];
    const set = new Set();
    for (const s of sections) {
      const r = sectionToRange(s, ms);
      if (!r) continue;
      set.add(r.inMeasure);
      set.add(r.outMeasure);
    }
    return [...set];
  }, [sections, layout.measures]);
  // The same landmarks, drawn on the score while an endpoint is up for grabs
  // (armed, or a handle mid-drag): only the section STARTS, because a section's
  // end and the next one's start are the same visual boundary one measure apart —
  // ticking both would double every line and say nothing extra. Snapping still
  // considers both ends (sectionBounds above); this is only what is SHOWN.
  const sectionMarks = useMemo(() => {
    const ms = layout.measures || [];
    return sections.map((s) => sectionToRange(s, ms)?.inMeasure).filter((m) => m != null);
  }, [sections, layout.measures]);
  // Nearest boundary within ONE measure, else the tapped measure unchanged.
  const snapMeasure = useCallback((mi) => {
    let best = mi;
    let bestD = Infinity;
    for (const b of sectionBounds) {
      const d = Math.abs(mi - b);
      if (d <= 1 && d < bestD) { bestD = d; best = b; }
    }
    return best;
  }, [sectionBounds]);

  // Commit one endpoint (§F). With NO range, an endpoint plants a one-measure
  // range with the loop OFF — `focus` stays atomic (there is never a half-marked
  // range) and the user is not committed to looping by a single tap. With a range
  // already set, this REPLACES that edge, swapping the ends if they crossed.
  // A range change is a move between rows of the Learn matrix, so it always stops
  // and quiets down (Task 9) and never auto-plays.
  // Cycle voiding is deliberately NOT done here: the focus effect below owns it
  // (a fresh arm resets, a change against an existing range voids — wave-3 C fix
  // round 1), and doing it in both places would void a fresh arm's honest first
  // pass.
  const commitEndpoint = useCallback((edge, mi, via) => {
    const measure = snapMeasure(mi);
    const f = focusRef.current;
    stopForMatrixChange();
    focusOriginRef.current = via === 'drag' ? 'drag' : 'handle-tap';
    if (!f) {
      setFocus({ kind: 'custom', inMeasure: measure, outMeasure: measure });
      setLoopOn(false);
    } else {
      let inMeasure = edge === 'in' ? measure : f.inMeasure;
      let outMeasure = edge === 'out' ? measure : f.outMeasure;
      if (inMeasure > outMeasure) { const t = inMeasure; inMeasure = outMeasure; outMeasure = t; }
      setFocus({ kind: 'custom', inMeasure, outMeasure });
    }
    logger.info('score.loop.set', { edge, measure, via, snapped: measure !== mi });
  }, [snapMeasure, stopForMatrixChange, logger]);

  // A handle drag in progress. The layer reports `(edge, measureIndex)` as measures
  // are crossed and `(edge, null)` when the gesture ENDS (commit, cancel or miss
  // alike) — so this flag can never latch the section ticks on. The previewed
  // measure itself is not applied: a drag paints its own handle, and writing
  // `focus` per crossed measure would stop the transport dozens of times
  // (commitEndpoint → stopForMatrixChange) during one gesture.
  // A live drag also RELEASES any pending arm. The two gestures answer the same
  // question, so once the finger starts moving a grip the arm has been superseded —
  // and an arm that survived the drag would be the audit-H4b hazard exactly: the
  // banner would still be up after the range committed, and the next tap on the
  // music would set an endpoint instead of seeking.
  const onHandlePreview = useCallback((edge, mi) => {
    if (mi == null) { setDraggingEdge(null); return; }
    setDraggingEdge(edge);
    setArming(null);
  }, []);

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
    // An ARMED endpoint (wave-3 F): this tap names the measure for that edge of
    // the loop and sets it — it does not seek. Hit-testing is coarse by design
    // (measureAtPoint): any x inside a system's band resolves to the nearest
    // measure column, so only a DEAD MARGIN is refused. The retired two-tap
    // flow's near-a-note radius (audit L3) is gone with it.
    if (arming) {
      const ms = layout.measures || [];
      const mi = measureAtPoint({
        events,
        // A degenerate engrave can publish steps with no measure model at all;
        // treat the whole piece as one measure so an armed tap on the music is
        // never a dead press (the fallback the retired measureIndexOfStep applied).
        measures: ms.length ? ms : [{ index: 0, firstStep: 0, lastStep: events.length - 1 }],
        x: e.clientX - r.left,
        y: e.clientY - r.top,
        slack: 40 * scale,
      });
      if (mi < 0) { setArmRejects((n) => n + 1); return; } // outside the music — say so, don't swallow it
      setArming(null);
      commitEndpoint(arming, mi, 'tap');
      return;
    }
    const i = nearestEvent(events, e.clientX - r.left, e.clientY - r.top);
    if (i < 0) return;
    // Normal seek. When a practice range is active, clamp the target into it.
    resumeAfterRef.current = null; // a tap-seek supersedes a pending rebuild-resume
    clearWrapDwell(); // a tap-seek overrides a pending loop-wrap dwell
    voidCycle(); // a tap-seek breaks any Learn gate cycle in progress (wave-3 C)
    const target = range ? clampStepToRange(i, range) : i;
    // Tap-to-seek is the primary navigation gesture and emitted nothing, so every
    // `play {step: N}` with an unexplained N was a seek nobody could see (T1).
    logger.info('score.seek.tap', { from: stepRef.current, to: target, mode });
    tapIntent('seek');
    setStep(target);
    setStruck(() => new Set());
    lastAdvanceRef.current = performance.now();
    // Seek jumps idxRef past pending note_offs — flush sounding notes first
    // (whenever the kiosk is on the audio plane) so a skipped-over note doesn't
    // drone on the piano.
    // NOTE: unlike pause→resume, we deliberately do NOT clear the delayed panic
    // here — the transport keeps playing, so the panic still needs to fire to
    // kill pre-seek queued note-ons whose note-offs the jump skipped. Accepted
    // minor limitation: it can also clip a post-seek note once at the +lookahead
    // mark; a one-time clip is preferable to stranding a pre-seek note (drone).
    if (sendsAudio) silenceScheduled();
    // Transport timeline is tempo-scaled (playTimeline uses factor 1/tempoMult);
    // seek positions come from the unscaled stepTimeline, so scale to match.
    transport.seek((stepTimeline[target]?.t ?? 0) / tempoMult);
  }, [mode, sendsAudio, flow, events, transport, stepTimeline, silenceScheduled, tempoMult, arming, commitEndpoint, layout.measures, range, logger, countIn, scale, clearWrapDwell, tapIntent, voidCycle]);

  // Single unmount teardown: immediate silence + one delayed panic (see the
  // silenceScheduled note above), plus any pending loop-wrap dwell — a restart
  // after unmount would replay into a dead view. One effect → order-independent
  // by construction.
  useEffect(() => () => { clearWrapDwell(); silenceScheduled(); }, [clearWrapDwell, silenceScheduled]);

  // ── Focus range: selection + custom-loop taps ─────────────────────────────────
  // When a practice range is (re)selected, jump the cursor to its in-point and log.
  // prevFocusRef lags one commit behind `focus` — unlike focusRef/rangeRef (which
  // mirror the CURRENT value during render, for reads inside other callbacks),
  // this one is updated at the end of THIS effect, so reading it at the top always
  // sees the PRIOR focus, never the one that just committed.
  const prevFocusRef = useRef(null);
  useEffect(() => {
    clearWrapDwell(); // a loop change (set/clear/nudge) invalidates a pending dwell
    // A range change only VOIDS a cycle it could have disrupted — i.e. one where a
    // range was already active. Arming a FRESH range (prior focus was null) has no
    // prior cycle to disrupt: it starts an honest first cycle instead, so reset
    // (not void) — voiding it would silently raise the pass-count bar on every
    // range selection (wave-3 C fix round 1).
    if (prevFocusRef.current) voidCycle(); // an existing range was replaced/cleared
    else { cycleVoidRef.current = false; cycleWrongsRef.current = new Set(); } // fresh arm (or bare mount)
    prevFocusRef.current = focus;
    // The no-focus path is BOTH a bare mount and a cleared range, and must not
    // touch the transport or the piano: this effect runs on mount, so stopping
    // here would have every ScorePlayer open by silencing a kiosk it has not yet
    // played a note through. A range CLEAR still stops its driver — onClearFocus
    // owns that (it calls stopForMatrixChange before clearing).
    if (!focus) return;
    // SETTING a range moves between rows of the Learn matrix — stop and quiet down
    // first, then position the cursor. Nothing below plays: a new range never
    // auto-starts a run.
    stopForMatrixChange();
    const r = layout.measures ? rangeSteps(layout.measures, focus) : null;
    if (!r) return;
    setStep(r[0]);
    setStruck(() => new Set());
    lastAdvanceRef.current = performance.now();
    logFocus({ kind: focus.kind, inMeasure: focus.inMeasure, outMeasure: focus.outMeasure, origin: focusOriginRef.current });
    focusOriginRef.current = 'restore';
    tapIntent('focus');
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hand preference (wave-3 E): user → household → both, applied once per score
  // when Learn is entered with no persisted hands choice. Clamped to staves
  // that actually carry notes — a preference must never dead-end the gate.
  const seededHandsRef = useRef(false);
  // The exact object just handed to setActiveParts, held until it lands: the
  // auto-range effect below (same source-order pass) still closes over the
  // PRE-seed `activeParts` the instant this effect calls setActiveParts — a
  // plain boolean latch can't tell that apart from "nothing to seed" (both are
  // seededHandsRef.current===true by the time the auto-range effect runs in the
  // same pass). Comparing against this ref's identity can: it stays !== the
  // rendered `activeParts` for exactly one extra pass, then becomes ===.
  const pendingHandSeedRef = useRef(null);
  // Session-scoped "the user already made a manual choice" latch (review fix
  // round 1): set by the manual hand handlers (onHandsChange, onCyclePart)
  // below, in ANY mode — a Listen-mode toggle counts. Without this, a user who
  // picks their hands manually before ever opening Learn gets silently
  // overridden the instant Learn seeds from the resolved preference.
  const userTouchedHandsRef = useRef(false);
  useEffect(() => {
    // !prefsLoaded: the prefs GET is a fresh round-trip per user switch while
    // OSMD engraving is pure client-side after mount, so a fast score can
    // report notes before the real per-user learnHands resolves — wait for it
    // rather than seeding off the household default and latching there (review
    // fix round 1). Not a latch itself: this returns WITHOUT touching
    // seededHandsRef, so the effect simply re-fires once prefsLoaded flips true
    // (getPref's identity changes when prefs load, re-running this effect).
    if (mode !== 'learn' || seededHandsRef.current || !grandStaff || !prefsLoaded) return;
    if (restored.activeParts && typeof restored.activeParts === 'object') { seededHandsRef.current = true; return; }
    if (userTouchedHandsRef.current) { seededHandsRef.current = true; return; } // manual pick this session wins, same as a persisted one
    if (!layout.notes?.length) return;
    seededHandsRef.current = true;
    const pref = getPref('learnHands', smCfg.learn.defaultHands);
    if (pref !== 'rh' && pref !== 'lh') return; // 'both' is already the default
    const staffHasNotes = (s) => layout.notes.some((nte) => nte.staff === s);
    const want = pref === 'rh' ? 0 : 1;
    const target = staffHasNotes(want) ? want : staffHasNotes(want === 0 ? 1 : 0) ? (want === 0 ? 1 : 0) : null;
    if (target == null) return;
    const next = { 0: target === 0, 1: target === 1 };
    pendingHandSeedRef.current = next;
    setActiveParts(next);
  }, [mode, grandStaff, layout.notes, restored.activeParts, getPref, smCfg, prefsLoaded]);
  useEffect(() => {
    seededHandsRef.current = false;
    pendingHandSeedRef.current = null;
    userTouchedHandsRef.current = false;
  }, [scoreMeta.id]);

  // Learn landing (wave-3 B): pick the frontier window when Learn is entered
  // without a range. Runs once per Learn entry — the learnAutoRef arms on entry
  // and disarms after the pick (or when the user sets a range themselves).
  const learnAutoRef = useRef(false);
  useEffect(() => { if (mode === 'learn' && !focus) learnAutoRef.current = true; else if (mode !== 'learn') learnAutoRef.current = false; }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!learnAutoRef.current || mode !== 'learn' || focus || !layout.measures?.length || !practiceLoaded) return;
    // Wait for a hand-preference seed requested THIS pass (above) to actually
    // land in `activeParts` — picking now would read the pre-seed value and
    // frontier off the wrong hands' practice history (audit: wave-3 E).
    if (pendingHandSeedRef.current && pendingHandSeedRef.current !== activeParts) return;
    learnAutoRef.current = false;
    const bucket = bucketOf(grandStaff, activeParts);
    const passes = practice?.measures
      ? layout.measures.map((m) => practice.measures[String(m.index)]?.[bucket]?.passes ?? 0)
      : null;
    const picked = pickLearnRange({ sections, measures: layout.measures, steps: layout.steps, activeParts, passesByMeasure: passes });
    focusOriginRef.current = 'auto';
    setFocus({ kind: 'custom', inMeasure: picked.inMeasure, outMeasure: picked.outMeasure });
    setLoopOn(true); // the landing IS the gate state — ready to play
    logger.info('score.learn.auto-range', { ...picked });
  }, [mode, focus, layout.measures, layout.steps, practiceLoaded, practice, activeParts, grandStaff, sections, logger]);

  // An arm must not outlive the user's intent. `arming` gates the seek branch of
  // onScoreClick, so a forgotten arm silently disables tap-to-seek — one user
  // armed, played for 30s, tapped to seek and got a 10-measure loop (audit H4b).
  useEffect(() => {
    if (!arming) return undefined;
    const t = setTimeout(() => {
      setArming(null);
      logger.info('score.loop.arm-expire', { edge: arming });
    }, SELECT_IDLE_MS);
    return () => clearTimeout(t);
  }, [arming, logger]);
  const onCancelArm = useCallback(() => setArming(null), []);

  const onClearFocus = useCallback(() => {
    setArming(null);
    stopForMatrixChange(); // clearing the range is a matrix change — stop, don't jump
    setFocus(null);
    logger.info('score.focus.clear', {});
  }, [stopForMatrixChange, logger]);
  // Endpoint labels for the bar's LoopGroup: 1-based measure numbers (indices are
  // 0-based internally), undefined when no range is set so the mark buttons stay
  // icon-only until there is something to show.
  const inLabel = focus ? `m${focus.inMeasure + 1}` : undefined;
  const outLabel = focus ? `m${focus.outMeasure + 1}` : undefined;

  // ── Bar handlers ──────────────────────────────────────────────────────────────
  const onMode = useCallback((id) => {
    if (id === mode) return;
    resumeAfterRef.current = null; // a mode change supersedes a pending rebuild-resume
    countIn.cancel();            // a mode change aborts a pending count-in
    setLearnDone(false);         // the Learn completion card belongs to Learn only
    flushPlaybackNow();          // leaving a Polish/Listen run
    if (mode === 'learn') flushFollowNow();
    clearWrapDwell();            // a pending loop-wrap dwell dies with the run
    // A mode exit mid-cycle DISCARDS it outright (not a void-until-next-wrap):
    // the gate this cycle belonged to is gone, so there is no "next wrap" to
    // resolve it against — reset both refs rather than merely marking voided.
    cycleVoidRef.current = false;
    cycleWrongsRef.current = new Set();
    transport.stop();
    setRunActive(false);         // …and so does the run itself (see runActive)
    silenceScheduled();
    setStruck(() => new Set());
    clearInks();                 // wet ink belongs to the mode it was played in (wave-3 D)
    // Loop/focus is Learn-only state (wave-3 §0): only Learn keeps a range. Listen
    // is a jukebox and Polish grades whole-piece runs, so entering either releases
    // the range AND the loop toggle (the wave-2 "loop follows the ladder" semantics
    // are deliberately reversed). Loop-arming always resets.
    if (id !== 'learn') { setFocus(null); setLoopOn(false); }
    // Listen's free-running click is session-local to the Listen visit itself
    // (mirrors learnClick's never-persisted discipline, wave-3 G): leaving
    // Listen ends that session, so a walk-up back into Listen never inherits a
    // ticking room it didn't start.
    if (mode === 'listen' && id !== 'listen') setListenClick(false);
    setArming(null);              // a mode change abandons a pending endpoint arm
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
  }, [mode, flushPlaybackNow, flushFollowNow, transport, silenceScheduled, logMode, countIn, clearWrapDwell, clearInks, tapIntent]);

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
    voidCycle(); // a key change breaks a Learn cycle in progress (wave-3 C)
    const n = Math.round(Number(v));
    const clamped = Number.isFinite(n) ? Math.min(7, Math.max(-7, n)) : 0;
    setTranspose(clamped);
    logTranspose({ semitones: clamped });
    tapIntent('transpose');
  }, [logTranspose, pauseForViewChange, tapIntent, voidCycle]);

  // Zoom (Size) — pause a running transport before the re-engrave (H2).
  const onScaleStep = useCallback((v) => { pauseForViewChange(); setScale(v); }, [pauseForViewChange]);

  const reset = useCallback(() => {
    resumeAfterRef.current = null; // Restart supersedes a pending rebuild-resume
    setArming(null);        // Restart means the user is done arming a loop
    countIn.cancel();       // reset aborts a pending count-in
    clearWrapDwell();       // …and any pending loop-wrap dwell
    setLearnDone(false);    // fresh pass — close the completion card
    transport.stop();
    setRunActive(false);    // Restart ends the current run (see runActive)
    if (sendsAudio) silenceScheduled();
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
  }, [transport, mode, sendsAudio, silenceScheduled, flushPlaybackNow, countIn, clearWrapDwell, logger, tapIntent]);

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
    else if (mode === 'listen') setListenClick((v) => !v); // free-run, session-local (wave-3 G)
    else setClickOn((v) => !v); // Polish arm state, persisted
  }, [mode]);
  // Flip looping on/off IN PLACE — the range stays defined (its brackets keep
  // showing) but wrap/clamp/home-step stop treating it as a boundary. In Learn
  // this MOVES between rows of the state matrix (gate ↔ machine playback), so it
  // stops whatever was running and silences first; turning it ON also parks the
  // cursor on the in-point, because that is where the gated pass begins. Turning
  // it OFF leaves the cursor exactly where it was. Neither direction auto-plays.
  const onToggleLoop = useCallback(() => {
    const next = !loopOnRef.current;
    stopForMatrixChange();
    setLoopOn(next);
    if (next && focus && layout.measures) {
      const r = rangeSteps(layout.measures, focus);
      if (r) { setStep(r[0]); setStruck(() => new Set()); lastAdvanceRef.current = performance.now(); }
    }
    logger.info('score.loop.on', { on: next });
  }, [stopForMatrixChange, focus, layout.measures, logger]);

  const toggleRun = useCallback(() => {
    resumeAfterRef.current = null; // an explicit play/pause supersedes a pending rebuild-resume
    setArming(null); // starting/stopping a run means the user is done arming a loop
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
      if (sendsAudio) silenceScheduled();
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
  }, [countIn, transport, mode, sendsAudio, silenceScheduled, flushPlaybackNow, logger, stepTimeline, tempoMap, tempoMult, parsed, clearWrapDwell, tapIntent]);

  // Toggle a staff's active state — the chip fallback for >2 staves. One branch,
  // every mode (wave-3 A): Learn/Polish need ≥1 active staff or the all-notes rule
  // can never be satisfied (the cursor would deadlock); Listen needs ≥1 too, or the
  // kiosk would have nothing left to perform / resume into. Refuse to turn off the
  // last active staff.
  const onCyclePart = useCallback((staff) => {
    const activeCount = parts.reduce((c, p) => c + (activeParts[p.staff] ? 1 : 0), 0);
    if (activeParts[staff] && activeCount <= 1) return; // keep the last staff on
    userTouchedHandsRef.current = true; // a manual pick outranks the hand-preference seed (review fix round 1)
    voidCycle(); // an active-parts change breaks a Learn cycle in progress (wave-3 C)
    if (sendsAudio) {
      // Changing the active-part map mid-flight invalidates the NOTE timeline —
      // pause, flush, and silence so a stale schedule doesn't drone, then resume
      // where we were (audit H5: the music dying on the spot read as a broken
      // button). Learn's machine states perform the same timeline (wave-3 §B), so
      // they need the same treatment; Learn's gate and Polish are silent.
      pauseForRebuild('part');
      silenceScheduled(); // also flush when nothing was playing (a stale schedule may still be queued)
    }
    setActiveParts((a) => ({ ...a, [staff]: !a[staff] }));
    logger.info('score.active-part', { staff, on: !activeParts[staff] });
    tapIntent('active-part');
  }, [sendsAudio, pauseForRebuild, silenceScheduled, logger, activeParts, parts, tapIntent, voidCycle]);

  // Grand-staff (2 staves) fast path: a single segmented control instead of chips.
  // One variant, every mode (wave-3 A) — value + handler map to activeParts alone.
  // Staff 0 = RH, 1 = LH (activeParts.js convention). `grandStaff` itself is
  // hoisted up near `parts` (Learn-cycle bucketOf needs it earlier).
  const handsValue = activeParts[0] && activeParts[1] ? 'both' : activeParts[0] ? 'rh' : 'lh';
  const onHandsChange = useCallback((v) => {
    // Both/RH/LH → which staves are active. Always ≥1 active (never deadlocks).
    userTouchedHandsRef.current = true; // a manual pick outranks the hand-preference seed (review fix round 1)
    setActiveParts({ 0: v !== 'lh', 1: v !== 'rh' });
    voidCycle(); // a hand-toggle change breaks a Learn cycle in progress (wave-3 C)
    if (sendsAudio) {
      // A hand change mid-flight invalidates the NOTE timeline (Listen and Learn's
      // machine states both perform it — wave-3 §B) — pause, flush, and silence so
      // a stale schedule doesn't drone, then resume where we were (audit H5: the
      // music dying on the spot read as a broken button).
      pauseForRebuild('part');
      silenceScheduled();
    }
    logger.info('score.hands', { value: v });
    tapIntent('hands');
  }, [sendsAudio, pauseForRebuild, silenceScheduled, logger, tapIntent, voidCycle]);

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
    setArming(null);
    clearInks(); // ink marks are pinned to the OLD engraving's geometry (wave-3 D)
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
  // the measure-grade wash (Polish) and the range tint / ticks / drag handles
  // (Learn), so it's computed whenever any of them could draw.
  const showGrades = mode === 'polish';
  // Learn-only (wave-3 F): Polish lost the loop in the state matrix (Task 9), so a
  // range tint there would advertise a control Polish does not have.
  const showFocusLayer = mode === 'learn';
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
          {/* Learn only (wave-3 D) — Listen/Polish/Perform have no user-input ink.
              Mounted AFTER the cursor div so the ink paints above the cursor band
              at the same z-index rather than under it. */}
          {mode === 'learn' && layoutFresh && (
            <LearnInkLayer
              inks={inks}
              staffBoxes={layout.staffBoxes}
              clefs={inkClefs}
              keyFifths={inkFifths}
            />
          )}
          {showGrades && layoutFresh && (
            <MeasureGradeLayer
              measures={layout.measures}
              stepBoxes={stepBoxes}
              grades={grades}
            />
          )}
          {/* The range's TINT plus the section ticks a commit snaps to. No bracket
              and no `pending` half-state (wave-3 F): the ends are the draggable
              handles below, and the first endpoint commits a real one-measure
              range. Mounted while ARMING even with no range yet — the ticks are
              precisely what a first endpoint lands on. */}
          {showFocusLayer && layoutFresh && (focus || arming) && (
            <FocusRangeLayer
              measures={layout.measures}
              stepBoxes={stepBoxes}
              range={focus ? { inMeasure: focus.inMeasure, outMeasure: focus.outMeasure } : null}
              marks={(arming || draggingEdge) ? sectionMarks : NO_MARKS}
            />
          )}
          {/* The range's two draggable ends. AFTER FocusRangeLayer so the grips sit
              above the tint; the layer root is inert, so only the 48px handles take
              the gesture (and they swallow it, keeping tap-to-seek off them). */}
          {mode === 'learn' && layoutFresh && focus && (
            <RangeHandleLayer
              measures={layout.measures}
              stepBoxes={stepBoxes}
              range={{ inMeasure: focus.inMeasure, outMeasure: focus.outMeasure }}
              onArm={onArm}
              onCommit={commitEndpoint}
              onPreview={onHandlePreview}
              scrollRef={scrollRef}
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
        <SelectBanner edge={arming} rejects={armRejects} onCancel={onCancelArm} />
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
        playLocked={learnGate}
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
        loopActive={!!focus}
        loopEnabled={loopOn}
        arming={arming}
        inLabel={inLabel}
        outLabel={outLabel}
        onArm={onArm}
        onClearFocus={onClearFocus}
        onToggleLoop={onToggleLoop}
        keyboardVisible={keyboardVisible}
        onToggleKeyboard={onToggleKeyboard}
        clickActive={clickActive}
        clickDisabled={mode === 'listen' && !clickAllowed}
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
