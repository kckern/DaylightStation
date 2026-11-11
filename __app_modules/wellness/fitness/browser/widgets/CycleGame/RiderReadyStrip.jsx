import React from 'react';
import PropTypes from 'prop-types';
import CircularUserAvatar from "../../components/CircularUserAvatar.jsx";
import { formatMultiplier } from "../../lib/cycleGame/boostState.js";
import "./RiderReadyStrip.scss";

const FALLBACK_AVATAR = '/api/v1/static/img/users/user';

/**
 * Pre-race rider strip shown during staging ("Riders, to your bikes!") and the
 * stoplight countdown. One chip per on-board rider: avatar, name, live RPM, and
 * a status that reads via word + icon + color (colorblind-safe):
 *   sensor reporting     → ✓ READY     (calm green)
 *   sensor not reporting → ⚠ NO SIGNAL (amber)
 * The start is rolling: pedalling before green is allowed and simply counts for
 * nothing until green, so cadence never changes the status.
 *
 * A ghost rider (audit C6 / user feedback 2026-07-02) shows here too, so the
 * strip reflects the WHOLE field the race will run with. It has no sensor (it
 * runs on its own recorded clock), so it gets a ghost-treated avatar and a fixed
 * "AUTO" chip instead of live rpm/status.
 *
 * A live rider with no heart-rate strap rides at the strapless multiplier; the
 * container passes it as `noStrapMultiplier` and the chip says so under the
 * name ("No strap · ×0.8"), so the handicap is known before the race.
 */
export default function RiderReadyStrip({ riders = [] }) {
  if (!Array.isArray(riders) || riders.length === 0) return null;
  return (
    <div className="cg-ready-strip" data-testid="rider-ready-strip">
      {riders.map((r) => {
        // Missing means unknown, which reads as ready: only a bike known to be
        // silent is flagged.
        const live = r.sensorLive !== false;
        const rpm = Math.round(Number.isFinite(r.rpm) ? r.rpm : 0);
        return (
          <div
            key={r.id}
            data-testid={`ready-rider-${r.id}`}
            className={`cg-ready-rider${r.isGhost ? ' is-ghost' : (live ? ' is-ready' : ' is-no-signal')}`}
          >
            <span className={`cg-ready-rider__avatar${r.isGhost ? ' cg-ghost' : ''}`}>
              <CircularUserAvatar
                name={r.name}
                avatarSrc={r.avatarSrc}
                fallbackSrc={FALLBACK_AVATAR}
                heartRate={Number.isFinite(r.heartRate) ? r.heartRate : undefined}
                zoneColor={r.zoneColor || undefined}
                size={88}
                showGauge={Number.isFinite(r.heartRate) && r.heartRate > 0}
                showIndicator={false}
              />
            </span>
            <span className="cg-ready-rider__name">{r.name}</span>
            {!r.isGhost && Number.isFinite(r.noStrapMultiplier) && (
              <span className="cg-ready-rider__strap" data-testid={`ready-rider-strap-${r.id}`}>
                {`No strap · ×${formatMultiplier(r.noStrapMultiplier)}`}
              </span>
            )}
            {r.isGhost ? (
              <span className="cg-ready-rider__auto" data-testid={`ready-rider-auto-${r.id}`}>AUTO</span>
            ) : (
              <>
                <span className="cg-ready-rider__rpm">
                  {rpm}<span className="cg-ready-rider__rpm-unit"> rpm</span>
                </span>
                <span className="cg-ready-rider__status">
                  <span className="cg-ready-rider__status-icon" aria-hidden="true">{live ? '✓' : '⚠'}</span>
                  {live ? 'READY' : 'NO SIGNAL'}
                </span>
              </>
            )}
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
    sensorLive: PropTypes.bool,
    isGhost: PropTypes.bool,
    noStrapMultiplier: PropTypes.number
  }))
};
