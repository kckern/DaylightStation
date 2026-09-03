import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import PropTypes from 'prop-types';
import { BaseRealtimeCard } from './BaseRealtimeCard.jsx';
import getLogger from '@/lib/logging/Logger.js';
import './StepMatCard.scss';
import '../../overlays/CycleRiderSwapModal.scss';

const avatarFor = (userId) => userId
  ? `/api/v1/static/img/users/${userId}`
  : '/api/v1/static/img/equipment/equipment';

function UserPicker({ open, participants, currentUserId, onAssign, onClose }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open || typeof document === 'undefined') return null;
  return ReactDOM.createPortal(
    <div className="cycle-swap-modal" role="dialog" aria-modal="true" aria-label="Choose who is stepping" onClick={onClose}>
      <div className="cycle-swap-modal__panel" onClick={(event) => event.stopPropagation()}>
        <div className="cycle-swap-modal__header">
          <h2 className="cycle-swap-modal__title">Who is stepping?</h2>
          <button type="button" className="cycle-swap-modal__close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="cycle-swap-modal__body">
          <ul className="cycle-swap-modal__list">
            {participants.length === 0 ? (
              <li className="cycle-swap-modal__item cycle-swap-modal__rider-hint">No active heart-rate users</li>
            ) : null}
            {participants.map((participant) => {
              const id = participant.id || participant.profileId;
              const label = participant.displayLabel || participant.name || id;
              return (
                <li key={id} className="cycle-swap-modal__item">
                  <button type="button" className="cycle-swap-modal__rider-btn" onClick={() => { onAssign(id); onClose(); }}>
                    <span className="cycle-swap-modal__rider-avatar-wrap">
                      <img className="cycle-swap-modal__rider-avatar" src={avatarFor(id)} alt="" />
                    </span>
                    <span className="cycle-swap-modal__rider-name">{label}</span>
                    {id === currentUserId ? <span className="cycle-swap-modal__rider-hint">Current</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="cycle-swap-modal__footer">
          {currentUserId ? <button type="button" className="cycle-swap-modal__cancel" onClick={() => { onAssign(null); onClose(); }}>Unassign</button> : null}
          <button type="button" className="cycle-swap-modal__cancel" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function StepMatCard({ equipment, snapshot, participants = [], assignedUserId, onAssign, onDisengage }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const holdTimer = useRef(null);
  const held = useRef(false);
  const name = equipment?.name || 'Step Mat';
  const device = { deviceId: snapshot.matId, lastSeen: snapshot.lastSeenAt };
  const logger = useMemo(
    () => getLogger().child({ component: 'fitness-step-mat-card', equipmentId: snapshot.equipmentId }),
    [snapshot.equipmentId]
  );

  useEffect(() => {
    logger.info('mounted', { matId: snapshot.matId });
    return () => logger.info('unmounted', { matId: snapshot.matId });
  }, [logger, snapshot.matId]);

  const clearHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };
  useEffect(() => clearHold, []);

  const beginHold = () => {
    held.current = false;
    clearHold();
    holdTimer.current = setTimeout(() => {
      held.current = true;
      const confirmed = snapshot.engaged
        && typeof window !== 'undefined'
        && window.confirm('Stop using the step mat for this session?');
      logger.info('disengage-request', { confirmed: Boolean(confirmed) });
      if (confirmed) onDisengage?.();
    }, 700);
  };
  const finishHold = () => {
    clearHold();
    if (!held.current) {
      logger.debug('assignment-picker-opened', { assignedUserId: assignedUserId || null });
      setPickerOpen(true);
    }
  };

  const status = !snapshot.online ? 'Sensor unavailable'
    : snapshot.active ? 'Stepping'
      : snapshot.engaged ? 'Dormant' : 'Ready';

  return (
    <>
      <div onPointerDown={beginHold} onPointerUp={finishHold} onPointerCancel={clearHold} onPointerLeave={clearHold}>
        <BaseRealtimeCard
          device={device}
          deviceName={name}
          className="step-mat-card"
          isInactive={!snapshot.active}
          imageSrc={avatarFor(assignedUserId)}
          imageAlt={assignedUserId || name}
          imageFallback="/api/v1/static/img/equipment/equipment"
          ariaLabel={`${name}: ${Math.round(snapshot.stepsPerMinute)} steps per minute, ${snapshot.sessionSteps} steps, ${snapshot.sessionStomps} stomps. Tap to assign; hold to stop using mat.`}
        >
          <div className="step-mat-card__rate"><strong>{Math.round(snapshot.stepsPerMinute)}</strong> SPM <span>{status}</span></div>
          <div className="step-mat-card__totals">
            <span><strong>{snapshot.sessionSteps}</strong> steps</span>
            <span><strong>{snapshot.sessionStomps}</strong> stomps</span>
          </div>
        </BaseRealtimeCard>
      </div>
      <UserPicker
        open={pickerOpen}
        participants={participants}
        currentUserId={assignedUserId}
        onAssign={(userId) => {
          logger.info('assignment-changed', { fromUserId: assignedUserId || null, toUserId: userId || null });
          onAssign?.(userId);
        }}
        onClose={() => setPickerOpen(false)}
      />
    </>
  );
}

StepMatCard.propTypes = {
  equipment: PropTypes.object,
  snapshot: PropTypes.object.isRequired,
  participants: PropTypes.array,
  assignedUserId: PropTypes.string,
  onAssign: PropTypes.func,
  onDisengage: PropTypes.func,
};

export default StepMatCard;
