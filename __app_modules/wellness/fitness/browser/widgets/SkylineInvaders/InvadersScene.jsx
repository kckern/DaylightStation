import React from 'react';
import PixelSprite from '../../../../../../__capabilities/gaming/browser/platform/ui/PixelSprite.jsx';
import { MUZZLE_Y, fireRules } from '../../lib/skylineInvaders/engine.js';
import { LANES, LANE_WIDTH, laneOfX, laneX, nextTarget } from '../../lib/skylineInvaders/lanes.js';
import { FIELD, THREATS, aimToX } from '../../lib/skylineInvaders/threats.js';
import { SHOT_TIERS, bombReady, weaponTier } from '../../lib/skylineInvaders/tiers.js';
import { INVADER_SPRITES, SPRITE_PIXEL } from '../../lib/skylineInvaders/sprites.js';
import './SkylineInvaders.scss';

// The playfield: a city at night, drawn in the engine's 1000 x 600 scene units.
// Pure render. Every moving thing is placed from `state`, and animation time
// is `state.time`, so a paused round is a still picture and a replay draws the
// same frames. The only time the stylesheet owns is the short effect
// animations. The cannon does not glide: it stands on a lane centre, and a
// shot leaves from exactly where it is drawn.
//
// Colour rule (SkylineInvaders.scss): what falls is cold, what the players own
// is warm. Shots take the colour of the weapon level that fires them.

// ── Art lookup: the skin hook. Nothing else reads sprites.js for a threat or
// the cannon, so a skin export can swap these two functions later. ──────────
export function threatArt(type, timeS /* , assets */) {
  const { frames } = INVADER_SPRITES[type] || INVADER_SPRITES.meteor;
  return { grid: frames[Math.floor(timeS * 2) % frames.length] };   // two frames per second
}
export const cannonArt = (/* assets */) => ({ grid: INVADER_SPRITES.cannon.frames[0] });

// ── Geometry ────────────────────────────────────────────────────────────────
const RANGE_X = FIELD.width - 2 * FIELD.marginX;
const CANNON = Object.freeze({ width: 11 * SPRITE_PIXEL, height: 8 * SPRITE_PIXEL });
const BUILDING_PIXEL = 8;
export const BUILDING_SIZE = Object.freeze({ width: 9 * BUILDING_PIXEL, height: 7 * BUILDING_PIXEL });
/** Centre x of building `index` of `count`, spread evenly over the cannon range. */
export const buildingX = (index, count) => FIELD.marginX + ((index + 0.5) * RANGE_X) / count;
const SHOT_HEIGHT = 18;
const BLAST_S = 0.5;   // engine.js keeps a blast in state this long; ttl / BLAST_S is how much is left

// A repeatable 0..1 for a whole number. The sky must not use Math.random: the
// stars would jump on every render.
const noise = (n) => {
  const v = Math.sin(n * 12.9898 + 4.1414) * 43758.5453;
  return v - Math.floor(v);
};
const snap = (value) => Math.round(value / SPRITE_PIXEL) * SPRITE_PIXEL;

const STARS = Object.freeze(Array.from({ length: 56 }, (_, i) => Object.freeze({
  x: snap(8 + noise(i) * (FIELD.width - 16)),
  y: snap(8 + noise(i + 100) * (FIELD.groundY - 140)),
  size: noise(i + 200) > 0.8 ? SPRITE_PIXEL : SPRITE_PIXEL / 2,
  dim: noise(i + 300) > 0.5,
})));
/** The fixed star field: [{ x, y, size, dim }]. The same list on every call. */
export const skyStars = () => STARS;

// The scene is 5:3 and the garage screen is 16:9, so the backdrop is drawn
// wider than the field: the sky, the far skyline and the street carry on into
// the bars at each side. Nothing the engine tracks ever goes out there.
const BLEED = 240;
const WIDE = Object.freeze({ x: -BLEED, width: FIELD.width + 2 * BLEED });

// Far skyline: flat silhouettes behind the buildings the players defend.
const FAR_BLOCKS = Object.freeze(Array.from({ length: Math.ceil(WIDE.width / 40) }, (_, i) => Object.freeze({
  x: WIDE.x + i * 40,
  width: 40,
  height: snap(28 + noise(i + 400) * 84),
})));
const TIERS = Object.freeze(Object.keys(SHOT_TIERS));

// Windows are the holes fully walled in by the building's own pixels. They are
// lit while the building stands and go dark when it falls.
function enclosedCells(grid) {
  const rows = grid.map((row) => Array.from(row).map((cell) => cell !== '.'));
  const h = rows.length;
  const w = rows[0].length;
  const open = rows.map((row) => row.map(() => false));
  const queue = [];
  const visit = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h || rows[y][x] || open[y][x]) return;
    open[y][x] = true;
    queue.push([x, y]);
  };
  for (let x = 0; x < w; x += 1) { visit(x, 0); visit(x, h - 1); }
  for (let y = 0; y < h; y += 1) { visit(0, y); visit(w - 1, y); }
  while (queue.length) {
    const [x, y] = queue.pop();
    visit(x + 1, y); visit(x - 1, y); visit(x, y + 1); visit(x, y - 1);
  }
  return rows.map((row, y) => row.map((filled, x) => (!filled && !open[y][x] ? '#' : '.')).join(''));
}
const mirror = (grid) => grid.map((row) => Array.from(row).reverse().join(''));
const BUILDING = INVADER_SPRITES.building.frames[0];
const RUBBLE = INVADER_SPRITES.rubble.frames[0];
// Every other building faces the other way, so the row reads as a street
// rather than one stamp repeated.
const BUILDING_ART = Object.freeze([
  Object.freeze({ standing: BUILDING, windows: enclosedCells(BUILDING), rubble: RUBBLE }),
  Object.freeze({ standing: mirror(BUILDING), windows: enclosedCells(mirror(BUILDING)), rubble: mirror(RUBBLE) }),
]);

const BLAST_DEBRIS = Object.freeze(Array.from({ length: 12 }, (_, i) => {
  const angle = (i / 12) * Math.PI * 2 + 0.26;
  return Object.freeze({ dx: Math.cos(angle), dy: Math.sin(angle), reach: 0.75 + 0.25 * noise(i + 500) });
}));
const BURST = Object.freeze(Array.from({ length: 8 }, (_, i) => {
  const angle = (i / 8) * Math.PI * 2 + 0.39;
  return Object.freeze({ dx: Math.round(Math.cos(angle) * 26), dy: Math.round(Math.sin(angle) * 26) });
}));
// Half an ellipse: it rises straight up at each end, so the end buildings sit
// inside the dome like the rest.
const SHIELD_PATH = `M 24 ${FIELD.groundY} A ${FIELD.width / 2 - 24} 150 0 0 1 ${FIELD.width - 24} ${FIELD.groundY}`;

const cls = (...names) => names.filter(Boolean).join(' ');

// ── Pieces ──────────────────────────────────────────────────────────────────
function Backdrop() {
  return (
    <g className="skyline-invaders__backdrop">
      <defs>
        <linearGradient id="si-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="skyline-invaders__sky-stop skyline-invaders__sky-stop--top" />
          <stop offset="0.62" className="skyline-invaders__sky-stop skyline-invaders__sky-stop--mid" />
          <stop offset="1" className="skyline-invaders__sky-stop skyline-invaders__sky-stop--low" />
        </linearGradient>
        <radialGradient id="si-blast">
          <stop offset="0" className="skyline-invaders__blast-stop skyline-invaders__blast-stop--core" />
          <stop offset="0.45" className="skyline-invaders__blast-stop skyline-invaders__blast-stop--mid" />
          <stop offset="1" className="skyline-invaders__blast-stop skyline-invaders__blast-stop--edge" />
        </radialGradient>
        {TIERS.map((tier) => (
          <linearGradient key={tier} id={`si-trail-${tier}`} x1="0" y1="0" x2="0" y2="1" className={`skyline-invaders__shot--${tier}`}>
            <stop offset="0" className="skyline-invaders__trail-stop skyline-invaders__trail-stop--head" />
            <stop offset="1" className="skyline-invaders__trail-stop skyline-invaders__trail-stop--tail" />
          </linearGradient>
        ))}
      </defs>
      <rect className="skyline-invaders__sky" x={WIDE.x} y="0" width={WIDE.width} height={FIELD.groundY} fill="url(#si-sky)" />
      <g className="skyline-invaders__stars">
        {STARS.map((star, i) => (
          <rect key={i} className={star.dim ? 'is-dim' : undefined} x={star.x} y={star.y} width={star.size} height={star.size} />
        ))}
      </g>
      <g className="skyline-invaders__far">
        {FAR_BLOCKS.map((block) => (
          <rect key={block.x} x={block.x} y={FIELD.groundY - block.height} width={block.width} height={block.height} />
        ))}
      </g>
      <rect className="skyline-invaders__ground" x={WIDE.x} y={FIELD.groundY} width={WIDE.width} height={FIELD.height - FIELD.groundY} />
      <rect className="skyline-invaders__street" x={WIDE.x} y={FIELD.groundY} width={WIDE.width} height={SPRITE_PIXEL} />
    </g>
  );
}

function Base({ buildings }) {
  return (
    <g className="skyline-invaders__base">
      {buildings.map((standing, index) => {
        const art = BUILDING_ART[index % 2];
        const box = { x: buildingX(index, buildings.length) - BUILDING_SIZE.width / 2, y: FIELD.groundY - BUILDING_SIZE.height, ...BUILDING_SIZE };
        return (
          <g key={index} data-building={standing ? 'standing' : 'rubble'} className={cls('skyline-invaders__building', !standing && 'is-rubble')}>
            <PixelSprite grid={standing ? art.standing : art.rubble} {...box} />
            {standing && <PixelSprite grid={art.windows} className="skyline-invaders__windows" {...box} />}
          </g>
        );
      })}
    </g>
  );
}

const PIP = Object.freeze({ width: 8, height: 4, gap: 4 });
function Threat({ threat, timeS, assets }) {
  const spec = THREATS[threat.type] || THREATS.meteor;
  const left = threat.x - spec.width / 2;
  const top = threat.y - spec.height / 2;
  const pipsWidth = spec.hp * PIP.width + (spec.hp - 1) * PIP.gap;
  return (
    <g
      data-threat={threat.type}
      data-hp={threat.hp}
      data-x={threat.x}
      data-y={threat.y}
      className={cls('skyline-invaders__threat', `skyline-invaders__threat--${threat.type}`, threat.hp < spec.hp && 'is-hurt')}
    >
      <PixelSprite grid={threatArt(threat.type, timeS, assets).grid} x={left} y={top} width={spec.width} height={spec.height} />
      {spec.hp > 1 && Array.from({ length: spec.hp }, (_, i) => (
        <rect
          key={i}
          data-pip={i < threat.hp ? 'on' : 'off'}
          className="skyline-invaders__pip"
          x={threat.x - pipsWidth / 2 + i * (PIP.width + PIP.gap)}
          y={top + spec.height + 6}
          width={PIP.width}
          height={PIP.height}
        />
      ))}
    </g>
  );
}

function Shot({ shot }) {
  const width = 2 * shot.halfWidth;
  const x = shot.x - shot.halfWidth;
  const y = shot.y - SHOT_HEIGHT / 2;
  return (
    <g className={cls('skyline-invaders__shot', `skyline-invaders__shot--${shot.tier}`)}>
      <rect className="skyline-invaders__shot-trail" x={x} y={y + SHOT_HEIGHT} width={width} height={SHOT_HEIGHT * 3} fill={`url(#si-trail-${TIERS.includes(shot.tier) ? shot.tier : 'small'})`} />
      <rect data-shot={shot.tier} className="skyline-invaders__shot-head" x={x} y={y} width={width} height={SHOT_HEIGHT} />
    </g>
  );
}

// A bomb going off. The disc is the true blast radius for its whole life, so
// what the picture covers is what the engine destroyed; the ring, the core and
// the debris move outward over the half second the engine keeps the blast.
function Blast({ blast }) {
  const left = Math.max(0, Math.min(1, blast.ttl / BLAST_S));
  const gone = 1 - left;
  return (
    <g className="skyline-invaders__blast">
      <circle data-blast cx={blast.x} cy={blast.y} r={blast.radius} opacity={left} fill="url(#si-blast)" />
      <circle className="skyline-invaders__blast-ring" cx={blast.x} cy={blast.y} r={blast.radius * (0.4 + 0.6 * gone)} strokeWidth={2 + 10 * left} opacity={left} />
      <circle className="skyline-invaders__blast-core" cx={blast.x} cy={blast.y} r={blast.radius * 0.3 * left} />
      {BLAST_DEBRIS.map((bit, i) => {
        const reach = blast.radius * bit.reach * (0.25 + 0.75 * gone);
        const size = SPRITE_PIXEL * (1 + 2 * left);
        return (
          <rect
            key={i}
            className="skyline-invaders__blast-debris"
            x={blast.x + bit.dx * reach - size / 2}
            y={blast.y + bit.dy * reach - size / 2}
            width={size}
            height={size}
            opacity={left}
          />
        );
      })}
    </g>
  );
}

// The cannon's lane, lit from the street to the top of the sky: where a shot
// will go. Faint ticks along the street mark every lane edge.
function Lanes({ x, tier }) {
  return (
    <g className={cls('skyline-invaders__lanes', `skyline-invaders__cannon--${tier}`)}>
      <defs>
        <linearGradient id="si-column" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="skyline-invaders__column-stop skyline-invaders__column-stop--top" />
          <stop offset="1" className="skyline-invaders__column-stop skyline-invaders__column-stop--low" />
        </linearGradient>
      </defs>
      {Array.from({ length: LANES + 1 }, (_, i) => (
        <rect key={i} className="skyline-invaders__lane-tick" x={FIELD.marginX + i * LANE_WIDTH - 1} y={FIELD.groundY - 10} width="2" height="10" />
      ))}
      {x.map((value, index) => (
        <g key={index} data-column data-lane={laneOfX(value)}>
          <rect className="skyline-invaders__column" x={value - LANE_WIDTH / 2} y="0" width={LANE_WIDTH} height={FIELD.groundY} fill="url(#si-column)" />
          <rect className="skyline-invaders__column-edge" x={value - LANE_WIDTH / 2} y="0" width="3" height={FIELD.groundY} />
          <rect className="skyline-invaders__column-edge" x={value + LANE_WIDTH / 2 - 3} y="0" width="3" height={FIELD.groundY} />
        </g>
      ))}
    </g>
  );
}

// Corner brackets around the threat the next shot will meet.
function TargetMark({ threat }) {
  const spec = THREATS[threat.type] || THREATS.meteor;
  const pad = 10;
  const left = threat.x - spec.width / 2 - pad;
  const right = threat.x + spec.width / 2 + pad;
  const top = threat.y - spec.height / 2 - pad;
  const bottom = threat.y + spec.height / 2 + pad;
  const arm = 14;
  const d = [
    `M ${left} ${top + arm} V ${top} H ${left + arm}`, `M ${right - arm} ${top} H ${right} V ${top + arm}`,
    `M ${right} ${bottom - arm} V ${bottom} H ${right - arm}`, `M ${left + arm} ${bottom} H ${left} V ${bottom - arm}`,
  ].join(' ');
  return <path data-target={threat.id} className="skyline-invaders__target" d={d} />;
}

// Practice targets for the controls intro: a ring over a lane (or a pair of
// lanes), lit while the cannon stands under it and ticked once it has been
// reached. They sit low, just over the rooftops: the card and its keys take
// the top of the screen.
const PRACTICE_Y = 452;
function PracticeTargets({ targets }) {
  return (
    <g className="skyline-invaders__practice">
      {targets.map((target) => {
        const centre = target.lanes.reduce((sum, lane) => sum + laneX(lane), 0) / target.lanes.length;
        return (
          <g key={target.id} data-practice-target={target.id} data-lit={!!target.lit} data-reached={!!target.reached} className={cls('skyline-invaders__practice-target', target.lit && 'is-lit', target.reached && 'is-reached')}>
            <circle cx={centre} cy={PRACTICE_Y} r="40" />
            <circle className="skyline-invaders__practice-core" cx={centre} cy={PRACTICE_Y} r="16" />
            {target.reached && <path className="skyline-invaders__practice-tick" d={`M ${centre - 18} ${PRACTICE_Y} l 12 14 l 24 -30`} />}
          </g>
        );
      })}
    </g>
  );
}

const OUTLINE = Object.freeze([[-SPRITE_PIXEL, 0], [SPRITE_PIXEL, 0], [0, -SPRITE_PIXEL]]);
const FUEL_BAR = Object.freeze({ width: 96, height: 16, y: FIELD.groundY + 14 });
function Cannon({ x, tier, twin, rapid, ready, fuel, assets }) {
  const { grid } = cannonArt(assets);
  return (
    <g
      data-cannon
      data-x={x}
      data-lane={laneOfX(x)}
      data-tier={tier}
      className={cls('skyline-invaders__cannon', `skyline-invaders__cannon--${tier}`, twin && 'is-twin', rapid && 'is-rapid', ready && 'is-bomb-ready')}
      style={{ transform: `translate(${x}px, 0px)` }}
    >
      {/* The cannon passes in front of the buildings: a dark outline keeps it apart from them. */}
      {OUTLINE.map(([dx, dy]) => (
        <PixelSprite key={`${dx},${dy}`} grid={grid} className="skyline-invaders__cannon-outline" x={-CANNON.width / 2 + dx} y={FIELD.groundY - CANNON.height + dy} width={CANNON.width} height={CANNON.height} />
      ))}
      <PixelSprite grid={grid} className="skyline-invaders__cannon-body" x={-CANNON.width / 2} y={FIELD.groundY - CANNON.height} width={CANNON.width} height={CANNON.height} />
      <rect className="skyline-invaders__muzzle" x={-SPRITE_PIXEL * 1.5} y={FIELD.groundY - CANNON.height} width={SPRITE_PIXEL * 3} height={SPRITE_PIXEL} />
      {/* Fuel, under the cannon, where the shooter is already looking. */}
      {fuel && !twin && (
        <g data-fuel-bar data-empty={!(fuel.value > 0)} className={cls('skyline-invaders__fuel-bar', !(fuel.value > 0) && 'is-empty')}>
          <rect className="skyline-invaders__fuel-track" x={-FUEL_BAR.width / 2} y={FUEL_BAR.y} width={FUEL_BAR.width} height={FUEL_BAR.height} />
          <rect className="skyline-invaders__fuel-fill" x={-FUEL_BAR.width / 2} y={FUEL_BAR.y} width={FUEL_BAR.width * Math.min(1, Math.max(0, fuel.value / fuel.cap))} height={FUEL_BAR.height} />
        </g>
      )}
    </g>
  );
}

function Pop({ pop }) {
  if (pop.kind === 'kill') {
    return (
      <g data-pop="kill" className={cls('skyline-invaders__pop', 'skyline-invaders__pop--kill', pop.threat && `skyline-invaders__threat--${pop.threat}`)}>
        {BURST.map((bit, i) => (
          <rect key={i} className="skyline-invaders__pop-bit" x={pop.x - 3} y={pop.y - 3} width="6" height="6" style={{ '--si-dx': `${bit.dx}px`, '--si-dy': `${bit.dy}px` }} />
        ))}
        {pop.points > 0 && <text className="skyline-invaders__pop-points" x={pop.x} y={pop.y - 14} textAnchor="middle">{`+${pop.points}`}</text>}
      </g>
    );
  }
  if (pop.kind === 'impact') {
    return (
      <g data-pop="impact" className="skyline-invaders__pop skyline-invaders__pop--impact">
        {BURST.filter((bit) => bit.dy < 0).map((bit, i) => (
          <rect key={i} className="skyline-invaders__pop-bit" x={pop.x - 4} y={FIELD.groundY - 8} width="8" height="8" style={{ '--si-dx': `${bit.dx * 1.6}px`, '--si-dy': `${bit.dy * 1.6}px` }} />
        ))}
        <rect className="skyline-invaders__pop-flash" x={pop.x - 44} y={FIELD.groundY - 6} width="88" height="12" />
      </g>
    );
  }
  return (
    <g data-pop="hit" className="skyline-invaders__pop skyline-invaders__pop--hit">
      <rect className="skyline-invaders__pop-flash" x={pop.x - 10} y={pop.y - 10} width="20" height="20" />
    </g>
  );
}

// ── Scene ───────────────────────────────────────────────────────────────────
/**
 * @param {object} props
 * @param {object} props.state    engine state (engine.js)
 * @param {object} props.level    the validated level being played
 * @param {number|number[]} props.aim  0..1 per cannon (a lane centre); two values only on a two-cannon level
 * @param {boolean} [props.twin]  a twin boost is running: draw the mirrored cannon
 * @param {boolean} [props.live]  a round (or a tryout) is on: draw the lit lane, the target mark and the fuel bar
 * @param {object[]} [props.targets] practice targets for the controls intro: [{ id, lanes, lit, reached }]
 * @param {object} [props.effects] `{ pops, shakeKey, shakeKind }` from invadersEffects.js
 * @param {object} [props.assets] skin assets (unused until skins land)
 */
export default function InvadersScene({ state, level, aim, twin = false, live = true, targets = null, effects = null, assets = null }) {
  const aims = (Array.isArray(aim) ? aim : [aim]).slice(0, level?.cannons === 2 ? 2 : 1);
  const cannons = aims.map((value) => ({ x: aimToX(value), twin: false }));
  if (twin) cannons.push({ x: aimToX(1 - (typeof aims[0] === 'number' ? aims[0] : 0.5)), twin: true });
  const active = state.boost?.active || null;
  const tier = weaponTier(state.weapon);
  const ready = bombReady(state.weapon);
  const fuel = live && !targets ? { value: state.fuel || 0, cap: fireRules(level).fuel_cap_s } : null;
  const marked = live ? [...new Set(cannons.map((cannon) => nextTarget(state.threats, cannon.x, SHOT_TIERS[tier].halfWidth)).filter(Boolean))] : [];
  const shake = effects?.shakeKey ? `${effects.shakeKind || 'hit'}-${effects.shakeKey % 2 ? 'b' : 'a'}` : 'none';
  // The first tenth of a second of a blast lights the whole sky.
  const flash = state.blasts.reduce((most, blast) => Math.max(most, (blast.ttl - 0.4) / 0.1), 0);
  return (
    <svg
      className="skyline-invaders__scene"
      viewBox={`0 0 ${FIELD.width} ${FIELD.height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Skyline Invaders playfield"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g data-shake={shake} className="skyline-invaders__stage">
        <Backdrop />
        {live && <Lanes x={cannons.map((cannon) => cannon.x)} tier={ready ? 'bomb' : tier} />}
        <Base buildings={state.base.buildings} />
        {targets && <PracticeTargets targets={targets} />}
        <g className="skyline-invaders__threats">
          {state.threats.map((threat) => <Threat key={threat.id} threat={threat} timeS={state.time} assets={assets} />)}
          {marked.map((threat) => <TargetMark key={threat.id} threat={threat} />)}
        </g>
        <g className="skyline-invaders__shots">
          {state.shots.map((shot) => <Shot key={shot.id} shot={shot} />)}
        </g>
        <g className="skyline-invaders__blasts">
          {flash > 0 && <rect className="skyline-invaders__sky-flash" x={WIDE.x} y="0" width={WIDE.width} height={FIELD.height} opacity={Math.min(1, flash) * 0.22} />}
          {state.blasts.map((blast) => <Blast key={blast.id} blast={blast} />)}
        </g>
        {cannons.map((cannon, index) => (
          <Cannon key={index} x={cannon.x} tier={ready ? 'bomb' : tier} twin={cannon.twin} rapid={active?.kind === 'rapid'} ready={ready} fuel={fuel} assets={assets} />
        ))}
        {active?.kind === 'shield' && (
          <path
            data-shield
            className={cls('skyline-invaders__shield', active.remaining < 2 && Math.floor(state.time * 6) % 2 === 0 && 'is-fading')}
            d={SHIELD_PATH}
          />
        )}
        <g className="skyline-invaders__pops">
          {(effects?.pops || []).map((pop) => <Pop key={pop.key} pop={pop} />)}
        </g>
      </g>
    </svg>
  );
}
