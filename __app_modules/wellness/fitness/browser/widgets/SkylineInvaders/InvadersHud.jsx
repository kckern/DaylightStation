import React from 'react';
import PixelSprite from '../../../../../../__capabilities/gaming/browser/platform/ui/PixelSprite.jsx';
import { LifeMeter, MomentBanner, ProgressMeter } from '../../../../../../__capabilities/gaming/browser/platform/ui/hud/index.js';
import { boostRules } from '../../lib/skylineInvaders/rules.js';
import { BOOST_LABELS } from '../../lib/skylineInvaders/invadersEffects.js';
import { INVADER_SPRITES } from '../../lib/skylineInvaders/sprites.js';
import './SkylineInvaders.scss';

// In-round header, read from across the garage. Left: how the city is doing
// and kills against the pass mark. Centre: the clock, with the score beside
// it. Right: what the shooter is firing and (with a partner on the bike) the boost. Pure render:
// no effects, no timers. Every number comes from the engine state.

export const TIER_LABELS = Object.freeze({ small: 'Small', big: 'Big', spread: 'Spread', nuke: 'Nuke' });
const URGENT_S = 10;

/** Seconds as m:ss, rounded up so the clock reads 0:00 only when time is up. */
export function formatClock(seconds) {
  const value = Math.max(0, Math.ceil(Number(seconds) || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

// The shot as it looks in the sky: one thin bolt, one wide bolt, a fan of
// three, or a warhead inside its blast ring.
function TierGlyph({ tier }) {
  return (
    <svg className="skyline-invaders__tier-glyph" viewBox="0 0 44 32" aria-hidden="true">
      {tier === 'big' && <rect x="14" y="3" width="16" height="26" />}
      {tier === 'spread' && (
        <g strokeWidth="5" stroke="currentColor" strokeLinecap="square">
          <line x1="22" y1="28" x2="6" y2="6" />
          <line x1="22" y1="28" x2="22" y2="4" />
          <line x1="22" y1="28" x2="38" y2="6" />
        </g>
      )}
      {tier === 'nuke' && (
        <>
          <circle cx="22" cy="16" r="6" />
          <circle cx="22" cy="16" r="12.5" fill="none" stroke="currentColor" strokeWidth="3" />
        </>
      )}
      {!['big', 'spread', 'nuke'].includes(tier) && <rect x="19" y="3" width="6" height="26" />}
    </svg>
  );
}

function aimNote(aimStatus) {
  // Manual aim (no camera, or Ready was skipped): a badge, not instructions.
  if (aimStatus?.mode === 'manual') return 'Gamepad aim';
  if (aimStatus?.lost && aimStatus?.mode === 'pose') return 'Step into view';
  return null;
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
 * @param {{tier: string, trusted: boolean}} props.tier   shotTier() result
 * @param {{lost: boolean, mode: 'pose'|'manual'}} [props.aimStatus]
 * @param {{state: string}} [props.poseStatus]            pose bridge status
 * @param {{riderId: string}|null} [props.partner]        the rider powering the boost, if any
 * @param {string} [props.shooterName]
 */
export default function InvadersHud({ state, level, tier, aimStatus = null, poseStatus = null, partner = null, shooterName = '' }) {
  const remaining = Math.max(0, level.duration_s - state.time);
  const tierId = TIER_LABELS[tier?.tier] ? tier.tier : 'small';
  const passKills = level.pass?.kills ?? 0;
  const killsPassed = state.kills >= passKills;
  const hp = Math.max(0, Math.ceil(state.base.hp));
  const urgent = remaining <= URGENT_S;
  return (
    <header className="skyline-invaders__hud" data-testid="skyline-invaders-hud" data-pose={poseStatus?.state || undefined} data-urgent={urgent}>
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

      {/* The clock and the score as one centred group, so the score never runs
          under the tier and boost on the far right (1381 px garage, 2026-11-12). */}
      <div className="skyline-invaders__hud-centre">
        <span className="skyline-invaders__hud-time" data-testid="invaders-time" data-urgent={urgent}>{formatClock(remaining)}</span>
        <div className="skyline-invaders__hud-points">
          <span className="skyline-invaders__hud-score" data-testid="invaders-score" aria-label={`Score ${state.score}`}>{state.score.toLocaleString('en-US')}</span>
          {state.combo > 1 && <span className="skyline-invaders__hud-combo" data-testid="invaders-combo" aria-label={`Combo ${state.combo}`}>{`×${state.combo}`}</span>}
        </div>
      </div>

      <div className="skyline-invaders__hud-right">
        <div className="skyline-invaders__hud-tier" data-testid="invaders-tier" data-tier={tierId}>
          <TierGlyph tier={tierId} />
          <span className="skyline-invaders__hud-tier-text">
            {shooterName && <small>{shooterName}</small>}
            <b>{TIER_LABELS[tierId]}</b>
          </span>
        </div>
        {partner && <Boost state={state} level={level} />}
      </div>

      <div className="skyline-invaders__hud-notes">
        <MomentBanner text={aimNote(aimStatus)} momentKey="aim" className="skyline-invaders__hud-note skyline-invaders__hud-note--aim" />
        <MomentBanner text={tier?.trusted === false ? 'No trusted heart rate — small shots' : null} momentKey="tier" className="skyline-invaders__hud-note skyline-invaders__hud-note--tier" />
      </div>
    </header>
  );
}
