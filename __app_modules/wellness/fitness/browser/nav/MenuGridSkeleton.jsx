import React from 'react';
import Skeleton from '@/lib/ui/Skeleton.jsx';

/**
 * Show-grid placeholder: the real `.fitness-grid` with poster-shaped cards
 * (`.show-card` geometry, 2:3), so posters replace them in place. Used for both
 * the menu's config load (was Mantine's spinner on a white overlay) and its
 * shows fetch.
 */
export const MENU_SKELETON_CARDS = 12;

export function MenuGridSkeletonCards({ count = MENU_SKELETON_CARDS }) {
  return Array.from({ length: count }, (_, i) => (
    <div key={`skeleton-${i}`} className="show-card skeleton-card" aria-hidden="true">
      <Skeleton className="skeleton-card__fill" radius="sm" />
    </div>
  ));
}

export default function MenuGridSkeleton({ count }) {
  return (
    <div className="fitness-menu" aria-busy="true">
      <div className="fitness-grid">
        <MenuGridSkeletonCards count={count} />
      </div>
    </div>
  );
}
