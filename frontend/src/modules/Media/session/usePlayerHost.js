// frontend/src/modules/Media/session/usePlayerHost.js
import { useEffect } from 'react';
import { usePlayerHostSetter } from './LocalSessionProvider.jsx';

/**
 * Claim the Player host for the lifetime of the mounted view.
 * When the view unmounts, the host reverts to null so HiddenPlayerMount
 * renders inline (the default hidden container).
 */
export function usePlayerHost(ref) {
  const setHost = usePlayerHostSetter();
  useEffect(() => {
    setHost(ref.current ?? null);
    return () => setHost(null);
  }, [ref, setHost]);
}

export default usePlayerHost;
