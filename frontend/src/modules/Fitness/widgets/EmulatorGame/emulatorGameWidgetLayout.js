// emulatorGameWidgetLayout.js — layout class helper for EmulatorGameWidget.jsx,
// split out so Fast Refresh can hot-reload the widget component on its own.

/**
 * Class for the portaled fullscreen wrapper. The running emulator is rendered via
 * createPortal to document.body, so it escapes the `.fitness-app-container.kiosk-ui`
 * cursor-hide scope. Tagging the wrapper with `kiosk-ui` lets EmulatorConsole.scss
 * re-apply the cursor-hide rule there.
 */
export function fullscreenClass(isKiosk) {
  return `fitness-emulator-fullscreen${isKiosk ? ' kiosk-ui' : ''}`;
}
