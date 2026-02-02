/**
 * Screen Framework
 * Config-driven kiosk interfaces for room-based displays
 */

export const VERSION = '0.1.0';

// Main renderer
export { ScreenRenderer } from './ScreenRenderer.jsx';

// Layouts
export { GridLayout } from './layouts/GridLayout.jsx';

// Input system
export { ActionBus, getActionBus, resetActionBus } from './input/ActionBus.js';

// Data layer
export { DataManager, getDataManager, resetDataManager } from './data/DataManager.js';

// Widget system
export { WidgetRegistry, getWidgetRegistry, resetWidgetRegistry } from './widgets/registry.js';
export { WidgetWrapper } from './widgets/WidgetWrapper.jsx';
export { registerBuiltinWidgets } from './widgets/builtins.js';
