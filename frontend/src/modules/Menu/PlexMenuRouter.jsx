import React, { Suspense, lazy, useState, useEffect } from 'react';
import { DaylightAPI } from '../../lib/api.mjs';
import { TVMenu } from './Menu';
import { PlayerOverlayLoading } from '../Player/Player';

// Lazy load specialized views
const ShowView = lazy(() => import('./ShowView').then(m => ({ default: m.default || m.ShowView })));
const SeasonView = lazy(() => import('./SeasonView').then(m => ({ default: m.default || m.SeasonView })));

/**
 * Loading fallback
 */
function LoadingFallback() {
  return <PlayerOverlayLoading shouldRender isVisible />;
}

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
        const data = await DaylightAPI(`data/list/${plexId}`);
        
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

  // Loading state
  if (routeInfo.loading) {
    return <LoadingFallback />;
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
      <Suspense fallback={<LoadingFallback />}>
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
      <Suspense fallback={<LoadingFallback />}>
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
