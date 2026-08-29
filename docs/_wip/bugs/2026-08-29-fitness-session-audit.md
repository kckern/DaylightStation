# Fitness session audit — 2026-08-29

The latest garage session exposed four independent faults:

- Ledger guests were marked HR-inactive during the session-boundary window in
  which their synthetic `UserManager` record was absent. The roster now falls
  back to the live device HR and every carried guest assignment receives a
  fresh session entity at start, preserving victory contribution while the
  governance subject filter continues to prevent guests from blocking.
- The configured ring image referenced an absent media asset. The live config
  now deliberately selects the code-owned animated `RingIcon`; a household may
  still configure a custom URL, and failed custom URLs also fall back safely.
  Ring sound volume remains configurable through `ring_celebrations.volume`
  (set to 0.3 for this household).
- The OpenAI integration read household/secrets credentials but not the existing
  system auth credential, leaving voice transcription unavailable. Integration
  loading now accepts the canonical system `api_key`. The overlay also no longer
  mistakes the normal microphone-request state for stale state and starts only
  one recorder.
- Soren's persisted score was 0 rings, while his cumulative heartbeat series
  crossed 1,400. Because exempt riders have no ring series, the live chart used
  its legacy heartbeat fallback and mislabeled that value as rings. Exempt
  entries now remain at zero when `rings_total` is intentionally absent.
- The Plex metadata route constructed its router with obsolete arguments,
  leaving its required `ContentAccessService` undefined. It now receives the
  shared service used by the display route, restoring enrichment lookups.
- ANT+ cadence device `46564` was registered in the live config as **Generic
  Pedaler**. Its observed revolution counter remained fixed at four, so it is
  registered without fabricating RPM; hardware diagnosis remains separate.

The two-browser path now claims a household live-session authority before it
creates a local ID. The whitelisted kiosk becomes writer and later clients
become mirrors of the same session ID; the existing save lock therefore has a
single record to protect, and mirrors suppress ring audio. The authority has a
two-minute writer lease; a temporary authority failure falls back to the
previous start path rather than preventing a workout.

The session also contained repeated unauthorized autosave responses and an
unrelated Plex enrichment exception; both should be handled in separate audits.
