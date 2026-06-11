// frontend/src/modules/Media/session/usePlayerHost.js
import { useContext, useEffect } from 'react';
import { PlayerHostSetterContext } from './playerHostContext.js';

/**
 * Claim the Player host for the lifetime of the mounted view. On unmount the
 * host reverts to null and PlayerBridge returns to the hidden mount.
 */
export function usePlayerHost(ref) {
  const setHost = useContext(PlayerHostSetterContext);
  useEffect(() => {
    setHost(ref.current ?? null);
    return () => setHost(null);
  }, [ref, setHost]);
}

export default usePlayerHost;
