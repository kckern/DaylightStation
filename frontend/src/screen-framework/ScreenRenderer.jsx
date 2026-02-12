import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { DaylightAPI } from '../lib/api.mjs';
import { GridLayout } from './layouts/GridLayout.jsx';
import { WidgetWrapper } from './widgets/WidgetWrapper.jsx';
import { registerBuiltinWidgets } from './widgets/builtins.js';
import { getActionBus } from './input/ActionBus.js';
import { createInputManager } from './input/InputManager.js';

// Register built-ins on module load
registerBuiltinWidgets();

/**
 * ScreenRenderer - Main entry point for config-driven screens
 *
 * Fetches screen config from API, selects layout engine,
 * instantiates widgets, and wires input handling.
 */
export function ScreenRenderer({ screenId: propScreenId }) {
  const params = useParams();
  const screenId = propScreenId || params.screenId;

  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch screen configuration
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const data = await DaylightAPI(`/api/v1/screens/${screenId}`);
        setConfig(data);
      } catch (err) {
        setError(`Failed to load screen "${screenId}": ${err.message}`);
      }
      setLoading(false);
    };

    if (screenId) {
      fetchConfig();
    } else {
      setError('No screen ID provided');
      setLoading(false);
    }
  }, [screenId]);

  // Initialize input system when config loads
  useEffect(() => {
    if (!config?.input) return;
    const manager = createInputManager(getActionBus(), config.input);
    return () => manager.destroy();
  }, [config]);

  if (loading) {
    return (
      <div className="screen-renderer screen-renderer--loading">
        Loading screen: {screenId}...
      </div>
    );
  }

  if (error) {
    return (
      <div className="screen-renderer screen-renderer--error">
        <h2>Screen Error</h2>
        <p>{error}</p>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="screen-renderer screen-renderer--not-found">
        Screen not found: {screenId}
      </div>
    );
  }

  // Select layout engine based on config
  const Layout = selectLayout(config.layout?.type);
  const layoutProps = {
    columns: config.layout?.columns,
    rows: config.layout?.rows,
    gap: config.layout?.gap
  };

  // Build widget list from config
  const widgets = Object.entries(config.widgets || {}).map(([name, widgetConfig]) => {
    // Handle shorthand (just position) vs full config
    const normalizedConfig = typeof widgetConfig === 'object'
      ? widgetConfig
      : {};

    const position = {
      row: normalizedConfig.row || 1,
      col: normalizedConfig.col || 1,
      colspan: normalizedConfig.colspan || 1,
      rowspan: normalizedConfig.rowspan || 1
    };

    return (
      <WidgetWrapper
        key={name}
        name={name}
        config={normalizedConfig}
        position={position}
      />
    );
  });

  return (
    <div className={`screen-renderer screen-renderer--${screenId}`}>
      <Layout {...layoutProps}>
        {widgets}
      </Layout>
    </div>
  );
}

/**
 * Select layout component based on type
 */
function selectLayout(type) {
  switch (type) {
    case 'grid':
    default:
      return GridLayout;
    // Future: case 'regions': return RegionsLayout;
    // Future: case 'flex': return FlexLayout;
  }
}

export default ScreenRenderer;
