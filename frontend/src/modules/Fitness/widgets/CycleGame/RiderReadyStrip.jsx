import React from 'react';
import PropTypes from 'prop-types';
import CircularUserAvatar from '@/modules/Fitness/components/CircularUserAvatar.jsx';
import './RiderReadyStrip.scss';

const FALLBACK_AVATAR = '/api/v1/static/img/users/user';

/**
 * Pre-race compliance strip shown during staging ("Riders, to your bikes!") and
 * the stoplight countdown. One chip per on-board rider: avatar, name, live RPM,
 * and a status that reads via word + icon + color (colorblind-safe) —
 *   compliant (not pedaling) → ✓ READY (calm green)
 *   violating (pedaling)     → ⚠ WAIT  (amber, pulsing)
 * Anyone still "WAIT" when the light goes green earns the hot-start penalty.
 */
export default function RiderReadyStrip({ riders = [] }) {
  if (!Array.isArray(riders) || riders.length === 0) return null;
  return (
    <div className="cg-ready-strip" data-testid="rider-ready-strip">
      {riders.map((r) => {
        const compliant = !!r.compliant;
        const rpm = Math.round(Number.isFinite(r.rpm) ? r.rpm : 0);
        return (
          <div
            key={r.id}
            data-testid={`ready-rider-${r.id}`}
            className={`cg-ready-rider${compliant ? ' is-compliant' : ' is-violating'}`}
          >
            <span className="cg-ready-rider__avatar">
              <CircularUserAvatar
                name={r.name}
                avatarSrc={r.avatarSrc}
                fallbackSrc={FALLBACK_AVATAR}
                heartRate={Number.isFinite(r.heartRate) ? r.heartRate : undefined}
                zoneColor={r.zoneColor || undefined}
                size={64}
                showGauge={Number.isFinite(r.heartRate) && r.heartRate > 0}
                showIndicator={false}
              />
            </span>
            <span className="cg-ready-rider__name">{r.name}</span>
            <span className="cg-ready-rider__rpm">
              {rpm}<span className="cg-ready-rider__rpm-unit"> rpm</span>
            </span>
            <span className="cg-ready-rider__status">
              <span className="cg-ready-rider__status-icon" aria-hidden="true">{compliant ? '✓' : '⚠'}</span>
              {compliant ? 'READY' : 'WAIT'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

RiderReadyStrip.propTypes = {
  riders: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string,
    avatarSrc: PropTypes.string,
    rpm: PropTypes.number,
    heartRate: PropTypes.number,
    zoneColor: PropTypes.string,
    compliant: PropTypes.bool
  }))
};
