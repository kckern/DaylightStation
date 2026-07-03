import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
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

const SOSTENUTO_CC = 66; // middle pedal — manual page turns
const MODES = [
  { id: 'follow', label: 'Follow' },
  { id: 'metronome', label: 'Metronome' },
  { id: 'play', label: 'Play' },
  { id: 'manual', label: 'Manual' },
];
const PART_LABEL = { play: 'Play', you: 'You', mute: 'Mute' };
const partName = (staff) => (staff === 0 ? 'RH' : staff === 1 ? 'LH' : `P${staff + 1}`);
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
 * ScorePlayer — interactive engraved score. Three modes:
 *  Follow    — MIDI advances the cursor on the correct note; wrong notes flash, no advance.
 *  Metronome — auto-advances at tempo.
 *  Manual    — no awareness; sostenuto (middle) pedal + tap-to-scroll + swipe move the page.
 * Plus: tap a note to move the cursor (follow/metronome), wrapped↔horizontal flow,
 * a size scaler, and an expandable title/metadata header.
 */
export default function ScorePlayer({ score: scoreMeta }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-score-player' }), []);
  const navigate = useNavigate();
  const { activeNotes, subscribe, subscribeRaw, pressNote, releaseNote, sendPanic } = usePianoMidi();
  const { setPlaying: setGlobalPlaying } = usePianoPlayback();
  const { config } = usePianoKioskConfig();
  const kb = config?.keyboard || { startNote: 21, endNote: 108 };

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

  const [layout, setLayout] = useState({ events: [], notes: [], tempoEntries: [], width: 0, height: 0, flow: null });
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState('follow');
  const [flow, setFlow] = useState('wrapped');
  const [scale, setScale] = useState(1);
  const [wrong, setWrong] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);
  const scrollRef = useRef(null);
  const cursorRef = useRef(null);
  const prevTopRef = useRef(null);
  const wrongTimer = useRef(null);
  const stepRef = useRef(0);
  stepRef.current = step;

  const events = layout.events;
  const current = events[step] || null;
  const onLayout = useCallback((res) => { setLayout(res); }, []);

  // Tempo map (mid-piece changes included) drives the metronome transport; the
  // opening tempo also feeds the header. Falls back to the parsed opening tempo
  // before layout has reported OSMD's tempo entries.
  const tempoMap = useMemo(
    () => buildTempoMap(layout.tempoEntries, parsed?.tempo || 90),
    [layout.tempoEntries, parsed],
  );
  const stepTimeline = useMemo(() => buildStepTimeline(events, tempoMap), [events, tempoMap]);

  // Play mode: per-staff roles (play/mute/you). Keyed to the staff SET (a stable
  // signature), not the parts array identity — otherwise every re-engrave
  // (zoom / flow / resize gives layout.notes a fresh reference) would wipe the
  // user's role picks. Staves that persist keep their role; new staves default to play.
  const [roles, setRoles] = useState({});
  const parts = useMemo(() => partsOf(layout.notes), [layout.notes]);
  const staffSig = parts.map((p) => p.staff).join(',');
  useEffect(() => {
    setRoles((prev) => Object.fromEntries(parts.map((p) => [p.staff, prev[p.staff] || 'play'])));
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

  const transport = useScoreTransport({
    timeline: mode === 'metronome' || mode === 'play' ? playTimeline : [],
    onEvent: (e) => {
      if (e.kind === 'step' || e.type == null) { setStep(e.index); return; }
      if (e.type === 'note_on') { pressNote?.(e.note, e.velocity ?? 80); soundingRef.current.add(e.note); }
      else { releaseNote?.(e.note); soundingRef.current.delete(e.note); }
    },
    onDone: () => { if (mode === 'play') silence(); logger.info('score.transport.done', { mode, steps: events.length }); },
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

  // Follow mode: advance on the correct note, flash on a plausible wrong one.
  useEffect(() => {
    if (mode !== 'follow') return undefined;
    return subscribe((evt) => {
      if (evt.type !== 'note_on' || !evt.velocity) return;
      const ev = events[stepRef.current];
      if (!ev) return;
      const expected = ev.midis || [ev.midi];
      if (evt.note === ev.midi) setStep((s) => Math.min(events.length - 1, s + 1));
      else if (!expected.includes(evt.note) && Math.abs(evt.note - ev.midi) <= 24) flashWrong();
    });
  }, [mode, events, subscribe, flashWrong]);

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
      // Seek jumps idxRef past pending note_offs — flush sounding notes first
      // (Play mode) so a skipped-over note doesn't drone on the piano.
      if (mode === 'play') silence();
      transport.seek(stepTimeline[i]?.t ?? 0);
    }
  }, [mode, flow, events, transport, stepTimeline, silence]);

  useEffect(() => () => silence(), [silence]);

  const reset = () => { transport.stop(); if (mode === 'play') silence(); setStep(0); scrollRef.current?.scrollTo({ top: 0, left: 0 }); };
  const toggleRun = () => {
    if (running) { transport.pause(); if (mode === 'play') silence(); logger.info('score.transport.pause', { step }); }
    else { transport.seek(stepTimeline[stepRef.current]?.t ?? 0); transport.play(); logger.info('score.transport.play', { step, mode, bpm: tempoMap[0].bpm }); }
  };
  const cursorColor = mode === 'follow' ? '#2ec46f' : mode === 'play' ? '#e8a33d' : '#6cf';
  const pct = Math.round(scale * 100);

  // Teleport (don't sweep diagonally) when the cursor crosses to a new system.
  const jump = current != null && prevTopRef.current != null && Math.abs(current.top - prevTopRef.current) > 1;
  useEffect(() => { prevTopRef.current = current?.top ?? null; }, [current]);

  // Title lives in the body (not the header): fixed at top in scroll mode, at the
  // top of the page (scrolls out of view) in wrap mode. Tap it for metadata.
  const titleBlock = (
    <div className="piano-score-bodytitle">
      <button type="button" className="piano-score-bodytitle__name" onClick={() => setMetaOpen((o) => !o)} aria-expanded={metaOpen}>
        {meta.title} <span className="piano-score-bodytitle__caret">{metaOpen ? '▴' : '▾'}</span>
      </button>
      {metaOpen && (
        <div className="piano-score-bodytitle__meta">
          {meta.composer && <span><b>Composer</b> {meta.composer}</span>}
          <span><b>Key</b> {meta.key || '—'}</span>
          <span><b>Time</b> {meta.time || '—'}</span>
          <span><b>Tempo</b> {meta.tempo} bpm</span>
          <span><b>Measures</b> {meta.measures}</span>
        </div>
      )}
    </div>
  );

  return (
    <div className="piano-score-player">
      <div className="piano-score-player__bar">
        <button type="button" className="piano-score-mode piano-score-player__back" onClick={() => navigate('..', { relative: 'path' })} aria-label="Back to sheet music">‹ Back</button>

        <div className="piano-score-player__modes" role="tablist">
          {MODES.map((m) => (
            <button key={m.id} type="button" className={`piano-score-mode${mode === m.id ? ' is-active' : ''}`} aria-selected={mode === m.id} onClick={() => { setMode(m.id); transport.stop(); silence(); logger.info('score.mode', { mode: m.id }); }}>{m.label}</button>
          ))}
        </div>

        <div className="piano-score-player__transport">
          <button type="button" className="piano-score-mode" onClick={() => setFlow((f) => (f === 'wrapped' ? 'horizontal' : 'wrapped'))} title="Toggle scroll direction">
            {flow === 'wrapped' ? '≡ Wrap' : '→ Scroll'}
          </button>
          <span className="piano-score-zoom">
            <button type="button" className="piano-score-mode" onClick={() => setScale((s) => Math.max(0.7, Math.round((s - 0.15) * 100) / 100))} aria-label="Smaller">A−</button>
            <span className="piano-score-player__pos">{pct}%</span>
            <button type="button" className="piano-score-mode" onClick={() => setScale((s) => Math.min(2, Math.round((s + 0.15) * 100) / 100))} aria-label="Bigger">A+</button>
          </span>
          {mode === 'play' && parts.map((p) => {
            const role = roles[p.staff] || 'play';
            return (
              <button key={p.staff} type="button" className={`piano-score-mode piano-score-part--${role}`}
                onClick={() => {
                  const next = cyclePart(role);
                  setRoles((r) => ({ ...r, [p.staff]: next }));
                  transport.pause(); silence(); // role change invalidates the note timeline mid-flight
                  logger.info('score.play.part', { staff: p.staff, role: next });
                }}>{`${partName(p.staff)}: ${PART_LABEL[role]}`}</button>
            );
          })}
          {(mode === 'metronome' || mode === 'play') && (
            <button type="button" className="piano-score-mode" onClick={toggleRun} disabled={!events.length}>{running ? '❚❚' : '▶'}</button>
          )}
          {mode !== 'manual' && <button type="button" className="piano-score-mode" onClick={reset}>⟲</button>}
          {mode !== 'manual' && <span className="piano-score-player__pos">{events.length ? `${Math.min(step + 1, events.length)} / ${events.length}` : ''}</span>}
        </div>
      </div>

      {flow === 'horizontal' && <div className="piano-score-bodytitle-slot">{titleBlock}</div>}

      <div className={`piano-score-player__scroll piano-score-player__scroll--${flow}`} ref={scrollRef} onClick={onScoreClick}>
        {flow === 'wrapped' && titleBlock}
        <MusicXmlRenderer score={parsed} musicXml={scoreMeta.musicXml} flow={flow} scale={scale} onLayout={onLayout}>
          {current && mode !== 'manual' && (
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
        </MusicXmlRenderer>
      </div>

      {flow === 'horizontal' && (
        <div className="piano-score-player__keys">
          <PianoKeyboard
            activeNotes={activeNotes}
            targetNotes={
              mode === 'play' && current ? youMidisAt(layout.notes, roles, current.onsetQuarter)
              : mode !== 'manual' && current ? new Set(current.midis || [current.midi])
              : null
            }
            startNote={kb.startNote}
            endNote={kb.endNote}
          />
        </div>
      )}
    </div>
  );
}
