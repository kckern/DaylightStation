// frontend/src/modules/Media/session/playerHostContext.js
// Where the Player's visual output renders. `PlayerHostContext` holds the active
// host element (null → PlayerBridge keeps the Player in its off-screen park).
// `PlayerHostRegistryContext` lets views claim/release the host at a priority;
// the highest-priority active claim wins (see playerHostRegistry.resolveActiveHost).
import { createContext } from 'react';

export const PlayerHostContext = createContext(null);
export const PlayerHostRegistryContext = createContext({
  claim: () => {},
  release: () => {},
});
