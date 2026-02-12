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
export { createInputManager } from './input/InputManager.js';
export { useScreenAction } from './input/useScreenAction.js';
export { translateAction, translateSecondary, ACTION_MAP } from './input/actionMap.js';
export { KeyboardAdapter } from './input/adapters/KeyboardAdapter.js';
export { NumpadAdapter } from './input/adapters/NumpadAdapter.js';
export { RemoteAdapter } from './input/adapters/RemoteAdapter.js';

// Data layer
export { DataManager, getDataManager, resetDataManager } from './data/DataManager.js';

// Widget system
export { WidgetRegistry, getWidgetRegistry, resetWidgetRegistry } from './widgets/registry.js';
export { WidgetWrapper } from './widgets/WidgetWrapper.jsx';
export { registerBuiltinWidgets } from './widgets/builtins.js';
