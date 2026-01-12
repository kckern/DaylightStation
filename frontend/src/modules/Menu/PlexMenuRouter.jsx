import React, { Suspense, lazy, useState, useEffect } from 'react';
import { DaylightAPI } from '../../lib/api.mjs';
import { TVMenu } from './Menu';
import './PlexViews.scss';

// Lazy load specialized views
const ShowView = lazy(() => import('./ShowView').then(m => ({ default: m.default || m.ShowView })));
const SeasonView = lazy(() => import('./SeasonView').then(m => ({ default: m.default || m.SeasonView })));

/**
 * Skeleton fallback for ShowView lazy loading
 */
function ShowViewSkeleton() {
  return (
    <div className="show-view show-view--skeleton">
      <div className="show-view__backdrop skeleton-pulse" />
      <div className="show-view__backdrop-gradient" />
      <div className="show-view__content">
        <div className="show-view__top">
          <div className="show-view__poster skeleton-pulse" />
          <div className="show-view__info">
            <div className="skeleton-text skeleton-text--lg skeleton-pulse" style={{ width: '60%', height: '2rem', marginBottom: '1rem' }} />
            <div className="skeleton-text skeleton-text--md skeleton-pulse" style={{ width: '40%', marginBottom: '0.75rem' }} />
            <div className="skeleton-text skeleton-pulse" style={{ width: '90%', marginBottom: '0.5rem' }} />
            <div className="skeleton-text skeleton-pulse" style={{ width: '85%', marginBottom: '0.5rem' }} />
            <div className="skeleton-text skeleton-pulse" style={{ width: '70%' }} />
          </div>
        </div>
        <div className="show-view__bottom">
          <div className="show-view__seasons-scroll">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="season-card season-card--skeleton">
                <div className="season-card__thumbnail skeleton-pulse" />
                <div className="skeleton-text skeleton-text--sm skeleton-pulse" style={{ marginTop: '0.5rem' }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Skeleton fallback for SeasonView lazy loading
 */
function SeasonViewSkeleton() {
  return (
    <div className="season-view season-view--grid season-view--skeleton">
      <aside className="season-view__sidebar">
        <div className="season-view__poster skeleton-pulse" />
        <div className="season-view__selected-info">
          <div className="skeleton-text skeleton-text--sm skeleton-pulse" />
          <div className="skeleton-text skeleton-text--lg skeleton-pulse" />
          <div className="skeleton-text skeleton-text--md skeleton-pulse" />
        </div>
      </aside>
      <main className="season-view__main">
        <header className="season-view__header">
          <div className="season-view__breadcrumb">
            <div className="skeleton-text skeleton-text--lg skeleton-pulse" style={{ width: '200px' }} />
          </div>
        </header>
        <div className="season-view__grid">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="episode-grid-card episode-grid-card--skeleton">
              <div className="episode-grid-card__thumbnail skeleton-pulse" />
              <div className="episode-grid-card__info">
                <div className="skeleton-text skeleton-text--sm skeleton-pulse" />
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

/**
 * Generic loading fallback
 */
const LoadingFallback = ShowViewSkeleton;

/**
 * PlexMenuRouter: Loads Plex menu data and routes to appropriate view
 * 
 * For Plex items without a pre-known type, this component:
 * 1. Fetches the data from /data/list/:plexId
 * 2. Checks the response type (show, season, etc.)
 * 3. Renders ShowView, SeasonView, or generic TVMenu accordingly
 * 
 * This solves the problem where menu items don't have type until loaded.
 */
export function PlexMenuRouter({ plexId, depth, onSelect, onEscape, list }) {
  const [routeInfo, setRouteInfo] = useState({ loading: true, type: null, data: null });

  useEffect(() => {
    if (!plexId) {
      setRouteInfo({ loading: false, type: null, data: null });
      return;
    }

    let canceled = false;
    setRouteInfo({ loading: true, type: null, data: null });

    async function fetchAndRoute() {
      try {
        // Fetch minimal data to determine type (don't need full recent_on_top for routing)
        // Migrated from legacy: data/list/${plexId}
        const data = await DaylightAPI(`api/list/folder/${plexId}`);
        
        if (!canceled) {
          setRouteInfo({
            loading: false,
            type: data?.type || null,
            data: data
          });
        }
      } catch (err) {
        if (!canceled) {
          setRouteInfo({ loading: false, type: null, data: null, error: err });
        }
      }
    }

    fetchAndRoute();
    return () => { canceled = true; };
  }, [plexId]);

  // Loading state - show appropriate skeleton based on context
  if (routeInfo.loading) {
    return <ShowViewSkeleton />;
  }

  // Error state
  if (routeInfo.error) {
    return (
      <div className="menu-error">
        <p>Failed to load: {routeInfo.error.message}</p>
      </div>
    );
  }

  // Route based on type
  const { type, data } = routeInfo;

  if (type === 'show') {
    return (
      <Suspense fallback={<ShowViewSkeleton />}>
        <ShowView 
          showId={plexId} 
          depth={depth} 
          onSelect={onSelect} 
          onEscape={onEscape} 
        />
      </Suspense>
    );
  }

  if (type === 'season') {
    return (
      <Suspense fallback={<SeasonViewSkeleton />}>
        <SeasonView 
          seasonId={plexId} 
          depth={depth} 
          onSelect={onSelect} 
          onEscape={onEscape} 
        />
      </Suspense>
    );
  }

  // Default: render generic menu with the pre-fetched data
  // Pass the data directly to avoid double-fetching
  return (
    <TVMenu
      list={data || list}
      depth={depth}
      onSelect={onSelect}
      onEscape={onEscape}
    />
  );
}

export default PlexMenuRouter;
