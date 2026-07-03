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
import { buildTempoMap, buildStepTimeline } from '../../../../MusicNotation/scoreTimeline.js';
import { useScoreTransport } from './useScoreTransport.js';
import { tweenScrollTo, cancelScrollTween } from './scrollTween.js';
import { partsOf, cyclePart, buildPlayTimeline, youMidisAt } from './playParts.js';
import { staffLabels, defaultActiveParts, expectedMidisAtStep } from './activeParts.js';
import useFollowTracker from './useFollowTracker.js';
import useScoreTelemetry from './useScoreTelemetry.js';
import ScoreTransportBar from './ScoreTransportBar.jsx';
import NoteHighlightLayer from './NoteHighlightLayer.jsx';

const SOSTENUTO_CC = 66; // middle pedal — manual page turns
const KEY_NAMES = { '-7': 'Cb', '-6': 'Gb', '-5': 'Db', '-4': 'Ab', '-3': 'Eb', '-2': 'Bb', '-1': 'F', 0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#' };
const NO_MISSED = new Set(); // stable empty ref — note-level missed flashing is deferred (cursor already flashes wrong)

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
 *  Follow    — full-hand tracking: the cursor advances only once every active-staff
 *              note of the step is struck; wrong notes flash; struck noteheads light.
 *  Metronome — auto-advances at tempo; noteheads light as they sound.
 *  Play      — the kiosk performs 'play' parts through the piano; 'you' parts are
 *              highlighted (never sent); 'mute' parts are silent.
 *  Manual    — no awareness; sostenuto (middle) pedal + tap-to-scroll move the page.
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
  const { logLoad, recordFire, flushPlayback, recordFollowHit, flushFollow } = useScoreTelemetry({ id: scoreMeta.id });

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

  const [layout, setLayout] = useState({ events: [], notes: [], steps: [], tempoEntries: [], width: 0, height: 0, flow: null });
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState('follow');
  const [flow, setFlow] = useState('wrapped');
  const [scale, setScale] = useState(1);
  const [wrong, setWrong] = useState(false);
  const [struck, setStruck] = useState(() => new Set());
  const [keyboardVisible, setKeyboardVisible] = useState(true); // default mode is follow → shown
  const scrollRef = useRef(null);
  const cursorRef = useRef(null);
  const prevTopRef = useRef(null);
  const wrongTimer = useRef(null);
  const stepRef = useRef(0);
  stepRef.current = step;

  const events = layout.events;
  const steps = layout.steps;
  const current = events[step] || null;
  const onLayout = useCallback((res) => { setLayout(res); }, []);

  // Tempo map (mid-piece changes included) drives the metronome transport; the
  // opening tempo also feeds the metadata popover. Falls back to the parsed
  // opening tempo before layout has reported OSMD's tempo entries.
  const tempoMap = useMemo(
    () => buildTempoMap(layout.tempoEntries, parsed?.tempo || 90),
    [layout.tempoEntries, parsed],
  );
  const stepTimeline = useMemo(() => buildStepTimeline(events, tempoMap), [events, tempoMap]);

  // Parts (one per staff). Roles (Play mode) and active-parts (Follow/Metronome
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

  const playTimeline = useMemo(
    () => (mode === 'play' ? buildPlayTimeline(events, layout.notes, tempoMap, roles) : stepTimeline),
    [mode, events, layout.notes, tempoMap, roles, stepTimeline],
  );

  const soundingRef = useRef(new Set());
  const silence = useCallback(() => {
    // Nothing the kiosk sent is sounding — don't broadcast a panic that would
    // cut off notes the player is holding on the piano (e.g. switching out of Follow).
    if (!soundingRef.current.size) return;
    soundingRef.current.forEach((n) => { try { releaseNote?.(n); } catch { /* port gone */ } });
    soundingRef.current.clear();
    // BLE one-turn-late bug can swallow a lone terminal note-off — panic (CC123)
    // goes through the flushed path (contract established by the Producer transport).
    sendPanic?.();
  }, [releaseNote, sendPanic]);

  // Flush playback telemetry only when a metronome/play run actually produced fires.
  const flushPlaybackNow = useCallback(() => {
    if (mode === 'metronome' || mode === 'play') flushPlayback(mode);
  }, [mode, flushPlayback]);

  const transport = useScoreTransport({
    timeline: mode === 'metronome' || mode === 'play' ? playTimeline : [],
    onEvent: (e) => {
      if (e.kind === 'step' || e.type == null) {
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
    onFire: (ev, driftMs, gapMs) => recordFire(ev, driftMs, gapMs, tempoMap[0]?.bpm),
    onDone: () => { if (mode === 'play') silence(); flushPlaybackNow(); logger.info('score.transport.done', { mode, steps: events.length }); },
  });
  const running = transport.playing;

  const flashWrong = useCallback(() => {
    setWrong(true);
    clearTimeout(wrongTimer.current);
    wrongTimer.current = setTimeout(() => setWrong(false), 280);
  }, []);
  useEffect(() => () => clearTimeout(wrongTimer.current), []);

  useReloadGuard(running);
  useEffect(() => { setGlobalPlaying(running); return () => setGlobalPlaying(false); }, [running, setGlobalPlaying]);

  // ── Follow mode: full-hand tracker (all active-staff notes → advance) ──────────
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
  const onFollowWrong = useCallback(() => { flashWrong(); followWrongsRef.current += 1; }, [flashWrong]);
  useFollowTracker({
    enabled: mode === 'follow',
    steps,
    activeParts,
    step,
    subscribe,
    onStep: onFollowStep,
    onHit: onFollowHit,
    onWrong: onFollowWrong,
  });

  // Flush follow-timing stats when leaving Follow (and on unmount if still in it).
  const flushFollowNow = useCallback(() => {
    if (followHitsRef.current || followWrongsRef.current) {
      flushFollow(followHitsRef.current, followWrongsRef.current);
      followHitsRef.current = 0; followWrongsRef.current = 0;
    }
  }, [flushFollow]);
  const flushFollowRef = useRef(flushFollowNow); flushFollowRef.current = flushFollowNow;
  useEffect(() => () => flushFollowRef.current(), []);

  // Auto-follow the cursor: retargetable tween on the scroll container only
  // (native smooth scrollIntoView self-cancels at per-note cadence and drags
  // ancestor scrollers with it). Skipped while the reported layout belongs to
  // the other flow (mid re-engrave — coordinates would be stale).
  useEffect(() => {
    if (mode === 'manual' || !current) return;
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

  // Manual mode: sostenuto (middle) pedal turns the page — rising edge only,
  // since continuous/half pedals stream many CC66 values per physical press.
  useEffect(() => {
    if (mode !== 'manual') return undefined;
    let prev = 0;
    return subscribeRaw(({ data }) => {
      if (!data || data.length < 3) return;
      if ((data[0] & 0xf0) !== 0xb0 || data[1] !== SOSTENUTO_CC) return;
      const rising = prev < 64 && data[2] >= 64;
      prev = data[2];
      if (!rising) return;
      const el = scrollRef.current;
      if (el) el.scrollBy({ [flow === 'horizontal' ? 'left' : 'top']: (flow === 'horizontal' ? el.clientWidth : el.clientHeight) * 0.85, behavior: 'smooth' });
      logger.info('score.manual.pageturn', {});
    });
  }, [mode, subscribeRaw, flow, logger]);

  // Tap: follow/metronome → move the cursor to the nearest note; manual → scroll it into view.
  const onScoreClick = useCallback((e) => {
    const el = scrollRef.current;
    const rdr = el?.querySelector('.musicxml-renderer');
    if (!el) return;
    if (mode === 'manual') {
      const r = el.getBoundingClientRect();
      const dy = e.clientY - (r.top + el.clientHeight / 2);
      const dx = e.clientX - (r.left + el.clientWidth / 2);
      el.scrollBy(flow === 'horizontal' ? { left: dx, behavior: 'smooth' } : { top: dy, behavior: 'smooth' });
      return;
    }
    if (!rdr || !events.length) return;
    const r = rdr.getBoundingClientRect();
    const i = nearestEvent(events, e.clientX - r.left, e.clientY - r.top);
    if (i >= 0) {
      setStep(i);
      setStruck(() => new Set());
      lastAdvanceRef.current = performance.now();
      // Seek jumps idxRef past pending note_offs — flush sounding notes first
      // (Play mode) so a skipped-over note doesn't drone on the piano.
      if (mode === 'play') silence();
      transport.seek(stepTimeline[i]?.t ?? 0);
    }
  }, [mode, flow, events, transport, stepTimeline, silence]);

  useEffect(() => () => silence(), [silence]);

  // ── Bar handlers ──────────────────────────────────────────────────────────────
  const onMode = useCallback((id) => {
    if (id === mode) return;
    flushPlaybackNow();          // leaving a metronome/play run
    if (mode === 'follow') flushFollowNow();
    transport.stop();
    silence();
    setStruck(() => new Set());
    setKeyboardVisible(id !== 'manual');
    setMode(id);
    logger.info('score.mode', { mode: id });
  }, [mode, flushPlaybackNow, flushFollowNow, transport, silence, logger]);

  const reset = useCallback(() => {
    transport.stop();
    if (mode === 'play') silence();
    flushPlaybackNow();
    setStep(0);
    setStruck(() => new Set());
    scrollRef.current?.scrollTo({ top: 0, left: 0 });
  }, [transport, mode, silence, flushPlaybackNow]);

  const toggleRun = useCallback(() => {
    if (running) {
      transport.pause();
      if (mode === 'play') silence();
      flushPlaybackNow();
      logger.info('score.transport.pause', { step });
    } else {
      transport.seek(stepTimeline[stepRef.current]?.t ?? 0);
      transport.play();
      logger.info('score.transport.play', { step, mode, bpm: tempoMap[0]?.bpm });
    }
  }, [running, transport, mode, silence, flushPlaybackNow, logger, step, stepTimeline, tempoMap]);

  const onCyclePart = useCallback((staff) => {
    if (mode === 'play') {
      const role = roles[staff] || 'play';
      const next = cyclePart(role);
      setRoles((r) => ({ ...r, [staff]: next }));
      if (running) { transport.pause(); flushPlaybackNow(); }
      silence(); // role change invalidates the note timeline mid-flight
      logger.info('score.play.part', { staff, role: next });
    } else {
      setActiveParts((a) => ({ ...a, [staff]: !a[staff] }));
      logger.info('score.active-part', { staff, on: !activeParts[staff] });
    }
  }, [mode, roles, running, transport, flushPlaybackNow, silence, logger, activeParts]);

  // ── Load timing (best-effort) ───────────────────────────────────────────────
  // Measured: fetch ms (from SheetMusic.jsx via score.fetchMs) + open→ready total
  // here. Fires once per document (re-engraves from zoom/flow don't re-log).
  const openTsRef = useRef(performance.now());
  const readySentRef = useRef(false);
  useEffect(() => { openTsRef.current = performance.now(); readySentRef.current = false; }, [scoreMeta.musicXml]);
  const onReady = useCallback(() => {
    if (readySentRef.current) return;
    readySentRef.current = true;
    logLoad({
      fetchMs: Math.round(scoreMeta.fetchMs || 0),
      openToReadyMs: Math.round(performance.now() - openTsRef.current),
    });
  }, [logLoad, scoreMeta.fetchMs]);

  const cursorColor = mode === 'follow' ? '#2ec46f' : mode === 'play' ? '#e8a33d' : '#6cf';

  // Teleport (don't sweep diagonally) when the cursor crosses to a new system.
  const jump = current != null && prevTopRef.current != null && Math.abs(current.top - prevTopRef.current) > 1;
  useEffect(() => { prevTopRef.current = current?.top ?? null; }, [current]);

  // Keyboard target set: Play → your ('you') part pitches at this onset; other
  // interactive modes → the active-staff expected midis at this step.
  const targetNotes = mode === 'play' && current
    ? youMidisAt(layout.notes, roles, current.onsetQuarter)
    : mode !== 'manual'
      ? expectedMidisAtStep(steps[step], activeParts)
      : null;

  return (
    <div className="piano-score-player">
      <div className={`piano-score-player__scroll piano-score-player__scroll--${flow}`} ref={scrollRef} onClick={onScoreClick}>
        <MusicXmlRenderer score={parsed} musicXml={scoreMeta.musicXml} flow={flow} scale={scale} onLayout={onLayout} onReady={onReady}>
          {mode !== 'manual' && current && (
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
          {mode !== 'manual' && (
            <NoteHighlightLayer
              step={steps[step]}
              activeParts={activeParts}
              struck={struck}
              missed={NO_MISSED}
              scale={scale}
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
        flow={flow}
        onToggleFlow={() => setFlow((f) => (f === 'wrapped' ? 'horizontal' : 'wrapped'))}
        scale={scale}
        onScale={setScale}
        parts={barParts}
        activeParts={activeParts}
        roles={roles}
        onCyclePart={onCyclePart}
        keyboardVisible={keyboardVisible}
        onToggleKeyboard={() => setKeyboardVisible((v) => !v)}
        meta={meta}
      />
    </div>
  );
}
