/**
 * SongView — the structure rail (design §7 Song view, Task 7.2).
 *
 * One slot card per ARRANGEMENT ENTRY (`Verse ×2 · 8 bars`), horizontally
 * scrolling in play order. A section referenced by several entries renders as
 * several slots sharing one identity glyph — edit the section once, every
 * slot follows. Empty sections (template slots) render as dashed "fill me"
 * affordances.
 *
 * IDLE (song not playing): tapping a slot opens its sheet —
 *   - empty slot → fill menu: "Use current jam" (SLOT_FILL; disabled when the
 *     workspace is empty), "Open in Loop to build" (LOAD_STACK empty +
 *     editingSectionId via the shell), "From My Loops" (disabled stub, Task 8.2);
 *   - filled slot → actions: Edit in Loop, repeats ±, bars ±, inline rename,
 *     Clone (CLONE_SECTION + ADD_ENTRY right after this slot), Delete (2-tap
 *     confirm — removes THIS slot; the section itself is deleted only when no
 *     other slot references it, so invisible material never lingers), and
 *     Move ←/→ (MOVE_ENTRY).
 *
 * PLAYING (scene launch): the active slot glows and auto-advances (the shell
 * feeds activeBlockIndex from the transport's onBlock). Tapping a FILLED slot
 * queues a jump to that entry's FIRST block — 'repeat' mode by default,
 * tap-and-hold ≥500 ms for 'bar' mode; the queued target shows a "next →"
 * chip until it lands. Tapping an EMPTY slot still opens the fill menu
 * (filling live is the point — the new material joins at the transport's
 * next input swap).
 *
 * BLOCK-INDEX MATH: compileArrangement lays out ONE BLOCK PER (entry ×
 * repeat) — including zero-length blocks for empty sections — so an entry's
 * first block index is simply the prefix sum of the coerced repeats of all
 * earlier entries (entryStartBlock). Entry 1 behind repeats [2, 3] → block 2.
 *
 * EMPTY STATE (no draft / no sections): the five structure templates as
 * visual cards, plus "Start from your jam" (PROMOTE — disabled until the
 * workspace has layers).
 *
 * Section verbs dispatch straight to the draft reducer (dispatch prop); flows
 * that need workspace state (fill, open, promote, template meta seeding) go
 * through shell callbacks.
 */
import { useEffect, useRef, useState } from 'react';
import getLogger from '../../../../lib/logging/Logger.js';
import { MaterialGlyph, seedFor } from './MaterialGlyph.jsx';
import { STRUCTURE_TEMPLATES } from './structureTemplates.js';
import {
  setRepeats, moveEntry, removeEntry, setSectionLength,
  deleteSection, cloneSection, addEntry, addSection, sectionGlyphSeeds,
} from './draftReducer.js';
import './SongView.scss';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-song-view' });
  return _logger;
}

/** Long-press threshold for 'bar'-mode scene launches. */
const HOLD_MS = 500;
/** Delete confirm window (same feel as ChannelStrip's remove). */
const DELETE_ARM_MS = 3000;

/** Repeat coercion IDENTICAL to arrangementScheduler's (floor, min 1). */
function coerceRepeats(repeats) {
  const n = Math.floor(Number(repeats));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/**
 * First compiled BLOCK index of arrangement entry `entryIdx`: the prefix sum
 * of earlier entries' repeats (compileArrangement emits one block per entry ×
 * repeat, zero-length blocks included, so indices line up 1:1).
 */
export function entryStartBlock(arrangement, entryIdx) {
  let sum = 0;
  for (let i = 0; i < entryIdx; i += 1) sum += coerceRepeats(arrangement[i]?.repeats);
  return sum;
}

/** Inverse: which arrangement entry a compiled block index falls in (−1 when
 * out of range). */
export function entryIndexOfBlock(arrangement, blockIndex) {
  if (!Number.isInteger(blockIndex) || blockIndex < 0) return -1;
  let sum = 0;
  for (let i = 0; i < arrangement.length; i += 1) {
    sum += coerceRepeats(arrangement[i]?.repeats);
    if (blockIndex < sum) return i;
  }
  return -1;
}

/** Mirror of draftReducer's private nextSectionId (max sec-N suffix + 1) so
 * Clone can dispatch ADD_ENTRY for the id CLONE_SECTION is about to mint.
 * Keep in sync — a drift only misplaces the new slot (ADD_ENTRY no-ops on an
 * unknown id), it can't corrupt the draft. */
function nextSectionIdOf(sections) {
  let max = 0;
  for (const s of sections) {
    const m = /^sec-(\d+)$/.exec(s.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `sec-${max + 1}`;
}

/**
 * @param {object} props
 * @param {object|null} props.draft - draftReducer state
 * @param {(action:object) => void} props.dispatch - draft dispatch
 * @param {boolean} props.hasJamLayers - workspace has layers (gates jam-sourced fills)
 * @param {() => void} props.onStartFromJam - PROMOTE via the shell (empty state)
 * @param {(template:object) => void} props.onApplyTemplate
 * @param {(sectionId:string) => void} props.onUseJam - SLOT_FILL via the shell
 * @param {(sectionId:string) => void} props.onOpenSection - LOAD_STACK + Mix tab via the shell
 * @param {boolean} [props.isSongPlaying] - transport is playing THE ARRANGEMENT
 * @param {number} [props.activeBlockIndex] - from the transport's onBlock (−1 idle)
 * @param {number|null} [props.pendingBlockIndex] - queued jump target block
 * @param {(blockIndex:number, mode:'repeat'|'bar') => void} [props.onQueueJump]
 * @param {() => void} [props.onSaveSong] - crystallize + persist (Task 8.2) under a
 *   default timestamped name; absent → the footer keeps the disabled "coming soon" stub
 * @param {() => void} [props.onOpenSongPicker] - open the saved-song picker
 * @param {(sectionId:string) => void} [props.onKeepSection] - keep a section to the Crate
 */
export function SongView({
  draft,
  dispatch,
  hasJamLayers,
  onStartFromJam,
  onApplyTemplate,
  onUseJam,
  onOpenSection,
  isSongPlaying = false,
  activeBlockIndex = -1,
  pendingBlockIndex = null,
  onQueueJump,
  onSaveSong,
  onOpenSongPicker,
  onKeepSection,
}) {
  const [openIdx, setOpenIdx] = useState(null); // arrangement entry whose sheet is open
  const [deleteArmed, setDeleteArmed] = useState(false);
  const disarmTimerRef = useRef(null);
  const holdRef = useRef({ timer: null, fired: false });
  useEffect(() => () => {
    clearTimeout(disarmTimerRef.current);
    clearTimeout(holdRef.current.timer);
  }, []);
  // A fresh sheet always starts disarmed.
  useEffect(() => {
    setDeleteArmed(false);
    clearTimeout(disarmTimerRef.current);
  }, [openIdx]);

  // ── empty state: template picker + jam door ────────────────────────────────
  if (!draft || draft.sections.length === 0) {
    return (
      <div className="piano-song-view piano-song-view--empty">
        <p className="piano-song-view__empty-blurb">
          Sketch a structure to fill, or promote the jam you have going.
        </p>
        <div className="piano-song-view__templates">
          {STRUCTURE_TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              className="piano-song-view__template"
              onClick={() => onApplyTemplate(t)}
            >
              <span className="piano-song-view__template-name">{t.name}</span>
              <span className="piano-song-view__template-shape" aria-hidden="true">
                {t.arrangement.map((e, i) => (
                  <span
                    key={i}
                    className={`piano-song-view__template-slot piano-song-view__template-slot--s${e.section % 4}`}
                    style={{ flexGrow: t.sections[e.section].lengthBars * e.repeats }}
                  >
                    {t.sections[e.section].name.charAt(0)}{e.repeats > 1 ? `×${e.repeats}` : ''}
                  </span>
                ))}
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="piano-song-view__from-jam"
          disabled={!hasJamLayers}
          title={hasJamLayers ? undefined : 'Stack some layers in Mix first'}
          onClick={onStartFromJam}
        >
          Start from your jam
        </button>
        {onOpenSongPicker && (
          <button
            type="button"
            className="piano-song-view__load"
            onClick={onOpenSongPicker}
          >
            Load a saved song
          </button>
        )}
      </div>
    );
  }

  const { sections, arrangement } = draft;
  const sectionsById = new Map(sections.map((s) => [s.id, s]));

  const jumpTo = (entryIdx, mode) => {
    if (onQueueJump) onQueueJump(entryStartBlock(arrangement, entryIdx), mode);
  };

  const handleSlotPointerDown = (entryIdx, filled) => {
    if (!isSongPlaying || !filled) return;
    holdRef.current.fired = false;
    clearTimeout(holdRef.current.timer);
    holdRef.current.timer = setTimeout(() => {
      holdRef.current.fired = true;
      jumpTo(entryIdx, 'bar');
    }, HOLD_MS);
  };

  const handleSlotPointerUp = (entryIdx, filled) => {
    if (!isSongPlaying || !filled) return;
    clearTimeout(holdRef.current.timer);
    if (!holdRef.current.fired) jumpTo(entryIdx, 'repeat');
    holdRef.current.fired = false;
  };

  const handleSlotPointerCancel = () => {
    clearTimeout(holdRef.current.timer);
    holdRef.current.fired = true; // swallow the trailing pointerup/click
  };

  const handleSlotTap = (entryIdx, filled) => {
    // While the song plays, taps on FILLED slots are scene launches (handled
    // in the pointer phase); empty slots still open the fill menu.
    if (isSongPlaying && filled) return;
    setOpenIdx((cur) => (cur === entryIdx ? null : entryIdx));
  };

  const handleClone = (section, entryIdx) => {
    const cloneId = nextSectionIdOf(sections);
    logger().info('piano.producer.section-clone', { sectionId: section.id, cloneId, at: entryIdx + 1 });
    dispatch(cloneSection(section.id));
    dispatch(addEntry(cloneId, entryIdx + 1));
    setOpenIdx(null);
  };

  const handleDelete = (section, entryIdx) => {
    if (!deleteArmed) {
      setDeleteArmed(true);
      clearTimeout(disarmTimerRef.current);
      disarmTimerRef.current = setTimeout(() => setDeleteArmed(false), DELETE_ARM_MS);
      return;
    }
    clearTimeout(disarmTimerRef.current);
    const lastRef = !arrangement.some((e, i) => i !== entryIdx && e.sectionId === section.id);
    logger().info('piano.producer.slot-delete', {
      sectionId: section.id, entryIdx, sectionDeleted: lastRef,
    });
    dispatch(removeEntry(entryIdx));
    // Never orphan invisible material: when this was the section's only slot,
    // the section goes with it (its carried refs are swept by the reducer).
    if (lastRef) dispatch(deleteSection(section.id));
    setOpenIdx(null);
  };

  const handleMove = (entryIdx, delta) => {
    logger().info('piano.producer.entry-move', { from: entryIdx, to: entryIdx + delta });
    dispatch(moveEntry(entryIdx, entryIdx + delta));
    setOpenIdx(entryIdx + delta); // the sheet follows its slot
  };

  const handleRepeats = (entryIdx, entry, delta) => {
    const repeats = coerceRepeats(entry.repeats) + delta;
    logger().info('piano.producer.section-repeats', { index: entryIdx, repeats });
    dispatch(setRepeats(entryIdx, repeats));
  };

  const handleBars = (section, delta) => {
    const lengthBars = section.lengthBars + delta;
    logger().info('piano.producer.section-bars', { sectionId: section.id, lengthBars });
    dispatch(setSectionLength(section.id, lengthBars));
  };

  const openEntry = openIdx != null ? arrangement[openIdx] : null;
  const openSection = openEntry ? sectionsById.get(openEntry.sectionId) : null;
  const openFilled = openSection ? openSection.stack.length > 0 : false;

  return (
    <div className="piano-song-view">
      <div className="piano-song-view__rail" role="list" aria-label="song structure">
        {arrangement.map((entry, idx) => {
          const section = sectionsById.get(entry.sectionId);
          if (!section) return null; // reducer invariants make this unreachable
          const filled = section.stack.length > 0;
          const repeats = coerceRepeats(entry.repeats);
          const start = entryStartBlock(arrangement, idx);
          const isActive = isSongPlaying && activeBlockIndex >= start && activeBlockIndex < start + repeats;
          const isPending = pendingBlockIndex != null
            && pendingBlockIndex >= start && pendingBlockIndex < start + repeats;
          const seeds = filled ? sectionGlyphSeeds(draft, section.id) : [];
          const classes = [
            'piano-song-view__slot',
            filled ? '' : 'piano-song-view__slot--empty',
            isActive ? 'is-active' : '',
            openIdx === idx ? 'is-open' : '',
          ].filter(Boolean).join(' ');
          return (
            <div role="listitem" key={`${entry.sectionId}:${idx}`} className="piano-song-view__slot-wrap">
              {isPending && <span className="piano-song-view__next-chip">next →</span>}
              <button
                type="button"
                className={classes}
                aria-label={`${section.name} slot ${idx + 1}`}
                aria-current={isActive || undefined}
                onPointerDown={() => handleSlotPointerDown(idx, filled)}
                onPointerUp={() => handleSlotPointerUp(idx, filled)}
                onPointerLeave={handleSlotPointerCancel}
                onPointerCancel={handleSlotPointerCancel}
                onClick={() => handleSlotTap(idx, filled)}
              >
                {filled ? (
                  <MaterialGlyph
                    seed={seedFor({ kind: 'section', children: seeds })}
                    size={40}
                    className="piano-song-view__slot-glyph"
                    title={section.name}
                  />
                ) : (
                  <span className="piano-song-view__fill-hint" aria-hidden="true">＋</span>
                )}
                <span className="piano-song-view__slot-name">{section.name}</span>
                <span className="piano-song-view__slot-meta">
                  ×{repeats} · {section.lengthBars} bar{section.lengthBars === 1 ? '' : 's'}
                </span>
                {filled ? (
                  <span className="piano-song-view__slot-stack" aria-hidden="true">
                    {seeds.map((m, i) => (
                      <MaterialGlyph key={i} material={m} size={14} />
                    ))}
                  </span>
                ) : (
                  <span className="piano-song-view__fill-label">fill me</span>
                )}
              </button>
            </div>
          );
        })}
        {/* Not a role=listitem: the add affordance is a control, not one of the
            song's sections — keeps the list == the real arrangement entries. */}
        <div className="piano-song-view__slot-wrap">
          <button
            type="button"
            className="piano-song-view__slot piano-song-view__slot--add"
            aria-label="add a new section"
            onClick={() => { dispatch(addSection()); setOpenIdx(null); }}
          >
            <span className="piano-song-view__fill-hint" aria-hidden="true">＋</span>
            <span className="piano-song-view__slot-name">Add section</span>
            <span className="piano-song-view__fill-label">new part</span>
          </button>
        </div>
      </div>

      {openSection && !openFilled && (
        <div className="piano-song-view__sheet" role="dialog" aria-label={`fill ${openSection.name}`}>
          <span className="piano-song-view__sheet-title">{openSection.name}</span>
          <button
            type="button"
            disabled={!hasJamLayers}
            title={hasJamLayers ? undefined : 'Stack some layers in Mix first'}
            onClick={() => { onUseJam(openSection.id); setOpenIdx(null); }}
          >Use current jam</button>
          <button
            type="button"
            onClick={() => { onOpenSection(openSection.id); setOpenIdx(null); }}
          >Open in Loop to build</button>
          <button type="button" disabled title="My Loops arrives in a later phase">From My Loops</button>
        </div>
      )}

      {openSection && openFilled && (
        <div className="piano-song-view__sheet" role="dialog" aria-label={`${openSection.name} actions`}>
          <span className="piano-song-view__rename">{openSection.name}</span>
          <button
            type="button"
            onClick={() => { onOpenSection(openSection.id); setOpenIdx(null); }}
          >Edit in Loop</button>
          <span className="piano-song-view__stepper">
            <button
              type="button"
              aria-label="repeats down"
              disabled={coerceRepeats(openEntry.repeats) <= 1}
              onClick={() => handleRepeats(openIdx, openEntry, -1)}
            >−</button>
            <span>×{coerceRepeats(openEntry.repeats)}</span>
            <button
              type="button"
              aria-label="repeats up"
              onClick={() => handleRepeats(openIdx, openEntry, 1)}
            >+</button>
          </span>
          <span className="piano-song-view__stepper">
            <button
              type="button"
              aria-label="bars down"
              disabled={openSection.lengthBars <= 1}
              onClick={() => handleBars(openSection, -1)}
            >−</button>
            <span>{openSection.lengthBars} bars</span>
            <button
              type="button"
              aria-label="bars up"
              onClick={() => handleBars(openSection, 1)}
            >+</button>
          </span>
          <button type="button" onClick={() => handleClone(openSection, openIdx)}>Clone</button>
          {onKeepSection && (
            <button
              type="button"
              className="piano-song-view__keep"
              onClick={() => { onKeepSection(openSection.id); setOpenIdx(null); }}
            >Keep to My Loops</button>
          )}
          <button
            type="button"
            className={`piano-song-view__delete${deleteArmed ? ' is-armed' : ''}`}
            onClick={() => handleDelete(openSection, openIdx)}
          >{deleteArmed ? 'Sure?' : 'Delete'}</button>
          <button
            type="button"
            aria-label="move left"
            disabled={openIdx === 0}
            onClick={() => handleMove(openIdx, -1)}
          >←</button>
          <button
            type="button"
            aria-label="move right"
            disabled={openIdx === arrangement.length - 1}
            onClick={() => handleMove(openIdx, 1)}
          >→</button>
        </div>
      )}

      <div className="piano-song-view__footer">
        {onSaveSong ? (
          <>
            <button
              type="button"
              className="piano-song-view__save"
              onClick={() => onSaveSong()}
            >Save song</button>
            {onOpenSongPicker && (
              <button type="button" className="piano-song-view__load" onClick={onOpenSongPicker}>
                Load
              </button>
            )}
          </>
        ) : (
          <button type="button" disabled title="Saving arrives with persistence (Task 8.x)">
            Save song — coming soon
          </button>
        )}
      </div>
    </div>
  );
}

export default SongView;
