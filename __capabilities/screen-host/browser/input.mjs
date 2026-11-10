/** Explicit input surface; implementation remains owner-private. */
export { getActionBus, ActionBus, resetActionBus } from "./input/ActionBus.js";
export { createInputManager } from "./input/InputManager.js";
export { rescueGesture, RESCUE_PRESSES, RESCUE_WINDOW_MS } from "./input/rescueGesture.js";
export { useScreenAction } from "./input/useScreenAction.js";
export { translateAction, translateSecondary, ACTION_MAP } from "./input/actionMap.js";
export { KeyboardAdapter } from "./input/adapters/KeyboardAdapter.js";
export { NumpadAdapter } from "./input/adapters/NumpadAdapter.js";
export { RemoteAdapter } from "./input/adapters/RemoteAdapter.js";
export { GamepadAdapter, gamepadPresence, acquireGamepadBuzzerCapture, acquireGamepadInputHost, bindNextGamepadPress, cancelPendingGamepadBind, clearGamepadRoleBindings, restoreGamepadRoleBindings } from "./input/adapters/GamepadAdapter.js";
export { TouchAdapter } from "./input/adapters/TouchAdapter.js";
export { useScopedRemoteControls } from "./input/useScopedRemoteControls.js";
