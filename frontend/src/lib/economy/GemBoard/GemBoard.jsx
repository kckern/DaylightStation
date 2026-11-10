/**
 * GemBoard — every child against every gem, for one week
 * (`GET /api/v1/earnings/gems`). One shared overlay for the fitness ring
 * chart and the school agenda. Design:
 * ops:docs/superpowers/specs/2026-11-04-achievement-gems-design.md §5.
 *
 * Columns are the children in roster order — never ranked. One table: rows
 * are gem categories under the sections the response names in `groups`
 * (Move, Games, School). A cell is one glyph (GemGlyph.jsx) and carries no
 * numerals but a ×n badge. No failure marks: a gem not earned is a blank
 * cell, a gem still in reach is a faint gem inside a ring of day segments,
 * an unreadable source a muted "?".
 *
 * A cell with something behind it opens a detail box (GemDetail.jsx): which
 * days counted, which milestones were paid, how a contest stands.
 *
 * Input: tap (a cell opens its detail), Escape (closes the detail, then the
 * board), ←/→ (move the highlighted column), ↑/↓ (move a row cursor; past
 * either end it is put away again), Enter (open the cell under the cursor;
 * with no cursor, or nothing to open there, toggle this week / last week). A surface with a gamepad hands its button
 * presses in through `keyRef` (the fitness screen does) — this file reads no
 * gamepad itself. Closes on its own after `idleMs` without input.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import GemIcon from '@/lib/icons/GemIcon.jsx';
import GemGlyph, { glyphLook, glyphWords } from './GemGlyph.jsx';
import GemDetail, { detailParts } from './GemDetail.jsx';
import getLogger from '@/lib/logging/Logger.js';
import './GemBoard.scss';

let _logger;
const logger = () => (_logger ||= getLogger().child({ component: 'gem-board' }));

const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00.000Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Read the board. `fresh` (the default for the overlay: someone just opened
 * it) re-reads the achievements instead of the server's minute-shared copy;
 * a background poll passes `fresh: false`.
 */
export async function fetchGemBoard(week = null, { fresh = true } = {}) {
  const params = { ...(week ? { week } : {}), ...(fresh ? { fresh: '1' } : {}) };
  const qs = Object.keys(params).length ? `?${new URLSearchParams(params)}` : '';
  const res = await fetch(`/api/v1/earnings/gems${qs}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`gems ${res.status}`);
  return res.json();
}

function Avatar({ id, name }) {
  const [failed, setFailed] = useState(false);
  const initials = (name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  if (failed || !id) return <span className="gem-board__avatar gem-board__avatar--fallback">{initials}</span>;
  return <img className="gem-board__avatar" src={`/api/v1/static/img/users/${id}`} alt="" onError={() => setFailed(true)} />;
}

/** A cell opens when its detail box would have something to say, however blank the cell looks. */
const cellOpenable = (cell) => detailParts(cell).length > 0;

/** One child's cell in one gem row. Exported for tests. */
export function GemCell({ cell, color, name, rowLabel, onOpen = null, cursor = false }) {
  const look = glyphLook(cell);
  const label = `${name}, ${rowLabel}: ${glyphWords(cell)}`;
  const glyph = <GemGlyph cell={cell} color={color} />;
  const openable = onOpen && cellOpenable(cell);
  return (
    <div className={`gem-board__cell${cursor ? ' is-cursor' : ''}`} role="cell" data-look={look} data-state={cell?.state ?? 'none'}>
      {openable
        ? <button type="button" className="gem-board__open" aria-label={label} onClick={onOpen}>{glyph}</button>
        : <span className="gem-board__still" role="img" aria-label={label}>{glyph}</span>}
    </div>
  );
}

/** The board's sections in display order, each with its rows; empty sections dropped. */
const boardSections = (board) => (board?.groups ?? [])
  .map((g) => ({ ...g, rows: (board?.categories ?? []).filter((c) => c.group === g.id) }))
  .filter((g) => g.rows.length);

/** Row ids top to bottom, as drawn (for the overlay's up / down keys). */
export const boardRowIds = (board) => boardSections(board).flatMap((g) => g.rows.map((c) => c.id));

/**
 * The board itself, from a `/earnings/gems` response. Pure display: no fetch.
 * @param {object} props
 * @param {object} props.board
 * @param {string|null} [props.focusLearnerId] - the highlighted column
 * @param {string|null} [props.cursorRowId] - with the focus column, the one cell under the cursor
 * @param {((rowId: string, learnerId: string) => void)|null} [props.onOpen] - makes cells with detail into buttons
 */
export function GemBoardGrid({ board, focusLearnerId = null, cursorRowId = null, onOpen = null }) {
  const learners = board?.learners ?? [];
  const sections = useMemo(() => boardSections(board), [board]);
  const columns = `minmax(9rem, 1.7fr) repeat(${Math.max(learners.length, 1)}, minmax(0, 1fr))`;
  const focusClass = (id) => (id === focusLearnerId ? ' is-focus' : '');

  if (!learners.length || !sections.length) {
    return <div className="gem-board__empty">No gems to show yet.</div>;
  }
  return (
    <div className="gem-board__grid" role="table" aria-label="Gems by child" style={{ gridTemplateColumns: columns }}>
      <div className="gem-board__corner" role="columnheader" />
      {learners.map((l) => (
        <div key={l.learnerId} className={`gem-board__head${focusClass(l.learnerId)}`} role="columnheader">
          <Avatar id={l.learnerId} name={l.name} />
          <span className="gem-board__name">{l.name}</span>
        </div>
      ))}
      {sections.map((group) => (
        <div key={group.id} className="gem-board__group" role="rowgroup">
          <div className="gem-board__group-label" role="row"><span role="rowheader">{group.label}</span></div>
          {group.rows.map((row) => (
            <div key={row.id} className="gem-board__row" role="row">
              <div className="gem-board__row-label" role="rowheader"><span>{row.label}</span></div>
              {learners.map((l) => (
                <div key={l.learnerId} className={`gem-board__col${focusClass(l.learnerId)}`} data-row={row.id} data-learner={l.learnerId}>
                  <GemCell
                    cell={board.cells?.[row.id]?.[l.learnerId]}
                    color={row.color}
                    name={l.name}
                    rowLabel={row.label}
                    onOpen={onOpen ? () => onOpen(row.id, l.learnerId) : null}
                    cursor={row.id === cursorRowId && l.learnerId === focusLearnerId}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
      <div className="gem-board__row gem-board__row--totals" role="row">
        <div className="gem-board__row-label" role="rowheader"><span>Gems</span></div>
        {learners.map((l) => {
          const t = board.totals?.[l.learnerId] ?? { week: 0, lifetime: 0 };
          return (
            <div key={l.learnerId} className={`gem-board__col${focusClass(l.learnerId)}`}>
              <div className="gem-board__total" role="cell" aria-label={`${l.name}: ${t.week} this week, ${t.lifetime} in all`}>
                <span className="gem-board__total-week">{t.week}</span>
                <span className="gem-board__total-life">{t.lifetime} in all</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The overlay: fetches the board, steps between this week and last, closes on
 * Escape / backdrop / the close button / idle.
 * @param {object} props
 * @param {boolean} props.open
 * @param {(reason: string) => void} props.onClose
 * @param {string} props.surface - 'fitness' | 'school' (for logs and styling)
 * @param {string|null} [props.focusLearnerId]
 * @param {{current: ((key: string) => void)|null}} [props.keyRef] - a surface's extra input (gamepad)
 * @param {(week: string|null) => Promise<object>} [props.load] - injectable fetch (tests)
 * @param {number} [props.idleMs]
 */
export default function GemBoardOverlay({
  open, onClose, surface, focusLearnerId = null, keyRef = null, load = fetchGemBoard, idleMs = 90_000,
}) {
  const [weekOffset, setWeekOffset] = useState(0); // 0 this week, -1 last week
  const [state, setState] = useState({ board: null, error: null, loading: false });
  const [focus, setFocus] = useState(focusLearnerId);
  const [rowCursor, setRowCursor] = useState(null); // the row under ↑/↓; with `focus`, one cell
  const [picked, setPicked] = useState(null); // {rowId, learnerId} of the open detail
  const openedAt = useRef(0);
  const thisWeek = useRef(null); // the current week's Monday, once the first read lands
  const idle = useRef(null);
  const panelRef = useRef(null);
  const wasPicked = useRef(null);

  const close = useCallback((reason) => {
    logger().info('gem-board.close', { surface, reason, dwellMs: Date.now() - openedAt.current });
    onClose?.(reason);
  }, [onClose, surface]);

  const poke = useCallback(() => {
    if (idle.current) clearTimeout(idle.current);
    if (idleMs > 0) idle.current = setTimeout(() => close('timeout'), idleMs);
  }, [close, idleMs]);

  // Opening: reset to this week, log, arm the idle timer. Closing: drop the
  // board, the detail and the cursor, so a reopen starts from nothing.
  useEffect(() => {
    if (!open) {
      setPicked(null);
      setRowCursor(null);
      setWeekOffset(0);
      setState({ board: null, error: null, loading: false });
      thisWeek.current = null;
      wasPicked.current = null;
      return undefined;
    }
    openedAt.current = Date.now();
    setWeekOffset(0);
    setFocus(focusLearnerId);
    setRowCursor(null);
    setPicked(null);
    logger().info('gem-board.open', { surface, focusLearnerId });
    poke();
    return () => { if (idle.current) clearTimeout(idle.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Load the wanted week. Last week is asked for by a study day inside it.
  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    const week = weekOffset === 0 || !thisWeek.current ? null : addDays(thisWeek.current, 7 * weekOffset);
    setState((s) => ({ ...s, loading: true, error: null }));
    load(week)
      .then((board) => {
        if (!live) return;
        if (weekOffset === 0 && board?.week) thisWeek.current = board.week;
        setState({ board, error: null, loading: false });
      })
      .catch((err) => {
        if (!live) return;
        logger().warn('gem-board.load-failed', { surface, week, error: err?.message ?? String(err) });
        setState((s) => ({ ...s, error: err, loading: false }));
      });
    return () => { live = false; };
  }, [open, weekOffset, load, surface]);

  // The open detail, when its row, child and cell are all on the board in hand.
  const detail = useMemo(() => {
    const board = state.board;
    if (!picked || !board || board.mode === 'off') return null;
    const row = (board.categories ?? []).find((c) => c.id === picked.rowId);
    const learner = (board.learners ?? []).find((l) => l.learnerId === picked.learnerId);
    const cell = board.cells?.[picked.rowId]?.[picked.learnerId];
    return row && learner && cell ? { row, learner, cell } : null;
  }, [picked, state.board]);

  const openDetail = useCallback((rowId, learnerId, via) => {
    poke();
    setPicked({ rowId, learnerId });
    logger().info('gem-board.detail-open', { surface, rowId, learnerId, via });
  }, [poke, surface]);

  const closeDetail = useCallback((reason) => {
    poke();
    if (picked) logger().debug('gem-board.detail-close', { surface, rowId: picked.rowId, learnerId: picked.learnerId, reason });
    setPicked(null);
  }, [picked, poke, surface]);

  // Focus goes back to the cell a detail was opened from, once the grid can take it again.
  useEffect(() => {
    const from = wasPicked.current;
    wasPicked.current = picked;
    if (picked || !from) return;
    const col = [...(panelRef.current?.querySelectorAll('.gem-board__col') ?? [])]
      .find((el) => el.dataset.row === from.rowId && el.dataset.learner === from.learnerId);
    col?.querySelector('.gem-board__open')?.focus();
  }, [picked]);

  const step = useCallback((offset) => {
    poke();
    // Last week is asked for by this week's Monday: not before the first read has landed.
    if (offset !== 0 && !thisWeek.current) return;
    if (picked) closeDetail('week');
    setRowCursor(null);
    setWeekOffset(offset);
    logger().debug('gem-board.week-step', { surface, offset });
  }, [closeDetail, picked, poke, surface]);

  const handleKey = useCallback((key) => {
    poke();
    const board = state.board;
    const ids = (board?.learners ?? []).map((l) => l.learnerId);
    if (detail) {
      // The detail is on top: Escape and Enter close it, arrows are swallowed.
      if (key === 'Escape') { closeDetail('back'); return true; }
      if (key === 'Enter') { closeDetail('key'); return true; }
      return key.startsWith('Arrow');
    }
    if (key === 'Escape') { close('back'); return true; }
    if (key === 'Enter') {
      if (rowCursor && focus && cellOpenable(board?.cells?.[rowCursor]?.[focus])) openDetail(rowCursor, focus, 'key');
      else step(weekOffset === 0 ? -1 : 0);
      return true;
    }
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      const rows = board && board.mode !== 'off' ? boardRowIds(board) : [];
      if (!rows.length) return false;
      setRowCursor((cur) => {
        const at = rows.indexOf(cur);
        if (at < 0) return key === 'ArrowUp' ? rows[rows.length - 1] : rows[0];
        // Past either end the cursor is put away, so Enter is the week switch again.
        return rows[key === 'ArrowUp' ? at - 1 : at + 1] ?? null;
      });
      // A cursor needs a column: with none highlighted yet, take the first child.
      if (ids.length) setFocus((cur) => (ids.includes(cur) ? cur : ids[0]));
      return true;
    }
    if ((key === 'ArrowLeft' || key === 'ArrowRight') && ids.length) {
      setFocus((cur) => {
        const at = ids.indexOf(cur);
        const next = key === 'ArrowLeft' ? (at <= 0 ? ids.length - 1 : at - 1) : (at < 0 || at >= ids.length - 1 ? 0 : at + 1);
        return ids[next];
      });
      return true;
    }
    return false;
  }, [close, closeDetail, detail, focus, openDetail, poke, rowCursor, state.board, step, weekOffset]);

  useEffect(() => {
    if (!keyRef) return undefined;
    keyRef.current = open ? handleKey : null;
    return () => { keyRef.current = null; };
  }, [keyRef, open, handleKey]);

  useEffect(() => {
    if (!open) return undefined;
    // Capture phase, and swallowed: the board is on top, so its keys are its own.
    const onKey = (e) => { if (handleKey(e.key)) { e.preventDefault(); e.stopPropagation(); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, handleKey]);

  if (!open) return null;
  const { board, error, loading } = state;
  const body = (
    <div className={`gem-board gem-board--${surface}`} role="dialog" aria-modal="true" aria-label="Gem board" onPointerDown={poke}>
      <div className="gem-board__backdrop" onClick={() => close('tap')} />
      <div className="gem-board__panel" ref={panelRef}>
        <div className="gem-board__header">
          <GemIcon size="1.4em" />
          <span className="gem-board__title">Gems</span>
          <div className="gem-board__weeks" role="group" aria-label="Week">
            <button type="button" className={`gem-board__week${weekOffset === -1 ? ' is-on' : ''}`} disabled={!thisWeek.current} onClick={() => step(-1)}>Last week</button>
            <button type="button" className={`gem-board__week${weekOffset === 0 ? ' is-on' : ''}`} onClick={() => step(0)}>This week</button>
          </div>
          <button type="button" className="gem-board__close" aria-label="Close" onClick={() => close('tap')}>×</button>
        </div>
        {error && !board && <div className="gem-board__empty">Can’t load the gems right now.</div>}
        {!board && !error && <div className="gem-board__empty">Loading…</div>}
        {board && board.mode === 'off' && <div className="gem-board__empty">Gems are switched off.</div>}
        {board && board.mode !== 'off' && (
          <div className={`gem-board__body${loading ? ' is-loading' : ''}`} inert={detail ? '' : undefined}>
            <GemBoardGrid board={board} focusLearnerId={focus} cursorRowId={rowCursor} onOpen={(rowId, learnerId) => openDetail(rowId, learnerId, 'tap')} />
          </div>
        )}
        {detail && (
          <GemDetail row={detail.row} learner={detail.learner} cell={detail.cell} windows={board?.windows} today={board?.today} onClose={closeDetail} />
        )}
      </div>
    </div>
  );
  return typeof document === 'undefined' ? body : createPortal(body, document.body);
}
