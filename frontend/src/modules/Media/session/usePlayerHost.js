// frontend/src/modules/Media/session/usePlayerHost.js
import { useContext, useEffect, useId } from 'react';
import { PlayerHostRegistryContext } from './playerHostContext.js';

/**
 * Claim the Player host while this hook is mounted and `active`. The Player
 * portals into the highest-priority active claim. Releases on `active=false`
 * or unmount. Backward compatible: usePlayerHost(ref) → priority 1, active true.
 *
 * @param {{current: Element|null}} ref  element the Player should portal into
 * @param {number} [priority=1]          higher wins (Now Playing=2, dock=1)
 * @param {boolean} [active=true]        only claim while true
 */
export function usePlayerHost(ref, priority = 1, active = true) {
  const { claim, release } = useContext(PlayerHostRegistryContext);
  const id = useId();
  useEffect(() => {
    if (active) claim(id, ref.current ?? null, priority);
    else release(id);
    return () => release(id);
  }, [ref, priority, active, claim, release, id]);
}

export default usePlayerHost;
