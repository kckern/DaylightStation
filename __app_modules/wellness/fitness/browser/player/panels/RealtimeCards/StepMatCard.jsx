import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import PropTypes from 'prop-types';
import { BaseRealtimeCard } from "./BaseRealtimeCard.jsx";
import getLogger from '@/lib/logging/Logger.js';
import { DaylightMediaPath } from '@/lib/api.mjs';
import { StepMatGlyph, GENERIC_EQUIPMENT_FALLBACK_SRC } from "../../../shared/EquipmentGlyph.jsx";
import "./StepMatCard.scss";
import "../../overlays/CycleRiderSwapModal.scss";

// Rider photos in the picker; a rider with no photo gets the neutral equipment
// mark rather than a picture of some other device.
const avatarFor = (userId) => (userId
  ? DaylightMediaPath(`/static/img/users/${userId}`)
  : GENERIC_EQUIPMENT_FALLBACK_SRC);

const STATES = {
  offline: 'Offline',
  stepping: 'Stepping',
  dormant: 'Dormant',
  ready: 'Ready',
};

const count = (value) => (Number.isFinite(Number(value)) ? Math.max(0, Math.round(Number(value))) : 0);

/**
 * The card's face once a rider has been picked on the card: their photo, or
 * the drawn step-mat glyph if it fails to load. With nobody picked it is the
 * glyph — a mat cannot sense who is on it.
 */
function MatFace({ src, state }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);
  return (
    <div className="step-mat-card__face" data-state={state}>
      {src && !failed ? (
        <img className="step-mat-card__photo" src={src} alt="" onError={() => setFailed(true)} />
      ) : (
        <StepMatGlyph className="step-mat-card__glyph" />
      )}
    </div>
  );
}

MatFace.propTypes = { src: PropTypes.string, state: PropTypes.string };

/**
 * With no rider picked the card carries a solid full-width "Who's stepping?"
 * strip under its numbers, so the picker is discoverable from the bike. The
 * whole card is the tap target; the strip says what a tap does.
 */
function WhoPrompt() {
  return (
    <div className="step-mat-card__who">
      <span className="step-mat-card__who-text">Who's stepping?</span>
      <span className="step-mat-card__who-hint">Tap to pick</span>
    </div>
  );
}

function UserPicker({ open, participants, currentUserId, onAssign, onClose, onRelease }) {
  const panelRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    panelRef.current?.querySelector('button')?.focus();
    const onKey = (event) => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
      if (event.key === 'Tab') {
        const buttons = [...(panelRef.current?.querySelectorAll('button:not(:disabled)') || [])];
        const first = buttons[0], last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previousFocus?.focus?.(); };
  }, [open, onClose]);
  if (!open || typeof document === 'undefined') return null;
  return ReactDOM.createPortal(
    <div className="cycle-swap-modal" role="dialog" aria-modal="true" aria-label="Choose who is stepping" onClick={onClose}>
      <div ref={panelRef} className="cycle-swap-modal__panel" onClick={(event) => event.stopPropagation()}>
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
          {onRelease ? <button type="button" className="cycle-swap-modal__cancel" onClick={() => { onRelease(); onClose(); }}>Release mat</button> : null}
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

  const releaseMat = () => {
    const confirmed = snapshot.engaged && typeof window !== 'undefined'
      && window.confirm('Release the step mat? Your totals stay saved. Stepping again resumes activity.');
    logger.info('disengage-request', { confirmed: Boolean(confirmed) });
    if (confirmed) onDisengage?.();
  };

  const beginHold = () => {
    held.current = false;
    clearHold();
    holdTimer.current = setTimeout(() => {
      held.current = true;
      releaseMat();
    }, 700);
  };
  const openPicker = () => {
    clearHold();
    if (!held.current) {
      logger.info('assignment-picker-opened', { assignedUserId: assignedUserId || null });
      setPickerOpen(true);
    }
    held.current = false;
  };
  const closePicker = React.useCallback(() => setPickerOpen(false), []);

  const state = !snapshot.online ? 'offline'
    : snapshot.active ? 'stepping'
      : snapshot.engaged ? 'dormant' : 'ready';
  const status = STATES[state];
  const rate = count(snapshot.stepsPerMinute);
  const steps = count(snapshot.sessionSteps);
  const stomps = count(snapshot.sessionStomps);
  // No config photo for an unpicked mat: the only face is a person someone
  // explicitly picked on this card in this session.
  const faceSrc = assignedUserId ? DaylightMediaPath(`/static/img/users/${assignedUserId}`) : null;
  const tapHint = assignedUserId
    ? `Stepping: ${assignedUserId}. Tap to change`
    : "Who's stepping? Tap to pick";

  return (
    <>
      <div onPointerDown={beginHold} onPointerUp={clearHold} onPointerCancel={clearHold} onPointerLeave={clearHold}>
        <BaseRealtimeCard
          device={device}
          deviceName={name}
          className={`step-mat-card step-mat-card--${state}${assignedUserId ? '' : ' step-mat-card--unpicked'}`}
          isInactive={!snapshot.active}
          isClickable
          onClick={openPicker}
          avatar={<MatFace src={faceSrc} state={state} />}
          progressBar={assignedUserId ? null : <WhoPrompt />}
          ariaLabel={`${name}: ${rate} steps per minute, ${steps} steps, ${stomps} stomps. ${status}. ${tapHint}; hold to release mat.`}
        >
          <div className="step-mat-card__state" data-state={state}>
            <span className="step-mat-card__state-dot" aria-hidden="true" />
            {status}
          </div>
          <div className="step-mat-card__stats">
            <span className="step-mat-card__stat step-mat-card__stat--rate"><strong>{rate}</strong><em>SPM</em></span>
            <span className="step-mat-card__stat"><strong>{steps}</strong><em>Steps</em></span>
            <span className="step-mat-card__stat"><strong>{stomps}</strong><em>Stomps</em></span>
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
        onClose={closePicker}
        onRelease={snapshot.engaged ? releaseMat : null}
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
