import React from 'react';
import './SkylineInvaders.scss';

// A stick figure showing one aim gesture, drawn large enough to copy from
// across the garage. Original art: a head, a torso, two legs, and arms that a
// stylesheet animation moves (SkylineInvaders.scss, `si-demo-*`). The figure
// faces the player like a mirror: its arm on the right of the picture is the
// player's right arm.
//
// Geometry, in the 200 x 230 viewBox: shoulders at (70, 74) and (130, 74),
// elbows hang at (62, 116) and (138, 116). Each moving part is a <g> whose
// transform-origin is set in the stylesheet to the joint it turns about.

const Body = () => (
  <g className="skyline-invaders__demo-body">
    <circle cx="100" cy="40" r="20" />
    <line x1="100" y1="62" x2="100" y2="150" />
    <line x1="100" y1="150" x2="78" y2="214" />
    <line x1="100" y1="150" x2="122" y2="214" />
  </g>
);
const Shoulders = () => <line className="skyline-invaders__demo-body" x1="70" y1="74" x2="130" y2="74" />;
const Hand = ({ cx, cy }) => <circle className="skyline-invaders__demo-hand" cx={cx} cy={cy} r="9" />;
// An arm hanging at rest, for the side a gesture does not use.
const RestArm = ({ side }) => (side === 'left'
  ? <g className="skyline-invaders__demo-arm"><line x1="70" y1="74" x2="58" y2="140" /><Hand cx="58" cy="140" /></g>
  : <g className="skyline-invaders__demo-arm"><line x1="130" y1="74" x2="142" y2="140" /><Hand cx="142" cy="140" /></g>);

const PARTS = {
  // Elbows in, forearms up, tilting together about the elbows.
  wiper: () => (
    <>
      <Shoulders />
      <g className="skyline-invaders__demo-arm">
        <line x1="70" y1="74" x2="62" y2="116" />
        <line x1="130" y1="74" x2="138" y2="116" />
        <g className="skyline-invaders__demo-move skyline-invaders__demo-move--elbow-left"><line x1="62" y1="116" x2="62" y2="62" /><Hand cx="62" cy="62" /></g>
        <g className="skyline-invaders__demo-move skyline-invaders__demo-move--elbow-right"><line x1="138" y1="116" x2="138" y2="62" /><Hand cx="138" cy="62" /></g>
      </g>
    </>
  ),
  // Arms straight out in front (seen end-on as two hands at the chest); the
  // whole upper body turns, so the shoulder line narrows and the hands swing across.
  twist: () => (
    <g className="skyline-invaders__demo-move skyline-invaders__demo-move--turn">
      <Shoulders />
      <g className="skyline-invaders__demo-arm"><Hand cx="88" cy="92" /><Hand cx="112" cy="92" /></g>
    </g>
  ),
  // Arms out wide, the whole line banking about the chest.
  wings: () => (
    <g className="skyline-invaders__demo-move skyline-invaders__demo-move--chest">
      <g className="skyline-invaders__demo-arm"><line x1="14" y1="74" x2="186" y2="74" /><Hand cx="14" cy="74" /><Hand cx="186" cy="74" /></g>
    </g>
  ),
  // Hands on a wheel in front of the chest; the wheel turns.
  wheel: () => (
    <>
      <Shoulders />
      <g className="skyline-invaders__demo-arm skyline-invaders__demo-arm--faint"><line x1="70" y1="74" x2="76" y2="108" /><line x1="130" y1="74" x2="124" y2="108" /></g>
      <g className="skyline-invaders__demo-move skyline-invaders__demo-move--wheel">
        <circle className="skyline-invaders__demo-prop" cx="100" cy="108" r="30" />
        <line className="skyline-invaders__demo-prop" x1="70" y1="108" x2="130" y2="108" />
        <g className="skyline-invaders__demo-arm"><Hand cx="70" cy="108" /><Hand cx="130" cy="108" /></g>
      </g>
    </>
  ),
  // Both arms meet at clasped hands, which sweep from side to side.
  sprinkler: () => (
    <>
      <Shoulders />
      <g className="skyline-invaders__demo-move skyline-invaders__demo-move--sweep">
        <g className="skyline-invaders__demo-arm"><line x1="70" y1="74" x2="100" y2="128" /><line x1="130" y1="74" x2="100" y2="128" /><Hand cx="100" cy="128" /></g>
      </g>
    </>
  ),
  // One hand held out to the side, and kept there.
  drag: () => (
    <>
      <Shoulders />
      <RestArm side="left" />
      <g className="skyline-invaders__demo-move skyline-invaders__demo-move--shoulder-right skyline-invaders__demo-move--hold">
        <g className="skyline-invaders__demo-arm"><line x1="130" y1="74" x2="130" y2="140" /><Hand cx="130" cy="140" /></g>
      </g>
    </>
  ),
  // One hand whipped out to the side, then brought back slowly.
  push: () => (
    <>
      <Shoulders />
      <RestArm side="left" />
      <g className="skyline-invaders__demo-move skyline-invaders__demo-move--shoulder-right skyline-invaders__demo-move--swipe">
        <g className="skyline-invaders__demo-arm"><line x1="130" y1="74" x2="130" y2="140" /><Hand cx="130" cy="140" /></g>
      </g>
    </>
  ),
  // One hand up to the shoulder (or punched out), then the other.
  hop: () => (
    <>
      <Shoulders />
      <g className="skyline-invaders__demo-move skyline-invaders__demo-move--shoulder-left skyline-invaders__demo-move--hop-left">
        <g className="skyline-invaders__demo-arm"><line x1="70" y1="74" x2="70" y2="140" /><Hand cx="70" cy="140" /></g>
      </g>
      <g className="skyline-invaders__demo-move skyline-invaders__demo-move--shoulder-right skyline-invaders__demo-move--hop-right">
        <g className="skyline-invaders__demo-arm"><line x1="130" y1="74" x2="130" y2="140" /><Hand cx="130" cy="140" /></g>
      </g>
    </>
  ),
};

/** @param {{ gesture: string }} props  one of gestures.js GESTURES */
export default function GestureDemo({ gesture }) {
  const Parts = PARTS[gesture] || PARTS.wiper;
  return (
    <svg className={`skyline-invaders__demo skyline-invaders__demo--${gesture}`} data-demo={gesture} viewBox="0 0 200 230" role="img" aria-label={`How to move: ${gesture}`}>
      <Body />
      <Parts />
    </svg>
  );
}
