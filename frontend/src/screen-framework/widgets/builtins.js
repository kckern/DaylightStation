/**
 * Built-in widget registrations
 * Maps existing modules to the screen framework registry
 */
import { getWidgetRegistry } from './registry.js';

/**
 * Register all built-in widgets with the registry
 */
export function registerBuiltinWidgets() {
  const registry = getWidgetRegistry();

  // Time/Clock widget
  registry.register('clock',
    () => import('../../modules/Time/Time.jsx').then(m => m.default),
    {
      defaultSource: null, // Clock uses local time
      refreshInterval: null,
      actions: []
    }
  );

  // Weather widget
  registry.register('weather',
    () => import('../../modules/Weather/Weather.jsx').then(m => m.default),
    {
      defaultSource: '/api/v1/home/weather',
      refreshInterval: 60000,
      actions: ['select', 'refresh']
    }
  );

  // Weather Forecast widget
  registry.register('weather-forecast',
    () => import('../../modules/Weather/WeatherForecast.jsx').then(m => m.default),
    {
      defaultSource: '/api/v1/home/weather',
      refreshInterval: 300000,
      actions: ['select']
    }
  );

  // Calendar/Upcoming widget
  registry.register('calendar',
    () => import('../../modules/Upcoming/Upcoming.jsx').then(m => m.default),
    {
      defaultSource: '/api/v1/calendar',
      refreshInterval: 300000,
      actions: ['select']
    }
  );

  // Finance chart widget
  registry.register('finance',
    () => import('../../modules/Finance/Finance.jsx').then(m => m.FinanceChart),
    {
      defaultSource: '/api/v1/finance/chart',
      refreshInterval: 3600000,
      actions: ['select']
    }
  );

  // Entropy panel widget
  registry.register('entropy',
    () => import('../../modules/Entropy/EntropyPanel.jsx').then(m => m.default),
    {
      defaultSource: '/api/v1/entropy',
      refreshInterval: 300000,
      actions: ['select']
    }
  );

  // Weight widget
  registry.register('weight',
    () => import('../../modules/Health/Weight.jsx').then(m => m.default),
    {
      defaultSource: '/api/v1/health',
      refreshInterval: 300000,
      actions: ['select']
    }
  );

  // Menu widget (for TV-style navigation)
  registry.register('menu',
    () => import('../../modules/Menu/Menu.jsx').then(m => m.TVMenu),
    {
      defaultSource: null, // Configured per-instance
      refreshInterval: null,
      actions: ['select', 'navigate', 'escape']
    }
  );

  // Player widget
  registry.register('player',
    () => import('../../modules/Player/Player.jsx').then(m => m.default),
    {
      defaultSource: null, // Receives queue via actions
      refreshInterval: null,
      actions: ['play', 'pause', 'seek', 'next', 'previous', 'escape']
    }
  );

  return registry;
}
