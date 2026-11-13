import React from 'react';
import PixelSprite from '../../../../../../__capabilities/gaming/browser/platform/ui/PixelSprite.jsx';
import { LifeMeter, MomentBanner, ProgressMeter } from '../../../../../../__capabilities/gaming/browser/platform/ui/hud/index.js';
import { GESTURE_INFO } from '../../lib/skylineInvaders/gestures.js';
import { boostRules, fireRules } from '../../lib/skylineInvaders/rules.js';
import { WEAPON_STEPS, bombReady, weaponTier } from '../../lib/skylineInvaders/tiers.js';
import { BOOST_LABELS } from '../../lib/skylineInvaders/invadersEffects.js';
import { INVADER_SPRITES } from '../../lib/skylineInvaders/sprites.js';
import './SkylineInvaders.scss';

// In-round header, read from across the garage. Left: how the city is doing
// and kills against the pass mark. Centre: the clock, with the score beside
// it. Right: the weapon ladder with its power meter and fuel gauge, and (with a partner on the bike) the boost. Pure render:
// no effects, no timers. Every number comes from the engine state.

const URGENT_S = 10;

/** Seconds as m:ss, rounded up so the clock reads 0:00 only when time is up. */
export function formatClock(seconds) {
  const value = Math.max(0, Math.ceil(Number(seconds) || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

// What to do about the aim, when there is something to do.
function aimNote(aimStatus, poseStatus) {
  const camera = poseStatus?.state;
  if (camera === 'camera-denied' || camera === 'error') return 'Camera off — aim with the gamepad';
  if (camera && camera !== 'detecting') return 'Camera starting — aim with the gamepad';
  if (aimStatus?.lost) return 'Step into view';
  return null;
}

// The weapon ladder, the power meter that climbs it, and the fuel that fires
// it. The ladder reads left to right; the lit step is the weapon in hand, and
// the last step lights when a full meter at the top has a bomb waiting.
function Weapon({ state, level }) {
  const rules = fireRules(level);
  const ready = bombReady(state.weapon);
  const at = ready ? WEAPON_STEPS.length - 1 : Math.min(WEAPON_STEPS.length - 2, Math.max(0, state.weapon?.level || 0));
  const power = Math.round(Math.min(1, Math.max(0, state.weapon?.meter || 0)) * 100);
  const fuel = Math.max(0, state.fuel || 0);
  const empty = !(fuel > 0);
  return (
    <div className="skyline-invaders__hud-weapon" data-testid="invaders-weapon" data-tier={weaponTier(state.weapon)} data-bomb={ready}>
      <ol className="skyline-invaders__hud-ladder" aria-label={`Weapon: ${WEAPON_STEPS[at]}`}>
        {WEAPON_STEPS.map((label, index) => (
          <li key={label} data-step={index} className={index === at ? 'is-current' : index < at ? 'is-done' : undefined}>{label}</li>
        ))}
      </ol>
      <div className="skyline-invaders__hud-gauge skyline-invaders__hud-gauge--power" data-testid="invaders-power" data-full={ready}>
        <b>{ready ? 'Stomp!' : 'Power'}</b>
        <ProgressMeter value={power} label={ready ? 'Bomb ready: stomp to drop it' : `Power ${power}%`} />
      </div>
      <div className="skyline-invaders__hud-gauge skyline-invaders__hud-gauge--fuel" data-testid="invaders-fuel" data-empty={empty}>
        <b>{empty ? 'Step!' : 'Fuel'}</b>
        <ProgressMeter value={fuel} maximum={rules.fuel_cap_s} label={empty ? 'Out of fuel: step on the mat' : `Fuel ${Math.round((100 * fuel) / rules.fuel_cap_s)}%`} />
      </div>
    </div>
  );
}

function Boost({ state, level }) {
  const rules = boostRules(level);
  const active = state.boost.active;
  const kind = active ? active.kind : rules.rotation[state.boost.next % rules.rotation.length];
  // Filling: the partner's meter. Running: the same bar drains with the time left.
  const pct = Math.round(state.boost.meter * 100);
  return (
    <div className="skyline-invaders__hud-boost" data-testid="invaders-boost" data-boost={active ? active.kind : 'filling'}>
      <span className="skyline-invaders__hud-boost-label">
        <b>{BOOST_LABELS[kind] || 'Boost'}</b>
        {active && <span className="skyline-invaders__hud-boost-time">{`${Math.ceil(active.remaining)}s`}</span>}
      </span>
      {active
        ? <ProgressMeter value={active.remaining} maximum={rules.duration_s} label={`${BOOST_LABELS[kind] || 'Boost'} time left`} />
        : <ProgressMeter value={pct} label={`Boost ${pct}%`} />}
    </div>
  );
}

/**
 * @param {object} props
 * @param {object} props.state        engine state
 * @param {object} props.level        the validated level being played
 * @param {string} [props.gesture]    the aim gesture in use (gestures.js)
 * @param {{lost: boolean, mode: 'pose'|'manual'}} [props.aimStatus]
 * @param {{state: string}} [props.poseStatus]            pose bridge status
 * @param {{riderId: string}|null} [props.partner]        the rider powering the boost, if any
 */
export default function InvadersHud({ state, level, gesture = null, aimStatus = null, poseStatus = null, partner = null }) {
  const remaining = Math.max(0, level.duration_s - state.time);
  const passKills = level.pass?.kills ?? 0;
  const killsPassed = state.kills >= passKills;
  const hp = Math.max(0, Math.ceil(state.base.hp));
  const urgent = remaining <= URGENT_S;
  const note = aimNote(aimStatus, poseStatus);
  const controls = GESTURE_INFO[gesture]?.label || null;
  return (
    <header className="skyline-invaders__hud" data-testid="skyline-invaders-hud" data-pose={poseStatus?.state || undefined} data-urgent={urgent} data-gesture={gesture || undefined}>
      <ProgressMeter className="skyline-invaders__hud-clock" value={remaining} maximum={level.duration_s} label="Time left" />

      <div className="skyline-invaders__hud-left">
        <div className="skyline-invaders__hud-base" data-danger={state.base.hp <= state.base.maxHp * 0.25}>
          <PixelSprite grid={INVADER_SPRITES.building.frames[0]} className="skyline-invaders__hud-icon skyline-invaders__hud-icon--base" />
          <LifeMeter current={state.base.hp} maximum={state.base.maxHp} label="Base" className="skyline-invaders__hud-base-meter" />
          <span className="skyline-invaders__hud-number" data-testid="invaders-base">{hp}</span>
        </div>
        <div className="skyline-invaders__hud-tally">
          <PixelSprite grid={INVADER_SPRITES.drone.frames[0]} className="skyline-invaders__hud-icon skyline-invaders__hud-icon--kills" />
          {/* Past the pass mark the target drops away: "25 / 4" reads as a mistake. */}
          <span className="skyline-invaders__hud-number" data-testid="invaders-kills" data-passed={killsPassed} aria-label={killsPassed ? `${state.kills} shot down, target of ${passKills} reached` : `${state.kills} of ${passKills} shot down`}>
            {killsPassed ? `${state.kills} ✓` : `${state.kills} / ${passKills}`}
          </span>
        </div>
      </div>

      <span className="skyline-invaders__hud-time" data-testid="invaders-time" data-urgent={urgent}>{formatClock(remaining)}</span>

      <div className="skyline-invaders__hud-points">
        <span className="skyline-invaders__hud-score" data-testid="invaders-score" aria-label={`Score ${state.score}`}>{state.score.toLocaleString('en-US')}</span>
        {state.combo > 1 && <span className="skyline-invaders__hud-combo" data-testid="invaders-combo" aria-label={`Streak ${state.combo}`}>{`×${state.combo}`}</span>}
      </div>

      <div className="skyline-invaders__hud-right">
        <Weapon state={state} level={level} />
        {partner && <Boost state={state} level={level} />}
      </div>

      <div className="skyline-invaders__hud-notes">
        <MomentBanner text={note} momentKey="aim" className="skyline-invaders__hud-note skyline-invaders__hud-note--aim" />
        {/* The controls in use, unless the aim note needs the strip. */}
        {controls && !note && <span className="skyline-invaders__hud-note skyline-invaders__hud-note--controls" data-testid="invaders-controls">{`Aim: ${controls}`}</span>}
      </div>
    </header>
  );
}
