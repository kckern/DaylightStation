import React, { useCallback, useEffect, Suspense, lazy } from 'react';
import { useMenuNavigationContext } from "../../../../../__capabilities/screen-host/browser/menu-navigation.mjs";
import { useScreenOverlay } from "../../../../../__capabilities/screen-host/browser/overlays.mjs";
import { TVMenu } from "./Menu.jsx";
import { PlayerOverlayLoading } from "../playback.mjs";
import { PlexMenuRouter } from "./PlexMenuRouter.jsx";
import { getLogger } from "../../../../../frontend/src/lib/logging/Logger.js";
import { getActionBus } from "../../../../../__capabilities/screen-host/browser/input.mjs";
import { artSceneIdFromDisplay } from "./displaySelection.js";
import SurroundHost from "../surround-host.mjs";
import { dispatchParticipantAction } from '../../../../../frontend/src/composition/participants/dispatchParticipantAction.js';
import { ParticipantLaunchHost } from '../../../../../frontend/src/composition/participants/ParticipantLaunchHost.jsx';
import {TVActionDialog} from '../../../../../frontend/src/composition/participants/TVActionDialog.jsx';
import { participantBrowserRegistry } from '../../../../../frontend/src/composition/participants/participantBrowserRegistry.js';

// Lazy load components that may be rendered from the stack
const Player = lazy(() => import("../playback.mjs").then(m => ({ default: m.default || m.Player })));
const AppContainer = lazy(() => import("../../../../../frontend/src/modules/AppContainer/AppContainer.jsx").then(m => ({ default: m.default || m.AppContainer })));
const Displayer = lazy(() => import("../../../../../frontend/src/modules/Displayer/Displayer.jsx").then(m => ({ default: m.default })));
const LaunchCard = lazy(() => import("./LaunchCard.jsx"));
const AndroidLaunchCard = lazy(() => import("./AndroidLaunchCard.jsx"));

/**
 * Loading fallback for lazy-loaded components
 */
function LoadingFallback() {
  return <PlayerOverlayLoading shouldRender isVisible />;
}

/**
 * listConfigNormalizer.mjs puts a YAML item's `shader:` field as a SIBLING of
 * `play`/`queue` (`result.shader = item.shader`), but Player only reads shader
 * nested inside the play/queue content object (useQueueController:
 * `play?.shader || queue?.shader`). This is the one seam that turns a menu
 * selection into Player props — thread it in here rather than teaching Player
 * a second contract.
 */
function threadShaderIntoContent(selection) {
  if (selection?.shader == null) return selection;
  const isContentObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const target = isContentObject(selection.play) ? 'play' : (isContentObject(selection.queue) ? 'queue' : null);
  if (!target || selection[target].shader != null) return selection;
  return { ...selection, [target]: { ...selection[target], shader: selection.shader } };
}

/**
 * Renders the current menu level from the navigation stack.
 * Only the topmost item is rendered (stack-based navigation).
 * 
 * @param {Object} props
 * @param {Object|string} props.rootMenu - The root menu configuration (list name or menu object)
 * @param {React.RefObject} [props.playerRef] - Optional ref forwarded to Player for playback broadcast
 */
export function MenuStack({ rootMenu, initialFocusUid, playerRef, MENU_TIMEOUT = 0, participantClient, participantRegistry = participantBrowserRegistry, onActivityReturn, onHostErrorBack, onActivityStart, onReturnTarget, getReturnMenuId, loadContentMenu, resolveMenuSource, onNavigationCancel, refreshParticipant, refreshToken = 0 }) {
  const { stack, currentContent, depth, push, pop, reset, replace, getSelection, setSelectionAtDepth, registerMenuBackHandler, unregisterMenuBackHandler, notifyNavigationIntent, subscribeNavigationIntent } = useMenuNavigationContext();
  const currentContentRef = React.useRef(currentContent);
  currentContentRef.current = currentContent;
  const [navigationError, setNavigationError] = React.useState(null);
  const navigationErrorRef = React.useRef(null);
  navigationErrorRef.current = navigationError;
  const [sourceVersion,setSourceVersion] = React.useState(0);
  const navigationGeneration = React.useRef(0);
  const pendingNavigation = React.useRef(false);
  useEffect(() => () => { navigationGeneration.current += 1; }, []);
  const returnFromActivityRef = React.useRef(null);
  const sourceFrame = [...stack].reverse().find(entry => entry.type === 'menu' && entry.props.sourceController);
  const sourceController = sourceFrame?.props.sourceController;
  const returnPolicy = sourceFrame?.props.list?.navigationPolicy || rootMenu?.navigationPolicy;
  const sourceRef = React.useRef(sourceController);
  useEffect(() => { const previous=sourceRef.current; if(previous && previous!==sourceController) previous.cancel(); sourceRef.current=sourceController; }, [sourceController]);
  useEffect(() => () => sourceRef.current?.cancel(), []);
  const { registerEscapeInterceptor, unregisterEscapeInterceptor, dismissOverlay, overlayOwnsNavStack } = useScreenOverlay();

  // Reset navigation state when rootMenu changes (including initial mount).
  // Without this, the nav stack from a previous menu persists — e.g., auto-selected
  // content (player) from menu A stays as currentContent when menu B opens.
  const prevRootMenuRef = React.useRef(null);
  React.useEffect(() => {
    if (rootMenu !== prevRootMenuRef.current) {
      reset();
      if (initialFocusUid && Array.isArray(rootMenu?.items)) {
        const index = rootMenu.items.findIndex(item => item.uid === initialFocusUid);
        if (index >= 0) setSelectionAtDepth(0, index, initialFocusUid);
      }
      prevRootMenuRef.current = rootMenu;
    }
  }, [rootMenu, reset, initialFocusUid, setSelectionAtDepth]);

  const closeNavigationError = useCallback(() => {
    navigationGeneration.current += 1;
    pendingNavigation.current = false;
    sourceController?.cancel();
    onNavigationCancel?.();
    navigationErrorRef.current = null;
    setNavigationError(null);
  }, [sourceController, onNavigationCancel]);

  useEffect(() => {
    const cancelPendingIntent = () => {
      if (pendingNavigation.current || navigationErrorRef.current) closeNavigationError();
    };
    const unsubscribe = subscribeNavigationIntent?.(cancelPendingIntent);
    const unsubscribeOverlay = getActionBus().subscribe('screen:overlay-mounted', cancelPendingIntent);
    return () => { unsubscribe?.(); unsubscribeOverlay(); };
  }, [subscribeNavigationIntent, navigationError, closeNavigationError]);

  // Register escape interceptor: pop navigation stack before overlay dismisses
  useEffect(() => {
    if (!registerEscapeInterceptor) return;

    const interceptor = () => {
      if (navigationError) { closeNavigationError(); return true; }
      if (pendingNavigation.current) {pendingNavigation.current=false;navigationGeneration.current++;sourceController?.cancel();return true;}
      if (depth > 0) {
        if (returnPolicy === 'return-to-selected' && ['player','composite','app','display','launch','android-launch','participant-result','participant-passthrough'].includes(currentContent?.type)) {
          returnFromActivityRef.current?.();
          return true;
        }
        navigationGeneration.current++;sourceController?.cancel();
        // If popping back to root on a timed menu, dismiss the overlay entirely
        // to avoid the auto-select timer creating an escape trap
        if (depth === 1 && MENU_TIMEOUT > 0 && !sourceController) {
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
  }, [MENU_TIMEOUT, depth, pop, registerEscapeInterceptor, unregisterEscapeInterceptor, rootMenu, currentContent, returnPolicy, sourceController, navigationError, closeNavigationError]);

  const pushOrdinaryList = useCallback(selection => {
    const id=selection.list?.contentId || selection.list?.plex;
    if(id && selection.type==='show') {push({type:'show-view',props:selection});return;}
    if(id && selection.type==='season') {push({type:'season-view',props:selection});return;}
    if(id && (id.startsWith('plex:') || /^\d+$/.test(id)) && !selection.type) {push({type:'plex-menu',props:selection});return;}
    push({type:'menu',props:selection});
  },[push]);

  /**
   * Handle selection from any menu level.
   * Maps selection to appropriate action (push menu, play content, open app).
   * 
   * For Plex items without known type, PlexMenuRouter will determine the view.
   * For items with type already set (from season/show responses), route directly.
   */
  const handleSelect = useCallback((selection) => {
    if (!selection || selection.disabled) return;
    notifyNavigationIntent?.();
    if (returnPolicy === 'return-to-selected' && selection.uid) {
      const menu = currentContent?.type === 'menu' ? currentContent.props.list : rootMenu;
      const index = menu?.items?.findIndex(item => item.uid === selection.uid) ?? -1;
      if (index >= 0) setSelectionAtDepth(depth, index, selection.uid);
    }
    const action = selection.list || selection.menu ? null : ['play','queue','display','open'].find(key => selection[key]);
    const startsActivity = action || selection.launch || selection.android;
    if (startsActivity) {navigationGeneration.current += 1;pendingNavigation.current=false;}
    if (startsActivity) (sourceController?.activityStart || onActivityStart)?.(currentContent?.type === 'menu' ? currentContent.props.list : rootMenu);
    if (action && Object.hasOwn(selection, 'participantLaunches')) {
      let intercepted = true;
      dispatchParticipantAction({selection, action, onOrdinaryAction: () => { intercepted = false; }, onInvalid: () => setNavigationError({kind:'invalid_participant'}), onPresentation: ({ref, action: selectedAction}) => push({type:'participant-launch', props:{ref, action:selectedAction, uid:selection.uid}})});
      if (intercepted) return;
    }

    const contentId = selection.list?.contentId;
    if (contentId && (sourceController || loadContentMenu || resolveMenuSource)) {
      const request = ++navigationGeneration.current;pendingNavigation.current=true;
      const open = async token => {
        if (sourceController) return {menu:await sourceController.navigate(contentId)};
        if (loadContentMenu) return {menu:await loadContentMenu(contentId)};
        const source=await resolveMenuSource(contentId);
        if (navigationGeneration.current!==token) {source?.controller?.cancel();return null;}
        if (!source) return null;
        return {menu:await source.controller.navigate(source.contentId),controller:source.controller};
      };
      open(request).then(result => {
        if (navigationGeneration.current !== request) {result?.controller?.cancel();return;}
        pendingNavigation.current=false;
        if (result) push({type:'menu',props:{list:result.menu,...(result.controller ? {sourceController:result.controller} : {})}});
        else pushOrdinaryList(selection);
      }).catch(error => {if (navigationGeneration.current !== request || error.code === 'stale_menu_request') return;pendingNavigation.current=false;getLogger().warn('menu.navigation.error',{code:error.code});setNavigationError({contentId,open,fallback:()=>pushOrdinaryList(selection)});});
      return;
    }

    if (selection.list || selection.menu) {
      pushOrdinaryList(selection);
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
      push({ type: 'player', props: threadShaderIntoContent(selection) });
    } else if (selection.display) {
      const sceneId = artSceneIdFromDisplay(selection.display);
      if (sceneId) {
        // ArtMode scene — hand off to the central display:content handler.
        getActionBus().emit('display:content', { id: sceneId });
      } else {
        // Generic content — map contentId to id for the Displayer component.
        const display = { ...selection.display, id: selection.display.contentId || selection.display.id };
        push({ type: 'display', props: { ...selection, display } });
      }
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
  }, [push, loadContentMenu, resolveMenuSource, sourceController, onActivityStart, currentContent, rootMenu, depth, setSelectionAtDepth, returnPolicy, pushOrdinaryList, notifyNavigationIntent]);

  /**
   * Clear function for Player/AppContainer to pop back
   */
  const clear = useCallback(() => {
    const targetId = sourceController?.returnMenuId() || getReturnMenuId?.();
    let targetDepth = depth - 1;
    if (targetId && returnPolicy === 'return-to-selected') {
      const index = stack.findLastIndex(entry => entry.type === 'menu' && entry.props.list?.id === targetId);
      if (index >= 0) targetDepth = index + 1;
      else if (rootMenu.id === targetId) targetDepth = 0;
    }
    for (let i = depth; i > targetDepth; i--) pop();
    if (sourceController) {const request=++navigationGeneration.current;sourceController.refresh().then(()=>{if(navigationGeneration.current===request)setSourceVersion(v=>v+1);}).catch(error=>{if(navigationGeneration.current===request && error.code!=='stale_menu_request')setNavigationError({kind:'refresh',controller:sourceController});});}
    else onActivityReturn?.();
  }, [pop, onActivityReturn, getReturnMenuId, depth, stack, rootMenu, returnPolicy, sourceController]);

  returnFromActivityRef.current = clear;
  React.useLayoutEffect(() => {
    if ((!navigationError && !resolveMenuSource && returnPolicy !== 'return-to-selected') || !registerMenuBackHandler) return;
    const handler = () => {
      if (navigationError) { closeNavigationError(); return true; }
      if (pendingNavigation.current) {pendingNavigation.current=false;navigationGeneration.current++;sourceController?.cancel();return true;}
      if (returnPolicy !== 'return-to-selected') return false;
      if (onHostErrorBack) { onHostErrorBack(); return true; }
      if (!['player','composite','app','display','launch','android-launch','participant-result','participant-passthrough'].includes(currentContent?.type)) {navigationGeneration.current++;sourceController?.cancel();return false;}
      returnFromActivityRef.current?.();
      return true;
    };
    registerMenuBackHandler(handler);
    return () => unregisterMenuBackHandler?.(handler);
  }, [rootMenu, currentContent, onHostErrorBack, registerMenuBackHandler, unregisterMenuBackHandler, returnPolicy, resolveMenuSource, sourceController, navigationError, closeNavigationError]);

  // A fullscreen menu owns dismissal for its Player. An embedded menu pops
  // its own activity, even when a different fullscreen overlay is open.
  const exitToHome = useCallback(() => {
    if (overlayOwnsNavStack && returnPolicy !== 'return-to-selected') dismissOverlay();
    else clear();
  }, [dismissOverlay, overlayOwnsNavStack, clear, returnPolicy]);

  if (navigationError) {
    const closeError = closeNavigationError;
    if (navigationError.kind === 'invalid_participant') return <TVActionDialog role="alert" label="Activity unavailable" onBack={closeError}><p>Activity launch unavailable.</p><button onClick={closeError}>Back</button></TVActionDialog>;
    const retry = () => {
      const request = ++navigationGeneration.current;
      pendingNavigation.current = true;
      const work = navigationError.kind==='refresh' ? navigationError.controller.refresh().then(()=>({refresh:true})) : navigationError.open ? navigationError.open(request) : loadContentMenu(navigationError.contentId).then(menu=>({menu}));
      work.then(result => {
        if (navigationGeneration.current !== request) { result?.controller?.cancel(); return; }
        pendingNavigation.current = false;
        navigationErrorRef.current = null;
        setNavigationError(null);if(result?.refresh) setSourceVersion(v=>v+1);else if(result) push({type:'menu',props:{list:result.menu,...(result.controller ? {sourceController:result.controller} : {})}});else navigationError.fallback?.();
      }).catch(error => {
        if (navigationGeneration.current !== request) return;
        pendingNavigation.current = false;
        getLogger().warn('menu.navigation.error',{code:error.code});
      });
    };
    return <TVActionDialog role="alert" label="Menu error" onBack={closeError}><p>Unable to load menu.</p>
      <button onClick={retry}>Retry</button>
      <button onClick={closeError}>Back</button>
    </TVActionDialog>;
  }

  // If stack is empty, render root menu
  if (!currentContent) {
    return (
      <TVMenu
        list={rootMenu}
        depth={0}
        onSelect={handleSelect}
        onEscape={() => {}} // At root, escape does nothing
        MENU_TIMEOUT={MENU_TIMEOUT}
        refreshToken={refreshToken + sourceVersion}
      />
    );
  }

  // Render based on content type
  const { type, props } = currentContent;

  switch (type) {
    case 'participant-launch':
      return <ParticipantLaunchHost key={`${props.ref.ref}:${props.attempt || 0}`} refValue={props.ref} action={props.action} client={participantClient} onClose={pop} requireConfirmation={props.requireConfirmation} canLaunch={consumer => participantRegistry.supports(consumer)} resolvePreview={options => participantRegistry.resolvePreview?.(options)}
        onConflict={async () => {
          if (!refreshParticipant && !sourceController) { pop(); return; }
          const originatingContent = currentContent;
          const ref = await (sourceController ? sourceController.refreshParticipant(props.uid, props.action) : refreshParticipant(props.uid, props.action));
          if (currentContentRef.current !== originatingContent) return;
          if (!ref) { pop(); return; }
          replace({type:'participant-launch',props:{...props,ref,requireConfirmation:true,attempt:(props.attempt || 0)+1}});
        }}
        onPassthrough={(result, consumer) => {
          const Adapter = participantRegistry.resolvePassthrough(consumer);
          if (!Adapter || result.action !== props.action) throw new Error('This activity is unavailable on this device');
          replace({type:'participant-passthrough', props:{Adapter, action:result.action, target:result.target}});
        }}
        onReady={result => {
          const Adapter = participantRegistry.resolve(result);
          if (!Adapter) throw new Error('This activity is unavailable on this device');
          if (result.return_to?.kind === 'content' && typeof result.return_to.item_uid === 'string') {
            const parentDepth = Math.max(0, depth - 1);
            setSelectionAtDepth(parentDepth, getSelection(parentDepth).index, result.return_to.item_uid);
          }
          if(sourceController) sourceController.returnTarget(result.return_to); else onReturnTarget?.(result.return_to);
          const {return_to: _returnTarget, ...participantLaunch} = result;
          replace({type:'participant-result', props:{Adapter, result:participantLaunch}});
        }} />;

    case 'participant-passthrough': {
      const Adapter = props.Adapter;
      return <Adapter action={props.action} target={props.target} clear={clear} />;
    }

    case 'participant-result': {
      const Adapter = props.Adapter;
      return <Adapter participantLaunch={props.result} clear={clear} />;
    }

    case 'menu':
      return (
        <TVMenu
          list={props.list || props.menu || props}
          depth={depth}
          onSelect={handleSelect}
          onEscape={props.sourceController ? () => {navigationGeneration.current++;props.sourceController.cancel();pop();} : clear}
          MENU_TIMEOUT={MENU_TIMEOUT}
          refreshToken={refreshToken + sourceVersion}
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
      // Menu-selected playback is a SECOND player seam — it does not go through
      // ScreenPlayer. Wrapping only that one would leave every living-room menu
      // selection unframed.
      return (
        <Suspense fallback={<LoadingFallback />}>
          <SurroundHost
            getPlayerHandle={() => playerRef?.current ?? null}
            contentId={props.play ?? props.queue ?? null}
          >
            <Player holdOnRefusal {...props} ref={playerRef} clear={exitToHome} />
          </SurroundHost>
        </Suspense>
      );

    case 'composite':
      // Composed presentation with visual + audio tracks
      return (
        <Suspense fallback={<LoadingFallback />}>
          <SurroundHost
            getPlayerHandle={() => playerRef?.current ?? null}
            contentId={props.play ?? props.queue ?? null}
          >
            <Player holdOnRefusal {...props} ref={playerRef} clear={exitToHome} />
          </SurroundHost>
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
