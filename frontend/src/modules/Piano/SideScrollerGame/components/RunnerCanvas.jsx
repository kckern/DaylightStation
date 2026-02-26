import { useMemo } from 'react';
import {
  GROUND_Y, PLAYER_X, PLAYER_HEIGHT, PLAYER_DUCK_HEIGHT, PLAYER_WIDTH,
} from '../sideScrollerEngine.js';
import './RunnerCanvas.scss';

/**
 * Renders the side-scroller game world: ground, stick figure, obstacles.
 * All positions are normalized 0-1 and rendered via percentage CSS.
 */
export function RunnerCanvas({ world, scrollSpeed, invincible }) {
  const playerH = world.playerState === 'ducking' ? PLAYER_DUCK_HEIGHT : PLAYER_HEIGHT;
  const playerTop = (world.playerY - playerH) * 100;
  const playerLeft = PLAYER_X * 100;

  // Ground scroll position — cycles background pattern
  const groundOffset = useMemo(
    () => (world.worldPos * 500) % 100,
    [world.worldPos]
  );

  return (
    <div className="runner-canvas">
      {/* Ground line */}
      <div
        className="runner-canvas__ground"
        style={{
          top: `${GROUND_Y * 100}%`,
          backgroundPositionX: `${-groundOffset}px`,
        }}
      />

      {/* Stick figure */}
      <div
        className={[
          'runner-canvas__player',
          `runner-canvas__player--${world.playerState}`,
          invincible && 'runner-canvas__player--invincible',
        ].filter(Boolean).join(' ')}
        style={{
          left: `${playerLeft}%`,
          top: `${playerTop}%`,
          width: `${PLAYER_WIDTH * 100}%`,
          height: `${playerH * 100}%`,
        }}
      >
        <StickFigure state={world.playerState} />
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

/**
 * SVG stick figure with three poses: running, jumping, ducking.
 */
function StickFigure({ state }) {
  return (
    <svg className="runner-canvas__figure-svg" viewBox="0 0 40 100" preserveAspectRatio="xMidYMax meet">
      {state === 'running' && (
        <>
          {/* Head */}
          <circle cx="20" cy="15" r="10" fill="none" stroke="white" strokeWidth="3" />
          {/* Body */}
          <line x1="20" y1="25" x2="20" y2="60" stroke="white" strokeWidth="3" />
          {/* Arms */}
          <line x1="20" y1="35" x2="5" y2="48" stroke="white" strokeWidth="3" />
          <line x1="20" y1="35" x2="35" y2="48" stroke="white" strokeWidth="3" />
          {/* Legs — spread for running */}
          <line x1="20" y1="60" x2="8" y2="85" stroke="white" strokeWidth="3" />
          <line x1="20" y1="60" x2="32" y2="85" stroke="white" strokeWidth="3" />
          {/* Feet */}
          <line x1="8" y1="85" x2="3" y2="85" stroke="white" strokeWidth="3" />
          <line x1="32" y1="85" x2="37" y2="85" stroke="white" strokeWidth="3" />
        </>
      )}
      {state === 'jumping' && (
        <>
          {/* Head */}
          <circle cx="20" cy="10" r="10" fill="none" stroke="white" strokeWidth="3" />
          {/* Body */}
          <line x1="20" y1="20" x2="20" y2="50" stroke="white" strokeWidth="3" />
          {/* Arms raised */}
          <line x1="20" y1="30" x2="5" y2="18" stroke="white" strokeWidth="3" />
          <line x1="20" y1="30" x2="35" y2="18" stroke="white" strokeWidth="3" />
          {/* Legs tucked */}
          <line x1="20" y1="50" x2="10" y2="65" stroke="white" strokeWidth="3" />
          <line x1="20" y1="50" x2="30" y2="65" stroke="white" strokeWidth="3" />
          <line x1="10" y1="65" x2="12" y2="75" stroke="white" strokeWidth="3" />
          <line x1="30" y1="65" x2="28" y2="75" stroke="white" strokeWidth="3" />
        </>
      )}
      {state === 'ducking' && (
        <>
          {/* Head — lower */}
          <circle cx="28" cy="25" r="9" fill="none" stroke="white" strokeWidth="3" />
          {/* Body — bent forward */}
          <line x1="25" y1="33" x2="15" y2="55" stroke="white" strokeWidth="3" />
          {/* Arms forward */}
          <line x1="20" y1="42" x2="32" y2="50" stroke="white" strokeWidth="3" />
          {/* Legs wide */}
          <line x1="15" y1="55" x2="5" y2="85" stroke="white" strokeWidth="3" />
          <line x1="15" y1="55" x2="30" y2="85" stroke="white" strokeWidth="3" />
          {/* Feet */}
          <line x1="5" y1="85" x2="0" y2="85" stroke="white" strokeWidth="3" />
          <line x1="30" y1="85" x2="35" y2="85" stroke="white" strokeWidth="3" />
        </>
      )}
    </svg>
  );
}
