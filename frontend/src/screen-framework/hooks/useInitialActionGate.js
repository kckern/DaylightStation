import { useEffect, useRef, useState, useCallback } from 'react';

const SAFETY_TIMEOUT_MS = 5000;

// Same canonical action list as ScreenAutoplay (ScreenRenderer.jsx ~line 31).
// Kept in sync intentionally — the gate must trigger for any param that
// ScreenAutoplay will eventually act on.
const GATED_ACTIONS = [
  'play', 'queue', 'playlist', 'random',
  'display', 'read', 'open',
  'app', 'launch', 'list',
];

// Direct URLSearchParams check — intentionally NOT using parseAutoplayParams
// because its alias fallback turns ANY unknown key (e.g. ?foo=bar) into a
// play action, which would over-engage the gate.
function hasGatedActionParam(searchString) {
  if (!searchString) return false;
  const params = new URLSearchParams(
    searchString.startsWith('?') ? searchString.slice(1) : searchString,
  );
  for (const key of GATED_ACTIONS) {
    if (params.has(key)) return true;
  }
  return false;
}

/**
 * useInitialActionGate — when a screen mounts with an action search-param
 * (?play=, ?queue=, ?open=, …), suppress the YAML-declared layout for the
 * first paint so the user sees a blank/loading shell rather than a menu
 * flash. Released either:
 *   - explicitly via releaseGate() (called when an overlay opens), OR
 *   - automatically after SAFETY_TIMEOUT_MS in case the action silently
 *     fails to mount anything.
 *
 * Initial-only: changes to `search` after first mount do NOT re-engage
 * the gate. The gate state is decided once on first render.
 *
 * @param {string} search - URL search string (with or without leading '?')
 * @returns {{ suppressLayout: boolean, releaseGate: () => void }}
 */
export function useInitialActionGate(search) {
  // Decided exactly once on first render.
  const initialDecision = useRef(null);
  if (initialDecision.current === null) {
    initialDecision.current = hasGatedActionParam(search ?? '');
  }

  const [suppressLayout, setSuppressLayout] = useState(initialDecision.current);

  const releaseGate = useCallback(() => setSuppressLayout(false), []);

  useEffect(() => {
    if (!suppressLayout) return undefined;
    const t = setTimeout(() => setSuppressLayout(false), SAFETY_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [suppressLayout]);

  return { suppressLayout, releaseGate };
}

export default useInitialActionGate;
