import { useMemo } from 'react';
import {
  GROUND_Y, PLAYER_X, PLAYER_HEIGHT, PLAYER_DUCK_HEIGHT, PLAYER_WIDTH,
} from '../sideScrollerEngine.js';
import { getSpriteFrame } from '../sideScrollerTheme.js';
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

/**
 * Renders the side-scroller game world: ground, player sprite, obstacles.
 * All appearance comes from the resolved `theme`; positions are normalized 0-1
 * and rendered via percentage CSS.
 */
export function RunnerCanvas({ world, invincible, phase, theme }) {
  const playerH = world.playerState === 'ducking' ? PLAYER_DUCK_HEIGHT : PLAYER_HEIGHT;
  const playerTop = (world.playerY - playerH) * 100;
  const playerLeft = PLAYER_X * 100;

  // Ground scroll position — cycles background pattern
  const groundOffset = useMemo(
    () => (world.worldPos * 500) % 1000,
    [world.worldPos]
  );

  const idle = phase !== 'PLAYING';
  const spriteFrame = getSpriteFrame(world.playerState, world.worldPos, { idle, invincible }, theme);

  const { player, obstacles, background, ground } = theme;
  const { width: spriteW, height: spriteH } = spriteSize(player.displaySize);
  const spriteBgSize = `${player.grid.cols * 100}% ${player.grid.rows * 100}%`;

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

      {/* Player sprite */}
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

      {/* Obstacles */}
      {world.obstacles.map((ob, i) => (
        <div
          key={i}
          className={[
            'runner-canvas__obstacle',
            ob.hit && 'runner-canvas__obstacle--hit',
          ].filter(Boolean).join(' ')}
          style={{
            left: `${ob.x * 100}%`,
            top: `${ob.y * 100}%`,
            width: `${ob.width * 100}%`,
            height: `${ob.height * 100}%`,
            ...obstacleStyle(obstacles[ob.type]),
          }}
        />
      ))}
    </div>
  );
}
