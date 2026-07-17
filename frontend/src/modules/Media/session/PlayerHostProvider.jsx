// frontend/src/modules/Media/session/PlayerHostProvider.jsx
// Owns the Player host claim registry. Views claim the host via usePlayerHost;
// the highest-priority active claim becomes PlayerHostContext, which PlayerBridge
// portals the single Player instance into.
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { PlayerHostContext, PlayerHostRegistryContext } from './playerHostContext.js';
import { resolveActiveHost } from './playerHostRegistry.js';

export function PlayerHostProvider({ children }) {
  const claimsRef = useRef(new Map()); // id → { el, priority, seq }
  const seqRef = useRef(0);
  const [activeHost, setActiveHost] = useState(null);

  const recompute = useCallback(() => {
    setActiveHost(resolveActiveHost([...claimsRef.current.values()]));
  }, []);

  const claim = useCallback((id, el, priority) => {
    if (el == null) claimsRef.current.delete(id);
    else claimsRef.current.set(id, { el, priority, seq: ++seqRef.current });
    recompute();
  }, [recompute]);

  const release = useCallback((id) => {
    if (claimsRef.current.delete(id)) recompute();
  }, [recompute]);

  const registry = useMemo(() => ({ claim, release }), [claim, release]);

  return (
    <PlayerHostContext.Provider value={activeHost}>
      <PlayerHostRegistryContext.Provider value={registry}>
        {children}
      </PlayerHostRegistryContext.Provider>
    </PlayerHostContext.Provider>
  );
}

export default PlayerHostProvider;
