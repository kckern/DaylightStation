/**
 * EmulatorToasts — transient connect/disconnect toasts for KNOWN controllers,
 * driven by the BlueZ `bt_inventory` feed (the realtime OS-level truth). The
 * first observation is a silent baseline; subsequent connection-state flips
 * raise a toast that auto-dismisses. Portaled to <body> so it floats over both
 * the arcade menu and the fullscreen game.
 *
 * Presentation + local timer state only — the data (`btInventory`) arrives via
 * props from the fitness host (FitnessContext), keeping EmulatorConsole agnostic.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import getLogger from '@/lib/logging/Logger.js';
import { knownControllerStates, diffControllerConnections } from '../input/controllerStatus.js';
import './EmulatorToasts.scss';

let _logger;
const logger = () => (_logger ??= getLogger().child({ component: 'emulator-controller-toasts' }));

let _seq = 0;
const nextId = () => `ct-${++_seq}`;

export function EmulatorToasts({ btInventory, controllers = [], autoDismissMs = 4000 }) {
  const states = useMemo(() => knownControllerStates(btInventory, controllers), [btInventory, controllers]);
  const sig = useMemo(() => states.map((s) => `${s.key}:${s.connected ? 1 : 0}`).join('|'), [states]);

  const prevRef = useRef(null);
  const statesRef = useRef(states);
  statesRef.current = states;
  const timersRef = useRef(new Map());
  const [toasts, setToasts] = useState([]);

  // Diff connection state on each change. First run = baseline (no toast).
  useEffect(() => {
    const prev = prevRef.current;
    const cur = statesRef.current;
    prevRef.current = cur;
    if (prev === null) return undefined;

    const { connected, disconnected } = diffControllerConnections(prev, cur);
    const fresh = [
      ...connected.map((c) => ({ id: nextId(), kind: 'connected', label: c.label, battery: c.battery })),
      ...disconnected.map((c) => ({ id: nextId(), kind: 'disconnected', label: c.label })),
    ];
    if (!fresh.length) return undefined;

    fresh.forEach((t) => logger().info('controller-toast', { kind: t.kind, label: t.label, battery: t.battery ?? null }));
    setToasts((curToasts) => [...curToasts, ...fresh]);
    fresh.forEach((t) => {
      const timer = setTimeout(() => {
        setToasts((curToasts) => curToasts.filter((x) => x.id !== t.id));
        timersRef.current.delete(t.id);
      }, autoDismissMs);
      timersRef.current.set(t.id, timer);
    });
    return undefined;
  }, [sig, autoDismissMs]);

  // Clear any pending dismiss timers on unmount.
  useEffect(() => () => {
    timersRef.current.forEach((t) => clearTimeout(t));
    timersRef.current.clear();
  }, []);

  if (typeof document === 'undefined' || !toasts.length) return null;

  return createPortal(
    <div className="emu-controller-toasts" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`emu-controller-toast emu-controller-toast--${t.kind}`}
          role="status"
        >
          <span className="emu-controller-toast__icon" aria-hidden="true">
            {t.kind === 'connected' ? '🎮' : '⚠️'}
          </span>
          <span className="emu-controller-toast__text">
            {t.label} {t.kind === 'connected' ? 'connected' : 'disconnected'}
            {t.kind === 'connected' && Number.isFinite(t.battery) ? ` · ${t.battery}%` : ''}
          </span>
        </div>
      ))}
    </div>,
    document.body,
  );
}

export default EmulatorToasts;
