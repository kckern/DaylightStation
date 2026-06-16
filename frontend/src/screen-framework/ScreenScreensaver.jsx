// frontend/src/screen-framework/ScreenScreensaver.jsx
import { useEffect, useRef } from 'react';
import { useScreenOverlay } from './overlays/ScreenOverlayProvider.jsx';
import { getWidgetRegistry } from './widgets/registry.js';
import { useMenuNavigationContext } from '../context/MenuNavigationContext.jsx';
import getLogger from '../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'ScreenScreensaver' });
  return _logger;
}

const ACTIVITY_EVENTS = ['keydown', 'pointerdown', 'click'];

/**
 * ScreenScreensaver — renderless controller that shows a configured widget as a
 * lowest-priority fullscreen overlay on idle / at boot. Suppressed while another
 * fullscreen overlay (player/piano/camera) is active. The idle timer restarts
 * whenever the screensaver closes.
 *
 * Two dismissal modes:
 *   - default: any input dismisses it (the first event is swallowed so it
 *     doesn't leak into the menu).
 *   - interactive: the controller does NOT grab input — the widget manages its
 *     own keys and calls the injected `onExit` prop to close. Use this for
 *     widgets like ArtMode that handle navigation/brightness themselves.
 *
 * Config (from screen YAML `screensaver:` block):
 *   widget: string       widget registry key to show (required)
 *   idle: number         seconds of inactivity before showing (default 120)
 *   showOnLoad: boolean  show immediately at boot (default false)
 *   interactive: boolean let the widget own input + call onExit (default false)
 *   props: object        props passed to the widget
 */
export function ScreenScreensaver({ config }) {
  const { showOverlay, dismissOverlay, hasOverlay } = useScreenOverlay();
  const { reset } = useMenuNavigationContext();

  const widgetKey = config?.widget ?? null;
  const idleSeconds = config?.idle ?? 120;
  const showOnLoad = config?.showOnLoad ?? false;
  const interactive = config?.interactive ?? false;
  const propsJson = JSON.stringify(config?.props ?? {});

  // Read latest hasOverlay without re-running the effect.
  const hasOverlayRef = useRef(hasOverlay);
  hasOverlayRef.current = hasOverlay;

  useEffect(() => {
    if (!widgetKey) return undefined;
    const widgetProps = JSON.parse(propsJson);
    let shown = false;
    let timer = null;

    const schedule = () => {
      if (!idleSeconds) return; // 0 / falsy → no idle timer
      if (timer) clearTimeout(timer);
      timer = setTimeout(show, idleSeconds * 1000);
    };

    // Close + restart the idle timer. Used by both the blanket wake handler and
    // the widget's onExit (interactive mode).
    const close = () => {
      if (!shown) return;
      shown = false;
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, wake, true));
      dismissOverlay('fullscreen');
      schedule();
    };

    function wake(e) {
      if (!shown) return;
      if (e) { e.stopPropagation(); e.preventDefault(); }
      logger().info('screensaver.wake', { widget: widgetKey });
      close();
    }

    const onExit = () => {
      logger().info('screensaver.exit', { widget: widgetKey });
      close();
    };

    function show() {
      if (shown) return;
      if (hasOverlayRef.current) { schedule(); return; } // suppressed by active overlay
      const Component = getWidgetRegistry().get(widgetKey);
      if (!Component) { logger().warn('screensaver.widget-not-found', { widget: widgetKey }); return; }
      reset?.();
      shown = true;
      showOverlay(Component, { ...widgetProps, onExit }, { mode: 'fullscreen' });
      logger().info('screensaver.show', { widget: widgetKey, interactive });
      // Interactive widgets own their input and call onExit; otherwise any input wakes.
      if (!interactive) {
        ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, wake, true));
      }
    }

    const onActivity = () => { if (!shown) schedule(); };
    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, onActivity));

    if (showOnLoad) show(); else schedule();

    return () => {
      if (timer) clearTimeout(timer);
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, onActivity));
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, wake, true));
      if (shown) dismissOverlay('fullscreen');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widgetKey, idleSeconds, showOnLoad, interactive, propsJson, showOverlay, dismissOverlay, reset]);

  return null;
}

export default ScreenScreensaver;
