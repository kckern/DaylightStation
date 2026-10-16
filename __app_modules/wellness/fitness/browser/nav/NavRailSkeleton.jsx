import React from 'react';
import Skeleton from '@/lib/ui/Skeleton.jsx';

/**
 * Nav rail placeholder. Uses the real `.nav-item` / `.nav-icon` classes so each
 * placeholder sits exactly where a nav button will — the hydrated rail replaces
 * them in place. Replaces the spinning ⏳ the empty rail used to show.
 */
export const NAV_SKELETON_ITEMS = 12;

export function NavRailSkeletonItems({ count = NAV_SKELETON_ITEMS }) {
  return Array.from({ length: count }, (_, i) => (
    <div key={i} className="nav-item nav-item--skeleton" aria-hidden="true">
      <div className="nav-icon">
        <Skeleton circle height={24} />
      </div>
    </div>
  ));
}

/** The whole rail, for screens drawn before the navbar exists (app config load). */
export default function NavRailSkeleton({ count }) {
  return (
    <div className="fitness-navbar fitness-navbar--skeleton" aria-hidden="true">
      <div className="navbar-header" />
      <nav className="navbar-nav">
        <NavRailSkeletonItems count={count} />
      </nav>
    </div>
  );
}
