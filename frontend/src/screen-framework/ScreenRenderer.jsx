import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { DaylightAPI } from '../lib/api.mjs';
import { PanelRenderer } from './panels/PanelRenderer.jsx';
import { ScreenDataProvider } from './data/ScreenDataProvider.jsx';
import { ScreenOverlayProvider } from './overlays/ScreenOverlayProvider.jsx';
import { registerBuiltinWidgets } from './widgets/builtins.js';
import { getActionBus } from './input/ActionBus.js';
import { createInputManager } from './input/InputManager.js';

// Register built-ins on module load
registerBuiltinWidgets();

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
    return () => manager.destroy();
  }, [config]);

  // Convert theme to --screen-* CSS custom properties
  const themeStyle = useMemo(() => {
    if (!config?.theme) return {};
    return Object.fromEntries(
      Object.entries(config.theme).map(([k, v]) => [`--screen-${k}`, String(v)])
    );
  }, [config]);

  if (loading) {
    return <div className="screen-root screen-root--loading">Loading screen: {screenId}...</div>;
  }

  if (error) {
    return <div className="screen-root screen-root--error"><h2>Screen Error</h2><p>{error}</p></div>;
  }

  if (!config) {
    return <div className="screen-root screen-root--not-found">Screen not found: {screenId}</div>;
  }

  return (
    <ScreenDataProvider sources={config.data}>
      <div className={`screen-root screen-root--${screenId}`} style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        position: 'relative',
        ...themeStyle,
      }}>
        <ScreenOverlayProvider>
          <PanelRenderer node={config.layout} />
        </ScreenOverlayProvider>
      </div>
    </ScreenDataProvider>
  );
}

export default ScreenRenderer;
