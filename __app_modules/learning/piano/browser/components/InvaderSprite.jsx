/**
 * Classic pixel-art space invader SVG sprites.
 * 3 variants (Crab, Squid, Wide-body), each with 2 animation frames.
 * Uses currentColor for fill so parent can tint via CSS color/--hue.
 */
import PixelSprite from '../../../../../__capabilities/gaming/browser/platform/ui/PixelSprite.jsx';

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
  return <PixelSprite grid={v.frames[frame % v.frames.length]} className={`invader-sprite ${className}`.trim()} />;
}

export default InvaderSprite;
