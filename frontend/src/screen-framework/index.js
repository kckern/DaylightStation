/**
 * Screen Framework
 * Config-driven kiosk interfaces for room-based displays
 */

export const VERSION = '0.1.0';

// Core exports
export { ActionBus, getActionBus, resetActionBus } from './input/ActionBus.js';
export { WidgetRegistry, getWidgetRegistry, resetWidgetRegistry } from './widgets/registry.js';
export { registerBuiltinWidgets } from './widgets/builtins.js';
export { DataManager, getDataManager, resetDataManager } from './data/DataManager.js';
