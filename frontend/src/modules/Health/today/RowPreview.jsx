// The row "magnifier": a speech-bubble card beside a food row, with the food's
// picture at a size that can be read (a UPC product photo is illegible at the
// row's 24px) and its numbers.
//
// Opened by hovering the row's artwork or name (at once, closed
// CLOSE_DELAY_MS after the pointer leaves both the row and the card), by
// keyboard (Tab) focus on the name, or — where there is no hover (coarse pointers) —
// by tapping the artwork. Never while a portion/numeric drag owns the row.
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatFoodPortion } from '@shared-contracts/health/foodQuantity.mjs';
import { foodDensity } from '@shared-contracts/health/foodDensity.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { focusCameFromTab, trackKeyboardModality } from '../../../lib/ui/keyboardModality.js';
import { MacroBadges } from './MacroBadges.jsx';
import { FoodIcon } from './FoodIcon.jsx';
import { nutritionPhotoUrl } from './photoUrl.js';

const logger = createAppLogger('health').child('row-preview');

// Hover opens at once; a delay read as the card lagging behind the pointer.
export const OPEN_DELAY_MS = 0;
export const CLOSE_DELAY_MS = 150;

trackKeyboardModality();

export const isCoarsePointer = () => {
  try { return Boolean(window.matchMedia?.('(pointer: coarse)').matches); } catch { return false; }
};

/**
 * Open/close state with hover intent. `disabled` (a live portion draft) closes
 * the card and keeps it closed. Handlers are stable across renders.
 */
export function useRowPreview({ disabled = false, onOpen } = {}) {
  const [opened, setOpenedState] = useState(false);
  const openedRef = useRef(false);
  const setOpened = value => { openedRef.current = value; setOpenedState(value); };
  const timer = useRef(null);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const clear = () => { clearTimeout(timer.current); timer.current = null; };
  const show = useCallback(() => {
    clear();
    if (disabledRef.current) return;
    if (!openedRef.current) onOpenRef.current?.();
    setOpened(true);
  }, []);
  const close = useCallback(() => { clear(); if (openedRef.current) setOpened(false); }, []);
  const scheduleOpen = useCallback(() => {
    clear();
    if (disabledRef.current) return;
    if (OPEN_DELAY_MS <= 0) show(); else timer.current = setTimeout(show, OPEN_DELAY_MS);
  }, [show]);
  const scheduleClose = useCallback(() => { clear(); timer.current = setTimeout(close, CLOSE_DELAY_MS); }, [close]);
  useEffect(() => { if (disabled) close(); }, [disabled, close]);
  useEffect(() => clear, []);
  // Hover only for a real mouse: a touch "hover" is the start of a tap.
  const onPointerEnter = useCallback(event => { if (event.pointerType === undefined || event.pointerType === 'mouse') scheduleOpen(); }, [scheduleOpen]);
  const onPointerLeave = useCallback(event => { if (event.pointerType === undefined || event.pointerType === 'mouse') scheduleClose(); }, [scheduleClose]);
  return {
    opened,
    close,
    /** Hover and focus on the artwork / name. */
    targetProps: { onPointerEnter, onPointerLeave },
    focusProps: {
      // Keyboard navigation only: not a tap, and not a sheet handing focus
      // back to the name it was opened from (that reopened the card by itself).
      onFocus: () => { if (focusCameFromTab()) scheduleOpen(); },
      onBlur: scheduleClose,
      onKeyDown: event => { if (event.key === 'Escape' && opened) { event.stopPropagation(); close(); } },
    },
    /** The card itself keeps itself open while the pointer is over it. */
    cardProps: { onPointerEnter: clear, onPointerLeave: scheduleClose },
    /** Tap on the artwork: on a touch screen, that is how the card opens. */
    onArtworkClick: () => { if (isCoarsePointer()) { if (opened) close(); else show(); } },
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
