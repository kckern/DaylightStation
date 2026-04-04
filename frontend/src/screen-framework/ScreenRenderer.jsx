import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { DaylightAPI } from '../lib/api.mjs';
import { PanelRenderer } from './panels/PanelRenderer.jsx';
import { ScreenDataProvider } from './data/ScreenDataProvider.jsx';
import { ScreenProvider } from './providers/ScreenProvider.jsx';
import { ScreenOverlayProvider, useScreenOverlay } from './overlays/ScreenOverlayProvider.jsx';
import { registerBuiltinWidgets } from './widgets/builtins.js';
import { getActionBus } from './input/ActionBus.js';
import { createInputManager } from './input/InputManager.js';
import { ScreenActionHandler } from './actions/ScreenActionHandler.jsx';
import { getWidgetRegistry } from './widgets/registry.js';
import { useScreenSubscriptions } from './subscriptions/useScreenSubscriptions.js';
import { useScreenCommands } from './commands/useScreenCommands.js';
import { MenuNavigationProvider, useMenuNavigationContext } from '../context/MenuNavigationContext.jsx';
import { parseAutoplayParams } from '../lib/parseAutoplayParams.js';
import { getApp } from '../lib/appRegistry.js';
import { bindBackButton, enableGlobalKeyCapture } from '../lib/fkb.js';
import getLogger from '../lib/logging/Logger.js';

// Register built-ins on module load
registerBuiltinWidgets();
// Bind FKB back button → Escape on module load
bindBackButton();
// Log all remote button presses for Shield TV audit
enableGlobalKeyCapture();

const AUTOPLAY_ACTIONS = ['play', 'queue', 'playlist', 'random', 'display', 'read', 'open', 'app', 'launch', 'list'];

/**
 * ScreenAutoplay - Parses URL path suffix and query params into navigation actions.
 *
 * Supports two input forms:
 *   Path:  /screens/living-room/fhe  → navigates to menu:fhe submenu
 *   Query: ?queue=plex:642120        → queues content for playback
 *
 * Path-based navigation pushes directly onto the MenuNavigationContext stack
 * (no ActionBus) so it works with panel-based MenuWidgets.
 * Query-based autoplay emits on the ActionBus for the ScreenActionHandler.
 *
 * Runs once on mount, then cleans the URL to prevent re-triggering on reload.
 */
function ScreenAutoplay({ routes }) {
  const { push } = useMenuNavigationContext();

  useEffect(() => {
    const pathname = window.location.pathname;
    const search = window.location.search;

    // Path-based navigation: /screens/living-room/weekly-review or /screens/living-room/fhe
    const pathMatch = pathname.match(/\/screens?\/[^/]+\/(.+)/);
    if (pathMatch) {
      const subPath = pathMatch[1];
      const logger = getLogger().child({ component: 'ScreenAutoplay' });
      logger.info('screen-autoplay.path', { subPath });

      // Check app registry first — if subPath is a registered app, open it as overlay
      const appEntry = getApp(subPath);
      if (appEntry) {
        logger.info('screen-autoplay.app', { app: subPath });
        setTimeout(() => {
          const bus = getActionBus();
          bus.emit('menu:open', { menuId: subPath });
        }, 500);
      } else if (routes?.[subPath]) {
        // Route defined in screen config — use its content ID and props
        const { contentId, ...routeProps } = routes[subPath];
        logger.info('screen-autoplay.route', { subPath, contentId });
        setTimeout(() => {
          push({ type: 'menu', props: { list: { contentId }, ...routeProps } });
        }, 500);
      } else {
        // Default: treat suffix as menu name
        setTimeout(() => {
          push({ type: 'menu', props: { list: { contentId: `menu:${subPath}` } } });
        }, 500);
      }

      // Clean URL to prevent re-trigger
      const cleanPath = pathname.replace(/\/[^/]+$/, '');
      window.history.replaceState({}, '', cleanPath);
      return;
    }

    // Query-based autoplay: ?queue=plex:642120&shader=dark
    if (!search) return;

    const autoplay = parseAutoplayParams(search, AUTOPLAY_ACTIONS);
    if (!autoplay) return;

    const bus = getActionBus();
    const logger = getLogger().child({ component: 'ScreenAutoplay' });
    logger.info('screen-autoplay.parsed', { keys: Object.keys(autoplay) });

    // Emit appropriate action after a brief delay to let the screen framework mount
    setTimeout(() => {
      if (autoplay.compose) {
        bus.emit('media:queue', { compose: true, sources: autoplay.compose.sources, ...autoplay.compose });
      } else if (autoplay.queue) {
        bus.emit('media:queue', { contentId: autoplay.queue.contentId, ...autoplay.queue });
      } else if (autoplay.play) {
        bus.emit('media:play', { contentId: autoplay.play.contentId, ...autoplay.play });
      } else if (autoplay.display) {
        bus.emit('display:content', autoplay.display);
      } else if (autoplay.read) {
        bus.emit('display:content', { ...autoplay.read, mode: 'reader' });
      } else if (autoplay.launch) {
        bus.emit('media:play', { contentId: autoplay.launch.contentId, ...autoplay.launch });
      } else if (autoplay.open) {
        bus.emit('menu:open', { menuId: autoplay.open.app });
      } else if (autoplay.list) {
        bus.emit('menu:open', { menuId: autoplay.list.contentId });
      }
    }, 500);

    // Clean URL to prevent re-trigger
    window.history.replaceState({}, '', pathname);
  }, [push]);

  return null;
}

/**
 * ScreenCommandHandler - Bridges WS command config to the ActionBus.
 *
 * Reads the websocket block from screen YAML config, subscribes to WS messages
 * that look like remote commands, and emits ActionBus events.
 *
 * This is a renderless component (returns null).
 */
function ScreenCommandHandler({ wsConfig, screenId }) {
  const bus = useMemo(() => getActionBus(), []);
  useScreenCommands(wsConfig, bus, screenId);
  return null;
}

/**
 * ScreenSubscriptionHandler - Bridges WS subscription config to the overlay system.
 *
 * Reads the subscriptions block from screen YAML config, subscribes to declared
 * WS topics, and triggers showOverlay/dismissOverlay based on incoming events.
 *
 * Must be mounted inside ScreenOverlayProvider to access overlay context.
 * This is a renderless component (returns null).
 */
function ScreenSubscriptionHandler({ subscriptions }) {
  const { showOverlay, dismissOverlay, hasOverlay } = useScreenOverlay();
  const registry = useMemo(() => getWidgetRegistry(), []);
  useScreenSubscriptions(subscriptions, showOverlay, dismissOverlay, registry, { hasOverlay });
  return null;
}

/**
 * ScreenRenderer - Config-driven kiosk screen.
 * Fetches YAML config, sets up theme + data + input, renders panel tree.
 */
export function ScreenRenderer({ screenId: propScreenId }) {
  const params = useParams();
  const screenId = propScreenId || params.screenId;

  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const inputHealthyRef = React.useRef(false);

  // Failsafe: digit 4 always reloads if the input system hasn't attached
  useEffect(() => {
    const failsafe = (e) => {
      const key = e.key || e.code?.replace(/^(Digit|Numpad)/, '');
      if (key !== '4') return;
      if (inputHealthyRef.current) return; // NumpadAdapter is handling input
      window.location.reload();
    };
    window.addEventListener('keydown', failsafe);
    return () => window.removeEventListener('keydown', failsafe);
  }, []);

  // Fetch screen configuration
  useEffect(() => {
    if (!screenId) {
      setError('No screen ID provided');
      setLoading(false);
      return;
    }

    const fetchConfig = async () => {
      try {
        const data = await DaylightAPI(`api/v1/screens/${screenId}`);
        setConfig(data);
      } catch (err) {
        setError(`Failed to load screen "${screenId}": ${err.message}`);
      }
      setLoading(false);
    };

    fetchConfig();
  }, [screenId]);

  // Initialize input system
  useEffect(() => {
    if (!config?.input) return;
    const manager = createInputManager(getActionBus(), config.input);
    inputHealthyRef.current = true;
    return () => {
      manager.destroy();
      inputHealthyRef.current = false;
    };
  }, [config]);

  // Convert theme to --screen-* CSS custom properties
  const themeStyle = useMemo(() => {
    if (!config?.theme) return {};
    return Object.fromEntries(
      Object.entries(config.theme).map(([k, v]) => [`--screen-${k}`, String(v)])
    );
  }, [config]);

  const res = config?.resolution;
  const bgColor = config?.theme?.['screen-bg'] || '#000';

  // Always render the dark viewport wrapper to prevent white flash during loading
  const viewport = (content) => (
    <div className="screen-viewport" style={{
      width: '100vw',
      height: '100vh',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      overflow: 'hidden',
      backgroundColor: bgColor,
    }}>
      {content}
    </div>
  );

  if (loading) {
    return viewport(
      <div className="screen-root screen-root--loading">Loading screen: {screenId}...</div>
    );
  }

  if (error) {
    return viewport(
      <div className="screen-root screen-root--error"><h2>Screen Error</h2><p>{error}</p></div>
    );
  }

  if (!config) {
    return viewport(
      <div className="screen-root screen-root--not-found">Screen not found: {screenId}</div>
    );
  }

  return (
    <ScreenDataProvider sources={config.data}>
      {viewport(
        <div className={`screen-root screen-root--${screenId}`} style={{
          width: res ? `${res.width}px` : '100%',
          height: res ? `${res.height}px` : '100%',
          display: 'flex',
          position: 'relative',
          overflow: 'hidden',
          ...themeStyle,
        }}>
          <MenuNavigationProvider>
            <ScreenOverlayProvider>
              <ScreenAutoplay routes={config.routes} />
              <ScreenActionHandler actions={config.actions} />
              <ScreenCommandHandler wsConfig={config.websocket} screenId={screenId} />
              <ScreenSubscriptionHandler subscriptions={config.subscriptions} />
              <ScreenProvider config={config.layout}>
                <PanelRenderer />
              </ScreenProvider>
            </ScreenOverlayProvider>
          </MenuNavigationProvider>
        </div>
      )}
    </ScreenDataProvider>
  );
}

export default ScreenRenderer;
