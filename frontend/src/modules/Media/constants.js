// frontend/src/modules/Media/constants.js
// Every timing/threshold in the Media App, named once. Stores and hooks accept
// a `timing` override in their factories so tests can shrink these freely.
// Sources: docs/reference/media/media-app-technical.md (§6.3, §6.4, §7.4, §11.3)
// and media-app-requirements.md (C9.3, C10.3).

export const TIMING = {
  ACK_TIMEOUT_MS: 5_000,                // §6.3 — device must ack a command within 5s
  DISPATCH_DEDUPE_WINDOW_MS: 5_000,     // C9.8 — identical dispatch within window is a no-op
  STALL_THRESHOLD_MS: 10_000,           // C9.3 — no progress while unpaused → stalled → advance
  TAKEOVER_DRIFT_CHECK_DELAY_MS: 1_500, // settle time before comparing positions post-claim
  TAKEOVER_DRIFT_TOLERANCE_S: 2,        // C7.3 — position tolerance across a transfer
  POSITION_PERSIST_INTERVAL_S: 5,       // §11.3 — durable position cadence while playing
  PERSIST_THROTTLE_MS: 500,             // §11.3 — ≤1 localStorage write per 500ms
  PLAYBACK_HEARTBEAT_MS: 5_000,         // C10.3 — playback_state heartbeat while playing
  DEVICE_STALE_AFTER_MS: 15_000,        // §7.4 — missed device heartbeats → stale
  VOLUME_APPLY_RETRY_MS: 200,           // PlayerBridge: media element may mount after the effect
  VOLUME_APPLY_GIVE_UP_MS: 5_000,
  SEARCH_DEBOUNCE_MS: 250,
  ACTION_FLASH_MS: 600,                 // row feedback flash after a queue action
  DISPATCH_TRAY_LINGER_MS: 3_000,       // success strip auto-hide
  OPTIMISTIC_REVERT_MS: 5_000,          // optimistic peek control reverts if no broadcast
};

// localStorage keys — docs/reference/media/media-app-technical.md §11.1.
// media-app.session schemaVersion is 1 and must stay byte-compatible with
// sessions persisted by the previous app generation.
export const STORAGE_KEYS = {
  CLIENT_ID: 'media-app.client-id',
  DISPLAY_NAME: 'media-app.display-name',
  SESSION: 'media-app.session',
  URL_COMMAND_TOKEN: 'media-app.url-command-token',
  SCOPE_LAST: 'media-scope-last',
};

export const SESSION_SCHEMA_VERSION = 1;
