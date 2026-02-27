import { useMemo } from 'react';
import {
  GROUND_Y, PLAYER_X, PLAYER_HEIGHT, PLAYER_DUCK_HEIGHT, PLAYER_WIDTH,
} from '../sideScrollerEngine.js';
import './RunnerCanvas.scss';

const SPRITE_URL = '/api/v1/static/img/sprites/megaman-sprites.png';

// Sprite sheet: 5 columns x 6 rows
// Col positions: 0%=0, 25%=1, 50%=2, 75%=3, 100%=4
// Row positions: 0%=0, 20%=1, 40%=2, 60%=3, 80%=4, 100%=5
const SPRITE_FRAMES = {
  stand:  '0% 0%',       // row 0, col 0 — passive init pose
  run1:   '0% 20%',      // row 1, col 0
  run2:   '25% 20%',     // row 1, col 1
  run3:   '50% 20%',     // row 1, col 2
  run4:   '75% 20%',     // row 1, col 3
  jump:   '100% 0%',     // row 0, col 4
  duck:   '0% 60%',      // row 3, col 0
  hit:    '50% 60%',     // row 3, col 2
};

const RUN_FRAMES = [SPRITE_FRAMES.run1, SPRITE_FRAMES.run2, SPRITE_FRAMES.run3, SPRITE_FRAMES.run4];

function getSpriteFrame(state, worldPos, { idle, invincible } = {}) {
  if (idle) return SPRITE_FRAMES.stand;
  if (invincible) return SPRITE_FRAMES.hit;
  if (state === 'jumping') return SPRITE_FRAMES.jump;
  if (state === 'ducking') return SPRITE_FRAMES.duck;
  // Running: cycle through 4 walk frames based on world position
  const frameIdx = Math.floor((worldPos * 32) % 4);
  return RUN_FRAMES[frameIdx];
}

/**
 * Renders the side-scroller game world: ground, Mega Man sprite, obstacles.
 * All positions are normalized 0-1 and rendered via percentage CSS.
 */
export function RunnerCanvas({ world, scrollSpeed, invincible, phase }) {
  const playerH = world.playerState === 'ducking' ? PLAYER_DUCK_HEIGHT : PLAYER_HEIGHT;
  const playerTop = (world.playerY - playerH) * 100;
  const playerLeft = PLAYER_X * 100;

  // Ground scroll position — cycles background pattern
  const groundOffset = useMemo(
    () => (world.worldPos * 500) % 1000,
    [world.worldPos]
  );

  const idle = phase !== 'PLAYING';
  const spriteFrame = getSpriteFrame(world.playerState, world.worldPos, { idle, invincible });

  return (
    <div className="runner-canvas">
      {/* Ground platform */}
      <div
        className="runner-canvas__ground"
        style={{ top: `${GROUND_Y * 100}%` }}
      />
      <div
        className="runner-canvas__ground-scroll"
        style={{
          top: `${GROUND_Y * 100}%`,
          backgroundPositionX: `${-groundOffset}px`,
        }}
      />

      {/* Mega Man sprite */}
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
            backgroundImage: `url(${SPRITE_URL})`,
            backgroundPosition: spriteFrame,
          }}
        />
      </div>

      {/* Obstacles */}
      {world.obstacles.map((ob, i) => (
        <div
          key={i}
          className={[
            'runner-canvas__obstacle',
            `runner-canvas__obstacle--${ob.type}`,
            ob.hit && 'runner-canvas__obstacle--hit',
          ].filter(Boolean).join(' ')}
          style={{
            left: `${ob.x * 100}%`,
            top: `${ob.y * 100}%`,
            width: `${ob.width * 100}%`,
            height: `${ob.height * 100}%`,
          }}
        />
      ))}
    </div>
  );
}
