import React, { useCallback, useEffect, Suspense, lazy } from 'react';
import { useMenuNavigationContext } from '../../context/MenuNavigationContext';
import { useScreenOverlay } from '../../screen-framework/overlays/ScreenOverlayProvider.jsx';
import { TVMenu } from './Menu';
import { PlayerOverlayLoading } from '../Player/Player';
import { PlexMenuRouter } from './PlexMenuRouter';
import { getLogger } from '../../lib/logging/Logger.js';

// Lazy load components that may be rendered from the stack
const Player = lazy(() => import('../Player/Player').then(m => ({ default: m.default || m.Player })));
const AppContainer = lazy(() => import('../AppContainer/AppContainer').then(m => ({ default: m.default || m.AppContainer })));
const Displayer = lazy(() => import('../Displayer/Displayer').then(m => ({ default: m.default })));
const LaunchCard = lazy(() => import('./LaunchCard.jsx'));
const AndroidLaunchCard = lazy(() => import('./AndroidLaunchCard.jsx'));

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
 * @param {React.RefObject} [props.playerRef] - Optional ref forwarded to Player for playback broadcast
 */
export function MenuStack({ rootMenu, playerRef, MENU_TIMEOUT = 0 }) {
  const { currentContent, depth, push, pop, reset } = useMenuNavigationContext();
  const { registerEscapeInterceptor, unregisterEscapeInterceptor } = useScreenOverlay();

  // Reset navigation state when rootMenu changes (including initial mount).
  // Without this, the nav stack from a previous menu persists — e.g., auto-selected
  // content (player) from menu A stays as currentContent when menu B opens.
  const prevRootMenuRef = React.useRef(null);
  React.useEffect(() => {
    if (rootMenu !== prevRootMenuRef.current) {
      reset();
      prevRootMenuRef.current = rootMenu;
    }
  }, [rootMenu, reset]);

  // Register escape interceptor: pop navigation stack before overlay dismisses
  useEffect(() => {
    if (!registerEscapeInterceptor) return;

    const interceptor = () => {
      if (depth > 0) {
        // If popping back to root on a timed menu, dismiss the overlay entirely
        // to avoid the auto-select timer creating an escape trap
        if (depth === 1 && MENU_TIMEOUT > 0) {
          pop();
          return false; // let overlay dismiss
        }
        pop();
        return true; // handled — don't dismiss overlay
      }
      return false; // at root — let overlay dismiss
    };

    registerEscapeInterceptor(interceptor);
    return () => unregisterEscapeInterceptor?.();
  }, [depth, pop, registerEscapeInterceptor, unregisterEscapeInterceptor]);

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
    // we can route directly to specialized views.
    // Check contentId first (unified), fall back to legacy plex key.
    const listContentId = selection.list?.contentId || selection.list?.plex;
    if (listContentId && selection.type === 'show') {
      push({ type: 'show-view', props: selection });
      return;
    }

    if (listContentId && selection.type === 'season') {
      push({ type: 'season-view', props: selection });
      return;
    }

    // For Plex items with unknown type, use the router to determine view
    // Non-plex lists (menu:, watchlist:, program:, query:) go through generic menu handler
    const isPlex = listContentId && (
      listContentId.startsWith('plex:') || /^\d+$/.test(listContentId)
    );
    if (isPlex && !selection.type) {
      push({ type: 'plex-menu', props: selection });
      return;
    }

    // Default handling for other lists
    if (selection.list || selection.menu) {
      push({ type: 'menu', props: selection });
    } else if (selection.play || selection.queue) {
      // Log playback intent - user initiated playback from menu
      const logger = getLogger();
      const media = selection.play || selection.queue?.[0] || selection;
      const contentId = media.contentId || media.plex || media.media || media.assetId || media.key || media.id;
      logger.info('playback.intent', {
        contentId,
        title: media.title || media.name || media.label || selection.label,
        artist: media.artist,
        album: media.album,
        grandparentTitle: media.grandparentTitle,
        parentTitle: media.parentTitle,
        mediaKey: media.assetId || media.key || media.plex || media.id,
        mediaType: media.type || media.mediaType,
        isQueue: !!selection.queue,
        queueLength: selection.queue?.length || 1,
        source: 'menu-selection',
        intentTs: Date.now()
      });
      push({ type: 'player', props: selection });
    } else if (selection.display) {
      // Map contentId to id for the Displayer component
      const display = { ...selection.display, id: selection.display.contentId || selection.display.id };
      push({ type: 'display', props: { ...selection, display } });
    } else if (selection.open) {
      push({ type: 'app', props: selection });
    } else if (selection.launch) {
      const logger = getLogger();
      logger.info('launch.intent', {
        contentId: selection.launch.contentId,
        targetDeviceId: selection.launch.targetDeviceId,
        title: selection.label || selection.title,
        parentTitle: selection.parentTitle,
        source: 'menu-selection',
        intentTs: Date.now()
      });
      push({ type: 'launch', props: selection });
    } else if (selection.android) {
      const logger = getLogger();
      logger.info('android-launch.intent', {
        package: selection.android.package,
        activity: selection.android.activity,
        title: selection.title || selection.label,
        source: 'menu-selection',
        intentTs: Date.now()
      });
      push({ type: 'android-launch', props: selection });
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
        MENU_TIMEOUT={MENU_TIMEOUT}
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
          MENU_TIMEOUT={MENU_TIMEOUT}
        />
      );

    case 'plex-menu':
      // PlexMenuRouter fetches data, detects type, and renders appropriate view
      return (
        <PlexMenuRouter
          plexId={props.list?.plex}
          contentId={props.list?.contentId}
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
            contentId={props.list?.contentId}
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
            contentId={props.list?.contentId}
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
          <Player {...props} ref={playerRef} clear={clear} />
        </Suspense>
      );

    case 'composite':
      // Composed presentation with visual + audio tracks
      return (
        <Suspense fallback={<LoadingFallback />}>
          <Player {...props} ref={playerRef} clear={clear} />
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
          <Displayer display={props.display} onClose={clear} />
        </Suspense>
      );

    case 'reader':
      // TODO: Implement reader component
      return (
        <div className="menu-stack-placeholder">
          Reader not yet implemented. ID: {props.read?.id}
        </div>
      );

    case 'launch':
      return (
        <Suspense fallback={<LoadingFallback />}>
          <LaunchCard
            launch={props.launch}
            title={props.title}
            thumbnail={props.thumbnail || props.image}
            metadata={props.metadata}
            onClose={clear}
          />
        </Suspense>
      );

    case 'android-launch':
      return (
        <Suspense fallback={<LoadingFallback />}>
          <AndroidLaunchCard
            android={props.android}
            title={props.title}
            image={props.image}
            onClose={clear}
          />
        </Suspense>
      );

    default:
      getLogger().warn('menu-stack.unknown-type', { type });
      return (
        <div className="menu-stack-error">
          Unknown content type: {type}
        </div>
      );
  }
}

export default MenuStack;
