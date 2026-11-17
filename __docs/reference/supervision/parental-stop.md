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

Portal capability preflight must inventory both composition paths independently.
An installation with no enabled supervision configuration or retained ledger
uses `shutdown/config.yml` → `portal_keys.base_url` and `portal_keys.auth_ref`.
Configured supervision uses `supervision/config.yml` →
`devices[].portal_keys.base_url` and `devices[].portal_keys.auth_ref`. Each auth
reference resolves through the household auth store and accepts either a token
string or `{token: <secret>}`. A configured consumer does not supply credentials
to the legacy shutdown adapter. The legacy `Portal key suppression is
unavailable` warning establishes a skipped or missing capability; it does not
establish that any particular parent command reached the native service.

Prepare an additive candidate of the currently installed legacy policy, preserving
its duration, targets, cue and reconciliation settings, with this additional block:

```yaml
portal_keys:
  base_url: http://<portal-host>:<portal-keys-port>
  auth_ref: <existing-household-auth-reference>
```

Keep tokens in household auth. Verify that the reference exists and resolves to
a nonempty token without printing it. Check the loaded configuration, not an
unregistered flat config file. Do not enable supervision or remove required
capabilities to make inventory checks pass. URL and auth wiring is composed at
backend startup; policy reload alone does not replace this adapter.

Before installing that candidate, read `GET <base_url>/status` without changing
native state. Require `serviceBound: true` and
`config.lockdownProtocolVersion: 2`. A successful HTTP response alone is
insufficient. The adapter's credential-aware `probe()` must advertise
`portal-keys`; absent configuration, missing service, unsupported protocol,
invalid status or an unreachable endpoint remains `CAPABILITY_UNAVAILABLE`.
A probe does not prove that the token can actuate keys. During the separately
authorized device drill, an ordered Stop must return `lockdownActive: true`,
`lockdownProtocolVersion: 2` and `lockdownRevision` equal to the current command
revision. Release must acknowledge false at its own current revision. HTTP
rejection is `NATIVE_LOCKDOWN_REJECTED`; malformed or mismatched acknowledgements
are `NATIVE_ACK_MISMATCH`. Observe physical key suppression as well. Keep the
configured runtime's 5,000 ms ACK freshness and 2,000 ms reconcile cadence.
Legacy mode keeps its existing finite shutdown window and does not acquire
persistent supervision Stop semantics from this wiring repair.

For configuration rollback, retain a separate copy of the exact previous
`shutdown/config.yml` before authorized installation. Restore that policy and
reload it through the selected backend deployment procedure; a backend restart
is required to restore the previous Portal URL/auth wiring. Preserve
`shutdown/lockdown.yml`, any `supervision/current.json`, command revisions and
the HA latch. Do not remove auth records or reset native state. If restoring the
old config removes a required native capability, acceptance fails and the kiosk
must retain required enforcement or locked maintenance until repaired. Neither
config rollback nor a successful probe authorizes releasing an active Stop.


Parent controls refresh enforcement evidence every 2,000 ms. Each row names its
registered device and capability and reports `requested`, `acknowledged`,
`unverified`, or `verified`. A native acknowledgement is current for at most
5,000 ms; only independent physical evidence produces `verified`. Missing
configuration, a missing consumer, obsolete revision, network failure, or stale
contact remains unverified. A native ACK alone displays “acknowledged (stopped)”
and does not establish that power, video, audio or input physically ceased.

After 5,000 ms of missing enforcement, the same Stop owner records an incident
per device, capability and command revision. The configured runtime keeps this
metadata in `enforcementIncidents` in its existing ledger, outside the assertion
outbox. Legacy shutdown uses `shutdown/enforcement-incidents.json`, a separate
kernel-locked diagnostic sidecar exposed by its existing datastore; the finite
`shutdown/lockdown.yml` window remains the only legacy Stop authority. Legacy
status adds `enforcement.consumers` and `enforcement.incidents`; it does not enable
supervision or turn a timed shutdown into a persistent Stop. Native evidence is
refreshed on the existing legacy reconcile schedule.

Both configurations may optionally set:

```yaml
enforcement_alerts:
  recipient_id: <configured-parent-username>
```

When omitted, the established ConfigService head-of-household resolver supplies
the recipient. An absent recipient or mobile push target leaves delivery visibly
pending. The alert adapter calls the existing NotificationService with an
explicit required push channel and a stable incident/type dedupe key. Failed or
suppressed sends remain pending and retry that key; in-app delivery cannot count
as parent push acceptance. Incident storage or notification failures never
withhold an actuator Stop and are surfaced as `INCIDENT_REPORTING_UNAVAILABLE`
when persistence fails.

Notification records distinguish `pending`, `failed`, `accepted` and `confirmed`.
A successful Home Assistant call means transport **accepted**, with phone delivery
unknown; it stops automatic retries but is not phone confirmation. An explicit
HA rejection remains failed. `confirmed` requires independent delivery evidence
from the injected port; the current HA adapter cannot provide that evidence.
Recovery is a separate event after a fresh, matching blocked acknowledgement;
a release or a newer revision cannot claim recovery for an older incident.
Pending alerts and recoveries survive backend restart. As with other external
side effects, a crash between transport acceptance and durable recording can
require retrying the same dedupe key; the push tag also stays stable.

The native/device and phone acceptance drill remains required. Unit tests, a
stored accepted notification, or an HTTP success cannot close that gate.


Legacy installations expose the same read-only enforcement rows in **Admin →
Household → Devices → Kiosk Stop enforcement**. The existing admin authentication
and permission gate protects `/api/v1/admin/household/shutdown/status`; the route
requires the resolved household to match its registered diagnostics provider and
rejects unsupported household selection. The panel displays top-level incident
reporting failures as well as per-consumer evidence, and refreshes freshness every
2,000 ms. It adds no Stop/release action or password flow. School and piano retain
their existing blackout behavior and finite shutdown-window cache; enforcement
metadata is never used to clear or extend that window.

Legacy ACK contact and recovery timestamps are sampled when the native response
completes, rather than when the request began. Fallback notification recipients
are resolved with the runtime household ID; a household without a configured head
leaves its notification pending instead of using another household's parent.
