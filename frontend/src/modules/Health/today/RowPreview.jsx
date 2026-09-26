// The row "magnifier": ONE card for the whole page, drawn at the cursor, with
// the hovered food's picture at a size that can be read (a UPC product photo
// is illegible at the row's 24px) and its numbers. A row may instead pass its
// own `node` to draw (the exercise rows do); the card then shows that as is.
//
// A singleton by construction: RowPreviewProvider owns the only card, and a
// row asks it to show that row's content. Moving onto another row swaps the
// content in place, so two cards can never overlap. The card follows the
// pointer (above-right of it; below when there is no room) and never takes
// the pointer itself.
//
// Opened by hovering the row's artwork or name (at once), by keyboard (Tab)
// focus on the name (anchored to the name), or — where there is no hover
// (coarse pointers) — by tapping the artwork (anchored to it). Never while a
// portion/numeric drag owns the row.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatFoodPortion } from '@shared-contracts/health/foodQuantity.mjs';
import { foodDensity } from '@shared-contracts/health/foodDensity.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { focusCameFromTab, trackKeyboardModality } from '../../../lib/ui/keyboardModality.js';
import { MacroBadges } from './MacroBadges.jsx';
import { FoodIcon } from './FoodIcon.jsx';
import { nutritionPhotoUrl } from './photoUrl.js';

const logger = createAppLogger('health').child('row-preview');

/** Grace after the pointer leaves a row, so crossing from its artwork to its name never flickers. */
export const CLOSE_DELAY_MS = 60;
/** Pointer-to-card offset. */
export const CURSOR_OFFSET_PX = 14;
const EDGE_PX = 8;

trackKeyboardModality();

export const isCoarsePointer = () => {
  try { return Boolean(window.matchMedia?.('(pointer: coarse)').matches); } catch { return false; }
};

/**
 * Where the card goes: above-right of the point, flipped below when there is
 * no room above, pulled left when it would leave the viewport.
 */
export function placeCard({ x, y }, { width, height }, { innerWidth, innerHeight }) {
  let left = x + CURSOR_OFFSET_PX;
  if (left + width > innerWidth - EDGE_PX) left = Math.max(EDGE_PX, innerWidth - EDGE_PX - width);
  const above = y - CURSOR_OFFSET_PX - height;
  const below = y + CURSOR_OFFSET_PX + 6;
  const side = above >= EDGE_PX || below + height > innerHeight - EDGE_PX ? 'top' : 'bottom';
  const top = side === 'top' ? Math.max(EDGE_PX, above) : below;
  return { left: Math.round(left), top: Math.round(top), side };
}

const PreviewContext = createContext(null);
// Which row holds the card right now; rows read it to know they are showing.
const PreviewOwnerContext = createContext(null);

/** Hosts the page's one preview card. Wrap the day's log in it. */
export function RowPreviewProvider({ children }) {
  const [shown, setShown] = useState(null); // { owner, row, isGroup, kcal } or { owner, node }
  const ownerRef = useRef(null);
  const point = useRef({ x: 0, y: 0 });
  const cardRef = useRef(null);
  const closeTimer = useRef(null);
  const frame = useRef(0);

  const position = useCallback(() => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const { left, top, side } = placeCard(point.current, { width: rect.width, height: rect.height }, window);
    card.style.transform = `translate(${left}px, ${top}px)`;
    card.dataset.position = side;
  }, []);

  const cancelClose = () => { clearTimeout(closeTimer.current); closeTimer.current = null; };
  const api = useMemo(() => ({
    show(owner, content, at) {
      cancelClose();
      if (at) point.current = at;
      if (ownerRef.current !== owner) content.onOpen?.();
      ownerRef.current = owner;
      setShown({ owner, ...content });
    },
    move(owner, at) {
      if (ownerRef.current !== owner || !at) return;
      point.current = at;
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(position);
    },
    hide(owner, { now = false } = {}) {
      if (ownerRef.current !== owner) return;
      cancelClose();
      const close = () => { if (ownerRef.current === owner) { ownerRef.current = null; setShown(null); } };
      if (now) close(); else closeTimer.current = setTimeout(close, CLOSE_DELAY_MS);
    },
    isOpen: owner => ownerRef.current === owner,
  }), [position]);

  useLayoutEffect(() => { if (shown) position(); }, [shown, position]);
  useEffect(() => () => { cancelClose(); cancelAnimationFrame(frame.current); }, []);
  // A scroll or a tap elsewhere closes it. (Escape is the focused name's own
  // key handler — see useRowPreview; a hover card closes by moving away.)
  useEffect(() => {
    if (!shown) return undefined;
    const close = () => { const owner = ownerRef.current; if (owner) api.hide(owner, { now: true }); };
    const onDown = event => { if (!event.target?.closest?.('.health-row-artwork, [data-row-preview-toggle]')) close(); };
    window.addEventListener('scroll', close, true);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('scroll', close, true);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [shown, api]);

  // Portalled INTO the themed `.ds-root`, whose inline --ds-* tokens the
  // card's surface, border and text colours read.
  const host = typeof document === 'undefined' ? null : (document.querySelector('.ds-root') || document.body);
  return <PreviewContext.Provider value={api}><PreviewOwnerContext.Provider value={shown?.owner ?? null}>
    {children}
    {shown && host ? createPortal(<div ref={cardRef} className="health-row-preview__card" role="tooltip" data-position="top">
      {shown.node ?? <RowPreviewContent row={shown.row} isGroup={shown.isGroup} kcal={shown.kcal} />}
    </div>, host) : null}
  </PreviewOwnerContext.Provider></PreviewContext.Provider>;
}

/**
 * A row's side of the card. `content` is what the card shows for this row.
 * `disabled` (a live portion draft) closes it and keeps it closed. Without a
 * provider it is inert.
 */
export function useRowPreview({ disabled = false, onOpen, content = null } = {}) {
  const api = useContext(PreviewContext);
  const owner = useRef(Symbol('row-preview')).current;
  const latest = useRef({ content, onOpen, disabled });
  latest.current = { content, onOpen, disabled };
  const opened = useContext(PreviewOwnerContext) === owner;
  const open = useCallback(at => {
    if (!api || latest.current.disabled || !latest.current.content) return;
    api.show(owner, { ...latest.current.content, onOpen: latest.current.onOpen }, at);
  }, [api, owner]);
  const close = useCallback((opts) => { api?.hide(owner, opts); }, [api, owner]);
  useEffect(() => { if (disabled) close({ now: true }); }, [disabled, close]);
  useEffect(() => () => api?.hide(owner, { now: true }), [api, owner]);
  // Keep the card's numbers live while it is showing this row.
  // `content` should be memoized by the caller (a new object per render would re-show every render).
  useEffect(() => { if (api?.isOpen(owner) && content) api.show(owner, { ...content }); }, [api, owner, content]);

  const isMouse = event => event.pointerType === undefined || event.pointerType === 'mouse' || event.pointerType === 'pen';
  const at = event => (Number.isFinite(event.clientX) && Number.isFinite(event.clientY) ? { x: event.clientX, y: event.clientY } : null);
  const anchorOf = element => { const r = element.getBoundingClientRect(); return { x: r.left, y: r.top }; };
  return {
    opened,
    close: () => close({ now: true }),
    /** Hover on the artwork / name: the card appears at, and follows, the cursor. */
    targetProps: {
      onPointerEnter: event => { if (isMouse(event)) open(at(event)); },
      onPointerMove: event => { if (isMouse(event)) { if (!api?.isOpen(owner)) open(at(event)); else api.move(owner, at(event)); } },
      onPointerLeave: event => { if (isMouse(event)) close(); },
    },
    focusProps: {
      // Keyboard navigation only: not a tap, and not a sheet handing focus
      // back to the name it was opened from (that reopened the card by itself).
      onFocus: event => { if (focusCameFromTab()) open(anchorOf(event.currentTarget)); },
      onBlur: () => close(),
      onKeyDown: event => { if (event.key === 'Escape' && api?.isOpen(owner)) { event.stopPropagation(); close({ now: true }); } },
    },
    /** Tap on the artwork: on a touch screen, that is how the card opens. */
    onArtworkClick: event => {
      if (!isCoarsePointer()) return;
      if (api?.isOpen(owner)) close({ now: true }); else open(anchorOf(event.currentTarget));
    },
  };
}

/**
 * What the card shows. `kcal` is the row's displayed calories (a group's is
 * its rollup). Image: the full product/capture photo, else the hi-res icon,
 * else the neutral placeholder.
 */
export function RowPreviewContent({ row, isGroup = false, kcal = null }) {
  const [brokenPhoto, setBrokenPhoto] = useState(null);
  const name = row.name || row.item || row.label || '';
  const children = isGroup ? (row.children || []) : [];
  const photo = row.photoRef && brokenPhoto !== row.photoRef ? nutritionPhotoUrl(row.photoRef) : null;
  const density = foodDensity(isGroup ? { kind: 'group', children } : row);
  const portion = isGroup ? null : formatFoodPortion(row);
  return <div className="health-row-preview">
    <div className="health-row-preview__hero" data-kind={photo ? 'photo' : row.icon && row.icon !== 'default' ? 'icon' : 'placeholder'}>
      {photo
        ? <img src={photo} alt="" decoding="async" onError={() => setBrokenPhoto(row.photoRef)} />
        : <FoodIcon icon={row.icon} className="health-row-preview__icon" />}
    </div>
    <div className="health-row-preview__body">
      <p className="health-row-preview__title">{name}</p>
      <p className="health-row-preview__facts">
        {portion && portion !== '—' ? <span>{portion}</span> : null}
        {isGroup ? <span>{`${children.length} ${children.length === 1 ? 'ingredient' : 'ingredients'}`}</span> : null}
        <span className="health-row-preview__kcal">{kcal == null ? '— kcal' : `${Math.round(kcal)} kcal`}</span>
      </p>
      <MacroBadges rows={isGroup ? children : [row]} showLabels className="health-row-preview__macros" />
      {density != null ? <p className="health-row-preview__density">{`${density.toFixed(1)} kcal/g`}</p> : null}
    </div>
  </div>;
}

/** Logged (sampled) each time a card opens. */
export function logRowPreviewOpen(row) {
  logger.sampled('row.preview.open', { uuid: row?.uuid ?? row?.id ?? null, hasPhoto: Boolean(row?.photoRef) }, { maxPerMinute: 20 });
}
