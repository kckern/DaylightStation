// frontend/src/modules/Media/session/PlayerHostProvider.jsx
// Owns the Player host claim registry. Views claim the host via usePlayerHost;
// the highest-priority active claim becomes PlayerHostContext, which PlayerBridge
// portals the single Player instance into.
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  PlayerHostContext,
  PlayerHostPresentationContext,
  PlayerHostRegistryContext,
} from './playerHostContext.js';
import { resolveActiveHostClaim } from './playerHostRegistry.js';
import mediaLog from '../logging/mediaLog.js';

// A host transition is the single most consequential event in the playback
// pipeline — it is what moves the player between the off-screen park, the dock,
// and Now Playing — and until 2026-08-16 it emitted nothing at all. Diagnosing a
// remount meant inferring the transition from an audio shader's bounding box
// changing from x:-10000 to x:16. Name it directly instead.
function describeHost(el) {
  if (el == null) return null;
  return el.getAttribute?.('data-testid')
    || (el.className && String(el.className).split(' ')[0])
    || el.tagName?.toLowerCase()
    || 'element';
}

export function PlayerHostProvider({ children }) {
  const claimsRef = useRef(new Map()); // id → { el, priority, seq }
  const seqRef = useRef(0);
  const [activeHost, setActiveHost] = useState(null);
  const activeHostRef = useRef(null);
  const [forceShader, setForceShader] = useState(null);
  const forceShaderRef = useRef(null);

  const recompute = useCallback((reason, id) => {
    const activeClaim = resolveActiveHostClaim([...claimsRef.current.values()]);
    const next = activeClaim?.el ?? null;
    const nextForceShader = activeClaim?.forceShader ?? null;
    const prev = activeHostRef.current;
    if (next !== prev) {
      activeHostRef.current = next;
      mediaLog.playerHostChanged({
        reason,
        claimant: id ?? null,
        from: describeHost(prev),
        to: describeHost(next),
        parked: next == null,
        claimCount: claimsRef.current.size,
      });
    }
    setActiveHost(next);
    if (nextForceShader !== forceShaderRef.current) {
      forceShaderRef.current = nextForceShader;
      setForceShader(nextForceShader);
    }
  }, []);

  const claim = useCallback((id, el, priority, presentation = {}) => {
    if (el == null) claimsRef.current.delete(id);
    else claimsRef.current.set(id, {
      el,
      priority,
      seq: ++seqRef.current,
      forceShader: presentation.forceShader ?? null,
    });
    recompute('claim', id);
  }, [recompute]);

  const release = useCallback((id) => {
    if (claimsRef.current.delete(id)) recompute('release', id);
  }, [recompute]);

  const registry = useMemo(() => ({ claim, release }), [claim, release]);

  return (
    <PlayerHostContext.Provider value={activeHost}>
      <PlayerHostPresentationContext.Provider value={{ forceShader }}>
        <PlayerHostRegistryContext.Provider value={registry}>
          {children}
        </PlayerHostRegistryContext.Provider>
      </PlayerHostPresentationContext.Provider>
    </PlayerHostContext.Provider>
  );
}

export default PlayerHostProvider;
