// frontend/src/modules/Media/index.js
// The Media module's public surface. App entry and UI components import from
// here; subsystem internals are not a contract. Grows phase by phase.

export { TIMING, STORAGE_KEYS, SESSION_SCHEMA_VERSION } from './constants.js';
export { mediaLog } from './logging/mediaLog.js';
export { mediaTheme, stateColor } from './theme/mediaTheme.js';

// Navigation & shell
export { MediaAppShell } from './shell/MediaAppShell.jsx';
export { NavProvider, useNav } from './shell/NavProvider.jsx';
export { DismissStackProvider, useDismissLayer } from './shell/DismissStackProvider.jsx';

// Controller seam — one interface, local and remote implementations
export { assertController, CONTROLLER_METHOD_GROUPS } from './controller/controllerShape.js';
export { createMockController } from './controller/mockController.js';
export { useSessionController } from './controller/useSessionController.js';
export { usePlaybackPosition } from './controller/usePlaybackPosition.js';

// Local session engine
export { ClientIdentityProvider, useClientIdentity } from './identity/ClientIdentityProvider.jsx';
export { LocalSessionProvider } from './session/LocalSessionProvider.jsx';
export { createLocalSessionController } from './session/LocalSessionController.js';
export { usePlayerHost } from './session/usePlayerHost.js';
export { readRecents } from './session/recents.js';

// URL namespaces
export {
  NAV_PARAM_KEYS,
  PLAYBACK_PARAM_KEYS,
  readNavFromSearch,
  writeNavToSearch,
  readPlaybackParams,
} from './lib/urlParams.js';
