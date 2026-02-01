import React, { useCallback, Suspense, lazy } from 'react';
import { useMenuNavigationContext } from '../../context/MenuNavigationContext';
import { TVMenu } from './Menu';
import { PlayerOverlayLoading } from '../Player/Player';
import { PlexMenuRouter } from './PlexMenuRouter';
import { getLogger } from '../../lib/logging/Logger.js';

// Lazy load components that may be rendered from the stack
const Player = lazy(() => import('../Player/Player').then(m => ({ default: m.default || m.Player })));
const AppContainer = lazy(() => import('../AppContainer/AppContainer').then(m => ({ default: m.default || m.AppContainer })));
const ArtViewer = lazy(() => import('../AppContainer/Apps/Art/Art').then(m => ({ default: m.default })));

/**
 * Loading fallback for lazy-loaded components
 */
function LoadingFallback() {
  return <PlayerOverlayLoading shouldRender isVisible />;
}

/**
 * Renders the current menu level from the navigation stack.
 * Only the topmost item is rendered (stack-based navigation).
 * 
 * @param {Object} props
 * @param {Object|string} props.rootMenu - The root menu configuration (list name or menu object)
 */
export function MenuStack({ rootMenu }) {
  const { currentContent, depth, push, pop } = useMenuNavigationContext();

  /**
   * Handle selection from any menu level.
   * Maps selection to appropriate action (push menu, play content, open app).
   * 
   * For Plex items without known type, PlexMenuRouter will determine the view.
   * For items with type already set (from season/show responses), route directly.
   */
  const handleSelect = useCallback((selection) => {
    if (!selection) return;

    // If type is already known (e.g., from ShowView/SeasonView selecting a child),
    // we can route directly to specialized views
    if (selection.list?.plex && selection.type === 'show') {
      push({ type: 'show-view', props: selection });
      return;
    }
    
    if (selection.list?.plex && selection.type === 'season') {
      push({ type: 'season-view', props: selection });
      return;
    }

    // For Plex items without known type, use the router to determine view
    if (selection.list?.plex && !selection.type) {
      push({ type: 'plex-menu', props: selection });
      return;
    }

    // Default handling for non-Plex lists
    if (selection.list || selection.menu) {
      push({ type: 'menu', props: selection });
    } else if (selection.play || selection.queue) {
      // Log playback intent - user initiated playback from menu
      const logger = getLogger();
      const media = selection.play || selection.queue?.[0] || selection;
      logger.info('playback.intent', {
        title: media.title || media.name || media.label,
        artist: media.artist,
        album: media.album,
        show: media.show,
        season: media.season,
        mediaKey: media.assetId || media.key || media.plex || media.id,
        mediaType: media.type || media.mediaType,
        isQueue: !!selection.queue,
        queueLength: selection.queue?.length || 1,
        source: 'menu-selection',
        intentTs: Date.now()
      });
      push({ type: 'player', props: selection });
    } else if (selection.open) {
      push({ type: 'app', props: selection });
    }
    // If none of the above, it might be a leaf action - let parent handle
  }, [push]);

  /**
   * Clear function for Player/AppContainer to pop back
   */
  const clear = useCallback(() => {
    pop();
  }, [pop]);

  // If stack is empty, render root menu
  if (!currentContent) {
    return (
      <TVMenu
        list={rootMenu}
        depth={0}
        onSelect={handleSelect}
        onEscape={() => {}} // At root, escape does nothing
      />
    );
  }

  // Render based on content type
  const { type, props } = currentContent;

  switch (type) {
    case 'menu':
      return (
        <TVMenu
          list={props.list || props.menu || props}
          depth={depth}
          onSelect={handleSelect}
          onEscape={clear}
        />
      );

    case 'plex-menu':
      // PlexMenuRouter fetches data, detects type, and renders appropriate view
      return (
        <PlexMenuRouter
          plexId={props.list?.plex}
          list={props}
          depth={depth}
          onSelect={handleSelect}
          onEscape={clear}
        />
      );

    case 'show-view':
      // Direct render when type is already known
      return (
        <Suspense fallback={<LoadingFallback />}>
          <PlexMenuRouter
            plexId={props.list?.plex}
            list={props}
            depth={depth}
            onSelect={handleSelect}
            onEscape={clear}
          />
        </Suspense>
      );

    case 'season-view':
      // Direct render when type is already known
      return (
        <Suspense fallback={<LoadingFallback />}>
          <PlexMenuRouter
            plexId={props.list?.plex}
            list={props}
            depth={depth}
            onSelect={handleSelect}
            onEscape={clear}
          />
        </Suspense>
      );

    case 'player':
      return (
        <Suspense fallback={<LoadingFallback />}>
          <Player {...props} clear={clear} />
        </Suspense>
      );

    case 'composite':
      // Composed presentation with visual + audio tracks
      return (
        <Suspense fallback={<LoadingFallback />}>
          <Player {...props} clear={clear} />
        </Suspense>
      );

    case 'app':
      return (
        <Suspense fallback={<LoadingFallback />}>
          <AppContainer open={props.open} clear={clear} />
        </Suspense>
      );

    case 'display':
      return (
        <Suspense fallback={<LoadingFallback />}>
          <ArtViewer item={props.display} onClose={clear} />
        </Suspense>
      );

    case 'reader':
      // TODO: Implement reader component
      return (
        <div className="menu-stack-placeholder">
          Reader not yet implemented. ID: {props.read?.id}
        </div>
      );

    default:
      console.warn(`MenuStack: Unknown content type "${type}"`, props);
      return (
        <div className="menu-stack-error">
          Unknown content type: {type}
        </div>
      );
  }
}

export default MenuStack;
