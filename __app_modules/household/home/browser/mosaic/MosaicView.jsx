import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SegmentedControl, UnstyledButton } from '@mantine/core';
import { CHROME_SCROLL_CLASS, EmptyState, useDismissLayer } from '@/lib/ui';
import { displayName, formatEntityState, formatSince } from '../entities/formatEntityState.js';
import { EntityDetailSheet } from '../ui/EntityDetailSheet.jsx';
import { useEntityDetail } from '../ui/useEntityDetail.js';
import homeLogger from '../homeLogger.js';
import { isLively, squareTone, toneFlags } from './squareTone.js';
import { iconFor } from './mosaicIcons.js';
import './MosaicView.scss';

const logger = homeLogger.child({ component: 'mosaic' });

const MODES = [{ value: 'room', label: 'By room' }, { value: 'type', label: 'By type' }];
const MODE_KEY = 'home.mosaic.mode';
// A tap's compatibility mouse events land within this long of its pointerdown.
const TOUCH_WINDOW_MS = 1000;

// The grouping is a per-viewer convenience; storage may be unavailable.
function readSavedMode() {
  try {
    const saved = window.localStorage.getItem(MODE_KEY);
    return MODES.some((m) => m.value === saved) ? saved : 'room';
  } catch { return 'room'; }
}
function saveMode(mode) {
  try { window.localStorage.setItem(MODE_KEY, mode); } catch { /* storage unavailable */ }
}

/** The groups to draw: each with its squares' entities and tones, in server order. */
function buildGroups(groups, byId, flags) {
  return (groups || []).map((g) => {
    const items = [];
    for (const id of g.entityIds || []) {
      const entity = byId.get(id);
      if (entity) items.push({ entity, tone: squareTone(entity, flags) });
    }
    return { id: g.id, label: g.label, items, lively: items.filter((i) => isLively(i.tone)).length };
  }).filter((g) => g.items.length);
}

/** "Kitchen light · On · changed 8:29 pm" — what a square is, in words. */
function tipText(entity) {
  const since = formatSince(entity.lastChanged);
  return [displayName(entity), formatEntityState(entity), since ? `changed ${since}` : null].filter(Boolean).join(' · ');
}

const Square = memo(function Square({ entity, tone }) {
  const Icon = iconFor(entity);
  const cls = `home-square home-square--${tone.fill}${tone.attention ? ' home-square--attention' : ''}`;
  return (
    <UnstyledButton
      className={cls}
      data-entity-id={entity.id}
      aria-label={`${displayName(entity)}: ${formatEntityState(entity)}`}
      style={tone.tempPct != null ? { '--tone-pct': tone.tempPct } : undefined}
    >
      <Icon className="home-square__icon" stroke={1.75} aria-hidden="true" focusable="false" />
    </UnstyledButton>
  );
});

/** Every group: a small header over its wrapping grid of squares. Hover never re-renders this. */
const MosaicGroups = memo(function MosaicGroups({ groups }) {
  return (
    <div className="home-mosaic__groups">
      {groups.map((g) => (
        <section key={g.id} className="home-mosaic__group" aria-label={g.label}>
          <h3 className="home-mosaic__head">
            <span className="home-mosaic__label">{g.label}</span>
            {g.lively > 0 ? <span className="home-mosaic__count">{g.lively} on</span> : null}
          </h3>
          <div className="home-mosaic__squares">
            {g.items.map(({ entity, tone }) => <Square key={entity.id} entity={entity} tone={tone} />)}
          </div>
        </section>
      ))}
    </div>
  );
});

/** The one shared tooltip, set over the square it describes and kept inside the mosaic. */
function MosaicTooltip({ id, tip, text, boxRef }) {
  const ref = useRef(null);
  const [place, setPlace] = useState(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const box = boxRef.current;
    if (!el || !box || !tip) return;
    const width = el.offsetWidth;
    const half = width / 2;
    const max = box.clientWidth;
    const left = Math.min(Math.max(tip.x, half), Math.max(half, max - half));
    // No room above the square on screen (or under a sticky header): drop it below instead.
    const below = tip.viewTop - el.offsetHeight - 6 < tip.ceiling;
    setPlace({ left, top: below ? tip.bottom + 6 : tip.top - 6, below });
  }, [tip, text, boxRef]);
  if (!tip || !text) return null;
  const style = place
    ? { left: place.left, top: place.top }
    : { left: tip.x, top: tip.top - 6, visibility: 'hidden' };
  return (
    <div
      ref={ref}
      role="tooltip"
      id={id}
      className={`home-mosaic__tip${place?.below ? ' home-mosaic__tip--below' : ''}`}
      style={style}
    >
      {text}
    </div>
  );
}

/**
 * Mosaic: every device as one small square, grouped by room or by type, in
 * the colour of what it is doing. Nothing on the grid is a word but the
 * group names; a square explains itself in a tooltip (hover with a mouse,
 * first tap on a touch screen) and opens its drawer on a click (or a second
 * tap).
 */
export function MosaicView({ entities, mosaic, summary, types, haUrl, toggle }) {
  const [mode, setMode] = useState(readSavedMode);
  const [tip, setTip] = useState(null);
  const boxRef = useRef(null);
  const tipIdRef = useRef(null);
  const touchRef = useRef({ at: 0, tipBefore: null });
  const detail = useEntityDetail(entities || []);
  const tipDomId = useId();

  const byId = useMemo(() => new Map((entities || []).map((e) => [e.id, e])), [entities]);
  const flags = useMemo(() => toneFlags(summary), [summary]);
  const groups = useMemo(
    () => (mosaic ? buildGroups(mode === 'type' ? mosaic.byType : mosaic.byRoom, byId, flags) : []),
    [mosaic, mode, byId, flags],
  );
  const typeLabels = useMemo(() => new Map((types || []).map((t) => [t.id, t.label])), [types]);

  useEffect(() => {
    logger.info('home.mosaic.mount', { mode, grouped: Boolean(mosaic) });
    return () => logger.info('home.mosaic.unmount', {});
    // mount/unmount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeMode = (next) => {
    logger.info('home.mosaic.mode', { from: mode, to: next });
    setMode(next);
    saveMode(next);
    setTip(null);
    tipIdRef.current = null;
  };

  const hideTip = useCallback(() => { tipIdRef.current = null; setTip(null); }, []);
  // An open tooltip is a layer on the app's one Escape handler, so Escape hides
  // it wherever focus is; with no tooltip open, Escape reaches the drawer.
  useDismissLayer(Boolean(tip), hideTip);
  // The square the tooltip describes names it (squares are memoised, so set it here).
  const tipId = tip?.id ?? null;
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || !tipId) return undefined;
    const sq = [...box.querySelectorAll('.home-square[data-entity-id]')].find((el) => el.dataset.entityId === tipId);
    if (!sq) return undefined;
    sq.setAttribute('aria-describedby', tipDomId);
    return () => sq.removeAttribute('aria-describedby');
  }, [tipId, tipDomId]);
  const showTip = useCallback((el) => {
    const entity = byId.get(el.dataset.entityId);
    const box = boxRef.current;
    if (!entity || !box) return;
    if (tipIdRef.current === entity.id) return;
    const r = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    tipIdRef.current = entity.id;
    // The chrome's scroll region starts under the app header: that edge is the
    // ceiling. Outside AppChrome nothing covers the page, so the viewport top is.
    const scroller = box.closest(`.${CHROME_SCROLL_CLASS}`);
    const ceiling = scroller ? scroller.getBoundingClientRect().top : 0;
    setTip({
      id: entity.id, x: r.left - b.left + r.width / 2,
      top: r.top - b.top, bottom: r.bottom - b.top, viewTop: r.top, ceiling,
    });
  }, [byId]);

  // Only a square on this board: the drawer also carries a data-entity-id.
  const squareOf = (e) => {
    const sq = e.target.closest?.('.home-square[data-entity-id]') || null;
    return sq && boxRef.current?.contains(sq) ? sq : null;
  };
  const recentTouch = () => Date.now() - touchRef.current.at < TOUCH_WINDOW_MS;

  const onPointerDown = (e) => {
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      touchRef.current = { at: Date.now(), tipBefore: tipIdRef.current };
    }
  };
  const onMouseOver = (e) => {
    const sq = squareOf(e);
    if (sq) showTip(sq);
    else if (!recentTouch()) hideTip();
  };
  const onClick = (e) => {
    const sq = squareOf(e);
    if (!sq) { hideTip(); return; }
    const entity = byId.get(sq.dataset.entityId);
    if (!entity) return;
    // A tap first explains the square; tapping the same square again opens it.
    if (recentTouch() && touchRef.current.tipBefore !== entity.id) {
      touchRef.current.tipBefore = entity.id;
      showTip(sq);
      return;
    }
    hideTip();
    detail.open(entity);
  };
  // A tap's own compatibility events can report the pointer leaving; only a mouse leaving hides it.
  const onMouseLeave = () => { if (!recentTouch()) hideTip(); };
  const onFocus = (e) => { const sq = squareOf(e); if (sq) showTip(sq); };
  const onKeyDown = (e) => { if (e.key === 'Escape' && tipIdRef.current) { e.stopPropagation(); hideTip(); } };

  if (!mosaic) {
    return (
      <div className="home-mosaic">
        <EmptyState title="This server does not group the mosaic yet" hint="Update the server to see every device as a square." />
      </div>
    );
  }

  const selected = detail.selected;
  return (
    <div className="home-mosaic">
      <div className="home-mosaic__bar">
        <SegmentedControl size="sm" data={MODES} value={mode} onChange={changeMode} aria-label="Group the mosaic" />
        <ul className="home-mosaic__legend" aria-label="What the colours mean">
          <li><span className="home-mosaic__swatch home-mosaic__swatch--on" aria-hidden="true" />On</li>
          <li><span className="home-mosaic__swatch home-mosaic__swatch--motion" aria-hidden="true" />Someone there</li>
          <li><span className="home-mosaic__swatch home-mosaic__swatch--open" aria-hidden="true" />Open</li>
          <li><span className="home-mosaic__swatch home-mosaic__swatch--temp" aria-hidden="true" />Temperature</li>
          <li><span className="home-mosaic__swatch home-mosaic__swatch--attention" aria-hidden="true" />Needs attention</li>
        </ul>
      </div>
      {groups.length ? (
        // Squares are buttons; the container only delegates their pointer and focus events.
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions
        <div
          className="home-mosaic__board"
          ref={boxRef}
          onPointerDown={onPointerDown}
          onMouseOver={onMouseOver}
          onMouseLeave={onMouseLeave}
          onClick={onClick}
          onFocus={onFocus}
          onBlur={hideTip}
          onKeyDown={onKeyDown}
        >
          <MosaicGroups groups={groups} />
          {/* The words come from the live reading, so a poll updates an open tooltip. */}
          <MosaicTooltip id={tipDomId} tip={tip} text={tip && byId.has(tip.id) ? tipText(byId.get(tip.id)) : null} boxRef={boxRef} />
        </div>
      ) : (
        <EmptyState title="No devices to show" hint="Home Assistant reported no devices in these groups." />
      )}
      <EntityDetailSheet
        entity={selected}
        haUrl={haUrl}
        onToggle={toggle}
        onClose={detail.close}
        typeLabel={selected ? typeLabels.get(selected.type) : undefined}
      />
    </div>
  );
}

export default MosaicView;
