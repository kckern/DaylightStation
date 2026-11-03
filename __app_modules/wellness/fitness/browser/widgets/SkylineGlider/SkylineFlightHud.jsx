import React from 'react';
import { boostRules, cameraTime } from '../../lib/skylineGlider/liftBoost.js';

// In-flight header: score on the left, and a 2×2 mini-pad mirroring the
// physical bike buttons on the right. The pad is a legend, not a touch target;
// the full button panel only appears in the menus. A press flashes its cell
// green when it fired and red (with the reason) when it was refused.

const ACTIONS = Object.freeze([
  { position: 1, action: 'laser', icon: 'ϟ', label: 'Laser' },
  { position: 2, action: 'bomb', icon: '●', label: 'Bomb' },
  { position: 3, action: 'missile', icon: '➤', label: 'Missile' },
  { position: 4, action: 'boost', icon: '»', label: 'Boost' },
]);

export const REFUSAL_TEXT = Object.freeze({
  cooldown: 'Reloading', empty: 'Empty', recharging: 'Charging', paused: 'Wait', off: 'Level 2', active: 'Boosting',
});

function readout(action, flight, course) {
  if (action === 'laser') return '∞';
  if (action === 'bomb') return String(flight.bombsLeft ?? 0);
  if (action === 'missile') return String(flight.missilesLeft ?? 0);
  return flight.boostRechargeRemaining > 0 ? `${Math.ceil(flight.boostRechargeRemaining)}s` : 'Ready';
}

function cellState(action, flight) {
  if (action === 'bomb' && !(flight.bombsLeft > 0)) return 'empty';
  if (action === 'missile' && !(flight.missilesLeft > 0)) return 'empty';
  if (action === 'boost' && flight.boostRemaining > 0) return 'active';
  if (action === 'boost' && flight.boostRechargeRemaining > 0) return 'charging';
  return 'ready';
}

export default function SkylineFlightHud({ flight, course, armed, targetsHit, power, press }) {
  const hearts = Math.max(0, flight.lives || 0);
  const recharge = boostRules(course).recharge_s;
  return <header className="skyline-glider__hud" data-testid="skyline-glider-hud">
    <span className="skyline-glider__hud-hearts" aria-label={`${hearts} hearts left`}>{'♥'.repeat(hearts) || '♡'}</span>
    <span className="skyline-glider__hud-time">{formatTime(course.duration_s - cameraTime(flight))}</span>
    <span className="skyline-glider__hud-stat" aria-label="Bells collected">🔔 {flight.collectedIds.length}</span>
    {armed && <span className="skyline-glider__hud-stat" data-testid="skyline-glider-targets" aria-label="Targets destroyed">◎ {targetsHit}</span>}
    {armed && power > 1 && <span className="skyline-glider__hud-stat skyline-glider__hud-power" data-testid="skyline-glider-power" aria-label="Heart-rate power">⚡{power}×</span>}
    <div className="skyline-glider__hud-pad" aria-label="Bike buttons">
      {armed && ACTIONS.map(({ position, action, icon, label }) => {
        const flash = press?.position === position ? press : null;
        const charge = action === 'boost' && flight.boostRechargeRemaining > 0 && !(flight.boostRemaining > 0)
          ? 1 - flight.boostRechargeRemaining / recharge : null;
        return <span key={flash ? `${position}-${flash.key}` : position} className="skyline-glider__hud-cell"
          data-position={position} data-action={action} data-state={cellState(action, flight)}
          data-flash={flash ? (flash.ok ? 'ok' : 'deny') : undefined}
          data-testid={action === 'bomb' ? 'skyline-glider-bombs' : `skyline-glider-hud-${action}`}
          aria-label={`${label}: ${readout(action, flight, course)}`}
          style={charge != null ? { '--charge': `${Math.round(charge * 100)}%` } : undefined}>
          <b aria-hidden="true">{icon}</b>
          <small>{flash && !flash.ok ? REFUSAL_TEXT[flash.reason] || 'Wait' : readout(action, flight, course)}</small>
        </span>;
      })}
    </div>
    {armed && <span className="skyline-glider__hud-menu">Hold » menu</span>}
  </header>;
}

function formatTime(seconds) {
  const value = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}
