/**
 * Screen Framework
 * Config-driven kiosk interfaces for room-based displays
 */

export const VERSION = '0.2.0';

// Main renderer
export { ScreenRenderer } from './ScreenRenderer.jsx';

// Panel layout
export { PanelRenderer } from './panels/PanelRenderer.jsx';

// Data coordination
export { ScreenDataProvider, useScreenData } from './data/ScreenDataProvider.jsx';

// Overlay system
export { ScreenOverlayProvider, useScreenOverlay } from './overlays/ScreenOverlayProvider.jsx';

// Input system
export { ActionBus, getActionBus, resetActionBus } from './input/ActionBus.js';
export { createInputManager } from './input/InputManager.js';
export { useScreenAction } from './input/useScreenAction.js';
export { translateAction, translateSecondary, ACTION_MAP } from './input/actionMap.js';
export { KeyboardAdapter } from './input/adapters/KeyboardAdapter.js';
export { NumpadAdapter } from './input/adapters/NumpadAdapter.js';
export { RemoteAdapter } from './input/adapters/RemoteAdapter.js';
export { GamepadAdapter } from './input/adapters/GamepadAdapter.js';

// Widget system
export { WidgetRegistry, getWidgetRegistry, resetWidgetRegistry } from './widgets/registry.js';
export { registerBuiltinWidgets } from './widgets/builtins.js';
