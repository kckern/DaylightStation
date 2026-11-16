import { useEffect, useRef } from 'react';
import { useSchoolSurface } from './SchoolSurface.jsx';
import { keyFromCode } from '../Programs/shared/physicalKey.js';

const registrations = new Set();
let activeHost = null;
let sequence = 0;
const hostOf = target => target?.closest?.('.school-surface') ?? null;
const editable = target => target?.isContentEditable || target?.closest?.('[contenteditable="true"]') || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName);
function activate(event) { const host = hostOf(event.target); if (host) activeHost = host; }
function dispatch(event) {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.metaKey || event.ctrlKey || event.altKey) return;
  const byKey = event.key === ' ' ? ' ' : String(event.key).toLowerCase();
  const byCode = keyFromCode(event.code);
  const targetHost = hostOf(event.target) ?? hostOf(document.activeElement);
  if (targetHost) activeHost = targetHost;
  if (activeHost && !activeHost.isConnected) activeHost = null;
  const entries = [...registrations];
  const host = activeHost ?? entries.filter(entry => entry.host?.isConnected).at(-1)?.host ?? null;
  const candidates = entries.filter(entry => entry.host === host && (!entry.scope || entry.scope === host?.dataset.schoolSurface || entry.scope === 'browser' && !host)).sort((a, b) => b.priority - a.priority || b.order - a.order);
  const topPriority = candidates[0]?.priority;
  const modal = host?.querySelector('[role="dialog"][aria-modal="true"], dialog[open]');
  if (modal && !(topPriority > 0)) return;
  for (const entry of candidates) {
    // A modal scope owns the keyboard even when this particular key is unmapped.
    if (entry.priority < topPriority) break;
    const key = byCode ?? byKey;
    if (editable(event.target) && !(typeof entry.allowInInput === 'function' ? entry.allowInInput(key) : entry.allowInInput)) continue;
    const action = entry.map.current[byCode] ?? entry.map.current[byKey];
    if (typeof action === 'function') { event.preventDefault(); action(event); return; }
    // Specialized handlers keep their own key/filter/default policy. They
    // share ownership and universal guards without becoming passive observers.
    const listener = entry.map.current['*'];
    if (typeof listener === 'function') { listener(event); if (event.defaultPrevented) return; }
  }
}

/** One dispatcher, local surface ownership, physical key mapping and modal priority. */
export function useSchoolCommands(map, { enabled = true, scope, priority = 0, allowInInput = false } = {}) {
  const surface = useSchoolSurface();
  const current = useRef(map);
  current.current = map;
  const allow = useRef(allowInInput);
  allow.current = allowInInput;
  const host = surface.overlayRoot?.parentElement ?? null;
  useEffect(() => {
    if (!enabled) return undefined;
    const entry = { map: current, host, scope, priority, order: ++sequence, allowInInput: key => typeof allow.current === 'function' ? allow.current(key) : allow.current };
    if (!registrations.size) {
      window.addEventListener('keydown', dispatch);
      window.addEventListener('pointerdown', activate, true);
      window.addEventListener('focusin', activate, true);
    }
    registrations.add(entry);
    return () => {
      registrations.delete(entry);
      if (!registrations.size) {
        window.removeEventListener('keydown', dispatch);
        window.removeEventListener('pointerdown', activate, true);
        window.removeEventListener('focusin', activate, true);
        activeHost = null;
      }
    };
  }, [enabled, host, scope, priority]);
}
export function useSchoolCommandListener(listener, options = {}) {
  useSchoolCommands({ '*': listener }, options);
}
export default useSchoolCommands;
