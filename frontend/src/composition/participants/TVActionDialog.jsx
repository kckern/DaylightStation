import React, {useEffect, useRef} from 'react';
import './TVActionDialog.css';
import {getActionBus} from '../../../../__capabilities/screen-host/browser/input.mjs';

/** A visible dialog owns semantic and keyboard input until it unmounts. */
export function TVActionDialog({children, label, onBack, focusKey, role='dialog'}) {
  const root = useRef(null);
  const back = useRef(onBack);
  back.current = onBack;
  useEffect(() => { root.current?.querySelector('button:not(:disabled)')?.focus(); }, [focusKey]);
  useEffect(() => {
    const perform = key => {
      if (['Escape','GoBack','BrowserBack'].includes(key)) { back.current?.(); return; }
      const buttons = [...root.current.querySelectorAll('button:not(:disabled)')];
      if (!buttons.length) return;
      const current = buttons.indexOf(document.activeElement);
      if (['Enter',' ','GamepadA','GamepadStart','MediaPlayPause'].includes(key)) { (buttons[current] || buttons[0]).click(); return; }
      const step = ['ArrowUp','ArrowLeft'].includes(key) ? -1 : 1;
      buttons[(current + step + buttons.length) % buttons.length].focus();
    };
    const keys = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter',' ','GamepadA','GamepadStart','MediaPlayPause','Escape','GoBack','BrowserBack'];
    const handle = event => {
      if (!root.current || (event.target instanceof Node && !root.current.contains(event.target))) return;
      const key = event.keyCode === 4 ? 'Escape' : event.key;
      if (!keys.includes(key)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.repeat) perform(key);
    };
    const release = getActionBus().capture(['navigate','select','escape'], (action, payload) => {
      if (!root.current) return false;
      const direction = {up:'ArrowUp',down:'ArrowDown',left:'ArrowLeft',right:'ArrowRight'}[payload?.direction];
      if (action === 'navigate' && !direction) return false;
      perform(action === 'navigate' ? direction : action === 'select' ? 'Enter' : 'Escape');
      return true;
    });
    window.addEventListener('keydown',handle,true);
    return () => { release(); window.removeEventListener('keydown',handle,true); };
  }, []);
  return <div ref={root} className="tv-action-dialog" role={role} aria-label={label}><div className="tv-action-dialog__panel">{children}</div></div>;
}
