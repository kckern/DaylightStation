import React, { useState } from 'react';
import PropTypes from 'prop-types';
import CircularUserAvatar from '@/modules/Fitness/components/CircularUserAvatar.jsx';
import { FALLBACK_AVATAR } from './constants.js';
import { useEscapeToClose } from './useEscapeToClose.js';
import { uiLog } from './uiLog.js';
import './picker.scss';
import './RiderPicker.scss';

/**
 * Modal sheet for picking a registered user to assign to a bike. Household
 * members show on the main tab; guests live behind a separate tab. When the
 * slot already has a rider, a Clear tile is offered.
 */
const PICKER_CATEGORIES = [
  { key: 'household', label: 'Household' },
  { key: 'family', label: 'Family' },
  { key: 'guest', label: 'Guests' }
];

function categoryOf(p) {
  if (p.category) return p.category;
  return p.isGuest ? 'guest' : 'household';
}

export function RiderPicker({ bike, people = [], currentRiderId = null, onAssign, onClear, onClose }) {
  const available = PICKER_CATEGORIES.filter(
    (c) => people.some((p) => categoryOf(p) === c.key)
  );
  const [tab, setTab] = useState(available[0]?.key || 'household');
  const activeTab = available.some((c) => c.key === tab) ? tab : (available[0]?.key || 'household');
  // Native anonymous guests (Adult / Kid) lead their tab; others keep their order.
  const list = people
    .filter((p) => categoryOf(p) === activeTab)
    .sort((a, b) => (b.native ? 1 : 0) - (a.native ? 1 : 0));
  const showTabs = available.length > 1;
  useEscapeToClose(onClose);

  const renderPerson = (p) => (
    <button
      key={p.id}
      type="button"
      className={`cgh-person${p.hasHR ? ' has-hr' : ''}${p.id === currentRiderId ? ' is-current' : ''}`}
      data-testid={`assign-${p.id}`}
      onClick={() => onAssign?.(bike.id, p.id)}
    >
      <CircularUserAvatar
        name={p.name}
        avatarSrc={p.avatarSrc}
        fallbackSrc={FALLBACK_AVATAR}
        heartRate={Number.isFinite(p.heartRate) ? p.heartRate : undefined}
        zoneId={p.zoneId || undefined}
        zoneColor={p.zoneColor || undefined}
        size={64}
        showGauge={p.hasHR}
        showIndicator={false}
      />
      <span className="cgh-person__name">{p.name}</span>
      {p.hasHR && <span className="cgh-person__badge">live</span>}
    </button>
  );

  return (
    <div className="cgh-picker" role="dialog" aria-modal="true" data-testid="rider-picker">
      <div className="cgh-picker__backdrop" onClick={onClose} />
      <div className="cgh-picker__sheet">
        <div className="cgh-picker__head">
          <div className="cgh-picker__heading">
            <div className="cgh-section-label cgh-section-label--sub">Assign rider</div>
            <div className="cgh-picker__bike">{bike?.name || bike?.id}</div>
          </div>
          <button type="button" className="cgh-picker__close" aria-label="close" onClick={onClose}>×</button>
        </div>

        {showTabs && (
          <div className="cgh-picker__tabs" role="tablist">
            {available.map((c) => (
              <button
                key={c.key}
                type="button"
                role="tab"
                aria-selected={activeTab === c.key}
                className={`cgh-tab${activeTab === c.key ? ' is-active' : ''}`}
                onClick={() => { uiLog().debug('cycle_game.ui.picker_tab', { tab: c.key, equipmentId: bike?.id }); setTab(c.key); }}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}

        <div className="cgh-picker__grid">
          {currentRiderId && (
            <button
              type="button"
              className="cgh-person cgh-person--clear"
              data-testid="rider-clear"
              onClick={() => onClear?.(bike.id)}
            >
              <span className="cgh-person__clear-glyph" aria-hidden="true">×</span>
              <span className="cgh-person__name">Clear</span>
            </button>
          )}
          {list.map(renderPerson)}
        </div>
        {list.length === 0 && (
          <div className="cgh-empty">No registered users</div>
        )}
      </div>
    </div>
  );
}

RiderPicker.propTypes = {
  bike: PropTypes.object,
  people: PropTypes.array,
  currentRiderId: PropTypes.string,
  onAssign: PropTypes.func,
  onClear: PropTypes.func,
  onClose: PropTypes.func
};

export default RiderPicker;
