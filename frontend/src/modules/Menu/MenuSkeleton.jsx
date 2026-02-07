import React from "react";

export function MenuSkeleton({ count = 10 }) {
  const items = Array.from({ length: count }, (_, index) => index);

  return (
    <div className="menu-items-container menu-skeleton">
      <header className="menu-header">
        <div className="menu-header-left">
          <div className="menu-skeleton-thumb skeleton shimmer" />
          <div className="menu-skeleton-title skeleton shimmer" />
        </div>
        <div className="menu-header-center">
          <div className="menu-header-datetime">
            <div className="menu-skeleton-time skeleton shimmer" />
            <div className="menu-skeleton-date skeleton shimmer" />
          </div>
        </div>
        <div className="menu-header-right">
          <div className="menu-skeleton-count skeleton shimmer" />
        </div>
      </header>
      <div className="menu-items">
        {items.map((item) => (
          <div className="menu-item menu-item-skeleton" key={`menu-skeleton-${item}`}>
            <div className="menu-item-img menu-item-img-skeleton skeleton shimmer" />
            <h3 className="menu-item-label skeleton shimmer" />
          </div>
        ))}
      </div>
    </div>
  );
}
