import React from 'react';

// Built-in SVG art, addressed by a zone's `draw:` names. These are the original
// Skyline Glider drawings and the fallback for any slot whose file is missing.

export const SCENE_WIDTH = 1000;
export const SCENE_HEIGHT = 600;
// The stage is rarely 5:3, and the scene is drawn to fit it (meet), so the
// viewBox never fills it alone. Everything that is backdrop (sky, parallax,
// terrain) bleeds this far past the viewBox: to 2.3:1 wide and 4:3 tall with no
// bands. The horizontal bleed matches the course projection's own margin.
export const SCENE_BLEED_X = 160;
export const SCENE_BLEED_Y = 80;
export const SCENE_ROOF = -SCENE_BLEED_Y;
export const SCENE_FLOOR = SCENE_HEIGHT + SCENE_BLEED_Y;

export function SceneDefs({ palette = {} }) {
  return <defs>
    <linearGradient id="glider-sky" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={SCENE_HEIGHT}><stop stopColor={palette.sky || "#78bce8"}/><stop offset="1" stopColor={palette.horizon || "#f8d69a"}/></linearGradient>
    <linearGradient id="glider-rock" x1="0" y1="0" x2="0" y2="1"><stop stopColor={palette.rock || "#42685e"}/><stop offset="1" stopColor={palette.rock_low || "#193d38"}/></linearGradient>
  </defs>;
}

// Backdrops repeat every 1000 units (each path ends where it starts, so copies
// join without a step); the caller translates by the scroll offset.
const BACKDROP_PATHS = {
  'alpine-far': { className: 'far', d: `M0 420 L130 250 260 420 420 210 590 420 760 260 1000 420 1130 250 1260 420 1420 210 1590 420 1760 260 2000 420 V${SCENE_FLOOR} H0Z` },
  'alpine-middle': { className: 'middle', d: `M0 470 L170 360 330 480 520 330 690 490 860 350 1000 470 1170 360 1330 480 1520 330 1690 490 1860 350 2000 470 V${SCENE_FLOOR} H0Z` },
  'alpine-near': { className: 'near', d: `M0 530 Q180 465 350 530 T700 510 T1000 530 Q1180 465 1350 530 T1700 510 T2000 530 V${SCENE_FLOOR} H0Z` },
};

// The palette sky over the whole stage, bleed included.
export function SkyRect(props) {
  return <rect x={-SCENE_BLEED_X} y={SCENE_ROOF} width={SCENE_WIDTH + 2 * SCENE_BLEED_X} height={SCENE_FLOOR - SCENE_ROOF} fill="url(#glider-sky)" {...props}/>;
}

export function BackdropPreset({ draw, offset = 0 }) {
  if (draw === 'alpine-sky') return <SkyRect/>;
  const preset = BACKDROP_PATHS[draw];
  if (!preset) return null;
  // Each path spans two periods; one copy a period either side of the scroll
  // position covers the bleed on both sides at any offset.
  const shift = -(offset % SCENE_WIDTH);
  return <g className={`skyline-glider__parallax skyline-glider__parallax--${preset.className}`}>
    <path d={preset.d} transform={`translate(${shift - SCENE_WIDTH} 0)`}/>
    <path d={preset.d} transform={`translate(${shift + SCENE_WIDTH} 0)`}/>
  </g>;
}

export const hasBackdropPreset = (draw) => draw === 'alpine-sky' || draw in BACKDROP_PATHS;

export function TerrainPreset({ segment, fill, edge = true }) {
  if (segment.type === 'lava') {
    const y = segment.top * SCENE_HEIGHT;
    return <g className="skyline-glider__lava"><rect data-lava-surface x={segment.x} y={y} width={segment.width} height={SCENE_FLOOR - y}/><path d={`M${segment.x} ${y} H${segment.x + segment.width}`} /></g>;
  }
  if (segment.profilePoints?.length) {
    const points = segment.profilePoints;
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
    // A zone texture goes in style: the stylesheet's terrain fill would beat a fill attribute.
    return <><path data-slope d={`${line} L${points.at(-1).x} ${SCENE_FLOOR} L${points[0].x} ${SCENE_FLOOR} Z`} className="skyline-glider__terrain" style={fill ? { fill } : undefined}/>{edge && <path d={line} className="skyline-glider__slope-edge"/>}</>;
  }
  const width = Math.max(4, segment.width);
  if (segment.type === 'lower-terrain') {
    const y = segment.top * SCENE_HEIGHT;
    return <>
      <rect x={segment.x} y={y} width={width} height={SCENE_FLOOR - y} className="skyline-glider__terrain skyline-glider__terrain--lower"/>
      <path d={`M${segment.x} ${y} l22 24 28 -24 32 34 34 -34 H${segment.x + width}`} className="skyline-glider__snowline"/>
    </>;
  }
  if (segment.type === 'upper-terrain') {
    const y = segment.bottom * SCENE_HEIGHT;
    return <>
      <rect x={segment.x} y={SCENE_ROOF} width={width} height={y - SCENE_ROOF} className="skyline-glider__terrain skyline-glider__terrain--upper"/>
      <path d={`M${segment.x} ${y} l24 -20 28 20 30 -28 34 28 H${segment.x + width}`} className="skyline-glider__cave-edge"/>
    </>;
  }
  if (segment.type === 'corridor') {
    const ceiling = segment.ceiling * SCENE_HEIGHT;
    const floor = segment.floor * SCENE_HEIGHT;
    return <>
      <rect x={segment.x} y={SCENE_ROOF} width={width} height={ceiling - SCENE_ROOF} className="skyline-glider__terrain skyline-glider__terrain--upper"/>
      <rect x={segment.x} y={floor} width={width} height={SCENE_FLOOR - floor} className="skyline-glider__terrain skyline-glider__terrain--lower"/>
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
  barrier: <><rect x="0" y="0" width="100" height="100" fill="#625567" stroke="#e6b85f" strokeWidth="4"/><path d="M0 20 H100 M0 40 H100 M0 60 H100 M0 80 H100 M25 0 V20 M75 20 V40 M25 40 V60 M75 60 V80 M25 80 V100" fill="none" stroke="#392e45" strokeWidth="3"/></>,
  // Breakable by missile only: the cracks say "this one gives".
  crackwall: <>
    <rect x="0" y="0" width="100" height="100" fill="#7a5a52" stroke="#f0a35e" strokeWidth="4"/>
    <path d="M0 25 H100 M0 50 H100 M0 75 H100 M50 0 V25 M20 25 V50 M80 25 V50 M50 50 V75 M20 75 V100 M80 75 V100" fill="none" stroke="#4b3436" strokeWidth="3"/>
    <path d="M58 6 L42 22 L60 34 L38 52 L62 66 L44 84 L56 96" fill="none" stroke="#ffd27a" strokeWidth="5" strokeLinejoin="round"/>
  </>,
  // A gate's posts are steel nothing breaks; the hazard band marks the edge of the gap.
  'gate-top': <>
    <rect x="6" y="0" width="88" height="100" fill="#3f4656" stroke="#1f2430" strokeWidth="4"/>
    <path d="M6 88 H94 V100 H6Z" fill="#f2c94c"/>
    <path d="M14 88 L26 100 M38 88 L50 100 M62 88 L74 100 M86 88 L94 96" stroke="#1f2430" strokeWidth="6"/>
  </>,
  'gate-bottom': <>
    <rect x="6" y="0" width="88" height="100" fill="#3f4656" stroke="#1f2430" strokeWidth="4"/>
    <path d="M6 0 H94 V12 H6Z" fill="#f2c94c"/>
    <path d="M14 0 L26 12 M38 0 L50 12 M62 0 L74 12 M86 0 L94 8" stroke="#1f2430" strokeWidth="6"/>
  </>,
  'gate-shutter': <>
    <rect x="10" y="0" width="80" height="100" fill="#c1443b" stroke="#5a1d1d" strokeWidth="4"/>
    <path d="M10 20 H90 M10 40 H90 M10 60 H90 M10 80 H90" stroke="#5a1d1d" strokeWidth="4"/>
  </>,
  // Ground targets for bombs: a squat bunker with a slit, and a radio tower.
  bunker: <>
    <path d="M0 100 V45 Q50 -10 100 45 V100Z" fill="#6b7a4f" stroke="#2f3a24" strokeWidth="5"/>
    <rect x="30" y="48" width="40" height="12" rx="4" fill="#1d2416"/>
    <circle cx="50" cy="20" r="7" fill="#ff6b5a"/>
  </>,
  tower: <>
    <path d="M4 100 L30 8 H70 L96 100Z" fill="#5b4a5e" stroke="#2e2333" strokeWidth="4"/>
    <path d="M22 70 H78 M27 45 H73 M33 22 H67 M14 92 L70 30 M86 92 L30 30" stroke="#2e2333" strokeWidth="4"/>
    <circle cx="50" cy="6" r="6" fill="#ff6b5a"/>
  </>,
  target: <><circle cx="50" cy="50" r="44" fill="#f7d778" stroke="#593847" strokeWidth="6"/><circle cx="50" cy="50" r="27" fill="#db6655"/><circle cx="50" cy="50" r="10" fill="#fff2c6"/></>,
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
  // A gate's posts and shutter each have their own drawing (`gate-top` …).
  const drawing = ENTITY_DRAWINGS[`${entity.draw}-${entity.piece}`] || ENTITY_DRAWINGS[entity.draw];
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
  // Grows and then is gone; never fades (flat colour, no see-through art).
  return <g>
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
  // Weapons pick their SVG preset by shot kind; a zone fills these slots only with sprite frames.
  weapons: {},
  checkpoint: {},
  finish: {},
  sprites: null,
  sounds: {},
});
