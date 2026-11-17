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
