import { useEffect, useRef } from 'react';
import { getActionBus } from './ActionBus.js';

// Modal apps own their native remote keys before the legacy menu and browser
// default click handlers. Other adapters can use the ordinary semantic bus.
export function useScopedRemoteControls(rootRef, { onEscape, onLeft, onRight } = {}) {
  const escapeRef = useRef(onEscape); escapeRef.current = onEscape;
  const leftRef = useRef(onLeft); leftRef.current = onLeft;
  const rightRef = useRef(onRight); rightRef.current = onRight;
  useEffect(() => {
    const root = rootRef.current; if (!root) return;
    const bus = getActionBus();
    const buttons = () => [...root.querySelectorAll('button:not(:disabled), [href], input:not(:disabled)')]
      .filter(node => !node.closest('[hidden], [aria-hidden="true"]'));
    const focus = () => { if (!root.contains(document.activeElement)) (root.querySelector('[autofocus]:not(:disabled)') || buttons()[0])?.focus(); };
    const handle = ({ action, direction, repeat } = {}) => {
      if (action === 'escape') { if (!repeat) escapeRef.current?.(); return; }
      if (action === 'navigate' && direction === 'left' && leftRef.current) {
        if (repeat || leftRef.current() !== false) return;
      }
      if (action === 'navigate' && direction === 'right' && rightRef.current) {
        if (repeat || rightRef.current() !== false) return;
      }
      const controls = buttons(); if (!controls.length) return;
      const index = controls.indexOf(document.activeElement);
      if (action === 'select') { if (!repeat) (controls[index] || controls[0])?.click(); return; }
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
    const observer = new MutationObserver(focus); observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled']}); focus();
    return () => { window.removeEventListener('keydown',keydown,true); observer.disconnect(); unsubscribe(); release(); };
  }, [rootRef]);
}
