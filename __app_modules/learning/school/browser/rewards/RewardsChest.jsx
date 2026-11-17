import { SchoolButton } from '../portal/SchoolButton.jsx';
import { useEffect, useRef, useState } from 'react';
import chestSheet from './treasure-chests.svg?url';
import { pressDown } from '../shared/pressDown.js';
import './RewardsChest.scss';

export const CHEST_OPEN_MS = 480;

/** Three CC0 SVG states, cropped from the original sheet; no wealth-dependent styling. */
export function TreasureChest({ open = false }) {
  return (
    <span className={`school-rewards-chest${open ? ' is-open' : ''}`} aria-hidden="true">
      {['44 109 148 150', '194 109 148 150', '349 109 148 150'].map((viewBox, index) => (
        <svg key={viewBox} className={`school-rewards-chest__frame school-rewards-chest__frame--${index}`} viewBox={viewBox} focusable="false">
          <image href={chestSheet} width="524.4095" height="372.04725" />
        </svg>
      ))}
    </span>
  );
}

export default function RewardsChest({ name, onOpen, onBeginOpening = null, disabled = false }) {
  const [opening, setOpening] = useState(false);
  const pending = useRef(false);
  const timer = useRef(null);
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  useEffect(() => () => clearTimeout(timer.current), []);

  const open = () => {
    if (disabled || pending.current) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { onBeginOpening?.(); openRef.current?.(); return; }
    pending.current = true;
    onBeginOpening?.();
    setOpening(true);
    timer.current = setTimeout(() => {
      pending.current = false;
      setOpening(false);
      openRef.current?.();
    }, CHEST_OPEN_MS);
  };

  return (
    <SchoolButton variant="plain" type="button" className={`school-rewards-door${opening ? ' is-opening' : ''}`}
      aria-label={`Open ${name}'s rewards`} aria-haspopup="dialog" disabled={disabled} aria-disabled={opening || undefined} {...pressDown(open)}>
      <TreasureChest />
    </SchoolButton>
  );
}
