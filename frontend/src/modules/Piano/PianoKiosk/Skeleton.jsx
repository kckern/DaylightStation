// Skeleton.jsx
// Reusable shimmer placeholders for kiosk loading states. Base <Skeleton> is a
// single shimmer block; the composed helpers shape common loading surfaces. The
// shimmer respects prefers-reduced-motion (callers pass animate={false}, or the
// CSS media query flattens it).

export function Skeleton({ className = '', animate = true, style }) {
  const cls = `piano-skeleton${animate ? ' is-shimmer' : ''}${className ? ` ${className}` : ''}`;
  return <div className={cls} style={style} aria-hidden="true" />;
}

/** A poster-shaped skeleton grid (2:3 tiles) for course/poster walls. */
export function SkeletonPoster({ count = 6, animate = true }) {
  return (
    <ul className="piano-skeleton-grid" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <li key={i}>
          <Skeleton className="piano-skeleton--poster" animate={animate} />
        </li>
      ))}
    </ul>
  );
}

export default Skeleton;
