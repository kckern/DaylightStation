/**
 * Classic pixel-art space invader SVG sprites.
 * 3 variants (Crab, Squid, Wide-body), each with 2 animation frames.
 * Uses currentColor for fill so parent can tint via CSS color/--hue.
 */

// Each variant is an 11×8 grid. 1 = filled pixel, 0 = empty.
// Two frames per variant for the "march" animation.
const VARIANTS = [
  // Variant 0: Crab
  {
    frames: [
      [
        [0,0,1,0,0,0,0,0,1,0,0],
        [0,0,0,1,0,0,0,1,0,0,0],
        [0,0,1,1,1,1,1,1,1,0,0],
        [0,1,1,0,1,1,1,0,1,1,0],
        [1,1,1,1,1,1,1,1,1,1,1],
        [1,0,1,1,1,1,1,1,1,0,1],
        [1,0,1,0,0,0,0,0,1,0,1],
        [0,0,0,1,1,0,1,1,0,0,0],
      ],
      [
        [0,0,1,0,0,0,0,0,1,0,0],
        [1,0,0,1,0,0,0,1,0,0,1],
        [1,0,1,1,1,1,1,1,1,0,1],
        [1,1,1,0,1,1,1,0,1,1,1],
        [1,1,1,1,1,1,1,1,1,1,1],
        [0,1,1,1,1,1,1,1,1,1,0],
        [0,0,1,0,0,0,0,0,1,0,0],
        [0,1,0,0,0,0,0,0,0,1,0],
      ],
    ],
  },
  // Variant 1: Squid
  {
    frames: [
      [
        [0,0,0,0,1,0,0,0,0,0,0],
        [0,0,0,1,1,1,0,0,0,0,0],
        [0,0,1,1,1,1,1,0,0,0,0],
        [0,1,1,0,1,0,1,1,0,0,0],
        [0,1,1,1,1,1,1,1,0,0,0],
        [0,0,0,1,0,1,0,0,0,0,0],
        [0,0,1,0,0,0,1,0,0,0,0],
        [0,1,0,0,0,0,0,1,0,0,0],
      ],
      [
        [0,0,0,0,1,0,0,0,0,0,0],
        [0,0,0,1,1,1,0,0,0,0,0],
        [0,0,1,1,1,1,1,0,0,0,0],
        [0,1,1,0,1,0,1,1,0,0,0],
        [0,1,1,1,1,1,1,1,0,0,0],
        [0,0,1,0,0,0,1,0,0,0,0],
        [0,0,0,1,0,1,0,0,0,0,0],
        [0,0,0,0,0,0,0,0,0,0,0],
      ],
    ],
  },
  // Variant 2: Wide-body (UFO/Shield)
  {
    frames: [
      [
        [0,0,0,1,1,1,1,1,0,0,0],
        [0,1,1,1,1,1,1,1,1,1,0],
        [1,1,1,1,1,1,1,1,1,1,1],
        [1,1,1,0,0,1,0,0,1,1,1],
        [1,1,1,1,1,1,1,1,1,1,1],
        [0,0,1,1,0,0,0,1,1,0,0],
        [0,1,1,0,0,0,0,0,1,1,0],
        [1,1,0,0,0,0,0,0,0,1,1],
      ],
      [
        [0,0,0,1,1,1,1,1,0,0,0],
        [0,1,1,1,1,1,1,1,1,1,0],
        [1,1,1,1,1,1,1,1,1,1,1],
        [1,1,1,0,0,1,0,0,1,1,1],
        [1,1,1,1,1,1,1,1,1,1,1],
        [0,0,0,1,1,0,1,1,0,0,0],
        [0,0,1,1,0,0,0,1,1,0,0],
        [0,1,1,0,0,0,0,0,1,1,0],
      ],
    ],
  },
];

const GRID_W = 11;
const GRID_H = 8;

/**
 * Render a classic pixel-art space invader as an inline SVG.
 *
 * @param {Object} props
 * @param {number} props.variant - 0 (Crab), 1 (Squid), 2 (Wide-body)
 * @param {number} props.frame - 0 or 1 (animation frame)
 * @param {string} [props.className] - Additional CSS class
 */
export function InvaderSprite({ variant = 0, frame = 0, className = '' }) {
  const v = VARIANTS[variant % VARIANTS.length];
  const grid = v.frames[frame % v.frames.length];

  const rects = [];
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if (grid[y][x]) {
        rects.push(
          <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} />
        );
      }
    }
  }

  return (
    <svg
      className={`invader-sprite ${className}`.trim()}
      viewBox={`0 0 ${GRID_W} ${GRID_H}`}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {rects}
    </svg>
  );
}

export default InvaderSprite;
