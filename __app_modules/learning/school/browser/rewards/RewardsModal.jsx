import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import CoinIcon from '../../../../../frontend/src/lib/icons/CoinIcon.jsx';
import GemIcon from '../../../../../frontend/src/lib/icons/GemIcon.jsx';
import { coinFigure } from '../../../../../frontend/src/lib/coins/coinFigure.js';
import { formatMeasure, streakLine } from '../../../../../frontend/src/lib/economy/GemBoard/GemDetail.jsx';
import { schoolApi } from '../schoolApi.js';
import { schoolLog } from '../schoolLog.js';
import { TreasureChest } from './RewardsChest.jsx';
import './RewardsModal.scss';

const LOADING = { status: 'loading', data: null };
const readSilver = id => schoolApi.earningsPreview(id);
const readBank = id => schoolApi.economyBank(id);
const readGems = () => schoolApi.gems();

/** A changed identity never paints a preceding child's data, even before effects run. */
function useRewardRead(learnerId, read, resource) {
  const [result, setResult] = useState(LOADING);
  useEffect(() => {
    let alive = true;
    Promise.resolve().then(() => read(learnerId)).then(response => {
      if (!alive) return;
      setResult({ learnerId, status: response?.ok && response.data ? 'ok' : 'unavailable', data: response?.ok ? response.data : null });
      if (!response?.ok) schoolLog.selfServiceError('rewards.read-failed', { learnerId, resource, status: response?.status ?? null });
    }).catch(error => {
      if (!alive) return;
      setResult({ learnerId, status: 'unavailable', data: null });
      schoolLog.selfServiceError('rewards.read-failed', { learnerId, resource, error: error?.message });
    });
    return () => { alive = false; };
  }, [learnerId, read, resource]);
  return result.learnerId === learnerId ? result : LOADING;
}

function CoinTotal({ metal, label, value, status }) {
  const kind = metal === 'silver' ? 'Silver' : 'Gold';
  return (
    <div className="school-rewards-modal__total">
      <div className="school-rewards-modal__amount">
        <CoinIcon metal={metal} />
        {status === 'loading' ? <span className="school-rewards-modal__message" role="status">Loading {metal}…</span>
          : Number.isFinite(value) ? <span>{coinFigure(value)}</span>
            : <span className="school-rewards-modal__message">{kind} is unavailable.</span>}
      </div>
      <p>{label}</p>
    </div>
  );
}

/** Only own progress is rendered. Never hand contest standings to a shared detail component. */
function GemPart({ part }) {
  const progress = part.progress;
  const line = progress ? streakLine(part)
    : part.cadence === 'contest' ? formatMeasure(part.score?.mine, part.score?.unit)
      : part.state === 'earned' || part.state === 'won' ? 'Earned this week'
        : part.state === 'unknown' ? 'Can’t tell yet' : null;
  return (
    <div className="school-rewards-modal__part">
      <span>{part.label}</span>
      {line && <p>{line}</p>}
      {progress && Number.isFinite(progress.have) && Number.isFinite(progress.need) && progress.need > 0 && (
        <progress value={Math.max(0, progress.have)} max={progress.need} aria-label={part.label} />
      )}
      {(part.items ?? []).map((item, index) => <p key={`${item.day}:${index}`}>{item.label}{item.day ? ` · ${item.day}` : ''}</p>)}
    </div>
  );
}

function PersonalGems({ result, learnerId }) {
  if (result.status === 'loading') return <p role="status">Loading gems…</p>;
  if (result.status !== 'ok' || !Array.isArray(result.data?.categories) || !result.data?.learners?.some(l => l.learnerId === learnerId)) {
    return <p>Gems are unavailable.</p>;
  }
  const board = result.data;
  if (board.mode !== 'live') return <p>Gems start soon.</p>;
  const rows = board.categories.map(category => ({ category, cell: board.cells?.[category.id]?.[learnerId] }))
    .filter(({ cell }) => cell && cell.state !== 'disabled');
  if (!rows.length) return <p>No gem achievements to show yet.</p>;
  return rows.map(({ category, cell }) => {
    const held = Math.max(Number(cell.week) || 0, Number(cell.held) || 0);
    const parts = (cell.parts ?? []).filter(p => p && p.state !== 'disabled');
    return (
      <article className="school-rewards-modal__achievement" key={category.id}>
        <GemIcon color={category.color} size="1.8rem" />
        <div>
          <h4>{category.label}</h4>
          {held > 0 && <p>{held} {held === 1 ? 'gem' : 'gems'} {cell.state === 'leading' ? 'held this week' : 'earned this week'}</p>}
          {parts.length ? parts.map(part => <GemPart key={part.ruleId} part={part} />)
            : <p>{cell.state === 'unknown' ? 'Can’t tell yet' : held ? 'Well done!' : 'No gem yet this week'}</p>}
        </div>
      </article>
    );
  });
}

export default function RewardsModal({ learner, onClose, onOpenBank = null, idleMs = 45_000 }) {
  const learnerId = learner.id;
  const titleId = useId();
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const timer = useRef(null);
  const silver = useRewardRead(learnerId, readSilver, 'silver');
  const bank = useRewardRead(learnerId, readBank, 'bank');
  const gems = useRewardRead(learnerId, readGems, 'gems');
  const noteActivity = () => {
    clearTimeout(timer.current);
    if (idleMs > 0) timer.current = setTimeout(() => closeRef.current?.(), idleMs);
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    const trigger = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (trigger?.isConnected) trigger.focus?.();
    };
  }, []);
  useEffect(() => { noteActivity(); return () => clearTimeout(timer.current); }, [idleMs, learnerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const priced = silver.data?.learnerId === learnerId && Number.isFinite(silver.data?.totals?.silver)
    && !(silver.data.lines?.length > 0 && silver.data.lines.every(line => line.status === 'indeterminate'));
  const soon = bank.status === 'ok' && bank.data?.mode !== 'live';

  return createPortal(
    <dialog ref={dialogRef} className="school-rewards-modal" aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); closeRef.current?.(); }}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const box = event.currentTarget.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeRef.current?.();
      }}
      onPointerDownCapture={noteActivity} onKeyDownCapture={noteActivity} onScrollCapture={noteActivity}>
      <header className="school-rewards-modal__header">
        <TreasureChest open />
        <div><p>A collection of your effort</p><h2 id={titleId}>{learner.name}'s rewards</h2></div>
        <button type="button" className="school-rewards-modal__close" aria-label="Close rewards" onClick={() => closeRef.current?.()} autoFocus>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
      </header>
      <div className="school-rewards-modal__body">
        {soon ? <p>Coins start soon.</p> : (
          <div className="school-rewards-modal__totals">
            <CoinTotal metal="silver" label="Silver earned this week" status={silver.status} value={priced ? silver.data.totals.silver : null} />
            <CoinTotal metal="gold" label="Gold in your bank" status={bank.status} value={bank.status === 'ok' ? bank.data?.balances?.gold : null} />
          </div>
        )}
        <h3>Your gems this week</h3>
        <PersonalGems result={gems} learnerId={learnerId} />
        {onOpenBank && <button type="button" className="school-rewards-modal__bank" onClick={() => onOpenBank(learnerId)}>Open bank details</button>}
        <button type="button" className="school-rewards-modal__done" onClick={() => closeRef.current?.()}>Back to today</button>
      </div>
    </dialog>, document.body,
  );
}
