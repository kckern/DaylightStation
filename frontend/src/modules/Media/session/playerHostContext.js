// frontend/src/modules/Media/session/playerHostContext.js
// Where the Player's visual output renders. Null → PlayerBridge keeps it in
// the hidden off-screen mount; a view (Now Playing) claims the host via
// usePlayerHost and the same Player instance portals into it.
import { createContext } from 'react';

export const PlayerHostContext = createContext(null);
export const PlayerHostSetterContext = createContext(() => {});
