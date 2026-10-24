import React from 'react';

// Built-in SVG art, addressed by a zone's `draw:` names. These are the original
// Skyline Glider drawings and the fallback for any slot whose file is missing.

export const SCENE_WIDTH = 1000;
export const SCENE_HEIGHT = 600;

export function SceneDefs() {
  return <defs>
    <linearGradient id="glider-sky" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#78bce8"/><stop offset="1" stopColor="#f8d69a"/></linearGradient>
    <linearGradient id="glider-rock" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#42685e"/><stop offset="1" stopColor="#193d38"/></linearGradient>
  </defs>;
}

// Backdrops repeat every 1000 units; the caller translates by the scroll offset.
const BACKDROP_PATHS = {
  'alpine-far': { className: 'far', d: 'M0 420 L130 250 260 420 420 210 590 420 760 260 1000 420 1130 250 1260 420 1420 210 1590 420 1760 260 2000 420 V600 H0Z' },
  'alpine-middle': { className: 'middle', d: 'M0 490 L170 360 330 480 520 330 690 490 860 350 1000 470 1170 360 1330 480 1520 330 1690 490 1860 350 2000 470 V600 H0Z' },
  'alpine-near': { className: 'near', d: 'M0 535 Q180 465 350 530 T700 510 T1000 530 Q1180 465 1350 530 T1700 510 T2000 530 V600 H0Z' },
};

export function BackdropPreset({ draw, offset = 0 }) {
  if (draw === 'alpine-sky') return <rect width={SCENE_WIDTH} height={SCENE_HEIGHT} fill="url(#glider-sky)"/>;
  const preset = BACKDROP_PATHS[draw];
  if (!preset) return null;
  return <g className={`skyline-glider__parallax skyline-glider__parallax--${preset.className}`} transform={`translate(${-(offset % SCENE_WIDTH)} 0)`}>
    <path d={preset.d}/>
  </g>;
}

export const hasBackdropPreset = (draw) => draw === 'alpine-sky' || draw in BACKDROP_PATHS;

export function TerrainPreset({ segment }) {
  const width = Math.max(4, segment.width);
  if (segment.type === 'lower-terrain') {
    const y = segment.top * SCENE_HEIGHT;
    return <>
      <rect x={segment.x} y={y} width={width} height={SCENE_HEIGHT - y} className="skyline-glider__terrain skyline-glider__terrain--lower"/>
      <path d={`M${segment.x} ${y} l22 24 28 -24 32 34 34 -34 H${segment.x + width}`} className="skyline-glider__snowline"/>
    </>;
  }
  if (segment.type === 'upper-terrain') {
    const y = segment.bottom * SCENE_HEIGHT;
    return <>
      <rect x={segment.x} y="0" width={width} height={y} className="skyline-glider__terrain skyline-glider__terrain--upper"/>
      <path d={`M${segment.x} ${y} l24 -20 28 20 30 -28 34 28 H${segment.x + width}`} className="skyline-glider__cave-edge"/>
    </>;
  }
  if (segment.type === 'corridor') {
    const ceiling = segment.ceiling * SCENE_HEIGHT;
    const floor = segment.floor * SCENE_HEIGHT;
    return <>
      <rect x={segment.x} y="0" width={width} height={ceiling} className="skyline-glider__terrain skyline-glider__terrain--upper"/>
      <rect x={segment.x} y={floor} width={width} height={SCENE_HEIGHT - floor} className="skyline-glider__terrain skyline-glider__terrain--lower"/>
      <path d={`M${segment.x} ${ceiling} H${segment.x + width} M${segment.x} ${floor} H${segment.x + width}`} className="skyline-glider__corridor-edge"/>
    </>;
  }
  return null;
}

export function CheckpointPreset() {
  return <><line x1="0" y1="90" x2="0" y2="530"/><path d="M0 100 h72 l-20 25 20 25 H0Z"/></>;
}

export function FinishPreset() {
  return <path d="M-45 510 V170 Q0 80 45 170 V510"/>;
}

export function BellPreset() {
  return <><path d="M-12 9 Q-9 1 -7 -10 Q0 -18 7 -10 Q9 1 12 9Z"/><circle cy="12" r="3"/></>;
}

// Entity drawings fill a 100×100 box stretched over the entity's hitbox.
const ENTITY_DRAWINGS = {
  pine: <>
    <rect x="44" y="78" width="12" height="22" className="skyline-glider__entity-trunk"/>
    <path d="M50 0 L80 38 H64 L88 66 H70 L96 84 H4 L30 66 H12 L36 38 H20Z" className="skyline-glider__entity-leaf"/>
  </>,
  chalet: <>
    <path d="M8 44 H92 V100 H8Z" className="skyline-glider__entity-wall"/>
    <path d="M0 48 L50 4 L100 48Z" className="skyline-glider__entity-roof"/>
    <rect x="40" y="66" width="20" height="34" className="skyline-glider__entity-door"/>
  </>,
  boulder: <path d="M4 100 C0 70 14 36 40 22 C62 10 88 24 96 56 C100 76 98 92 96 100Z" className="skyline-glider__entity-rock"/>,
  signpost: <>
    <rect x="44" y="30" width="12" height="70" className="skyline-glider__entity-trunk"/>
    <path d="M6 4 H86 L98 20 L86 36 H6Z" className="skyline-glider__entity-board"/>
  </>,
};

export function EntityPreset({ entity }) {
  const drawing = ENTITY_DRAWINGS[entity.draw];
  return <svg x={entity.x} y={entity.y} width={entity.width} height={entity.height} viewBox="0 0 100 100" preserveAspectRatio="none" overflow="visible">
    {drawing || <rect width="100" height="100" rx="12" className="skyline-glider__entity-box"/>}
  </svg>;
}

export function GliderPreset({ craftFront, craftRear }) {
  return <>
    <path d={`M-${craftRear} -6 L4 -8 ${craftFront} 0 L6 7 L-${craftRear - 6} 6 L-${craftRear} 1Z`} className="skyline-glider__wing"/>
    <path d={`M-${craftRear - 18} 1 Q4 -3 ${craftFront - 14} 0 Q6 6 -${craftRear - 16} 5Z`} className="skyline-glider__body"/>
    <path d={`M-${craftRear - 24} 3 L-${craftRear - 10} 7 M-${craftRear - 10} 7 L-${craftRear - 2} 9`} className="skyline-glider__frame"/>
    <circle cx={-(craftRear - 12)} cy="5" r="3" className="skyline-glider__pilot"/>
  </>;
}

// Weapons draw at their own origin: a laser's tip, a bomb's centre, a blast's centre.
export function LaserPreset() {
  return <>
    <rect x="-52" y="-5" width="52" height="10" rx="5" className="skyline-glider__laser-glow"/>
    <rect x="-46" y="-2" width="44" height="4" rx="2" className="skyline-glider__laser-core"/>
  </>;
}

export function BombPreset() {
  return <>
    <path d="M-5 -6 L-9 -14 H9 L5 -6Z" className="skyline-glider__bomb-fin"/>
    <circle r="8" className="skyline-glider__bomb-body"/>
  </>;
}

const BLAST_SPARKS = Array.from({ length: 8 }, (_, index) => (index * Math.PI) / 4);

export function BlastPreset({ width, height, progress }) {
  const scale = 0.4 + 0.6 * progress;
  const reach = (radians, from) => [Math.cos(radians) * (width / 2) * scale * from, Math.sin(radians) * (height / 2) * scale * from];
  return <g opacity={1 - progress}>
    <ellipse rx={(width / 2) * scale} ry={(height / 2) * scale} className="skyline-glider__blast-outer"/>
    <ellipse rx={(width / 4) * scale} ry={(height / 4) * scale} className="skyline-glider__blast-inner"/>
    {BLAST_SPARKS.map((radians) => {
      const [x1, y1] = reach(radians, 0.7);
      const [x2, y2] = reach(radians, 1.15);
      return <line key={radians} x1={x1} y1={y1} x2={x2} y2={y2} className="skyline-glider__blast-spark"/>;
    })}
  </g>;
}

/** The alpine look, used when a course arrives without a resolved zone. */
export const DEFAULT_ZONE = Object.freeze({
  id: 'alpine',
  name: 'Alpine',
  pixel_art: false,
  layers: [
    { id: 'sky', kind: 'svg', draw: 'alpine-sky' },
    { id: 'far', kind: 'svg', draw: 'alpine-far', parallax: 0.14 },
    { id: 'middle', kind: 'svg', draw: 'alpine-middle', parallax: 0.31 },
    { id: 'near', kind: 'svg', draw: 'alpine-near', parallax: 0.53 },
  ],
  terrain: { draw: 'alpine-rock', edge_lip: 0.02 },
  craft: { draw: 'glider' },
  collectible: { draw: 'bell' },
  weapons: { laser: { draw: 'laser' }, bomb: { draw: 'bomb' }, blast: { draw: 'blast' } },
  checkpoint: {},
  finish: {},
  sprites: null,
  sounds: {},
});
