import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { usePianoMidi } from '../../PianoMidiContext.jsx';
import { usePianoKioskConfig } from '../../PianoConfig.jsx';
import { PianoKeyboard } from '../../../components/PianoKeyboard.jsx';
import { useKeepScreenAwake } from '../../usePianoScreensaver.jsx';
import PianoEmpty from '../../PianoEmpty.jsx';
import { useLoopLibrary } from '../../useLoopLibrary.js';
import { useLoopTransport } from '../../useLoopTransport.js';
import { roleOf } from '@shared-music/layerMatch.mjs';
import { RomanProgression } from '../../../components/roman/RomanProgression.jsx';
import { detectKey } from '../../../../MusicNotation/index.js';
import { detectChords } from '../Lessons/theory/theoryEngine.js';
import { romanAnalysis, bestTonic } from '@shared-music/romanAnalysis.mjs';
import { SvgStaffRenderer } from '../../../../MusicNotation/index.js';
import './Producer.scss';

/**
 * Lazily loads notes for a melodic entry and renders a staff thumbnail.
 * Shows the bare staff immediately (empty pitches), fills in notes async.
 */
function MelodicStaffThumb({ entry, lib }) {
  const [pitches, setPitches] = useState([]);
  useEffect(() => {
    let cancelled = false;
    lib.loadNotes(entry).then((notes) => {
      if (cancelled || !notes?.notes?.length) return;
      // First 8 unique pitches for a compact thumbnail.
      const seen = new Set();
      const first8 = [];
      for (const n of notes.notes) {
        if (!seen.has(n.midi)) { seen.add(n.midi); first8.push(n.midi); }
        if (first8.length >= 8) break;
      }
      setPitches(first8);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [entry, lib]); // eslint-disable-line react-hooks/exhaustive-deps
  return <SvgStaffRenderer targetPitches={pitches} />;
}

const ROLES = [
  { key: null, label: 'All' },
  { key: 'chords', label: 'Chords' },
  { key: 'melody', label: 'Melody' },
  { key: 'bass', label: 'Bass' },
  { key: 'idea', label: 'Ideas' },
];
const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const keyName = (shift) => NOTE_NAMES[((shift % 12) + 12) % 12];

/**
 * Producer — the MIDI loop-layering jam surface. Pick a base loop, stack
 * compatibility-ranked layers (chords/melody/bass) that auto-conform to the
 * base, loop the stack through the synth, and play along on the keyboard footer.
 * Everything is canonical MIDI (C), transposed live to the chosen key.
 */
export function Producer() {
  const logger = useMemo(() => getLogger().child({ component: 'piano-producer' }), []);
  const { config } = usePianoKioskConfig();
  const kb = config?.keyboard || { startNote: 21, endNote: 108 };
  const { activeNotes, pressNote, releaseNote } = usePianoMidi();
  const lib = useLoopLibrary();

  const [base, setBase] = useState(null);
  const [layers, setLayers] = useState([]); // [{ id, entry, notes }]
  const [muted, setMuted] = useState({}); // id -> bool
  const [soloed, setSoloed] = useState({}); // id -> bool
  const [keyShift, setKeyShift] = useState(0);
  const [role, setRole] = useState(null);
  const [text, setText] = useState('');
  const [bpm, setBpm] = useState(100);
  const [browsing, setBrowsing] = useState(false);
  const [previewLayers, setPreviewLayers] = useState([]);
  const [activeChord, setActiveChord] = useState(-1);
  const [showRoman, setShowRoman] = useState(false);
  const playheadRef = useRef(null);

  // Split note: half of the keyboard range, defaulting to middle C (60).
  const splitNote = useMemo(() => Math.floor((kb.startNote + kb.endNote) / 2), [kb.startNote, kb.endNote]);

  // Seed tempo from base when it changes
  useEffect(() => { if (base?.bpm) setBpm(base.bpm); }, [base]);
  useEffect(() => { logger.info('piano.producer.mounted', {}); return () => logger.info('piano.producer.unmounted', {}); }, [logger]);

  const anySolo = useMemo(() => Object.values(soloed).some(Boolean), [soloed]);
  const transportLayers = useMemo(
    () => layers.filter((l) => l.notes).map((l) => {
      const effectiveMuted = !!muted[l.id] || (anySolo && !soloed[l.id]);
      return { notes: l.notes.notes, ppq: l.notes.ppq, barSpan: l.entry.barSpan, transpose: keyShift, muted: effectiveMuted };
    }),
    [layers, keyShift, muted, soloed, anySolo],
  );
  const transport = useLoopTransport({ layers: transportLayers, bpm, pressNote, releaseNote });
  const previewTransport = useLoopTransport({ layers: previewLayers, bpm, pressNote, releaseNote });
  useKeepScreenAwake('producer', transport.isPlaying);

  const pickBase = useCallback(async (entry) => {
    const notes = await lib.loadNotes(entry);
    setBase(entry);
    setLayers([{ id: entry.path, entry, notes }]);
    setMuted({});
    setSoloed({});
    setBrowsing(false);
    logger.info('piano.producer.base', { slug: entry.slug, role: roleOf(entry) });
  }, [lib, logger]);

  const addLayer = useCallback(async (entry) => {
    if (layers.some((l) => l.id === entry.path)) return;
    const notes = await lib.loadNotes(entry);
    setLayers((ls) => [...ls, { id: entry.path, entry, notes }]);
    logger.info('piano.producer.layer-add', { slug: entry.slug, role: roleOf(entry) });
  }, [layers, lib, logger]);

  const onPickFromBrowse = useCallback(async (entry) => {
    if (base) { await addLayer(entry); setBrowsing(false); }
    else await pickBase(entry);
  }, [base, addLayer, pickBase]);

  const peek = useCallback(async (entry) => {
    const notes = await lib.loadNotes(entry);
    if (!notes) return;
    const stack = [];
    const baseNotes = layers[0]?.notes;
    if (base && baseNotes) stack.push({ notes: baseNotes.notes, ppq: baseNotes.ppq, barSpan: base.barSpan, transpose: keyShift });
    stack.push({ notes: notes.notes, ppq: notes.ppq, barSpan: entry.barSpan, transpose: keyShift });
    setPreviewLayers(stack);
    logger.info('piano.producer.peek', { slug: entry.slug });
  }, [lib, layers, base, keyShift, logger]);

  // Start/stop the preview transport when previewLayers change
  useEffect(() => {
    if (previewLayers.length) previewTransport.play();
    return () => previewTransport.stop();
  }, [previewLayers]); // eslint-disable-line react-hooks/exhaustive-deps

  // rAF-driven playhead: reads positionRef (no React state per-frame) and updates
  // the CSS width directly so the playhead sweeps without render-storm risk.
  // Simultaneously snapshots loopNotesRef into state at rAF cadence (one state
  // update per frame, not per-note) and derives the active roman chord index.
  const [loopNotes, setLoopNotes] = useState(null);
  useEffect(() => {
    let raf;
    const paint = () => {
      const p = transport.positionRef?.current ?? 0;
      if (playheadRef.current) playheadRef.current.style.width = `${p * 100}%`;
      setActiveChord(base?.roman?.length ? Math.floor(p * base.roman.length) : -1);
      if (transport.loopNotesRef?.current) {
        setLoopNotes(new Set(transport.loopNotesRef.current));
      }
      raf = requestAnimationFrame(paint);
    };
    if (transport.isPlaying) raf = requestAnimationFrame(paint);
    else {
      if (playheadRef.current) playheadRef.current.style.width = '0%';
      setActiveChord(-1);
      setLoopNotes(null);
    }
    return () => cancelAnimationFrame(raf);
  }, [transport.isPlaying, base]); // eslint-disable-line react-hooks/exhaustive-deps

  const removeLayer = useCallback((id) => {
    setLayers((ls) => {
      const next = ls.filter((l) => l.id !== id);
      setBase(next[0]?.entry ?? null);
      return next;
    });
    setMuted((m) => { const { [id]: _drop, ...rest } = m; return rest; });
    setSoloed((s) => { const { [id]: _drop, ...rest } = s; return rest; });
  }, []);

  // Detect key from base layer notes
  const detectedKey = useMemo(() => {
    if (!base || !layers[0]?.notes) return 'C';
    const pcs = layers[0].notes.notes.map((n) => n.midi % 12);
    return detectKey(pcs);
  }, [base, layers]);

  // Left-hand roman chord readout: detect from notes below the split.
  // detectChords returns string[] (tonal Chord.detect); bestTonic + romanAnalysis
  // accept string[] directly. Guard on showRoman and enough notes to form a chord.
  const handLabel = useMemo(() => {
    if (!showRoman) return null;
    const left = [...activeNotes.keys()].filter((n) => n < splitNote);
    if (left.length < 2) return null;
    try {
      const detected = detectChords(left);
      if (!detected?.length) return null;
      const tonic = bestTonic(detected);
      return romanAnalysis(detected, tonic)[0] || null;
    } catch {
      return null;
    }
  }, [showRoman, activeNotes, splitNote]);

  const candidates = useMemo(
    () => (base
      ? lib.rankFor(base, { ...(role ? { role } : {}), onlyStackable: true })
          .filter((r) => !layers.some((l) => l.id === r.entry.path)).slice(0, 30)
      : []),
    [base, lib, role, layers],
  );
  const browse = useMemo(() => lib.query({ role, text }).slice(0, 60), [lib, role, text]);

  return (
    <section className="piano-mode piano-producer-mode">
      {lib.loading && <PianoEmpty loading />}
      {lib.error && <PianoEmpty message={`Couldn't load the loop library: ${lib.error}`} />}

      {lib.loops && (
        <div className="piano-producer-mode__body">
          <header className="piano-producer-mode__deck">
            <div className="piano-producer-mode__controls">
            <button
              type="button"
              className={`piano-producer-mode__play${transport.isPlaying ? ' is-on' : ''}`}
              onClick={transport.toggle}
              disabled={!layers.length}
            >
              {transport.isPlaying ? '◼ Stop' : '▶ Play'}
            </button>
            <div className="piano-producer-mode__meta">
              <span className="piano-producer-mode__tempo">
                <button type="button" aria-label="tempo down" onClick={() => setBpm((b) => Math.max(40, b - 4))}>−</button>
                <span aria-label="tempo">{bpm} BPM</span>
                <button type="button" aria-label="tempo up" onClick={() => setBpm((b) => Math.min(220, b + 4))}>+</button>
              </span>
              <span className="piano-producer-mode__key">
                <button type="button" onClick={() => setKeyShift((k) => k - 1)} aria-label="key down">−</button>
                Key {detectedKey}
                <button type="button" onClick={() => setKeyShift((k) => k + 1)} aria-label="key up">+</button>
              </span>
            </div>
            </div>
            {base?.roman?.length ? (
              <div className="piano-producer-mode__roman-row">
                <RomanProgression roman={base.roman} activeIndex={activeChord} />
              </div>
            ) : null}
            <div className="piano-producer-mode__playhead">
              <div ref={playheadRef} className="piano-producer-mode__playhead-fill" />
            </div>
          </header>

          {/* Role filter chips (shared by browse + suggestions). */}
          <div className="piano-producer-mode__roles">
            {ROLES.map((r) => (
              <button
                key={r.label}
                type="button"
                className={`piano-chip${role === r.key ? ' is-on' : ''}`}
                onClick={() => setRole(r.key)}
              >{r.label}</button>
            ))}
            <button
              type="button"
              className={`piano-chip${showRoman ? ' is-on' : ''}`}
              aria-label="roman"
              aria-pressed={showRoman}
              onClick={() => setShowRoman((v) => !v)}
            >Roman</button>
          </div>

          {(!base || browsing) && (
            <div className="piano-producer-mode__browse">
              {!base && (
                <p className="piano-producer-mode__hint">Pick a base loop, then stack layers that fit.</p>
              )}
              <input
                className="piano-producer-mode__search"
                placeholder="Search loops (chords, mood, artist…)"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <ul className="piano-producer-mode__list">
                {browse.map((e) => (
                  <li key={e.path}>
                    <button type="button" className="piano-loop" onClick={() => onPickFromBrowse(e)}>
                      <span className="piano-loop__name">{e.title || e.slug}</span>
                      {e.roman?.length
                        ? <RomanProgression roman={e.roman} inline />
                        : <span className="piano-loop__staff"><MelodicStaffThumb entry={e} lib={lib} /></span>}
                      {e.mood && <span className="piano-loop__tag">{e.mood}</span>}
                    </button>
                    <button type="button" className="piano-loop__peek" aria-label={`preview ${e.title || e.slug}`}
                      onClick={(ev) => { ev.stopPropagation(); peek(e); }}>▶</button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {base && (
            <div className="piano-producer-mode__stack">
              <div className="piano-producer-mode__stack-header">
                <button type="button" className="piano-chip" onClick={() => setBrowsing((b) => !b)}>
                  {browsing ? 'Close library' : 'Browse library'}
                </button>
              </div>
              <div className="piano-producer-mode__layers">
                {layers.map((l, i) => (
                  <div key={l.id} className={`piano-layer${i === 0 ? ' is-base' : ''}${muted[l.id] ? ' is-muted' : ''}`}>
                    <button type="button" className={`piano-layer__m${muted[l.id] ? ' is-on' : ''}`} aria-pressed={!!muted[l.id]} aria-label="mute" onClick={() => setMuted((m) => ({ ...m, [l.id]: !m[l.id] }))}>M</button>
                    <button type="button" className={`piano-layer__s${soloed[l.id] ? ' is-on' : ''}`} aria-pressed={!!soloed[l.id]} aria-label="solo" onClick={() => setSoloed((s) => ({ ...s, [l.id]: !s[l.id] }))}>S</button>
                    <span className="piano-layer__role">{roleOf(l.entry)}</span>
                    <span className="piano-layer__name">{l.entry.title || l.entry.slug}</span>
                    {l.entry.roman?.length ? <RomanProgression roman={l.entry.roman} inline /> : null}
                    <button type="button" className="piano-layer__remove" onClick={() => removeLayer(l.id)}>✕</button>
                  </div>
                ))}
              </div>

              <h3 className="piano-producer-mode__h">Add a layer{role ? ` · ${role}` : ''}</h3>
              <ul className="piano-producer-mode__list">
                {candidates.map((c) => (
                  <li key={c.entry.path}>
                    <button type="button" className="piano-loop" onClick={() => addLayer(c.entry)}>
                      <span className="piano-loop__name">{c.entry.title || c.entry.slug}</span>
                      {c.entry.roman?.length ? <RomanProgression roman={c.entry.roman} inline /> : null}
                      {c.reasons.slice(0, 2).map((r) => <span key={r} className="piano-loop__why">{r}</span>)}
                    </button>
                    <button type="button" className="piano-loop__peek" aria-label={`preview ${c.entry.title || c.entry.slug}`}
                      onClick={(ev) => { ev.stopPropagation(); peek(c.entry); }}>▶</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="piano-producer-mode__keys">
        <PianoKeyboard
          activeNotes={activeNotes}
          loopNotes={loopNotes}
          startNote={kb.startNote}
          endNote={kb.endNote}
          splitNote={showRoman ? splitNote : null}
          handChordLabel={handLabel}
          onNoteOn={pressNote}
          onNoteOff={releaseNote}
        />
      </div>
    </section>
  );
}

export default Producer;
