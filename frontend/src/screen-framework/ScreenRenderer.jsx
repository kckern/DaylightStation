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
import { MenuNavigationProvider } from '../context/MenuNavigationContext.jsx';

// Register built-ins on module load
registerBuiltinWidgets();

/**
 * ScreenCommandHandler - Bridges WS command config to the ActionBus.
 *
 * Reads the websocket block from screen YAML config, subscribes to WS messages
 * that look like remote commands, and emits ActionBus events.
 *
 * This is a renderless component (returns null).
 */
function ScreenCommandHandler({ wsConfig }) {
  const bus = useMemo(() => getActionBus(), []);
  useScreenCommands(wsConfig, bus);
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
              <ScreenActionHandler actions={config.actions} />
              <ScreenCommandHandler wsConfig={config.websocket} />
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
