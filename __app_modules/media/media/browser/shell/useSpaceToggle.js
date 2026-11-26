// shell/useSpaceToggle.js
// Addendum item 8 (2026-11-26): Space plays / pauses the current session —
// the aimed screen's when it is playing (or paused) something, else this
// device's — unless a text field or the search box has focus, or a control
// that Space itself activates (a button, a menu item). It never starts
// anything new: with nothing playing or paused, Space does nothing here and
// the page keeps its own Space (scrolling).
import { useCallback, useContext } from 'react';
import { useHotkey } from '@/lib/hooks/useHotkey.js';
import { LocalSessionContext } from "../session/LocalSessionContext.js";
import { PeekContext } from "../peek/PeekContext.js";
import { FleetContext } from "../fleet/FleetProvider.jsx";
import { useCastTarget } from "../cast/useCastTarget.js";
import mediaLog from "../logging/mediaLog.js";

const RUNNING = new Set(['playing', 'buffering']);

function actionFor(snapshot) {
  if (!snapshot?.currentItem) return null;
  if (RUNNING.has(snapshot.state)) return 'pause';
  if (snapshot.state === 'paused') return 'play';
  return null;
}

/**
 * Pure: what Space would do. The aimed screen wins only while it has a
 * session to toggle; otherwise this device's own.
 * @returns {{ target: 'screen', deviceId: string, action: 'play'|'pause' }|{ target: 'local', action: 'play'|'pause' }|null}
 */
export function spaceTarget({ aimIds = [], entryFor = () => null, localSnapshot = null }) {
  for (const id of aimIds ?? []) {
    const entry = entryFor(id);
    if (!entry || entry.offline) continue;
    const action = actionFor(entry.snapshot);
    if (action) return { target: 'screen', deviceId: id, action };
  }
  const local = actionFor(localSnapshot);
  return local ? { target: 'local', action: local } : null;
}

// Space activates these itself; the shortcut must not steal it.
const SPACE_OWNERS = 'button, a[href], summary, [role="button"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"], [role="switch"], [role="checkbox"], [role="radio"], [role="tab"], [role="slider"], [role="combobox"], [contenteditable="true"]';

export function spaceIsOwned(element) {
  return !!element?.closest?.(SPACE_OWNERS);
}

export function useSpaceToggle() {
  const local = useContext(LocalSessionContext)?.controller ?? null;
  const peek = useContext(PeekContext);
  const store = useContext(FleetContext)?.store ?? null;
  const { targetIds } = useCastTarget();
  const handler = useCallback((event) => {
    if (spaceIsOwned(event?.target) || spaceIsOwned(document.activeElement)) return false;
    const picked = spaceTarget({
      aimIds: targetIds ?? [],
      entryFor: (id) => store?.getEntry?.(id) ?? null,
      localSnapshot: local?.getSnapshot?.() ?? null,
    });
    if (!picked) return false;
    const transport = picked.target === 'screen' ? peek?.getController?.(picked.deviceId)?.transport : local?.transport;
    const run = transport?.[picked.action];
    if (typeof run !== 'function') return false;
    mediaLog.spaceToggle({ ...picked });
    try {
      Promise.resolve(run.call(transport)).catch((error) => mediaLog.spaceToggleFailed({ ...picked, error: error?.message ?? String(error) }));
    } catch (error) {
      mediaLog.spaceToggleFailed({ ...picked, error: error?.message ?? String(error) });
    }
    return true;
  }, [targetIds, store, local, peek]);
  useHotkey(' ', handler, { code: 'Space' });
}

export default useSpaceToggle;
