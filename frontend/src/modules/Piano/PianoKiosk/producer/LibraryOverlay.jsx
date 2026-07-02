/**
 * LibraryOverlay — INTERIM full-screen library surface for the Producer shell
 * (Task 4.4). Design §7: deep-scroll surfaces go full-bleed — the shell hides
 * the transport bar and keyboard bands while this is open; a compact
 * now-playing pill floats when the jam keeps looping underneath (tap = close).
 *
 * This is a thin port of the OLD Producer's browse/candidates logic so the
 * new shell ships functional: search input, role chips, rankFor onlyStackable
 * candidates when layers exist (else query browse), RomanProgression /
 * MelodicStaffThumb cards, tap = pick. Preview (the old tap-▶) is deliberately
 * DROPPED here — Task 5.2 brings press-to-peek properly.
 *
 * Task 5.1 replaces this component wholesale with the real LibraryBrowser +
 * consonance gate: it is contained so the shell swaps ONE import.
 *
 * Styles live in the shell's Producer.scss (`piano-producer-mode__overlay*`).
 *
 * @param {object} props
 * @param {object} props.lib - useLoopLibrary() surface (query/rankFor/loadNotes)
 * @param {Array} props.layers - workspace layers (rank against the first library layer)
 * @param {string|null} [props.initialRole] - pre-filter ('chords' for "Start from a loop")
 * @param {(entry:object) => void} props.onPick - tap a card → add to the stage
 * @param {() => void} props.onClose
 * @param {boolean} [props.isPlaying] - shows the floating now-playing pill
 * @param {{current:{bar:number,beat:number}}} [props.positionRef]
 * @param {Array<object>} [props.pillMaterials] - materials for the pill's glyph stack
 */
import { useEffect, useMemo, useState } from 'react';
import { SvgStaffRenderer } from '../../../MusicNotation/index.js';
import { RomanProgression } from '../../components/roman/RomanProgression.jsx';
import { MaterialGlyph } from './MaterialGlyph.jsx';

const ROLES = [
  { key: null, label: 'All' },
  { key: 'chords', label: 'Chords' },
  { key: 'melody', label: 'Melody' },
  { key: 'bass', label: 'Bass' },
  { key: 'idea', label: 'Ideas' },
];

/** How often the pill readout syncs from positionRef (≤4Hz — no per-frame state). */
const PILL_READOUT_MS = 250;

/**
 * Lazily loads notes for a melodic entry and renders a staff thumbnail
 * (ported from the old Producer). Bare staff immediately, notes async.
 */
function MelodicStaffThumb({ entry, lib }) {
  const [pitches, setPitches] = useState([]);
  useEffect(() => {
    let cancelled = false;
    lib.loadNotes(entry).then((notes) => {
      if (cancelled || !notes?.notes?.length) return;
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

/** Floating "the jam is still looping" pill: glyph stack + bar:beat, tap = close. */
function NowPlayingPill({ positionRef, pillMaterials, onClose }) {
  const [pos, setPos] = useState({ bar: 0, beat: 0 });
  useEffect(() => {
    const read = () => {
      const p = positionRef?.current;
      if (!p) return;
      setPos((prev) => (prev.bar === p.bar && prev.beat === p.beat ? prev : { bar: p.bar, beat: p.beat }));
    };
    read();
    let raf = 0;
    let last = 0;
    const tick = (t) => {
      if (t - last >= PILL_READOUT_MS) { last = t; read(); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [positionRef]);
  return (
    <button type="button" className="piano-producer-mode__pill" aria-label="now playing" onClick={onClose}>
      <span className="piano-producer-mode__pill-glyphs">
        {(pillMaterials || []).slice(0, 4).map((m, i) => (
          <MaterialGlyph key={i} material={m} size={22} />
        ))}
      </span>
      <span className="piano-producer-mode__pill-pos">
        {Math.max(0, pos.bar) + 1}:{Math.max(0, pos.beat) + 1}
      </span>
    </button>
  );
}

export function LibraryOverlay({
  lib,
  layers,
  initialRole = null,
  onPick,
  onClose,
  isPlaying = false,
  positionRef,
  pillMaterials,
}) {
  const [role, setRole] = useState(initialRole);
  const [text, setText] = useState('');

  // Rank against the first library-sourced layer (the jam's base), like the
  // old Producer ranked against `base`. All-take stacks fall back to browse.
  const baseEntry = useMemo(
    () => layers.find((l) => l.source?.kind === 'library')?.source.entry ?? null,
    [layers],
  );

  const items = useMemo(() => {
    const existing = new Set(layers.map((l) => l.id));
    if (baseEntry) {
      const q = text.trim().toLowerCase();
      return lib.rankFor(baseEntry, { ...(role ? { role } : {}), onlyStackable: true })
        .filter((r) => !existing.has(r.entry.path))
        .filter((r) => !q || `${r.entry.title || ''} ${r.entry.slug || ''}`.toLowerCase().includes(q))
        .slice(0, 30)
        .map((r) => ({ entry: r.entry, reasons: r.reasons || [] }));
    }
    return lib.query({ role, text }).slice(0, 60).map((e) => ({ entry: e, reasons: [] }));
  }, [lib, layers, baseEntry, role, text]);

  return (
    <div className="piano-producer-mode__overlay" role="dialog" aria-label="loop library">
      <div className="piano-producer-mode__overlay-top">
        <input
          className="piano-producer-mode__search"
          placeholder="Search loops (chords, mood, artist…)"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="button" className="piano-producer-mode__overlay-close" aria-label="close library" onClick={onClose}>
          ✕
        </button>
      </div>

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

      <ul className="piano-producer-mode__list">
        {items.map(({ entry, reasons }) => (
          <li key={entry.path}>
            <button type="button" className="piano-loop" aria-label={entry.title || entry.slug} onClick={() => onPick(entry)}>
              {entry.roman?.length
                ? <RomanProgression roman={entry.roman} />
                : (
                  <>
                    <span className="piano-loop__name">{entry.title || entry.slug}</span>
                    {/* Grooves carry drum-map pitches, not notes — a treble
                        staff of them is nonsense. Name-only card. */}
                    {entry.type !== 'groove' && (
                      <span className="piano-loop__staff"><MelodicStaffThumb entry={entry} lib={lib} /></span>
                    )}
                  </>
                )}
              {reasons.slice(0, 2).map((r) => <span key={r} className="piano-loop__why">{r}</span>)}
              {entry.mood && <span className="piano-loop__tag">{entry.mood}</span>}
            </button>
          </li>
        ))}
      </ul>

      {isPlaying && (
        <NowPlayingPill positionRef={positionRef} pillMaterials={pillMaterials} onClose={onClose} />
      )}
    </div>
  );
}

export default LibraryOverlay;
