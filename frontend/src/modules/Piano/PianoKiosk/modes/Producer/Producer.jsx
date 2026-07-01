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
import './Producer.scss';

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
  const [keyShift, setKeyShift] = useState(0);
  const [role, setRole] = useState(null);
  const [text, setText] = useState('');
  const [bpm, setBpm] = useState(100);

  // Seed tempo from base when it changes
  useEffect(() => { if (base?.bpm) setBpm(base.bpm); }, [base]);
  useEffect(() => { logger.info('piano.producer.mounted', {}); return () => logger.info('piano.producer.unmounted', {}); }, [logger]);

  const transportLayers = useMemo(
    () => layers.filter((l) => l.notes).map((l) => ({
      notes: l.notes.notes, ppq: l.notes.ppq, barSpan: l.entry.barSpan,
      transpose: keyShift, muted: !!muted[l.id],
    })),
    [layers, keyShift, muted],
  );
  const transport = useLoopTransport({ layers: transportLayers, bpm, pressNote, releaseNote });
  useKeepScreenAwake('producer', transport.isPlaying);

  const pickBase = useCallback(async (entry) => {
    const notes = await lib.loadNotes(entry);
    setBase(entry);
    setLayers([{ id: entry.path, entry, notes }]);
    setMuted({});
    logger.info('piano.producer.base', { slug: entry.slug, role: roleOf(entry) });
  }, [lib, logger]);

  const addLayer = useCallback(async (entry) => {
    if (layers.some((l) => l.id === entry.path)) return;
    const notes = await lib.loadNotes(entry);
    setLayers((ls) => [...ls, { id: entry.path, entry, notes }]);
    logger.info('piano.producer.layer-add', { slug: entry.slug, role: roleOf(entry) });
  }, [layers, lib, logger]);

  const removeLayer = useCallback((id) => {
    setLayers((ls) => (ls[0]?.id === id ? [] : ls.filter((l) => l.id !== id)));
    if (layers[0]?.id === id) setBase(null);
  }, [layers]);

  // Detect key from base layer notes
  const detectedKey = useMemo(() => {
    if (!base || !layers[0]?.notes) return 'C';
    const pcs = layers[0].notes.notes.map((n) => n.midi % 12);
    return detectKey(pcs);
  }, [base, layers]);

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
          </div>

          {!base && (
            <div className="piano-producer-mode__browse">
              <input
                className="piano-producer-mode__search"
                placeholder="Search loops (chords, mood, artist…)"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <ul className="piano-producer-mode__list">
                {browse.map((e) => (
                  <li key={e.path}>
                    <button type="button" className="piano-loop" onClick={() => pickBase(e)}>
                      <span className="piano-loop__name">{e.title || e.slug}</span>
                      {e.roman?.length ? <RomanProgression roman={e.roman} inline /> : null}
                      {e.mood && <span className="piano-loop__tag">{e.mood}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {base && (
            <div className="piano-producer-mode__stack">
              <div className="piano-producer-mode__layers">
                {layers.map((l, i) => (
                  <div key={l.id} className={`piano-layer${i === 0 ? ' is-base' : ''}${muted[l.id] ? ' is-muted' : ''}`}>
                    <button type="button" className="piano-layer__mute" onClick={() => setMuted((m) => ({ ...m, [l.id]: !m[l.id] }))}>
                      {muted[l.id] ? '🔇' : '🔊'}
                    </button>
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
          startNote={kb.startNote}
          endNote={kb.endNote}
          onNoteOn={pressNote}
          onNoteOff={releaseNote}
        />
      </div>
    </section>
  );
}

export default Producer;
