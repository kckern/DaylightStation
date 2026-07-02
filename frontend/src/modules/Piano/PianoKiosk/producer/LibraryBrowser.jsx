/**
 * LibraryBrowser — the real full-screen library surface with consonance
 * guardrails (Task 5.1, design §4/§4b/§7). Replaces the interim LibraryOverlay
 * at the exact same seam: Producer imports ONE component with the same props.
 *
 * Behavior map:
 * - Pinned top bar: search + facet chips — store (Library / Ours / Prefabs),
 *   kind (All/Chords/Melody/Bass/Ideas/Grooves), mood (top 8 + overflow),
 *   feel (groove kind only). 'Ours' and 'Prefabs' are STUB facets rendering
 *   honest empty states (Tasks 8.2 / 9.1 fill them).
 * - Guardrails: when the browse is anchored to a base with a harmonic
 *   timeline, the grid shows buildCompatibleSet's guardrailed results
 *   ("Showing what fits your jam · N"). "Show all" lifts the gate for honest
 *   browsing — non-stackable cards get a small ⚠ but adding them is ALLOWED
 *   (guardrails are defaults, not prisons; design §4b).
 * - "Goes with →" pivot: any card can re-anchor the browse with ITSELF as the
 *   base (pivotEntry overrides the workspace base); a breadcrumb chip shows
 *   the pivot with ✕ to return. Works with or without a workspace base.
 * - Cards: MaterialGlyph + kind identity — RomanProgression (harmonic), staff
 *   thumb (melodic), feel/bpm chips (grooves — they carry NO timeline, so no
 *   fake onset rows). Title only when a REAL title exists; the glyph+roman IS
 *   the identity (requirements §3.1). For melodic/groove material without a
 *   title the slug appears only as a subdued debug caption, never as a name.
 * - Tap card = onPick(entry). Press-AND-HOLD (150ms arm) = peek audition
 *   (design §7): the entry sounds over the jam if it's playing, solo +
 *   metronome if not, conformed to the current key/tempo (usePeek). Release
 *   silences it and NEVER adds — a peek is a listen, adding takes a fresh
 *   tap. Scroll safety mirrors GainStrip (touch-action pan-y + >12px drift
 *   cancels the arm), but the commit points differ: peek starts on the HOLD
 *   TIMER, tap commits on pointer-up.
 * - Perf: the compatible set is built on open + base/pivot change (memo),
 *   NEVER per keystroke — search/facets filter the already-built set. Render
 *   is capped at 120 cards with a "refine to see more" footer instead of
 *   virtualization (simple + honest at ~3.2k entries).
 *
 * Styles live in the shell's Producer.scss (`piano-producer-mode__overlay*`,
 * `piano-loop*`).
 *
 * @param {object} props
 * @param {object} props.lib - useLoopLibrary() surface (loops/facets/loadNotes)
 * @param {Array} props.layers - workspace layers (first library layer anchors the gate)
 * @param {string|null} [props.initialRole] - pre-filter ('chords' for "Start from a loop")
 * @param {(entry:object) => void} props.onPick - tap a card → add to the stage
 * @param {() => void} props.onClose
 * @param {boolean} [props.isPlaying] - shows the floating now-playing pill
 * @param {{current:{bar:number,beat:number}}} [props.positionRef]
 * @param {Array<object>} [props.pillMaterials] - materials for the pill's glyph stack
 * @param {object} [props.router] - voiceRouter for the press-and-hold peek (no router → taps only)
 * @param {number} [props.bpm] - workspace tempo the peek conforms to
 * @param {number} [props.keyShift] - workspace keyShift the peek conforms to
 * @param {() => void} [props.onAudioGesture] - audio unlock, called on card
 *   pointer-down (the hold TIMER callback is not a browser gesture context)
 */
import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import getLogger from '../../../../lib/logging/Logger.js';
import { SvgStaffRenderer } from '../../../MusicNotation/index.js';
import { roleOf } from '@shared-music/layerMatch.mjs';
import { RomanProgression } from '../../components/roman/RomanProgression.jsx';
import { MaterialGlyph } from './MaterialGlyph.jsx';
import { buildCompatibleSet, rankCompatible, timelineOf, entryIdentity } from './libraryRanking.js';
import { usePeek } from './usePeek.js';

const STORES = [
  { key: 'curated', label: 'Library' },
  { key: 'ours', label: 'Ours' },
  { key: 'prefabs', label: 'Prefabs' },
];

const KINDS = [
  { key: null, label: 'All' },
  { key: 'chords', label: 'Chords' },
  { key: 'melody', label: 'Melody' },
  { key: 'bass', label: 'Bass' },
  { key: 'idea', label: 'Ideas' },
  { key: 'groove', label: 'Grooves' },
];

/** Render cap — refine (search/facets) to see more; no virtualization. */
const CARD_CAP = 120;
/** Mood chips shown before the overflow toggle. */
const MOOD_TOP = 8;
/** How often the pill readout syncs from positionRef (≤4Hz — no per-frame state). */
const PILL_READOUT_MS = 250;
/** Press-and-hold arm delay: shorter reads as a laggy tap, longer feels dead. */
const HOLD_MS = 150;
/** Drift beyond this during the arm window = the gesture is a scroll (GainStrip's rule). */
const MOVE_CANCEL_PX = 12;

/**
 * Lazily loads notes for a melodic entry and renders a staff thumbnail
 * (moved from the interim LibraryOverlay). Bare staff immediately, notes async.
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

/**
 * One library card: glyph-forward identity + kind display + pivot affordance.
 * The pivot is a SIBLING button (nested buttons are invalid HTML).
 *
 * Pointer choreography (Task 5.2 press-to-peek):
 * - pointer-down arms a HOLD_MS timer (and captures the pointer);
 * - >MOVE_CANCEL_PX drift before it fires = scroll → cancel, neither tap nor peek;
 * - up before it fires = TAP → onPick (commit on up, GainStrip's scroll-safe rule);
 * - timer fires = PEEK starts (onPeekStart; the card pulses via is-peeking);
 * - up/cancel/leave after that = onPeekStop, and the pick is SUPPRESSED — a
 *   hold was a listen, not an add; adding takes a fresh tap (design §7).
 * - onClick handles ONLY keyboard activation (detail === 0): the pointer flow
 *   owns taps, and the guard swallows the browser's post-tap ghost click.
 */
function LoopCard({ result, warn, lib, onPick, onPivot, isPeeking, onPeekStart, onPeekStop, onAudioGesture }) {
  const { entry, reasons = [] } = result;
  const isGroove = entry.type === 'groove';
  const hasRoman = !!entry.roman?.length;
  const label = entry.title || entry.slug; // accessible name only — never rendered as a title

  const holdRef = useRef(null); // { pointerId, x, y, timer, peeking } | null

  const clearHold = () => {
    if (holdRef.current) clearTimeout(holdRef.current.timer);
    holdRef.current = null;
  };

  // A card unmounting mid-gesture (grid re-filter) must not leak its timer or
  // leave a peek sounding with no releasing pointer handler left to stop it.
  useEffect(() => () => {
    const hold = holdRef.current;
    holdRef.current = null;
    if (!hold) return;
    clearTimeout(hold.timer);
    if (hold.peeking) onPeekStop(entry);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePointerDown = (e) => {
    if (holdRef.current) return; // one gesture per card at a time
    if (typeof e.preventDefault === 'function') {
      e.preventDefault(); // interaction isolation (GainStrip's pattern)
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* jsdom / old WebView */ }
    }
    onAudioGesture?.(); // unlock audio HERE — the hold timer is not a gesture context
    const hold = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, peeking: false, timer: 0 };
    hold.timer = setTimeout(() => {
      hold.peeking = true;
      onPeekStart(entry);
    }, HOLD_MS);
    holdRef.current = hold;
  };

  const handlePointerMove = (e) => {
    const hold = holdRef.current;
    if (!hold || hold.pointerId !== e.pointerId || hold.peeking) return;
    if (Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > MOVE_CANCEL_PX) clearHold(); // scroll
  };

  const handlePointerUp = (e) => {
    const hold = holdRef.current;
    if (!hold || hold.pointerId !== e.pointerId) return;
    clearHold();
    if (hold.peeking) onPeekStop(entry); // hold-release = silence, NEVER add
    else onPick(result); // quick tap = add
  };

  /** pointercancel (browser claimed the scroll) or pointerleave mid-hold. */
  const handlePointerHalt = () => {
    const hold = holdRef.current;
    if (!hold) return;
    clearHold();
    if (hold.peeking) onPeekStop(entry);
  };

  return (
    <li>
      <button
        type="button"
        className={`piano-loop${isPeeking ? ' is-peeking' : ''}`}
        aria-label={label}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerHalt}
        onPointerLeave={handlePointerHalt}
        onClick={(e) => { if (e.detail === 0 && !holdRef.current) onPick(result); }}
      >
        <span className="piano-loop__head">
          <MaterialGlyph material={entry} size={44} />
          {warn && (
            <span className="piano-loop__warn" role="img" aria-label="may clash" title="May clash with your jam">⚠</span>
          )}
        </span>
        {hasRoman && <RomanProgression roman={entry.roman} />}
        {!hasRoman && !isGroove && (
          <span className="piano-loop__staff"><MelodicStaffThumb entry={entry} lib={lib} /></span>
        )}
        {isGroove && (
          <span className="piano-loop__chips">
            {entry.feel && <span className="piano-loop__chip">{entry.feel}</span>}
            {entry.bpm ? <span className="piano-loop__chip">{entry.bpm} bpm</span> : null}
          </span>
        )}
        {entry.title
          ? <span className="piano-loop__name">{entry.title}</span>
          : (!hasRoman && <span className="piano-loop__caption">{entry.slug}</span>)}
        {reasons.slice(0, 2).map((r) => <span key={r} className="piano-loop__why">{r}</span>)}
        {entry.mood && <span className="piano-loop__tag">{entry.mood}</span>}
      </button>
      <button
        type="button"
        className="piano-loop__pivot"
        aria-label={`goes with ${label}`}
        onClick={() => onPivot(entry)}
      >goes with →</button>
    </li>
  );
}

export function LibraryBrowser({
  lib,
  layers,
  initialRole = null,
  onPick,
  onClose,
  isPlaying = false,
  positionRef,
  pillMaterials,
  router = null,
  bpm,
  keyShift = 0,
  onAudioGesture,
}) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-producer-library' }), []);
  const [store, setStore] = useState('curated');
  const [kind, setKind] = useState(initialRole);
  const [mood, setMood] = useState(null);
  const [feel, setFeel] = useState(null);
  const [text, setText] = useState('');
  const [moodsExpanded, setMoodsExpanded] = useState(false);
  const [pivot, setPivot] = useState(null); // "goes with →" anchor, overrides the workspace base
  const [gateLifted, setGateLifted] = useState(false);

  // Press-and-hold audition engine (Task 5.2). isPlaying doubles as the
  // "jam is looping underneath" signal: peeks ride over the stack when true,
  // solo + metronome when false.
  const { peekingId, startPeek, stopPeek } = usePeek({
    router, lib, bpm, keyShift, isJamPlaying: isPlaying, layers,
  });
  // Identity-scoped stop (multi-touch belt-and-braces): a stale card's
  // release must only stop ITS OWN peek, never a newer one.
  const handlePeekStop = useCallback((entry) => stopPeek(entryIdentity(entry)), [stopPeek]);

  const entries = lib.loops || [];
  const workspaceBase = useMemo(
    () => layers.find((l) => l.source?.kind === 'library')?.source.entry ?? null,
    [layers],
  );
  const base = pivot ?? workspaceBase;
  // The gate only exists when the anchor has a harmonic timeline (groove or
  // unenriched anchors can't gate — buildCompatibleSet passes everything).
  const gateActive = !!timelineOf(base);
  const showAll = gateActive && gateLifted;

  useEffect(() => {
    logger.info('library.open', {
      base: workspaceBase?.slug ?? null,
      gate: gateActive,
      entries: entries.length,
    });
    // Open-context snapshot only — later base/entry changes log via pivot/pick.
  }, [logger]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── compatible set: rebuilt on base/pivot change ONLY, never per keystroke ──
  const compatible = useMemo(() => buildCompatibleSet({ entries, baseEntry: base }), [entries, base]);
  const ranked = useMemo(() => rankCompatible(compatible, base), [compatible, base]);
  const passing = useMemo(
    () => new Map(compatible.map((r) => [entryIdentity(r.entry), r])),
    [compatible],
  );

  // Show-all pool: every entry (minus the anchor), gate verdict kept as a flag
  // so non-stackable cards can carry the ⚠. Ranked the same way.
  const pool = useMemo(() => {
    if (!showAll) return ranked;
    const baseId = entryIdentity(base);
    const rows = entries
      .filter((e) => entryIdentity(e) !== baseId)
      .map((e) => passing.get(entryIdentity(e)) ?? { entry: e, stackable: false, reasons: [] });
    return rankCompatible(rows, base);
  }, [showAll, ranked, entries, passing, base]);

  // ── client-side facet + search filtering of the already-built pool ─────────
  const existingIds = useMemo(() => new Set(layers.map((l) => l.id)), [layers]);
  const filtered = useMemo(() => {
    const q = text.trim().toLowerCase();
    return pool.filter(({ entry }) => {
      if (existingIds.has(entryIdentity(entry))) return false; // layer ids follow the same path||slug rule
      if (kind === 'groove') { if (entry.type !== 'groove') return false; }
      else if (kind && roleOf(entry) !== kind) return false;
      if (mood && (entry.mood || '') !== mood) return false;
      if (feel && (entry.feel || '') !== feel) return false;
      if (q) {
        const hay = [entry.title, entry.slug, entry.mood, entry.artist, entry.descriptor, ...(entry.chords || [])]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [pool, existingIds, kind, mood, feel, text]);

  const visible = filtered.slice(0, CARD_CAP);
  const overflow = filtered.length - visible.length;

  // ── facet chip data ─────────────────────────────────────────────────────────
  const moodChips = useMemo(() => {
    const counts = Object.entries(lib.facets?.moods || {}).sort((a, b) => b[1] - a[1]);
    return { top: counts.slice(0, MOOD_TOP).map(([m]) => m), rest: counts.slice(MOOD_TOP).map(([m]) => m) };
  }, [lib.facets]);
  const feelChips = useMemo(
    () => [...new Set(entries.filter((e) => e.type === 'groove' && e.feel).map((e) => e.feel))],
    [entries],
  );

  useEffect(() => {
    logger.sampled('library.filter', {
      store, kind: kind ?? 'all', mood, feel, textLen: text.length,
    }, { maxPerMinute: 30, aggregate: true });
  }, [store, kind, mood, feel, text, logger]);

  // ── handlers ────────────────────────────────────────────────────────────────
  const handlePick = useCallback((result) => {
    logger.info('library.pick', {
      slug: result.entry.slug,
      stackable: result.stackable,
      ...(result.fit != null ? { fit: Math.round(result.fit * 100) / 100 } : {}),
    });
    onPick(result.entry);
  }, [logger, onPick]);

  const handlePivot = useCallback((entry) => {
    logger.info('library.pivot', { slug: entry.slug });
    setPivot(entry);
    setGateLifted(false);
  }, [logger]);

  const clearPivot = useCallback(() => {
    logger.info('library.pivot-clear', {});
    setPivot(null);
    setGateLifted(false);
  }, [logger]);

  const liftGate = useCallback(() => {
    logger.info('library.gate-lift', { lifted: !gateLifted });
    setGateLifted((v) => !v);
  }, [logger, gateLifted]);

  const clearFilters = useCallback(() => {
    setKind(null); setMood(null); setFeel(null); setText('');
  }, []);

  const pivotLabel = pivot
    ? (pivot.title || (pivot.roman?.length ? pivot.roman.join(' ') : pivot.type))
    : null;

  const storeStub = store === 'ours'
    ? 'Nothing kept yet — record or save something'
    : store === 'prefabs' ? 'Prefabs are coming soon' : null;

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

      <div className="piano-producer-mode__facets">
        <div className="piano-producer-mode__roles" role="group" aria-label="store">
          {STORES.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`piano-chip${store === s.key ? ' is-on' : ''}`}
              onClick={() => setStore(s.key)}
            >{s.label}</button>
          ))}
        </div>
        <div className="piano-producer-mode__roles" role="group" aria-label="kind">
          {KINDS.map((k) => (
            <button
              key={k.label}
              type="button"
              className={`piano-chip${kind === k.key ? ' is-on' : ''}`}
              onClick={() => setKind(k.key)}
            >{k.label}</button>
          ))}
        </div>
        {(moodChips.top.length > 0) && (
          <div className="piano-producer-mode__roles" role="group" aria-label="mood">
            {(moodsExpanded ? [...moodChips.top, ...moodChips.rest] : moodChips.top).map((m) => (
              <button
                key={m}
                type="button"
                className={`piano-chip${mood === m ? ' is-on' : ''}`}
                onClick={() => setMood((cur) => (cur === m ? null : m))}
              >{m}</button>
            ))}
            {moodChips.rest.length > 0 && (
              <button type="button" className="piano-chip" onClick={() => setMoodsExpanded((v) => !v)}>
                {moodsExpanded ? 'Less' : `+${moodChips.rest.length} more`}
              </button>
            )}
          </div>
        )}
        {kind === 'groove' && feelChips.length > 0 && (
          <div className="piano-producer-mode__roles" role="group" aria-label="feel">
            {feelChips.map((f) => (
              <button
                key={f}
                type="button"
                className={`piano-chip${feel === f ? ' is-on' : ''}`}
                onClick={() => setFeel((cur) => (cur === f ? null : f))}
              >{f}</button>
            ))}
          </div>
        )}
      </div>

      {pivot && (
        <div className="piano-producer-mode__crumb">
          <span className="piano-producer-mode__crumb-label">Goes with</span>
          <MaterialGlyph material={pivot} size={26} />
          <span className="piano-producer-mode__crumb-name">{pivotLabel}</span>
          <button type="button" className="piano-producer-mode__crumb-clear" aria-label="clear pivot" onClick={clearPivot}>✕</button>
        </div>
      )}

      {gateActive && !storeStub && (
        <div className="piano-producer-mode__gate">
          <span className="piano-producer-mode__gate-note">
            {gateLifted
              ? 'Showing everything — ⚠ may clash with your jam'
              : `Showing what fits your jam · ${filtered.length} loops`}
          </span>
          <button type="button" className="piano-chip" onClick={liftGate}>
            {gateLifted ? 'Show fits' : 'Show all'}
          </button>
        </div>
      )}

      {storeStub ? (
        <div className="piano-producer-mode__library-empty">
          <p>{storeStub}</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="piano-producer-mode__library-empty">
          <p>No loops match those filters.</p>
          <button type="button" className="piano-chip" onClick={clearFilters}>Clear filters</button>
        </div>
      ) : (
        <>
          <ul className="piano-producer-mode__list">
            {visible.map((result) => (
              <LoopCard
                key={result.entry.path || result.entry.slug}
                result={result}
                warn={showAll && !result.stackable}
                lib={lib}
                onPick={handlePick}
                onPivot={handlePivot}
                isPeeking={peekingId != null && peekingId === entryIdentity(result.entry)}
                onPeekStart={startPeek}
                onPeekStop={handlePeekStop}
                onAudioGesture={onAudioGesture}
              />
            ))}
          </ul>
          {overflow > 0 && (
            <p className="piano-producer-mode__list-footer">
              {overflow} more — refine your search or facets to see them
            </p>
          )}
        </>
      )}

      {isPlaying && (
        <NowPlayingPill positionRef={positionRef} pillMaterials={pillMaterials} onClose={onClose} />
      )}
    </div>
  );
}

export default LibraryBrowser;
