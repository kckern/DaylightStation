# Satellite source, producer/consumer and operator contracts

`wire-contract-review.json` now contains nineteen initial source-boundary reviews:
Piano recorder, pressure-mat relay, fingerprint profile helpers, audio-router
launcher, document processor, Portal keys, native audio bridge, content barcode,
kitchen relay, OMR, automotive OBD, e-ink panels, IR/RF blasters, Playback Hub and
Android Piano bridge, Fitness, calculator relay and TI-86 application. They are not
interchangeable daemons or completed runtime certifications. Every target now has
an initial review; each retains explicit gaps in control/resource/consumer
accounting or runtime/build evidence. All 19 keep their build declarations and
stable operator paths.
PRE-2.3.3 is not complete. No device, recorder, firmware, provisioning generator,
document daemon or operator command was executed.

Thirty unique actual selected baseline cases cover pressure normalization/commands,
fingerprint profiles, Portal input, relay dispatch/OMR, automotive acknowledgements
e-ink HTTP, hub adapter, Piano note/repair clients, Fitness and SchoolCalc. Source-only findings below are
not represented as executed Java, Python, shell, hardware or audio tests.

The independent build-input inventory now includes Gradle wrapper artifacts,
Android manifests and firmware partition tables (60 declarations/artifacts), not
just package/platform manifests. Operator entries explicitly include provisioning,
vendor-fetch, simulation and Android control tools; test entries remain labeled
as tests, not automatically safe commands. Generated headers and downloaded
vendor trees were not read or created. The target list still does not certify a
flashed device or reproducible image from version ranges alone.

## Fitness: sensors, management requests and passive identity are separate

Sensor frames use source/topic `fitness`. ANT provides a default type/timestamp
before spreading input fields. BLE heart rate deliberately presents an
ANT-compatible `type:ant`, `profile:HR`, `deviceId:ble_<user>` envelope with
`ComputedHeartRate`, sensor contact and nested source `ble`. Its decoder retains
the existing 50–230 range and 8/16-bit little-endian handling. Jump rope has its
own type and cumulative revolution data. The controller's source branch republishes
the whole sensor message; biometric messages omit that source deliberately.

Management uses request IDs across unlock/enroll/delete topics. The central
gateway drops some result fields: unlock keeps Boolean-coerced matched and
userId, not uuid or refusal reason; local timeout has a different shape. Enroll
progress replaces requestId with the browser's clientToken. Delivery count is
ignored. Current settlement is keyed only by requestId, not pending operation
kind, sender or source; a different recognized result topic can settle a pending
request. The constructor's subscription has no retained unsubscribe/dispose API.
These are observed validation/lifetime constraints, not approved abstractions.

Continuous scanning is a distinct flow. The injected loop policy emits
`biometric.scan` for a matched UUID or a real unrecognized touch, but not absent
templates, preemption or reader faults. It waits after touches and backs off
faults; false send results are not retried. The controller resolves profile
identity and current authorization on receipt. A raw template UUID is not itself
an authorization decision. Four new cases exercise these gateway/policy/decoder
boundaries with fake timers, bus and delays—not the physical scanner.

Recognized simulation values are auto-match, auto-deny and interactive. Startup
disables continuous scanning for any nonempty simulation value, however, so an
unknown value combines real management requests with no continuous scanner.
Interactive HTTP removes the newest pending request before attempting delivery.
Template deletion is outside the simulation/reader-arbiter branches. Neither a
simulation flag nor an HTTP success can be assumed to guarantee no device/filesystem
effects throughout this daemon.

Biometric templates are separate persistent libfprint bytes at `<store>/<uuid>.tpl`;
profiles are centrally maintained YAML metadata. Enrollment writes a whole file
directly, with no explicit atomic replacement, fsync, lock or mode in the helper.
UUID is embedded in the serialized print. The server recognizes a duplicate
enrollment response, but the tracked helper does not implement duplicate-gallery
rejection. Delete interpolates the UUID into its path and treats missing files as
success. No templates were inspected or changed; these branches need separate
validation and hardware review, not silent migration repairs.

Additional surfaces include Bluetooth inventory/pair/remove topics and HTTP
TV serial commands, BLE start/stop/HR scanning, status and simulation controls.
Inventory caches the last device JSON before sending, so unchanged data is not
replayed after failed delivery. Several GET routes mutate hardware. Startup runs
at module evaluation and includes hardware, config fetch, WebSocket, inventory,
scan loop and listener. Shutdown's stop flag does not prove an in-flight reader
has joined. The node18-slim/npm/apt/Python image is independent; its lockfile does
not pin the native USB/BlueZ/libfprint stack. No daemon/image/helper was run.

## Calculator relay: layered framing and staged transfers

TI link packets, TI String length wrappers, SchoolCalc record envelopes and
foreground SCF1 frames are separate integrity layers. Packet checksums are
additive; SchoolCalc and SCF1 have their own CRC16. Foreground frames carry type,
flags, sequence and length, with a 256-byte payload maximum and default 128-byte
chunks. Handshake/capability/nonce, input and heartbeat state are not replaced by
an HTTP route contract. Direct-key TI commands also have a special header format.
No C++ or electrical link behavior was executed here.

Firmware sends binary SCI1 to identify and JSON/base64url wrappers to sync, using
Bearer plus an asserted relay ID. The current firmware requires HTTP, not TLS.
The central verifier requires exact Bearer syntax and binds the credential's
relay ID; an omitted assertion is allowed, a conflicting truthy assertion is not.
Middleware runs before body parsers and freezes verified identity. The new auth
case tests that middleware with synthetic credentials, not full device/agenda
authorization or controller setup.

Sync wrappers carry rawInfo, optional installedState/resultQueue/requestRecord/
interactionRecord/studyEntry and catalog generation. Central orchestration runs
profiles, observation, results, deliveries, interaction, study, progress, plan
in that order when optional inputs are present. Acknowledgements include only the
current batch's outcomes with literal `acknowledge:true`. A late failed stage
stops later work, without undoing earlier effects. Two new orchestration cases
assert this exact sequence and boundary. The real queue importer separately
preflights every decoded record's device binding before sequential common import.

The relay reads DSID/DSINFO plus optional installed/result/request/interaction/study
variables. Resolved Adaptive Study stages the artifact if supplied, DSSTDNEW/SCSP,
then DSSYNC/SCSA last. The retained catalog path stages profiles, progress,
interaction, catalog/artifacts, acknowledgements and finally DSSYNC/SCM1. The
resolved-study branch does not stage the normal ack/profile records even though
those response records were validated. Relay success means awaiting calculator
commit—not proof the shell committed, removed a queue or consumed the marker.

Normal artifact GET compares response metadata, exact length and actual SHA-256.
The inline adaptive-artifact path checks metadata/digest syntax, length and SCP1
envelope, but does not perform the same byte-hash comparison. This asymmetry is
an explicit remaining verification/repair decision. Do not describe both paths
as fully digest-verified based on the normal download implementation.

Local sync/foreground endpoints return 202 when a job is queued or 409 for busy/
disabled transmission. Diagnostics, screenshots and BLE pairing have independent
effects. Generated config headers contain credentials; the generator requires
explicit private input and creation mode 0600. ESP platform/NimBLE version pins
coexist with ranged libraries. Native Graph Link tooling downloads versioned
archives without an in-script checksum lock, applies a patch and compiles source
from the sibling TI-86 target. Those paths and installed identities remain
separate from controller packages. Nothing was compiled, flashed or contacted.

## TI-86 application: current release versus retained implementation

The canonical Adaptive Study install builder transfers SCHLCALC, SCLEARN, SCQUEUE,
SCQR, SCSYNC and DSID, followed by the ASCHL launcher last. Catalog/profile/tutor/
native/request routes are omitted from that release, not deleted from source.
The older full-client and starter builders therefore do not define v1's default
bundle. Even the invoked provisioning builder emits extra roster/progress files
that the canonical transfer list does not include. Inspect the transfer manifest,
not every file present under dist, when specifying a future build check.

The record envelope's ABI version differs from the artifact compiler revision.
The same exact SCR1 result bytes can travel inside SCQ1 or in unpadded BASE32
`sch:r1:` QR text, with the adaptive QR record ceiling of 69 bytes. The small
String-file helper only packages exact Buffer bytes, names, lengths and additive
checksum; it does not validate the SchoolCalc envelope. Its new case proves that
wrapper, not CRC, semantic codec, QR readability or physical transfer.

Assembly's adaptive commit compares SCSA/retained SCE1/staged SCSP identities,
checks the selected artifact length/schema/ID, copies to DSSTUDY, then deletes
the request/staging/marker. Its digest-byte regions are skipped rather than
checked with the normal downloaded-artifact SHA implementation. Exact cut and
digest tests remain required. The JS staged-sync reference instead models the
retained SCM1/alternating SCL1 path; its tests cannot certify Adaptive Study's
SCSA recovery by themselves.

QR and cable feed a common backend importer. It checks enrolled device/platform,
historical learner binding, immutable artifact, adaptive session and local-score
consistency before a new claim. Device/sequence/digest distinguish replay and
conflict; backend receipt time is not offline occurrence time. Full grading,
ledger/agenda durability and result/cut matrices are not proved by the selected
orchestration tests.

Builders run at top level, invoke z80asm and write both dist and source/generated
include files. They are not permissible discovery imports under the source freeze.
Host tools also import backend codec/domain helpers by relative path, and native
C tooling is built from the relay tree. Some retained starter tools read private
catalog/household locations; no such data or ROM was opened. Emitted current-release
identity, ABI/resource/include paths and C++/Z80/hardware parity remain explicit
follow-up work.

## Cross-root consumer index

A frozen-source scan indexes 540 literal `_extensions/<target>` references outside
the named target across 12,128 selected tracked text/build files. Only file, line,
target and source identity are retained; full lines can contain private deployment
values. Documentation, tests, other satellites and runtime/build/operator files
remain separate. A hit in a runtime file can still be a comment, not an import.

Seven manually reviewed operator bindings distinguish these cases:

- Fitness simulation uses a working-directory-derived default script path; its
  injected process capabilities and script path remain separate contracts.
- The old Fitness test utility has private-data fallbacks and helpers that kill
  processes/start servers. Its simulator path is inventoried, not invoked.
- The calculator-relay build reaches TI-86 native C source in another extension;
  preserving only one extension root would break that build input.
- Root `schoolcalc:gui:lint` and `schoolcalc:gui:render` commands directly name
  TI-86 tool paths.
- The Playback Hub JS validator refers to the satellite Python validator as a
  semantic twin, not as an imported implementation. Their parity fixtures matter.
- The OMR recovery CLI is another wire producer; applying a replay can persist
  and grade assessments. It is not a safe discovery command merely because it is
  a CLI or has a dry-run option.
- The controller's Docker ignore declaration excludes `_extensions/`; source
  ownership does not imply these runtimes are in the controller image.

Computed paths, absolute installed locations and operator state outside the
repository are not proved by this literal scan. Positive references remain
consumer-impact candidates until adjudicated; no blanket “all callers covered”
claim follows from the count.

## Piano recorder is not every Piano transport

The Python converter emits `topic: midi`, `source: piano`, ISO timestamp,
nullable session ID, type and data. Note events retain note/name/velocity/channel;
zero-velocity note-on becomes note-off. Controls distinguish control-change,
pitchwheel and program-change. Session start/end have their own data fields.

The current app callback requires truthy type/timestamp and forwards only
source/type/timestamp/sessionId/data. WebSocketEventBus adds topic and a default
timestamp before spreading the payload. The browser's MIDI hook uses receipt-time
`Date.now()` for note events; it does not score using the recorder timestamp.
Sustain is based on `controlName` and value >= 64. Session start resets held notes,
sustain and history. These details matter to games consuming the event stream.

Queueing is bounded, can drop and can reorder a failed send by requeueing at the
tail; it is not exactly-once delivery. Recorder JSON ping/pong and the server's
periodic heartbeat use different shapes. Their round-trip compatibility has not
been proved merely by finding the word “heartbeat” in both sources.

The session-end builder can delete short recordings before creating its message.
The recorder constructor creates directories, opens a script-relative log, installs
signal handlers and can start a network thread. It is not a passive serializer
fixture. Its Python environment is not pinned by the simulator's Node lockfile.
Android `piano-bridge` is a separate target reviewed below, not covered by recorder
findings or a generic “MIDI” test label.

## Playback Hub: appliance results are not target-specific acknowledgements

The Python status endpoint returns an array including both legacy hub UI fields
and controller fields. `slot` maps to the domain's `position`; the legacy wire
`position` means playback time in seconds and must not be substituted. Optional
controller fields default to null. Domain validation retains strict booleans and
positive integer slot identity. Malformed domain values can raise
`INVALID_SLOT_STATUS`, not necessarily the adapter's `HUB_BAD_RESPONSE`.

The controller sends `/api/play` with action, comma-joined colors and optional
content/volume/duration. Plex IDs lose their prefix; other sources keep it. Zero
options remain present. Python accepts `resume_previous`, but this adapter does
not send it, and the shell parses its flag without implementing saved-state
restoration. These are separate surfaces, not an opportunity to add functionality.

Python invokes the sibling shell command with an argument array, converts numeric
options through `int`, waits up to 70 seconds and reads the final stdout JSON
line. A missing action/target returns 400, subprocess timeout 504 and nonzero
exit 500. The shell reports numeric applied/skipped counts and succeeds when at
least one target applied. In particular, play can mean “armed for playback,” not
“audible now.” Stop and disconnect have different BlueZ/armed-state effects.

The central adapter ignores the response `ok` field. Any positive numeric
`applied` count becomes **all requested colors**; numeric skipped then applies
only to targets not already in that list. Modern arrays instead preserve string
applied values, including unrequested or empty strings, while unknown skipped
reasons normalize to `invalid-target`. HTTP 409 becomes all-target contention
even if its body is malformed. The inspected Python endpoint does not currently
emit 409; adapter support is not paired-producer evidence.

Transport errors retain distinct HTTP, timeout and network codes. Nonstring or
invalid JSON text becomes null. The central default two-second timeout is shorter
than Python's command deadline; an abandoned request does not establish rollback.
`verifyAudio` accepts an arbitrary object after HTTP success, whereas Python's
actual endpoint checks configured color, handles disconnected Bluetooth and
samples the PipeWire monitor. Node tests do not prove audible output.

Four `CASE-WIRE-HUB-*` cases execute the original adapter/value objects with an
injected raw-HTTP spy. Python, shell, Bluetooth, MPV, PipeWire and private files
remain untouched. Config/cache, per-slot sockets/PIDs/armed state and logs are
runtime authorities, not files to move with source. The shell sources a sibling
cache helper and relies on deployed Python helpers; its subcommands refresh config
before dispatch. Installed binary/Python/audio versions, validator parity, all
admin routes and queue/cache/restart durability remain named gaps.

## Android Piano bridge: native ownership and two control lifetimes

The native payload emits `note.on`/`note.off` with note and optional velocity,
not the recorder's topic/source/session/time envelope. The browser maps missing
on-velocity to zero and every off-velocity to zero. It does not validate note
ranges. Status messages carry engine/preset/cpu/xruns/speaker health; three
consecutive falsy speaker values mark the speaker disconnected, while one truthy
value restores it. The selected hook test also rejects the recorder dialect.

Raw MIDI goes the other direction. The browser checks only an open socket and a
nonempty ordinary array, sends bytes/repeat unchanged and returns local send
success. Android coerces bytes, clamps repetitions to 1–10 and spaces repeats by
30ms; it reports failure, not a positive physical acknowledgement. Inbound
`note.on/off` instead drive the internal synth. These commands are not synonyms.

The reset client POSTs to the local payload, uses a 65-second abort timer and
distinguishes HTTP failure, malformed JSON, unverified repair, timeout and network
failure. Only literal `fixed:true` succeeds, independently of `ok`. It projects
recoveredAt/verdict, not all server steps or linkVerdict. The native operation can
reconnect BLE, bounce the radio and probe echo; canceling browser fetch does not
cancel an already-running repair. Two reset cases use synthetic responses and a
bounded real cancellation timer, with no repair request sent.

The payload and shell have different listener lifetimes. Server heartbeat/status,
native keepalive, client closure before listener shutdown and browser exponential
retry/grace rules are source-reviewed, not timing-certified by the single hook
case. The shell keeps payload/restart/rollback available when the payload listener
fails. Both reviewed Piano route tables lack Portal's authorization gate. That
trust model is recorded, not changed here. An accepted swap is queued work, not a
healthy active payload; full SHA validation precedes store commit.

Shell APK, shell-api and payload are distinct build/runtime units. The payload
uses compileOnly shell-api and NanoHTTPD, preserving shell-owned class identity.
D8 enumerates compiled classes at execution, checks each source class plus the
exact Main entry, then computes SHA. The build selects installed SDK/build-tools
inputs and is not fully pinned by repository manifests. Crucially, `bakePayload`
writes `app/src/main/assets/payload-baked.jar`; an ordinary Gradle build is not
allowed under the current protected-source freeze.

Both satellite `pbctl.mjs` and central `cli/pianobridge.cli.mjs` are operator
consumers; the shell fallback rewrites a default-port suffix rather than performing
service discovery. Keep these paths and artifact/entry-class conventions stable.
The remaining HTTP routes, heartbeat/controller consumers, native MIDI parser,
assets/engine/permissions, reconnect/grace timing and installed APK/payload identity
still need their own evidence. No Android code, build, update or hardware was run.

## Pressure-mat relay

Firmware v2 emits top-level snake_case measurements and provenance. There is no
topic on the readings themselves; PressureMatAdapter selects the configured/default
topic and projects camelCase fields for subscribers. Device `ts` is uptime in
milliseconds. The adapter adds its own ISO receipt time, and online status uses
receipt age below 90 seconds. History bucketing uses household time, not uptime.

The adapter accepts valid readings for an unconfigured ID; command authorization
separately requires a configured device. Hello and presence have distinct validation
rules. Unknown fields do not automatically survive normalization. Source-to-source
field mappings and release-summary fields are recorded in the JSON.

Two new original-adapter tests use fake bus/clock capabilities:

- `CASE-WIRE-PRESSURE-INGEST` checks normalization, invalid-reading rejection,
  configured/default topic selection, receipt-clock expiry and private connection
  metadata exclusion.
- `CASE-WIRE-PRESSURE-COMMAND` checks command envelopes, unknown/offline failures,
  and that positive thresholds above firmware limits are still accepted by the
  current adapter. Firmware independently ignores out-of-range threshold values.
  A positive bus delivery count is not device application acknowledgement.

Provisioning generates an ignored/private `include/config.h`; it must not be
copied into source packages. Explicit local config overrides referenced provisioning,
and legacy bare sibling references retain a parent-directory fallback. Source paths
for flash/OTA/config tools remain stable; the captured PlatformIO declaration is
not proof of the flashed firmware or complete dependency lock identity.

The normalized presence gateway and day-log repository already separate application
policy from transport and file paths. Preserve that boundary. Sharing event-bus
mechanics does not make hardware detection, Piano rules, or household history
platform responsibilities.

## Fingerprint is a profile helper here, not a tracked host service

This target has three tracked artifacts: README, pure helper and helper test.
The README describes enrollment/identify/host bridge responsibilities as planned;
no host daemon or enrollment CLI implementation is present in this target.
The separate Fitness target has its own helper and biometric transport, which
must not be certified by reviewing this small directory.

The host helper and central profile writer append `{id, finger, enrolled}`,
including an own `enrolled` property when its value is undefined. They discard
`simulated`. The Fitness helper instead omits undefined `enrolled` and preserves
supplied `simulated`. All shallow-copy the profile/identity/list while retaining
existing entries. These differences can matter before JSON/YAML serialization;
a same-looking helper name is not evidence they can be consolidated unchanged.

Gallery construction retains user order and duplicate IDs. The host helper throws
for an undefined authorized-user list, while the Fitness helper returns an empty
list. The central identity index has a different purpose: duplicate IDs resolve
to the last enumerated owner, with missing finger normalized to null.

The central writer calls read, write and cache refresh synchronously. A false
write return still proceeds to refresh; a thrown write prevents it. A refresh
exception rejects after writing, without undoing that write. Removal filters all
matching IDs. Three `CASE-WIRE-FINGERPRINT-*` cases execute these original pure
helpers and writer with synthetic objects/spies. They do not prove disk durability,
identity authorization or biometric enrollment. No user profiles/templates read.

## Audio-router: attributable implementation absence

Only the systemd unit is tracked. It declares a simple service, ordering after
graphical/PipeWire targets, automatic restart with a five-second delay, and an
environment file. Its executable basename is `audio-router.sh`, but no tracked
file has that basename. The packet withholds absolute launch/config values.

`TARGET-AUDIO-ROUTER-IMPLEMENTATION` names the missing script/version/protocol
evidence and audio operator reviewer. Keep the launch path stable; obtaining the
actual external implementation is a later scoped read-only operator step, not
permission to copy a private service into this repository. This is a completed
absence finding, not successful wire or build verification.

## Document processor: independent daemon and file handoff

`createServer` immediately starts a listener; it is not an inert router factory.
The watcher evaluates chokidar setup and server startup at import time. Neither
was imported or started. The watcher uses a local `processing` flag, while HTTP
uses a shared status object's state. Both update status, but the watcher guard
does not consult HTTP's processing state: a single shared exclusion mechanism is
not established by finding both flags.

`POST /process` returns 409 while the shared status is processing. Otherwise it
returns `{ok:true,result}` and updates idle/lastRun/lastResult, or 500/error for an
uncaught failure. An empty inbox produces null result. `processBatch` catches
many failures into `{documents,errors}`, so a batch containing errors can still
produce HTTP 200. `GET /status` returns state/lastRun/lastResult. Failure does not
update lastRun. No controller-side binding was found by the recorded literal
search; dynamic/external operators remain an explicit gap.

JPG/JPEG filenames are sorted, then renamed one by one from Inbox into a
clock-named Processing batch. PDFs go to Ready. A fully successful batch removes
its inputs; partial/outer failure attempts a move to Pending. These mounted data
paths are separate from source paths and are not transactional batch semantics.
The Paperless hook copies `DOCUMENT_FILENAME` into a year archive derived from
`DOCUMENT_CREATED` or current year. Its comment mentions added date, but its code
does not read `DOCUMENT_ADDED`.

The model request asks for grouped pages/category/description/date/issues. Its
parser only verifies JSON and a documents array, not complete/exclusive grouping
or per-document schema. New validation would be behavior work. The dedicated
Dockerfile launches the watcher with its own package installation; neither the
image nor model output nor actual documents were exercised by this review.

## Portal keys: two input transports and a separate control plane

Volume events contain type/key/action/interactive/epoch timestamp. The service
publishes both volume actions before handling a dark display's wake path. The
browser hook only checks type/key: both down and up step volume, even when
interactive is false. Its `stepSize || 0.05` fallback and current-handler ref are
preserved. Mute cases exist in the browser, but the current Android service
passes all non-volume keys through rather than broadcasting them. Comments about
mute handling or avoiding blind volume changes do not override executable branches.
These are baseline observations, not an authorized UX fix.

HID keyboard events use a separate loopback server and type/action/key/code,
location/modifier/repeat/timestamp fields. The sender starts repeat after 450ms
and repeats every 50ms for repeatable usages; up cancels it. Browser validation
requires keyboard/down-or-up and key/code strings up to 64 characters, but does
not reject empty strings. It coerces location/flags and ignores producer time.

The dispatcher creates an untrusted, cancelable KeyboardEvent with a
non-configurable `portalHid` marker. Only unprevented keydown performs manual
text edits, focus movement, activation or scrolling. Text inputs use their native
value setter followed by input events; contenteditable uses optional execCommand.
The three `CASE-WIRE-PORTAL-*` cases exercise field rejection, keyup/no edit,
default prevention, text/textarea edits, focus/activation, volume action semantics,
handler refresh and socket cleanup in jsdom with fake sockets. Reconnect timing,
real WebView behavior, USB decoding, permissions and backlight are not proved.

The shell control channel is separate: token/Bearer authorization, payload URL
and SHA256 submission, queued swap/restart/rollback, and later status. “Accepted”
does not mean loaded/healthy. The loader verifies full SHA256, loads the exact
payload entry class through the shell's parent loader, and can fall back to a
previous payload. The Android shell-api, application APK and payload JAR retain
distinct build/runtime identities. All other ops endpoints and actual deployment
remain open; an npm package move does not migrate this Android system.

## Native audio bridge: shared transport, distinct consumers

The APK sends a JSON header for 48kHz mono PCM16 little-endian, then binary audio.
Its nominal buffer is 960 bytes/10ms, but each send uses actual bytes read; fixed
packet size is not guaranteed. First connected client owns capture. A second
gets error JSON and close code 1008; active disconnect stops capture. There is
no client command/ack/replay protocol.

The Input hook is config-enabled and uses the format's rate/default, main-thread
AEC plus AudioWorklet and gain multiplied by shared effective master volume.
It ignores binary data until its pipeline exists. The separate WeeklyReview
recorder uses a fixed loopback bridge and a 1500ms header timeout with its own
audio pipeline and cleanup. Neither implements full negotiated format validation.
Do not silently substitute one client for the other.

Raw Speex source and worklet loading, shared ScreenVolumeContext identity, companion
APK package identity and device-heal launch behavior are independent dependencies.
This review started no microphone, AudioContext, AEC, kiosk or companion APK.
Actual PCM replay, concurrency/retry, native/WebView behavior and installed build
identity remain explicit verification gaps.

## Content barcode and kitchen: one source can feed several policies

The content scanner emits source `barcode-relay`, type scan, device/route/label/
code and uptime `ts`. Its relay function updates local diagnostics even while
offline, but only sends when connected; it has no replay queue or acknowledgement.
The barcode gateway also accepts `kitchen-relay` scans. It trims a nonempty string
code, chooses configured defaults for missing device or invalid route, drops label
and device time, and publishes `barcode-relay` on the fixed topic of that name.

The kitchen board emits scale, button, scan and hello under one source. Gateways
split by type; scale/button still accept the legacy `food-scale-relay` source.
Scale grams are Number-coerced, including null to zero; stable is Boolean-coerced
and unit defaults to g. Scale events use source `ble-relay`; button events have
no source property and normalize any non-long press to short. Their topics are
per-scale configured or `food-scale`. Both barcode and scale invoke their listener
before publishing and ignore a false listener return. OMR does not share that rule.

These gateways stamp receipt time, ignoring capture uptime and `delayed_ms`.
The kitchen's two offline queues are distinct: 24 scans versus 16 scale/button
events, both drop oldest. Queued readings expire after two minutes; buttons do
not. Flushed readings are stable; a refused send retains the item. Comments saying
readings are never queued predate this scale-side implementation.

Application policy stays separate: barcode scan dispatch precedes serial log
append; scale persistence tracks meaningful stable changes/pan emptying and
captures latest weight on button. Those policies use injected semantic stores,
not firmware or filesystem paths. `CASE-WIRE-KITCHEN-DISPATCH` exercises the actual
gateway discrimination, projection, coercion, legacy/default behavior and disposal.
It does not execute BLE decoding, offline queues or the full persistence policy.

## OMR: the echo is not a durable-write acknowledgement

Firmware turns two serial bytes into each 12-bit mark column. Truncated frames
never become sheets; short acknowledgements are ignored, question-mark errors
become reader-error, and odd byte lengths become raw events. NFC has its own UID
and tag fields. The outgoing RAM queue is bounded by 64 items/40,960 bytes and
drains four per loop. It removes an item after send acceptance, not after echo.
The drain adds `ageMs`; the gateway reconstructs positive finite age relative to
server receipt time, preserving queued reads' household-local timestamps.

The gateway validates/coerces mark arrays, recomputes column counts and validates
trimmed uppercase NFC UID shape. It calls application policy before broadcasting,
and honors a false return. The policy can suppress repeated NFC broadcasts;
sheet persistence deduplication does not suppress sheet echoes. The device matches
reader ID plus NFC UID, or the oldest outstanding sheet without a unique sheet ID.

`CASE-WIRE-OMR-NORMALIZE` verifies selected coercion/time/count/veto behavior.
`CASE-WIRE-OMR-ECHO-PERSIST` proves a sheet is echoed before its asynchronous append,
even when the append later fails. An echo must not be redefined as storage or
grading success by a new shared transport abstraction. Subscription/boot liveness
observations and the replay CLI are additional consumers, not covered by these
two cases. Actual serial/NFC decoding, queue timing, manifest/School grading,
replay effects and device firmware remain unverified.

## Automotive: storage sequencing, retry and destructive ack

The OBD producer emits hello, snapshot, event and chunked trip messages. Snapshot
fields include current measurements, GPS, optional diagnostics/VIN/counters and
diagnostic-code status. Trips carry ID, seq, final, positional samples and final
metadata. The gateway retains payload fields, resolves identity and adds server
receipt time; policy owns normalization, summaries and device/rebased/boot-relative
clock provenance.

Current trip assembly appends in arrival order. It does not sort, validate or
deduplicate using seq, nor reset on seq zero. Truthy final completes the collected
trip; stale partials expire on a later trip arrival. Publication occurs before
the persistence chain settles. Normal completion inspects existing storage,
saves a new trip, appends a summary, then sends direct `{type:'trip-ack',trip_id}`.
The firmware deletes its buffered file after matching this ack to its current
upload. HTTP retrieval is non-deleting; disconnect permits another upload attempt.

The exception paths matter. A failed save/log withholds the first ack. If the
trip file was saved but its summary failed, a retry's existing-file branch acks
without repairing that summary. Below-sample-floor trips append a dropped
breadcrumb before ack. There is no atomic transaction across those stores.
`CASE-WIRE-AUTOMOTIVE-ACK` verifies arrival-order preservation and delayed ack;
`CASE-WIRE-AUTOMOTIVE-FAILURE` verifies the summary-failure/existing-trip retry.
They use synthetic store promises, not actual durable writes or vehicle deletion.

The Freematics dependency helper defaults to a moving branch and prints a later
remote revision query; that is not an immutable identity for the copied library.
Native, bench and hardware environments stay distinct. No vendor fetch, telemetry
device, trip file, firmware recovery or OTA action was performed.

## E-ink: plain text is the device API

Sleeping panels request `/api/v1/eink/:id/config` with battery/signal/wake/uptime/
memory/reset telemetry. The response is ordered `key=value` text with trailing
newline, not JSON: identity, rotation, three button actions, next wake, image URL
and image hash. Telemetry recording precedes the snapshot and a synchronous
telemetry exception does not fail the response. The image URL encodes snapshot ID.

Firmware applies known fields, retains cached strings for blank/oversized values,
and requires positive next-wake seconds. On button wake it sends a GET action and
fetches another snapshot. Hash comparison controls image fetching; successful
decode/render updates the RTC hash. PNG is an unconditional response—`res.end`
bypasses Express conditional freshness. `/status` returns the last telemetry,
not a query to the sleeping device. Changing API formats or GET effects is not
authorized merely because the HTTP wrapper is moving.

`CASE-WIRE-EINK-CONFIG` compares exact text and telemetry ordering/filtering.
`CASE-WIRE-EINK-PANEL-ACTION` checks unconditional image bytes despite
If-None-Match, GET action effects and absent telemetry. Synthetic image bytes are
not a valid PNG/renderer test. Actual dither/display/RTC, complete image hash
inputs, controller authentication and firmware parser execution remain open.
The provisioning template's old query-ID/header comment does not match the current
path/text implementation. The platform declaration and fetched Seeed decoder branch
are unpinned; no generated header, decoder download or build was performed.

## IR and RF: external actuators, distinct protocols

Both firmware servers expose status/health and code-triggered send. Missing code
returns 400; unknown code returns 404 plus available names; local send returns
200/500 with ok/code/id. Registrations omit an explicit method filter; the
documented GET can actuate hardware. No handler was invoked. Source points to
Home Assistant/manual operators, not an identified central blaster adapter;
private operator configuration and actual device state remain external gaps.

IR code generation decodes Tuya base64/FastLZ little-endian duration arrays or
accepts raw microseconds. Firmware sends a configured carrier and rejects empty
or over-256-duration codes. Successful transmission does not verify the TV state.
RF instead uses raw timings/repeats/gap with baseband OOK and RMT packing. A zero
request override falls back to configured repeats. Its learning endpoint captures
for a clamped one-to-thirty-second window and returns timing diagnostics; repeated
length is not a receiver acknowledgement or proof of an identical valid code.

The RF source explicitly warns that hardware is untested. Generated RF timing
limits and expanded RMT item capacity are different constraints. No physical
waveform, receiver, learning operation, private code table or flashed identity
was verified. These targets remain unchanged during the Gratitude rehearsal;
their inventory does not expand the migration's first changeset.
