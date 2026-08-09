import { deriveInteraction } from './reducer.mjs';

/**
 * First-wave projection is intentionally boring: the card battle has no hidden
 * fields. Every consumer still goes through this function so field visibility
 * can be added without changing the view/controller contract.
 */
export function projectState(state, definition, viewerId = null) {
  const projectedState = structuredClone(state);
  return {
    state: projectedState,
    interaction: deriveInteraction(projectedState, definition, viewerId),
  };
}
