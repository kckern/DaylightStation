/** Explicit session surface; implementation remains owner-private. */
export { createScreenSessionControls } from "./session/screenSessionControls.js";
export { createScreenPlayerFeatures } from "./session/screenPlayerFeatures.js";
export { createContinuationResolver } from "./session/continuationResolver.js";
export { loadPersistedSession, savePersistedSession, updatePersistedSpot, clearPersistedSession, POWER_RESTORE_DELAY_MS } from "./session/sessionPersistence.js";
