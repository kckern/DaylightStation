/** Explicit contracts surface; implementation remains owner-private. */
export { getPlayerQueueOpRegistry } from "./player/lib/queueOpRegistry.js";
export { registerTrackOwner, createTrackPreferenceStore } from "./player/lib/trackPolicy.js";
export { musicBehindVerdict } from "./player/lib/musicBehindPolicy.js";
export { setNaturalEndPolicy } from "./player/lib/naturalEndPolicy.js";
export { playbackLog, configurePlaybackLogger, default as Default_playbackLogger_js } from "./player/lib/playbackLogger.js";
export { resolveContentId, durationFromSeconds } from "./player/utils/mediaIdentity.js";
export { guid } from "./player/lib/helpers.js";
