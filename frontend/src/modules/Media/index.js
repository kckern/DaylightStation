// frontend/src/modules/Media/index.js
// The Media module's public surface. App entry and UI components import from
// here; subsystem internals are not a contract. Grows phase by phase.

export { TIMING, STORAGE_KEYS, SESSION_SCHEMA_VERSION } from './constants.js';
export { mediaLog } from './logging/mediaLog.js';
export { mediaTheme, stateColor } from './theme/mediaTheme.js';

// Navigation & shell
export { MediaAppShell } from './shell/MediaAppShell.jsx';
export { NavProvider, useNav } from './shell/NavProvider.jsx';
export { DismissStackProvider } from './shell/DismissStackProvider.jsx';
export { useDismissLayer } from './shell/useDismissLayer.js';

// Controller seam — one interface, local and remote implementations
export { assertController, CONTROLLER_METHOD_GROUPS } from './controller/controllerShape.js';
export { createMockController } from './controller/mockController.js';
export { useSessionController } from './controller/useSessionController.js';
export { usePlaybackPosition } from './controller/usePlaybackPosition.js';

// Local session engine
export { ClientIdentityProvider } from './identity/ClientIdentityProvider.jsx';
export { useClientIdentity } from './identity/useClientIdentity.js';
export { LocalSessionProvider } from './session/LocalSessionProvider.jsx';
export { createLocalSessionController } from './session/LocalSessionController.js';
export { usePlayerHost } from './session/usePlayerHost.js';
export { readRecents } from './session/recents.js';

// Fleet observation
export { FleetProvider } from './fleet/FleetProvider.jsx';
export { useFleetContext } from './fleet/useFleetContext.js';
export { useDevice } from './fleet/useDevice.js';
export { useFleetSummary } from './fleet/useFleetSummary.js';

// Peek (remote control) + portability
export { PeekProvider } from './peek/PeekProvider.jsx';
export { usePeek } from './peek/usePeek.js';
export { useTakeOver } from './peek/useTakeOver.js';

// Cast / dispatch
export { CastTargetProvider } from './cast/CastTargetProvider.jsx';
export { useCastTarget } from './cast/useCastTarget.js';
export { DispatchProvider } from './cast/DispatchProvider.jsx';
export { useDispatch } from './cast/useDispatch.js';
export { useHandOff } from './cast/useHandOff.js';

// Search
export { SearchProvider } from './search/SearchProvider.jsx';
export { useSearchContext } from './search/useSearchContext.js';
export { useLiveSearch } from './search/useLiveSearch.js';

// URL namespaces
export {
  NAV_PARAM_KEYS,
  PLAYBACK_PARAM_KEYS,
  readNavFromSearch,
  writeNavToSearch,
  readPlaybackParams,
} from './lib/urlParams.js';
