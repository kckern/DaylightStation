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

// Controller seam (local + remote implementations land in later phases)
export { assertController, CONTROLLER_METHOD_GROUPS } from './controller/controllerShape.js';
export { createMockController } from './controller/mockController.js';

// URL namespaces
export {
  NAV_PARAM_KEYS,
  PLAYBACK_PARAM_KEYS,
  readNavFromSearch,
  writeNavToSearch,
  readPlaybackParams,
} from './lib/urlParams.js';
