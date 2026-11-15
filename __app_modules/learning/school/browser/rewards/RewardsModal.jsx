import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import CoinIcon from '../../../../../frontend/src/lib/icons/CoinIcon.jsx';
import RingIcon from '../../../../../frontend/src/lib/icons/RingIcon.jsx';
import GemGlyph, { glyphWords } from '../../../../../frontend/src/lib/economy/GemBoard/GemGlyph.jsx';
import AreaIcon from '../../../../../frontend/src/lib/economy/GemBoard/AreaIcon.jsx';
import { coinFigure } from '../../../../../frontend/src/lib/coins/coinFigure.js';
import '../../../../../frontend/src/lib/economy/GemBoard/GemBoard.scss';
import { schoolLog } from '../schoolLog.js';
import { pressDown } from '../shared/pressDown.js';
import { rewardsGridFit } from './rewardsGridFit.js';
import './RewardsModal.scss';

const weekLabel = week => week ? new Date(`${week}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : null;

export default function RewardsModal({ learner, snapshot, onClose, onOpenBank = null, idleMs = 45_000 }) {
  // Lock the whole prepared opening, even when a caller receives newer memory.
  const opening = useRef(snapshot);
  if (opening.current?.learnerId !== learner.id) opening.current = snapshot;
  const view = opening.current;
  const titleId = useId();
  const dialogRef = useRef(null);
  const gridBox = useRef(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const [fit, setFit] = useState({ columns: Math.max(1, Math.ceil(Math.sqrt(view.gems.length))), fontPx: 16 });
  const timer = useRef(null);
  const lastActivityLog = useRef(null);
  const noteActivity = () => {
    const now = Date.now();
    if (lastActivityLog.current == null || now - lastActivityLog.current >= 30_000) {
      lastActivityLog.current = now;
      schoolLog.selfService('board.rewards-activity', { learnerId: learner.id });
    }
    clearTimeout(timer.current);
    if (idleMs > 0) timer.current = setTimeout(() => closeRef.current?.(), idleMs);
  };

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const trigger = document.activeElement;
    dialog.showModal();
    const measure = () => {
      const box = gridBox.current?.getBoundingClientRect();
      if (box?.width > 0 && box?.height > 0) setFit(rewardsGridFit(view.gems.length, box.width, box.height));
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (gridBox.current) observer?.observe(gridBox.current);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect(); window.removeEventListener('resize', measure);
      dialog.close(); if (trigger?.isConnected) trigger.focus?.();
    };
  }, [view]);
  useEffect(() => { noteActivity(); return () => clearTimeout(timer.current); }, [idleMs, learner.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation(); closeRef.current?.();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  const groups = (view.groups ?? []).filter(group => view.gems.some(row => row.group === group.id));
  return createPortal(
    <dialog ref={dialogRef} className="school-rewards-modal" aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); closeRef.current?.(); }}
      onMouseDown={event => {
        if (event.target !== event.currentTarget) return;
        const box = event.currentTarget.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeRef.current?.();
      }}
      onPointerDownCapture={noteActivity} onKeyDownCapture={noteActivity}>
      <header className="school-rewards-modal__header">
        <h2 id={titleId}>{learner.name}'s rewards</h2>
        {view.week && <span className="school-rewards-modal__week">Week of {weekLabel(view.week)}</span>}
        <button type="button" className="school-rewards-modal__close" aria-label="Close rewards" {...pressDown(() => closeRef.current?.())} autoFocus>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
      </header>
      <div className="school-rewards-modal__totals">
        <div aria-label="Silver earned this week"><CoinIcon metal="silver" /><strong>{view.mode === 'live' && Number.isFinite(view.silver) ? coinFigure(view.silver) : '—'}</strong><span>Silver</span></div>
        <div aria-label="Gold in your bank"><CoinIcon metal="gold" /><strong>{view.mode === 'live' && Number.isFinite(view.gold) ? coinFigure(view.gold) : '—'}</strong><span>Gold</span></div>
        <div aria-label="Rings this week"><RingIcon /><strong>{Number.isFinite(view.rings) ? view.rings.toLocaleString('en-US') : '—'}</strong><span>Rings</span></div>
      </div>
      <div className="school-rewards-modal__legend" aria-hidden="true">
        {groups.map(group => <span key={group.id}><AreaIcon area={group.id} />{group.label}</span>)}
      </div>
      <div ref={gridBox} className="school-rewards-modal__grid-box">
        {view.gems.length ? (
          <div className="school-rewards-modal__grid" role="list" aria-label="Your gems" style={{ fontSize: `${fit.fontPx}px`, gridTemplateColumns: `repeat(${fit.columns}, 5em)` }}>
            {view.gems.map(row => (
              <div className="school-rewards-modal__gem" role="listitem" key={row.id} data-group={row.group}>
                <span role="img" aria-label={`${row.label}: ${glyphWords(row.cell)}`}><GemGlyph cell={row.cell} color={row.color} area={row.area ?? row.group} /></span>
                <span className="school-rewards-modal__gem-label" title={row.label}>{row.label}</span>
              </div>
            ))}
          </div>
        ) : <p className="school-rewards-modal__empty">{view.mode === 'off' || view.mode === 'dry-run' ? 'Rewards start soon.' : view.mode === 'unknown' ? 'Rewards are unavailable.' : 'No gems to show yet.'}</p>}
      </div>
      <footer className="school-rewards-modal__footer">
        {onOpenBank && <button type="button" className="school-rewards-modal__bank" {...pressDown(() => {
          dialogRef.current.close(); onOpenBank(learner.id);
        })}>Bank log <span aria-hidden="true">›</span></button>}
      </footer>
    </dialog>, document.body,
  );
}
