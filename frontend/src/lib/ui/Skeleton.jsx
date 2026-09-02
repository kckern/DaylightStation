import './Skeleton.scss';

/**
 * Skeleton — the house loading placeholder.
 *
 * Replaces Mantine's `<Skeleton>`, whose default is a flat grey pulse tuned for
 * a light theme; on our dark panels it reads as a bright slab flashing on and
 * off. This is a low-contrast block with a sheen that sweeps across it, so a
 * loading surface looks like the shape it is about to become rather than a
 * blinking hole.
 *
 * The prop surface is deliberately Mantine-compatible (`height`, `width`,
 * `radius`, `circle`) so call sites swap one import and nothing else.
 *
 * Motion is a `transform` sweep — compositor-only. An earlier lesson in this
 * codebase is that animating `filter` costs real frames on the kiosk; a
 * placeholder must never be the reason a screen drops them.
 * `prefers-reduced-motion` flattens it to the static base.
 *
 * Decorative by contract: `aria-hidden`, so a screen reader hears the eventual
 * content and not a row of empty boxes.
 */

const RADIUS = { xs: '3px', sm: '5px', md: '9px', lg: '14px', xl: '22px' };

const toSize = (value) => (typeof value === 'number' ? `${value}px` : value);

export default function Skeleton({
  height,
  width,
  radius = 'md',
  circle = false,
  animate = true,
  className = '',
  style,
  ...rest
}) {
  const resolvedRadius = circle ? '50%' : (RADIUS[radius] ?? toSize(radius));
  return (
    <div
      {...rest}
      aria-hidden="true"
      className={`ds-skeleton${animate ? ' ds-skeleton--animate' : ''}${className ? ` ${className}` : ''}`}
      style={{
        ...(height != null ? { height: toSize(height) } : null),
        ...(width != null ? { width: toSize(width) } : null),
        ...(circle && height != null ? { width: toSize(height) } : null),
        borderRadius: resolvedRadius,
        ...style,
      }}
    />
  );
}

export { Skeleton };
