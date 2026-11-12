import React from 'react';
import { boostRules, cameraTime } from '../../lib/skylineGlider/liftBoost.js';
import { PadGlyph, PixelIcon } from './SkylinePixelIcons.jsx';

// In flight: hearts, clock and score as outlined readouts straight on the sky
// (top left), and a 2×2 block mirroring the physical bike buttons (top right).
// The block is a legend, not a touch target; the full button panel only appears
// in the menus. A press flashes its cell when it fired and turns it red (with
// the reason) when it was refused.

const ACTIONS = Object.freeze([
  { position: 1, action: 'laser', icon: 'bolt', label: 'Laser' },
  { position: 2, action: 'bomb', icon: 'bomb', label: 'Bomb' },
  { position: 3, action: 'missile', icon: 'missile', label: 'Missile' },
  { position: 4, action: 'boost', icon: 'boost', label: 'Boost' },
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

// The pickup counter wears the zone's own collectible: the first frame of its
// sprite (a coin on the SMW coin levels), or the bell where the zone draws the
// built-in bell. Never a bell beside coins (2026-11-12).
export function CollectibleIcon({ zone, assets }) {
  const spec = zone?.collectible;
  const name = spec?.frames?.[0] || spec?.frame || null;
  const frame = name && assets?.sheet ? assets.frames?.[name] : null;
  if (!frame) return <PixelIcon name="bell"/>;
  return <svg className="skyline-glider__collectible-icon" data-collectible="sprite" aria-hidden="true" focusable="false"
    viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`} style={{ '--w': frame.w, '--h': frame.h }} preserveAspectRatio="xMidYMid meet">
    <image href={assets.sheet.url} width={assets.sheet.width} height={assets.sheet.height}/>
  </svg>;
}

// The touch "more" button: opens the sound sheet. The bike buttons reach the
// same sheet through the flight menu (hold 4, then 2).
export function MoreButton({ onMore, className = '' }) {
  return <button type="button" className={`skyline-glider__more ${className}`.trim()} aria-label="Sound and settings" onClick={onMore} data-testid="skyline-glider-more">
    <PixelIcon name="more"/>
  </button>;
}

export default function SkylineFlightHud({ flight, course, assets, armed, targetsHit, power, press, onMore }) {
  const hearts = Math.max(0, Math.floor(flight.lives || 0));
  const slots = Math.max(hearts, Math.floor(course.rules?.lives || 0));
  const recharge = boostRules(course).recharge_s;
  return <header className="skyline-glider__hud" data-testid="skyline-glider-hud">
    <span className="skyline-glider__hud-hearts" role="img" aria-label={`${hearts} hearts left`}>
      {Array.from({ length: slots }, (_, index) => <PixelIcon key={index} name="heart" className={index < hearts ? '' : 'is-spent'}/>)}
    </span>
    <span className="skyline-glider__hud-time">{formatTime(course.duration_s - cameraTime(flight))}</span>
    <span className="skyline-glider__hud-stat" data-testid="skyline-glider-collected" aria-label="Collected"><CollectibleIcon zone={course.zone} assets={assets}/>{flight.collectedIds.length}</span>
    {armed && <span className="skyline-glider__hud-stat skyline-glider__hud-targets" data-testid="skyline-glider-targets" aria-label="Targets destroyed"><PixelIcon name="target"/>{targetsHit}</span>}
    {armed && power > 1 && <span className="skyline-glider__hud-stat skyline-glider__hud-power" data-testid="skyline-glider-power" aria-label="Heart-rate power"><PixelIcon name="bolt"/>{power}×</span>}
    <div className="skyline-glider__hud-pad" aria-label="Bike buttons" data-armed={armed ? 'true' : 'false'}>
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
          <b aria-hidden="true"><PixelIcon name={icon}/></b>
          <small>{flash && !flash.ok ? REFUSAL_TEXT[flash.reason] || 'Wait' : readout(action, flight, course)}</small>
        </span>;
      })}
    </div>
    {armed && <span className="skyline-glider__hud-menu">Hold <PadGlyph position={4}/> for menu</span>}
    {onMore && <MoreButton onMore={onMore} className="skyline-glider__hud-more"/>}
  </header>;
}

function formatTime(seconds) {
  const value = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}
