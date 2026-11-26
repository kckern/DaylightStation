// shell/navContext.js — the navigation context object on its own, so hooks
// that only optionally navigate (fleet/usePlayingOn.js) can read it without
// requiring a NavProvider (useNav throws outside one).
import { createContext } from 'react';

export const NavContext = createContext(null);
