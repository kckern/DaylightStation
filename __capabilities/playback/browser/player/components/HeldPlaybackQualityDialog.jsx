import React, { useEffect, useRef, useState } from 'react';
import { useScopedRemoteControls } from '../../../../../frontend/src/lib/input/useScopedRemoteControls.js';
import { PlaybackQualityForm } from './PlaybackQualityForm.jsx';

const FOCUSABLE = 'select:not(:disabled), input:not(:disabled):not([tabindex="-1"]), button:not(:disabled):not([tabindex="-1"])';

/** TV input belongs to this dialog; the shared form keeps its desktop behavior. */
export function HeldPlaybackQualityDialog({ request, onApply, onClose, returnFocus }) {
  const root = useRef(null);
  const editing = useRef(null);
  const [editingLabel, setEditingLabel] = useState(null);
  const finishEditing = () => { editing.current = null; setEditingLabel(null); };
  useEffect(() => () => { if (returnFocus?.isConnected) returnFocus.focus(); }, [returnFocus]);
  useScopedRemoteControls(root, {
    focusSelector: FOCUSABLE,
    onAction: ({ action, direction, repeat }) => {
      const active = document.activeElement;
      if (editing.current && editing.current !== active) finishEditing();
      if (action === 'escape') {
        if (!repeat) { if (editing.current) finishEditing(); else onClose(); }
        return true;
      }
      const editable = active?.tagName === 'SELECT' || (active?.tagName === 'INPUT' && active.type !== 'checkbox');
      if (action === 'select' && editable) {
        if (!repeat) {
          if (editing.current) finishEditing();
          else { editing.current = active; setEditingLabel(active.labels?.[0]?.textContent ?? 'value'); }
        }
        return true;
      }
      if (action !== 'navigate' || editing.current !== active) return false;
      // OK explicitly enters/leaves editing. While editing, arrows change the
      // native value instead of stealing focus or opening a platform popup.
      const delta = ['up', 'left'].includes(direction) ? -1 : 1;
      if (active.tagName === 'SELECT') {
        const options = [...active.options].filter(option => !option.disabled);
        const index = options.findIndex(option => option.value === active.value);
        const option = options[Math.max(0, Math.min(options.length - 1, index + delta))];
        if (option) {
          Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(active, option.value);
          active.dispatchEvent(new Event('change', { bubbles: true }));
        }
      } else {
        const value = Math.max(Number(active.min) || 1, Math.min(Number(active.max) || 8000, (Number(active.value) || 0) + delta));
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(active, String(value));
        active.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return true;
    },
  });
  return <div ref={root} className="player-held-quality" role="dialog" aria-modal="true" aria-label="Playback quality"
    data-no-fullscreen="true" onKeyDown={event => event.stopPropagation()}>
    <p role="status">{editingLabel ? `Editing ${editingLabel}. Use arrows to change; OK finishes editing.`
      : 'Use arrows to move, OK to edit or activate, and Back to close Quality.'}</p>
    <PlaybackQualityForm request={request} onApply={onApply} />
    <button type="button" onClick={onClose}>Close Quality</button>
  </div>;
}
