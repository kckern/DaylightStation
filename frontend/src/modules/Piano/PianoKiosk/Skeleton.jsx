// Skeleton.jsx
// Reusable shimmer placeholders for kiosk loading states. Base <Skeleton> is a
// single shimmer block; the composed helpers shape common loading surfaces so a
// wall/list/stage loads into its own silhouette instead of bare "Loading…" text.
// The shimmer respects prefers-reduced-motion (callers pass animate={false}, or
// the CSS media query flattens it). All composed helpers are aria-hidden — a
// decorative placeholder, not content.

export function Skeleton({ className = '', animate = true, style }) {
  const cls = `piano-skeleton${animate ? ' is-shimmer' : ''}${className ? ` ${className}` : ''}`;
  return <div className={cls} style={style} aria-hidden="true" />;
}

/**
 * A skeleton grid of media tiles. `aspect` shapes each tile: "poster" (2:3, for
 * course/score walls) or "square" (1:1, for album/playlist walls).
 */
export function SkeletonGrid({ count = 6, aspect = 'poster', animate = true }) {
  const tileClass = aspect === 'square' ? 'piano-skeleton--square' : 'piano-skeleton--poster';
  return (
    <ul className="piano-skeleton-grid" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <li key={i}>
          <Skeleton className={tileClass} animate={animate} />
        </li>
      ))}
    </ul>
  );
}

/** A poster-shaped (2:3) skeleton grid — the common case (course/score walls). */
export function SkeletonPoster({ count = 6, animate = true }) {
  return <SkeletonGrid count={count} aspect="poster" animate={animate} />;
}

/**
 * A vertical list of row placeholders (a leading thumb + two text lines each),
 * for track / lecture / drill lists.
 */
export function SkeletonList({ rows = 5, animate = true }) {
  return (
    <ul className="piano-skeleton-list" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="piano-skeleton-row">
          <Skeleton className="piano-skeleton-row__thumb" animate={animate} />
          <div className="piano-skeleton-row__lines">
            <Skeleton className="piano-skeleton-row__line" animate={animate} />
            <Skeleton className="piano-skeleton-row__line piano-skeleton-row__line--short" animate={animate} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** One large block filling a media/viewer stage (video, score viewer, lazy load). */
export function SkeletonStage({ animate = true }) {
  return <Skeleton className="piano-skeleton--stage" animate={animate} />;
}

export default Skeleton;
