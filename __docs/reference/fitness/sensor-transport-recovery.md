# Fitness sensor transport evidence

The standalone fitness controller reports socket readiness and source activity separately. An open WebSocket or a successful health request does not demonstrate sensor or browser delivery. `/health` retains HTTP 200 for a ready socket and 503 otherwise, labels that status `socket-ready` or `socket-unavailable`, and includes separate `websocket` and `dataPath` objects. `/status` also exposes both.

Every 5,000 ms while running, the controller attempts a `fitness.transport.health` bus message with these top-level fields:

| Field | Meaning |
| --- | --- |
| `protocol` | Diagnostic schema version, currently `1` |
| `bootId` | Random ID for this controller process |
| `sourceSeq` / `receivedCount` | Number of actual ANT+/BLE manager sample callbacks since boot, including callbacks while disconnected |
| `sentCount` | Number of sample writes whose local WebSocket send callback completed successfully; this is not a downstream acknowledgement |
| `lastSourceAgeMs` | Monotonic elapsed time since the last sample callback; `null` before the first sample |
| `socketPhase` | Current supervisor phase |
| `service` / `version` | Controller identity and bundled package version |
| `buildId` | Optional `FITNESS_BUILD_ID` provided by the build/deployment environment, otherwise `unknown` |
| `timestamp` | UTC wall timestamp with `Z` offset |

Actual sample messages carry additive top-level `bootId` and `sourceSeq` from the same receipt counter. The backend's fitness publication preserves these fields through the `fitness` browser subscription. Browser consumers can pass `{bootId: message.bootId, seq: message.sourceSeq}` into transport monitoring and compare real sample delivery with diagnostics. A restart creates a new boot ID; sequences are only comparable inside that boot.

Diagnostics have no `source: fitness` field and use an explicit allowlisted relay before generic fitness-source handling. Even a diagnostic accidentally marked with that source stays on the diagnostic topic. Consumers must subscribe to `fitness.transport.health` separately and must never advance sensor `lastPacketAt` for health, ping, or pong traffic. No synthetic samples or replay queue are introduced.

New transport logging uses the satellite's existing structured `logging` bus event path, with service/build/boot identity. It emits metadata only, with no HR, cadence, biometric, or fingerprint values. Structured events are dropped while disconnected, as before. No root logger dependency is imported into the standalone Docker build context; its Node.js >=18 floor and transport recovery defaults are retained.

To isolate a stall, compare actual source callbacks, local send completion, backend relay, and browser sample sequences under the same boot ID. Advancing source counts without advancing browser samples locates a delivery gap; quiet source counts alone cannot establish a transport failure. If device journals show source activity but `receivedCount` is stationary, inspect the ANT+/BLE receiver-to-callback boundary before changing socket recovery. Receiver availability, deployed versions/build identity, real browser delivery, and recovery under physical conditions require separate release verification. Synthetic fake-client tests establish routing and metadata preservation only; they do not establish the deployed incident's root cause.

## Browser recovery and session handoff

`FitnessProvider` subscribes to the explicit diagnostic topic alongside its sensor topics. `createTransportRecovery` uses `performance.now()` for elapsed deadlines. Actual accepted `fitness` samples advance delivery freshness; retired boot generations and duplicate sequences are fenced before session ingestion. Diagnostic messages never enter `DeviceManager`.

An active session with missing delivery becomes suspect after 5 seconds, reasserts the singleton socket's **full desired subscription set** after 15 seconds, requests one coalesced reconnect after 30 seconds, and becomes lost after 60 seconds. Refresh and reconnect together consume at most two attempts per rolling 120 seconds. Each incident performs each step once; new real samples resolve it. Inactive time does not age a new recovery deadline. Fresh samples remain healthy without diagnostics. Recent diagnostics reporting a quiet source yield `quiet/source-quiet`, while an advancing source without browser samples yields `delivery-gap`; no diagnostics yields `health-missing`. A single absent strap cannot trigger transport recovery while other real samples arrive.

`requestRecovery({owner,reason})` joins the existing reconnect timer and returns a cancellation function. It preserves queued messages and unrelated subscribers, including authorized call subscriptions. The replacement socket reasserts subscriptions once on open. Stop and route disposal release the fitness owner; other consumers' ordinary reconnects remain owned by the singleton. Recovery does not resume content, start a session or change earning policy.

The context exposes `transportRecovery = {state,reason,incidentId,since,bootId,silenceMs}`. `state` is `healthy|quiet|suspect|recovering|lost`; `since` is the monotonic time of the published transition, and `silenceMs` is its observed delivery age. This is a transition snapshot, not a live elapsed counter. `incidentId` remains stable from the first stalled event until a real sample recovers it. Session events use `logEvent('fitness_transport', metadata)` with `type: stalled|lost|recovered`, the incident identity, state/reason, boot ID, silence duration and an offset-aware UTC timestamp. The sustained-loss session policy must preserve/checkpoint this event before suspending autosave. Events also preserve the bridge health packet's actual `service`, `version` and `buildId` for the current boot. Missing or invalid identity values are explicit `unknown`; a new boot clears the previous boot's identity. `deviceId` is `unknown` because these packets do not supply a trusted bridge/kiosk hardware ID. Sensor/strap IDs are not relabeled as the path device. The reporter validates bounded identifier strings and persists these fields unchanged; legacy committed events receive explicit unknown provenance. These events contain no biometrics.

## Parent alert delivery

After `FitnessSessionOperations.save` passes the existing session-write policy and commits the workout, the report service accepts only the committed, allowlisted transport metadata. Unsupported household scope is rejected before the notification provider. The existing household-head Home Assistant notify service carries the push; no new notification endpoint or authority is introduced.

`YamlSessionDatastore` stores server-owned delivery metadata in `fitness/log/_transport/incidents.yml`, using durable atomic replacement. The directory is excluded from the date-based session index. Browser resaves cannot overwrite this sidecar, and queue writes do not rewrite workout evidence. Accepted incident IDs deduplicate subsequent saves and process restarts. A crash between provider acceptance and persisting its result may retry the same notification tag; phone delivery is not claimed.

The existing production agents Scheduler registers `fitness:transport-incident-retry` every minute. It drains only previously committed work for the configured household, including after restart with no new browser save. Failed requests remain explicit and retry after 60 seconds, then 120 seconds, then a capped 300 seconds until accepted; in-process deadlines are monotonic. Missing targets and provider failure remain `failed`, while only an explicit gateway `{ok: true}` result becomes `accepted` with `delivered: unknown`. A resolved `{ok: false}` response remains failed and retryable, just like a thrown provider error. Accepted records stop retrying. A recovered incident cancels its outstanding alert. Scheduler lifecycle shutdown owns retry disposal; no additional process or interval is created.
