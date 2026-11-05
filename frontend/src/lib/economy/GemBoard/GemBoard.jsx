/**
 * GemBoard — every child against every gem, for one week
 * (`GET /api/v1/earnings/gems`). One shared overlay for the fitness ring
 * chart and the school agenda. Design:
 * ops:docs/superpowers/specs/2026-11-04-achievement-gems-design.md §5.
 *
 * Columns are the children in roster order — never ranked. Rows are gem
 * categories under three quiet headings (this week, contests, milestones).
 * No failure marks: a gem not earned is a blank cell, a gem still in reach
 * is a faint gem with its progress, an unreadable source a muted "?".
 *
 * Input: tap, Escape (closes), ←/→ (move the highlighted column), Enter
 * (toggle this week / last week). A surface with a gamepad hands its button
 * presses in through `keyRef` (the fitness screen does) — this file reads no
 * gamepad itself. Closes on its own after `idleMs` without input.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import GemIcon from '@/lib/icons/GemIcon.jsx';
import getLogger from '@/lib/logging/Logger.js';
import './GemBoard.scss';

let _logger;
const logger = () => (_logger ||= getLogger().child({ component: 'gem-board' }));

const GROUPS = [
  { cadence: 'weekly', label: 'This week' },
  { cadence: 'contest', label: 'Contests' },
  { cadence: 'milestone', label: 'Milestones' },
];

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

const CELL_LABEL = {
  won: 'won', earned: 'earned', leading: 'leading', pending: 'still in reach', unknown: 'can’t tell yet', none: 'not this week', disabled: 'off',
};

/** One child's cell in one gem row. Exported for tests. */
export function GemCell({ cell, color, name, rowLabel, cadence = 'weekly' }) {
  const state = cell?.state ?? 'none';
  const label = `${name}, ${rowLabel}: ${CELL_LABEL[state] ?? state}${cell?.progress ? `, ${cell.progress.have} of ${cell.progress.need}` : ''}`;
  let body = null;
  if (state === 'won' || state === 'earned') {
    body = (
      <>
        <GemIcon className="gem-board__gem" color={color} size="1.9em" />
        {cell.week > 1 && <span className="gem-board__times">×{cell.week}</span>}
      </>
    );
  } else if (state === 'leading') {
    body = <GemIcon className="gem-board__gem is-leading" color={color} size="1.9em" />;
  } else if (state === 'pending') {
    body = (
      <>
        <GemIcon className="gem-board__gem is-pending" color={color} size="1.5em" />
        {cell.progress && <span className="gem-board__progress">{cell.progress.have}/{cell.progress.need}</span>}
      </>
    );
  } else if (state === 'unknown') {
    body = <span className="gem-board__muted">?</span>;
  } else if (state === 'disabled') {
    body = <span className="gem-board__muted">–</span>;
  }
  // A milestone row keeps its tally: how many of these the child has ever earned.
  const tally = cadence === 'milestone' && cell?.lifetime > 0
    ? <span className="gem-board__tally" aria-hidden="true">{cell.lifetime}</span>
    : null;
  return <div className={`gem-board__cell is-${state}`} role="cell" aria-label={label} data-state={state}>{body}{tally}</div>;
}

/**
 * The board itself, from a `/earnings/gems` response. Pure display: no fetch.
 * @param {{board: object, focusLearnerId?: string|null}} props
 */
export function GemBoardGrid({ board, focusLearnerId = null, cadences = null, totals = true }) {
  const learners = board?.learners ?? [];
  const groups = useMemo(() => GROUPS
    .filter((g) => !cadences || cadences.includes(g.cadence))
    .map((g) => ({ ...g, rows: (board?.categories ?? []).filter((c) => c.cadence === g.cadence) }))
    .filter((g) => g.rows.length), [board, cadences]);
  const columns = `minmax(9rem, 1.7fr) repeat(${Math.max(learners.length, 1)}, minmax(0, 1fr))`;
  const focusClass = (id) => (id === focusLearnerId ? ' is-focus' : '');

  if (!learners.length || !groups.length) {
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
      {groups.map((group) => (
        <div key={group.cadence} className="gem-board__group" role="rowgroup">
          <div className="gem-board__group-label" role="row"><span role="rowheader">{group.label}</span></div>
          {group.rows.map((row) => (
            <div key={row.id} className="gem-board__row" role="row">
              <div className="gem-board__row-label" role="rowheader">
                <GemIcon color={row.color} size="1.1em" />
                <span>{row.label}</span>
              </div>
              {learners.map((l) => (
                <div key={l.learnerId} className={`gem-board__col${focusClass(l.learnerId)}`}>
                  <GemCell cell={board.cells?.[row.id]?.[l.learnerId]} color={row.color} name={l.name} rowLabel={row.label} cadence={row.cadence} />
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
      {totals && <div className="gem-board__row gem-board__row--totals" role="row">
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
      </div>}
    </div>
  );
}

const WEEK_CADENCES = ['weekly', 'contest'];
const MILESTONE_CADENCES = ['milestone'];

/**
 * The whole board: one grid, or — once milestones exist — two side by side
 * (this week + contests with the totals; milestones with their tallies), so
 * every row fits the Portal's 800 px without scrolling.
 */
export function GemBoardPanels({ board, focusLearnerId = null }) {
  const split = (board?.categories ?? []).some((c) => c.cadence === 'milestone')
    && (board?.categories ?? []).some((c) => c.cadence !== 'milestone');
  if (!split) return <GemBoardGrid board={board} focusLearnerId={focusLearnerId} />;
  return (
    <div className="gem-board__panels">
      <GemBoardGrid board={board} focusLearnerId={focusLearnerId} cadences={WEEK_CADENCES} />
      <GemBoardGrid board={board} focusLearnerId={focusLearnerId} cadences={MILESTONE_CADENCES} totals={false} />
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
  const openedAt = useRef(0);
  const thisWeek = useRef(null); // the current week's Monday, once the first read lands
  const idle = useRef(null);

  const close = useCallback((reason) => {
    logger().info('gem-board.close', { surface, reason, dwellMs: Date.now() - openedAt.current });
    onClose?.(reason);
  }, [onClose, surface]);

  const poke = useCallback(() => {
    if (idle.current) clearTimeout(idle.current);
    if (idleMs > 0) idle.current = setTimeout(() => close('timeout'), idleMs);
  }, [close, idleMs]);

  // Opening: reset to this week, log, arm the idle timer.
  useEffect(() => {
    if (!open) return undefined;
    openedAt.current = Date.now();
    setWeekOffset(0);
    setFocus(focusLearnerId);
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

  const step = useCallback((offset) => {
    poke();
    setWeekOffset(offset);
    logger().debug('gem-board.week-step', { surface, offset });
  }, [poke, surface]);

  const handleKey = useCallback((key) => {
    poke();
    const ids = (state.board?.learners ?? []).map((l) => l.learnerId);
    if (key === 'Escape') { close('back'); return true; }
    if (key === 'Enter') { step(weekOffset === 0 ? -1 : 0); return true; }
    if ((key === 'ArrowLeft' || key === 'ArrowRight') && ids.length) {
      setFocus((cur) => {
        const at = ids.indexOf(cur);
        const next = key === 'ArrowLeft' ? (at <= 0 ? ids.length - 1 : at - 1) : (at < 0 || at >= ids.length - 1 ? 0 : at + 1);
        return ids[next];
      });
      return true;
    }
    return false;
  }, [close, poke, state.board, step, weekOffset]);

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
      <div className="gem-board__panel">
        <div className="gem-board__header">
          <GemIcon size="1.4em" />
          <span className="gem-board__title">Gems</span>
          <div className="gem-board__weeks" role="group" aria-label="Week">
            <button type="button" className={`gem-board__week${weekOffset === -1 ? ' is-on' : ''}`} onClick={() => step(-1)}>Last week</button>
            <button type="button" className={`gem-board__week${weekOffset === 0 ? ' is-on' : ''}`} onClick={() => step(0)}>This week</button>
          </div>
          <button type="button" className="gem-board__close" aria-label="Close" onClick={() => close('tap')}>×</button>
        </div>
        {error && !board && <div className="gem-board__empty">Can’t load the gems right now.</div>}
        {!board && !error && <div className="gem-board__empty">Loading…</div>}
        {board && board.mode === 'off' && <div className="gem-board__empty">Gems are switched off.</div>}
        {board && board.mode !== 'off' && (
          <div className={`gem-board__body${loading ? ' is-loading' : ''}`}>
            <GemBoardPanels board={board} focusLearnerId={focus} />
          </div>
        )}
      </div>
    </div>
  );
  return typeof document === 'undefined' ? body : createPortal(body, document.body);
}
