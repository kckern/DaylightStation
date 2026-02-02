import React, { Suspense, useState, useEffect, useCallback } from 'react';
import { getActionBus } from '../input/ActionBus.js';
import { getDataManager } from '../data/DataManager.js';
import { getWidgetRegistry } from './registry.js';

/**
 * WidgetWrapper - Loads widget component, manages data, wires actions
 *
 * Handles:
 * - Lazy loading widget component from registry
 * - Subscribing to data source
 * - Connecting to action bus
 * - Passing standardized props to widget
 */
export function WidgetWrapper({
  name,
  config = {},
  position = {},
  children
}) {
  const [WidgetComponent, setWidgetComponent] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const registry = getWidgetRegistry();
  const dataManager = getDataManager();
  const actionBus = getActionBus();

  // Load widget component
  useEffect(() => {
    const loadWidget = async () => {
      const componentLoader = registry.get(name);
      if (!componentLoader) {
        setError(`Widget "${name}" not found in registry`);
        setLoading(false);
        return;
      }

      try {
        // Handle both sync and async (lazy) components
        const component = typeof componentLoader === 'function'
          ? await componentLoader()
          : componentLoader;
        setWidgetComponent(() => component);
      } catch (err) {
        setError(`Failed to load widget "${name}": ${err.message}`);
      }
      setLoading(false);
    };

    loadWidget();
  }, [name, registry]);

  // Subscribe to data source
  useEffect(() => {
    const metadata = registry.getMetadata(name);
    const source = config.source || metadata?.defaultSource;
    const refreshInterval = config.refresh || metadata?.refreshInterval;

    if (!source) return;

    const unsubscribe = dataManager.subscribe(source, setData, { refreshInterval });
    return unsubscribe;
  }, [name, config.source, config.refresh, registry, dataManager]);

  // Dispatch action helper
  const dispatch = useCallback((action, payload) => {
    actionBus.emit(action, { widget: name, ...payload });
  }, [actionBus, name]);

  // Build position data attributes
  const positionAttrs = {
    'data-row': position.row,
    'data-col': position.col,
    'data-colspan': position.colspan,
    'data-rowspan': position.rowspan
  };

  if (loading) {
    return (
      <div className="screen-widget screen-widget--loading" {...positionAttrs}>
        Loading {name}...
      </div>
    );
  }

  if (error) {
    return (
      <div className="screen-widget screen-widget--error" {...positionAttrs}>
        {error}
      </div>
    );
  }

  if (!WidgetComponent) {
    return (
      <div className="screen-widget screen-widget--missing" {...positionAttrs}>
        Widget not found: {name}
      </div>
    );
  }

  return (
    <div className={`screen-widget screen-widget--${name}`} {...positionAttrs}>
      <Suspense fallback={<div>Loading...</div>}>
        <WidgetComponent
          data={data}
          config={config}
          dispatch={dispatch}
          {...config}
        />
      </Suspense>
    </div>
  );
}

export default WidgetWrapper;
