// ControllersOverlay — the arcade's controllers panel, opened from the fitness
// settings menu. Same component (ControllerStatus), same context actions; only
// the host differs. Controller config comes from the emulator library's
// `input` block (media/emulation/input.yml).
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DaylightAPI } from '@/lib/api.mjs';
import getLogger from '@/lib/logging/Logger.js';
import { useFitnessContext } from '../../context/FitnessContext.jsx';
import { ControllerStatus } from '../../../../../games/emulator/browser/input/ControllerStatus.jsx';
import { useGamepadKeys } from '../../lib/useGamepadKeys.js';
import './ControllersOverlay.scss';

let _logger;
const logger = () => (_logger ||= getLogger().child({ component: 'fitness-controllers-overlay' }));

export default function ControllersOverlay({ open, onClose }) {
  const ctx = useFitnessContext() || {};
  const [controllers, setControllers] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setControllers(null);
    setLoadError(null);
    logger().info('controllers-overlay.open', {});
    DaylightAPI('api/v1/emulator/library').then((lib) => {
      if (cancelled) return;
      const list = Array.isArray(lib?.input?.controllers) ? lib.input.controllers : [];
      setControllers(list);
      logger().info('controllers-overlay.config-loaded', { controllers: list.length });
    }).catch((err) => {
      if (cancelled) return;
      setControllers([]);
      setLoadError(err?.message || 'load failed');
      logger().warn('controllers-overlay.config-failed', { error: err?.message });
    });
    return () => { cancelled = true; logger().info('controllers-overlay.close', {}); };
  }, [open]);

  // Gamepad: arrows move between buttons, A presses, B closes. Focus moves only
  // on a key press; the panel focuses its own start button when the add panel or
  // repair guide opens, and this handler carries on from wherever focus is.
  useGamepadKeys(open, (key) => {
    const root = panelRef.current;
    if (!root) return;
    if (key === 'Escape') { onClose?.(); return; }
    const buttons = [...root.querySelectorAll('button:not([disabled])')];
    if (buttons.length === 0) return;
    const i = buttons.indexOf(document.activeElement);
    if (key === 'Enter') {
      // Nothing focused yet: A only lands focus. Clicking buttons[0] (Close)
      // would shut the overlay on the first press.
      if (i >= 0) buttons[i].click(); else buttons[0].focus();
      return;
    }
    const step = key === 'ArrowUp' || key === 'ArrowLeft' ? -1 : 1;
    buttons[i < 0 ? 0 : (i + step + buttons.length) % buttons.length].focus();
  });

  if (!open) return null;
  return createPortal(
    <div className="fitness-controllers-overlay" role="dialog" aria-modal="true" aria-label="Controllers"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose?.(); } }}>
      <div className="fitness-controllers-overlay__panel" ref={panelRef}>
        <header className="fitness-controllers-overlay__header">
          <h3>Controllers</h3>
          <button type="button" className="fitness-controllers-overlay__close" aria-label="Close controllers" onClick={onClose}>
            Close
          </button>
        </header>
        {loadError ? (
          <p role="alert" className="fitness-controllers-overlay__error">
            Could not load the controller list ({loadError}). Adding a new device still works.
          </p>
        ) : null}
        {controllers === null ? <p className="fitness-controllers-overlay__loading">Loading…</p> : (
          <ControllerStatus
            controllers={controllers}
            btInventory={ctx.btInventory}
            pairing={ctx.controllerPairing}
            onPair={ctx.pairController}
            canAdd={typeof ctx.pairController === 'function'}
            onForget={ctx.forgetController}
            forgetResult={ctx.controllerForget}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}
