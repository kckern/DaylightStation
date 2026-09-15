import { useMemo } from 'react';
import {
  GROUND_Y, PLAYER_X, PLAYER_HEIGHT, PLAYER_DUCK_HEIGHT, PLAYER_WIDTH,
  PELLET_WIDTH, PELLET_HEIGHT, isShootable,
} from '../sideScrollerEngine.js';
import { getSpriteFrame, frameToPosition } from '../sideScrollerTheme.js';
import './RunnerCanvas.scss';

/** Normalize displaySize (number | {width,height}) into px CSS values. */
function spriteSize(displaySize) {
  if (displaySize && typeof displaySize === 'object') {
    return { width: `${displaySize.width}px`, height: `${displaySize.height}px` };
  }
  return { width: `${displaySize}px`, height: `${displaySize}px` };
}

/** Background style for an obstacle: image skin if `src`, else procedural CSS. */
function obstacleStyle(skin) {
  if (skin?.src) {
    return { backgroundImage: `url(${skin.src})`, backgroundSize: '100% 100%' };
  }
  const [from, to] = skin?.fill ?? ['#888', '#555'];
  const border = skin?.border ?? from;
  return {
    background: `linear-gradient(180deg, ${from} 0%, ${to} 100%)`,
    border: `2px solid ${border}`,
    boxShadow: `inset 0 1px 0 rgba(255, 255, 255, 0.35), 0 0 6px ${border}80`,
  };
}

// A broken block becomes its four quarters, each flung outward and down.
const SHARDS = [
  { x: 0, y: 0, dx: -1, dy: -1 },
  { x: 50, y: 0, dx: 1, dy: -1 },
  { x: 0, y: 50, dx: -1, dy: 0.4 },
  { x: 50, y: 50, dx: 1, dy: 0.4 },
];

// The classic burst: eight directions, a fast outer ring and a slow inner one.
const ORBS = Array.from({ length: 16 }, (_, i) => {
  const angle = (i % 8) * (Math.PI / 4);
  return { ux: Math.cos(angle), uy: Math.sin(angle), reach: i < 8 ? 75 : 40 };
});

function Obstacle({ ob, skin }) {
  const shootable = isShootable(ob.type);
  const cls = [
    'runner-canvas__obstacle',
    ob.hit && 'runner-canvas__obstacle--hit',
    shootable && !skin?.src && skin?.pattern && `runner-canvas__obstacle--${skin.pattern}`,
    shootable && !ob.broken && ob.hp < ob.maxHp && 'runner-canvas__obstacle--cracked',
    ob.broken && 'runner-canvas__obstacle--broken',
  ].filter(Boolean).join(' ');
  const box = {
    left: `${ob.x * 100}%`,
    top: `${ob.y * 100}%`,
    width: `${ob.width * 100}%`,
    height: `${ob.height * 100}%`,
  };

  if (ob.broken) {
    return (
      <div className={cls} style={box}>
        {SHARDS.map((shard, i) => (
          <div
            key={i}
            className="runner-canvas__shard"
            style={{ left: `${shard.x}%`, top: `${shard.y}%`, '--dx': shard.dx, '--dy': shard.dy, ...obstacleStyle(skin) }}
          />
        ))}
      </div>
    );
  }
  return <div className={cls} style={{ ...box, ...obstacleStyle(skin) }} />;
}

function DeathBurst({ x, y, explosion }) {
  const fill = `radial-gradient(circle, ${explosion.core} 0 30%, ${explosion.ring} 31% 55%, ${explosion.edge} 56% 100%)`;
  return (
    <div className="runner-canvas__burst" style={{ left: `${x * 100}%`, top: `${y * 100}%` }}>
      {ORBS.map((orb, i) => (
        <div key={i} className="runner-canvas__orb" style={{ '--ux': orb.ux, '--uy': orb.uy, '--reach': `${orb.reach}vmax` }}>
          <div className="runner-canvas__orb-body" style={{ width: explosion.size, height: explosion.size, background: fill }} />
        </div>
      ))}
    </div>
  );
}

/**
 * Renders the side-scroller game world: ground, player sprite, pellets,
 * obstacles, and the death burst. All appearance comes from the resolved
 * `theme`; positions are normalized 0-1 and rendered via percentage CSS.
 */
export function RunnerCanvas({ world, invincible, shooting, phase, theme }) {
  const dying = phase === 'DYING';
  const playerH = world.playerState === 'ducking' ? PLAYER_DUCK_HEIGHT : PLAYER_HEIGHT;
  const playerTop = (world.playerY - playerH) * 100;
  const playerLeft = PLAYER_X * 100;

  // Ground scroll position — cycles background pattern
  const groundOffset = useMemo(
    () => (world.worldPos * 500) % 1000,
    [world.worldPos]
  );

  const idle = phase !== 'PLAYING';
  const spriteFrame = getSpriteFrame(world.playerState, world.worldPos, { idle, invincible, shooting }, theme);

  const { player, projectile, obstacles, explosion, background, ground } = theme;
  const { width: spriteW, height: spriteH } = spriteSize(player.displaySize);
  const spriteBgSize = `${player.grid.cols * 100}% ${player.grid.rows * 100}%`;

  // The pellet reuses the player sheet unless the theme names its own
  const pelletGrid = projectile.grid ?? player.grid;
  const pelletSprite = {
    backgroundImage: `url(${projectile.src ?? player.src})`,
    backgroundPosition: frameToPosition(projectile.frame, pelletGrid),
    backgroundSize: `${pelletGrid.cols * 100}% ${pelletGrid.rows * 100}%`,
    ...spriteSize(projectile.displaySize),
  };

  const canvasBg = background.src ? { backgroundImage: `url(${background.src})` } : { background: background.color };

  return (
    <div className="runner-canvas" style={canvasBg}>
      {/* Ground platform */}
      <div
        className="runner-canvas__ground"
        style={{ top: `${GROUND_Y * 100}%`, background: ground.color }}
      />
      <div
        className="runner-canvas__ground-scroll"
        style={{
          top: `${GROUND_Y * 100}%`,
          backgroundPositionX: `${-groundOffset}px`,
        }}
      />

      {/* Player sprite — replaced by the burst while dying */}
      {!dying && (
        <div
          className={[
            'runner-canvas__player',
            invincible && 'runner-canvas__player--invincible',
          ].filter(Boolean).join(' ')}
          style={{
            left: `${playerLeft}%`,
            top: `${playerTop}%`,
            width: `${PLAYER_WIDTH * 100}%`,
            height: `${playerH * 100}%`,
          }}
        >
          <div
            className="runner-canvas__sprite"
            style={{
              backgroundImage: `url(${player.src})`,
              backgroundPosition: spriteFrame,
              backgroundSize: spriteBgSize,
              width: spriteW,
              height: spriteH,
            }}
          />
        </div>
      )}
      {dying && (
        <DeathBurst x={PLAYER_X + PLAYER_WIDTH / 2} y={world.playerY - playerH / 2} explosion={explosion} />
      )}

      {/* Pellets */}
      {(world.projectiles ?? []).map((pellet) => (
        <div
          key={pellet.id}
          className="runner-canvas__pellet"
          style={{ left: `${(pellet.x + PELLET_WIDTH / 2) * 100}%`, top: `${(pellet.y + PELLET_HEIGHT / 2) * 100}%` }}
        >
          <div className="runner-canvas__pellet-sprite" style={pelletSprite} />
        </div>
      ))}

      {/* Obstacles */}
      {world.obstacles.map((ob, i) => (
        <Obstacle key={ob.id ?? `legacy-${i}`} ob={ob} skin={obstacles[ob.type] ?? obstacles.high} />
      ))}
    </div>
  );
}
