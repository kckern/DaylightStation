# Reliable parental Stop

A normal owner/guardian fingerprint scan immediately records a persistent Stop for the configured group. An explicit unlock-purpose scan remains an unlock operation. A scan while stopped does not implicitly release. Release requires a fresh parent command or explicit new release scan. Stop never expires automatically.

The supervision owner durably stores intent, audit, publication outbox and monotonically increasing command revisions in `supervision/current.json`. State Gates evaluates `supervision.interactive`; its explicit false stop assertion is required for access. Publication failures and missing policy evidence deny admission. Custom household policy needs the additive `scripts/migrate-supervision-policy.mjs` migration, which validates and writes a separate candidate while preserving existing gates.

Every routed child surface sits inside an unmounting boundary. Detached audio/WebAudio and native consumers have lifecycle stop ports. Canonical access permits last at most five seconds; WebSocket events can revoke local access but cannot grant it. Parent controls remain available and suspend child handlers before password entry. Released content requires an explicit return to the menu.

Pair each kiosk through Parent controls → Pair this kiosk, using a parent password and its registered device ID. This creates only HttpOnly SameSite Strict device cookies, never an adult login. The provisioning cookie lasts 30 days and renews ten-minute kiosk sessions. Rotation of that device credential invalidates both kinds immediately. IP, Referer, selected profile and device query parameters are not device authority. Configure delegation explicitly when a kiosk may launch on a different registered device. The browser acknowledges its protocol and actual blocked state after child teardown commits; old bundles cannot activate coverage.

Scanner events use the `_extensions/fingerprint/src/signScan.mjs` protocol: HMAC-SHA256 over the fixed topic/data/scanner envelope, a random nonce and current timestamp. The server rejects missing/bad signatures, replay, events older than five seconds and excessive clock skew. Provision the signing secret only on the physical scanner and server. An unsigned generic WebSocket message cannot establish parent authority in configured mode.

Required enforcement is an explicit per-device capability manifest. Every native or HA adapter must acknowledge the current durable command revision; missing/skipped/unreachable consumers remain visible and prevent activation. A recent acknowledgement expires after five seconds. Native games are force-stopped: unsaved progress may be lost. The Portal requires ordered lockdown protocol 2; older APKs are an unmet capability. Never uninstall to bypass signing incompatibility.

HA keeps a persistent parental latch above TV/speaker automation. Release only clears it; no content or power is restarted. A latch acknowledgement differs from physical off verification: two distinct fresh off reports, separated by at least two seconds, must arrive within 30 seconds. HTTP success, queued scripts and serial writes do not prove off. A stopped kiosk remains blocked even when a relay cannot be verified.

Removing configuration retains saved coverage and Stop intent. Corrupt storage aborts initialization; missing credentials or capabilities keep the runtime closed. Legacy fitness locks use Unix seconds and are migrated before initialization, alongside shared shutdown windows. Rollback must preserve this ledger and HA latch and retain mandatory enforcement or display locked maintenance; an old permissive bundle is unsafe during a Stop.

A never-configured installation with no supervision ledger stays in legacy mode
through a read-only bootstrap check, without creating directories or acquiring a
Linux writer lock. Enabled configuration or any existing ledger still requires
the kernel-backed single-writer lock; an unavailable lock or unreadable ledger
aborts initialization. Persisted configuration remains authoritative even before
the first device state has been written.

See `__docs/configuration/supervision.yml` for the configuration template. The actual inventory includes Garage (`garage-tv`), school Portal (`portal`), piano tablet (`yellow-room-tablet`) and arcade/media Shield (`livingroom-tv`). This is reviewed inventory, not a claim that every consumer has passed live acceptance. Deploy only through the activity-aware rollout gate and record the parent-operated drill, including per-device ACKs and real actuator observations. A persistent idle latch alone is not an active human; recent verified parent intervention/release still protects against deployment.

Approval-mode policy extends the same graph with trusted household evidence, an occurrence-scoped grant and a fail-closed normal-current companion. The neutral `$household` selector binds to the engine's actual household; static period selectors retain their full bounds. It requires the separate `household-presence` producer principal. The additive migration installs both the occurrence and normal entitlements and preserves existing app rules.

An approved media activity retains Retry, Play, Pause and Toggle for its current
item. Screen commands derive that scope from the current playback owner's
snapshot at dispatch, and the owner still validates Retry's visit target. Queue
changes, other content and idle secondary selections cannot borrow that grant.
