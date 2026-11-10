import { useEffect, useRef } from 'react';
import getLogger from '../../../../frontend/src/lib/logging/Logger.js';
import { getActionBus } from './ActionBus.js';

let _logger;
const logger = () => _logger ||= getLogger().child({ component: 'scoped-remote-controls' });

// Modal apps own their native remote keys before the legacy menu and browser
// default click handlers. Other adapters can use the ordinary semantic bus.
// onAction({ action, direction, repeat }) sees every remote action first; returning
// true claims it (e.g. a game board with its own cursor and judging keys).
export function useScopedRemoteControls(rootRef, { onEscape, onLeft, onRight, onAction } = {}) {
  const actionRef = useRef(onAction); actionRef.current = onAction;
  const escapeRef = useRef(onEscape); escapeRef.current = onEscape;
  const leftRef = useRef(onLeft); leftRef.current = onLeft;
  const rightRef = useRef(onRight); rightRef.current = onRight;
  useEffect(() => {
    const root = rootRef.current; if (!root) return;
    const bus = getActionBus();
    // HTML controls only. A bare `[href]` also matched an icon's SVG <use>,
    // which has no click(): with nothing focused, select "clicked" it and threw
    // `click is not a function` (17 times in Charades, 2026-09-13..14).
    const buttons = () => [...root.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled)')]
      .filter(node => node instanceof HTMLElement && !node.closest('[hidden], [aria-hidden="true"]'));
    // React autoFocus moves focus once but does not leave an HTML autofocus
    // attribute. Keep a DOM marker so recovery can find the intended action.
    const primary = controls => controls.find(node => node.matches('[data-remote-autofocus="true"], [autofocus]')) || controls[0];
    const focus = () => { const controls = buttons(); if (!controls.includes(document.activeElement)) primary(controls)?.focus(); };
    const handle = ({ action, direction, repeat } = {}) => {
      if (actionRef.current?.({ action, direction, repeat: Boolean(repeat) }) === true) return;
      if (action === 'escape') { if (!repeat) escapeRef.current?.(); return; }
      if (action === 'navigate' && direction === 'left' && leftRef.current) {
        if (repeat || leftRef.current() !== false) return;
      }
      if (action === 'navigate' && direction === 'right' && rightRef.current) {
        if (repeat || rightRef.current() !== false) return;
      }
      const controls = buttons(); if (!controls.length) return;
      const index = controls.indexOf(document.activeElement);
      if (index < 0) {
        const target = primary(controls);
        target?.focus();
        logger().info('remote.focus-recovered', { action, preferred: target?.dataset.remoteAutofocus === 'true', controlId: target?.dataset.testid || target?.tagName });
        if (action === 'select' && !repeat) target?.click();
        return;
      }
      if (action === 'select') { if (!repeat) controls[index]?.click(); return; }
      const delta = direction === 'up' || direction === 'left' ? -1 : 1;
      controls[(Math.max(0,index) + delta + controls.length) % controls.length]?.focus();
    };
    const unsubscribe = bus.subscribe('controls:action', handle);
    const release = bus.capture(['navigate', 'select', 'escape'], (action, payload) => { handle({ ...payload, action }); return true; });
    const keydown = event => {
      const direction = {ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right'}[event.key];
      const action = direction ? 'navigate' : ['Enter',' ','MediaPlayPause'].includes(event.key) ? 'select' : ['Escape','BrowserBack'].includes(event.key) ? 'escape' : null;
      if (!action) return;
      event.preventDefault(); event.stopImmediatePropagation();
      // GamepadAdapter has already emitted this action on the semantic bus;
      // swallow its compatibility key event so neither we nor legacy UI repeat it.
      if (event.__gamepadSynthetic) return;
      bus.emit('controls:action', {action,direction,repeat:event.repeat});
    };
    window.addEventListener('keydown',keydown,true);
    window.addEventListener('focus',focus);
    const observer = new MutationObserver(focus); observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled']}); focus();
    return () => { window.removeEventListener('keydown',keydown,true); window.removeEventListener('focus',focus); observer.disconnect(); unsubscribe(); release(); };
  }, [rootRef]);
}
