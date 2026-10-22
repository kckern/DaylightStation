/** Explicit sessions surface; implementation remains owner-private. */
export { usePlayerSessionBinding } from "./sessions/usePlayerSessionBinding.js";
export { SessionSourceProvider, default as SessionSourceContext } from "./sessions/SessionSourceContext.jsx";
export { createRegistrySessionSource } from "./sessions/registrySessionSource.js";
export { getPlayerSessionRegistry } from "./sessions/playerSessionRegistry.js";
export { useSessionSourceContext } from "./sessions/useSessionSourceContext.js";
export { createSessionSource } from "./sessions/SessionSource.js";
export { createPlaybackStallWatch } from "./sessions/playbackStallWatch.js";
export { useRegistryPlaybackState } from "./sessions/useRegistryPlaybackState.js";
export { useDeviceAudience, getDeviceAudienceStore, createAudienceStore, audienceKey } from "./sessions/deviceAudience.js";

