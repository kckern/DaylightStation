// ControllersOverlay — the arcade's controllers panel, opened from the fitness
// settings menu. Same component (ControllerStatus), same context actions; only
// the host differs. Controller config comes from the emulator library's
// `input` block (media/emulation/input.yml).
import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DaylightAPI } from '@/lib/api.mjs';
import getLogger from '@/lib/logging/Logger.js';
import { useFitnessContext } from '../../context/FitnessContext.jsx';
import { ControllerStatus } from '../../../../../games/emulator/browser/input/ControllerStatus.jsx';
import { useGamepadKeys } from '../../lib/useGamepadKeys.js';
import './ControllersOverlay.scss';

let _logger;
const logger = () => (_logger ||= getLogger().child({ component: 'fitness-controllers-overlay' }));

const STEP = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 };
const enabledButtons = (root) => [...root.querySelectorAll('button:not([disabled])')];

export default function ControllersOverlay({ open, onClose }) {
  const titleId = useId();
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

  // Focus Close when the overlay opens, so a keyboard-mode remote's keys land
  // in the dialog, not on the sidebar button behind it. Keyed on `open` only:
  // the panel moves focus itself when its add panel or repair guide opens, and
  // nothing here pulls it back on a re-render.
  const closeRef = useRef(null);
  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  // One navigation path for the gamepad and the keyboard: arrows move between
  // enabled buttons (wrapping), Enter presses, Escape closes. Returns whether
  // the key was handled.
  const navigate = (key) => {
    if (key === 'Escape') { onClose?.(); return true; }
    const root = panelRef.current;
    if (!root) return false;
    const buttons = enabledButtons(root);
    if (buttons.length === 0) return false;
    const i = buttons.indexOf(document.activeElement);
    if (key === 'Enter') {
      // Nothing focused yet: Enter only lands focus. Clicking buttons[0]
      // (Close) would shut the overlay on the press that opened it.
      if (i >= 0) buttons[i].click(); else buttons[0].focus();
      return true;
    }
    const step = STEP[key];
    if (!step) return false;
    buttons[i < 0 ? 0 : (i + step + buttons.length) % buttons.length].focus();
    return true;
  };

  useGamepadKeys(open, (key) => { navigate(key); });

  const handleKeyDown = (e) => {
    if (e.key === 'Tab') {
      // Keep Tab inside the dialog.
      const buttons = panelRef.current ? enabledButtons(panelRef.current) : [];
      if (buttons.length === 0) return;
      e.preventDefault();
      const i = buttons.indexOf(document.activeElement);
      const step = e.shiftKey ? -1 : 1;
      buttons[i < 0 ? 0 : (i + step + buttons.length) % buttons.length].focus();
      return;
    }
    if (e.key === 'Enter' && e.target instanceof HTMLButtonElement) {
      // The browser turns Enter on a button into a click; pressing it here too
      // would press twice. Only keep the sidebar behind from seeing it.
      e.stopPropagation();
      return;
    }
    if (e.key === 'Escape' || e.key === 'Enter' || STEP[e.key]) {
      e.preventDefault();
      e.stopPropagation();
      navigate(e.key);
    }
  };

  if (!open) return null;
  return createPortal(
    <div className="fitness-controllers-overlay" role="dialog" aria-modal="true" aria-labelledby={titleId}
      onKeyDown={handleKeyDown}>
      <div className="fitness-controllers-overlay__panel" ref={panelRef}>
        <header className="fitness-controllers-overlay__header">
          <h3 id={titleId}>Controllers</h3>
          <button type="button" ref={closeRef} className="fitness-controllers-overlay__close" aria-label="Close controllers" onClick={onClose}>
            Close
          </button>
        </header>
        {loadError ? (
          <p role="alert" className="fitness-controllers-overlay__error">
            Could not load the controller list ({loadError}). Adding a new device still works.
          </p>
        ) : null}
        {controllers === null ? <p role="status" className="fitness-controllers-overlay__loading">Loading…</p> : (
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
