# Fingerprint Identity & Action-Unlock

Gates selected FitnessApp actions behind a fingerprint scan from an **authorized user**,
and arms the emergency lockdown ceremony, off a single continuous reader feed. Headline: a
child cannot open Dance Party from the menu; an authorized adult unlocks it by placing a
finger on the garage reader (DigitalPersona U.are.U 4500). Vocabulary is abstract — "lock /
unlock / authorized user", never role-specific.

## Identity event pipeline

There is **one** consumer of the physical reader, by design. The garage box runs an
always-on scan loop that broadcasts a *dumb* `biometric.scan` event on every touch; the
backend enriches it with identity + authorization facts and rebroadcasts a single
`fitness.identity.detected` event; the frontend routes that event by app context (is an
unlock modal open? what is the emergency phase?). The reader never decides "emergency vs
unlock" — the frontend does, from its own context. This removes reader contention by
construction.

```
garage reader (one owner: continuous scan loop)
        │  identify against full local template store, loop forever
        ▼
biometric.scan  { modality, matched, uuid }        ← dumb: just "this uuid touched"
        │  WebSocket → backend relay
        ▼
identity relay: uuid → user (fingerprint index), user → authz (locks + emergency)
        │
        ▼
fitness.identity.detected  { matched, userId, finger, authz:{ emergency, locks[] }, at }
        │  WebSocket → frontend
        ▼
frontend identity router (single owner)
   ├─ unlock modal open  → grant iff the match authorizes THIS lock; else "denied" (modal stays)
   └─ no modal open      → only emergency-authorized matches act on the lockdown phase
```

The relay never sends template uuids to the browser; the frontend sees only the resolved
`userId` plus the authorization flags. A non-matching or unknown-uuid touch broadcasts an
`unrecognized` identity event (matched: false) so the UI can distinguish "wrong finger"
from "no scan."

### Authorization facts

For each matched touch the relay computes, from the lock policy (below):

- **`authz.locks`** — every lock name whose authorized-user list includes this user.
- **`authz.emergency`** — true when the user is authorized for the special `emergency`
  lock. On an emergency-authorized match the relay also stamps a short-lived
  **pending detection** (TTL ~30 s) that the `/emergency/{commit,abort,release}` endpoints
  consume — the guard that ties a destructive HA action to a real recent admin scan.

### Frontend routing

A single provider owns the emergency hook and an unlock sub-API, and installs one stable
subscription to the identity topic:

- **Modal open** (a consumer has registered an unlock for a named lock): a match grants
  only if `authz.locks` includes that lock. A wrong finger sets state to *denied* but does
  **not** close the modal — only an explicit cancel or a granting finger ends it. On grant
  the provider resolves the consumer's promise, holds an "Access Granted" confirmation
  while the success chime plays, and resolves the verdict (chime end / silent device /
  safety cap).
- **No modal open**: only emergency-authorized matches matter. In the normal phase a match
  starts the lockdown ceremony; during the triggering phase a second match aborts it; once
  locked, release is press-and-hold UI driven (a scan does nothing).

The success chime sound and volume are config-driven (`fitness.yml → unlock.{sound,volume}`,
fallbacks otherwise); the cue element is primed from the unlock tap gesture so it plays even
in the menu where no player is mounted.

## Data model

### Lock policy — `data/household/config/fitness.yml` → `locks`
Maps each lock name to the usernames authorized to unlock it. A lock is **active** iff its
value is a **non-empty array**; absent/empty ⇒ the gated control behaves as before (no gate).

```yaml
locks:
  dance_party:        [kckern, elizabeth]   # open Dance Party from the menu
  governance_bypass:  [kckern, elizabeth]   # bypass the HR/effort governance lock
  skip_content:       [kckern, elizabeth]   # play a sequentially-locked episode
  emergency:          [kckern, elizabeth]   # arm/abort/release the emergency lockdown
```

`locks` must be surfaced to the fitness config the frontend reads (root or nested `fitness`
block); the gated surfaces look it up there.

### Enrolled fingerprints — `data/users/<username>/profile.yml` → `identities.fingerprints`
A **list** (multiple fingers per user). Each `id` is the on-box libfprint template uuid;
identify resolves a scan to that uuid → this user. Templates never leave the box; only uuids
live in the profile.

```yaml
identities:
  admin: true             # may act on OTHER users' prints (config-only; never written in-app)
  fingerprints:
    - id: 3f9c1a2e-...      # libfprint template uuid (real enrolled finger)
      finger: right-index   # standard finger name (left-thumb … right-little)
      enrolled: 2026-06-17   # enrollment date (metadata; presence of `id` is the signal)
    - id: sim-kckern-0001   # a `sim-` uuid is a SIMULATED finger for hardware-free testing
      finger: right-index
      enrolled: 2026-06-17
      simulated: true
```

> **Freshness:** an in-app enroll/delete reloads that user's cached profile immediately, so
> a newly enrolled finger is usable without a restart. A hand-edited `profile.yml` is still
> only picked up on the next config reload/restart.

## Enrollment & management

Enrollment captures a finger into an on-box libfprint template and registers its uuid
against the user. It runs **entirely in the garage `daylight-fitness` container** (libfprint
+ the GObject-introspection fprint binding + python3-gi baked into the image). The host
carries **no** fingerprint stack — it only passes the USB reader through and bind-mounts the
template store. Host `fprintd` is **masked** so the container is the sole libfprint claimant
(the reader allows one claimant at a time).

### Storage
- **Template:** `<uuid>.tpl` in the on-box template store — the libfprint-serialized print,
  written on the garage box (host bind mount → survives image rebuilds). The uuid is baked
  into the template, so an identify match resolves straight back to the uuid (and thus the
  user) with no side lookup.
- **Registry:** `data/users/<username>/profile.yml → identities.fingerprints[]` (see Data
  model). Only the uuid is registered; the template never leaves the box.

### On-box helper
A single JSON-on-stdout CLI (human progress goes to stderr so stdout stays parseable):

| Command | Effect |
|---|---|
| `enroll --uuid <uuid> --finger <name>` | multi-press capture (U.are.U 4500), writes the template, prints `{enrolled, uuid, finger, …}` |
| `identify --uuids a,b,c [--timeout S]` | one press, prints `{matched:true, uuid}` or `{matched:false}`; `--timeout 0` blocks until a touch or a preempt signal |
| `list` | device info (name, enroll stages, scan type) + stored template uuids |

> **Implementation gotcha:** keep the libfprint `Context` referenced for the device's entire
> lifetime. If it is garbage-collected while the device is open, libfprint **segfaults** on
> the next device call. The helper holds both context and device for this reason.

### Fingerprint Manager

A fitness widget for enrolling and removing fingerprints in-app, so a household no longer
edits `profile.yml` by hand to set up the reader.

#### Eligibility — fitness-scoped
Only **primary** fitness users (`fitness.yml → users.primary`) can hold fingerprints — they
are the profiled users with a `data/users/<username>/profile.yml`. Inline `family`/`friends`
users are **not eligible**: they are never listed by the manager, and an enroll/delete
request naming one is refused with `403 not-eligible`.

#### Access model
The widget is open to anyone, but acting on a user's prints requires authority over that
user:

- **Trust on first use** — a primary user with **zero** enrolled prints may enroll their
  first finger with no scan. This bootstraps the very first authorized user.
- **Self or admin after** — once a user has any print, enrolling or deleting one requires a
  live scan that resolves to that same user *or* to an admin. The identify gallery for that
  decision is the target's own uuids plus every admin's uuids, deduped.

Admin status is the `identities.admin: true` flag in a user's own profile. It is
**config-only**: the manager reads it to decide who may act for others and to show an admin
badge, but never writes it. There is no in-app path to grant or revoke admin.

> **Reader path for management auth.** Unlike the gated actions above, the management
> self/admin scan does *not* ride the continuous broadcaster — it is a targeted identify
> against a specific candidate gallery. It runs as a **preempting `manage` request** through
> the reader arbiter (the request/result correlator), so it momentarily takes the reader
> from the continuous loop, then hands it back. This is the only remaining user of the
> request/response unlock topic.

#### Endpoints — `/api/v1/fitness/fingerprints`
- **`GET /fingerprints`** — lists eligible (primary) users with `{username, displayName,
  admin, fingerprints:[{finger, enrolled}]}`. Template uuids stay server-side; only finger
  names reach the browser.
- **`POST /fingerprints/enroll`** — `{username, finger, clientToken}`. Rejects an unknown
  user (`400`), a non-eligible user (`403 not-eligible`), a missing finger, and a finger
  already enrolled for that user (`409 finger-taken`). After the access gate and a successful
  capture it appends the new uuid to the profile and reloads it. `clientToken` lets the
  garage's capture-stage progress be rebroadcast to the right browser.
- **`DELETE /fingerprints`** — `{username, finger}`. Delete is **keyed by finger name**: the
  finger is resolved to its uuid server-side, refusing an unknown one. The uuid is removed
  from the profile and the on-box template is deleted.

#### WebSocket contract (management)
Enroll and delete are correlated requests relayed to the garage container over the existing
socket, mirroring the targeted unlock request:

- `fitness.enroll.request` → `fitness.enroll.progress` (rebroadcast per stage, tagged with
  the caller's `clientToken`) → `fitness.enroll.result`
- `fitness.fingerprint.delete.request` → `fitness.fingerprint.delete.result`

Enroll progress mirrors the hardware capture — the multi-press stage sequence the reader
expects — so the modal shows stage-by-stage prompts.

## How unlock is requested

Gated surfaces register an unlock for a named lock via the frontend identity provider and
await a verdict promise. There is **no per-request POST** for these — the verdict arrives
through the continuous identity feed. The provider owns a single unlock instance per
consumer (menu / show / player each own one).

| Surface | Lock | Behavior |
|---------|------|----------|
| Dance Party menu item | `dance_party` | Lock badge; tap → register unlock + prompt → launch the module on a granting finger |
| Governed show + sequential episode | `governance_bypass`, `skip_content` | "Unlock" affordance / locked-episode pill → on a `governance_bypass` match the whole show is marked to bypass governance; on a `skip_content` match the locked episode plays. State resets on show change |
| In-player governance lock overlay | `governance_bypass` | "Skip / Unlock" button → on a match a **per-item** runtime bypass releases the current lock only (cleared when the next item starts, so one unlock can't disable governance for the rest of the session) |

A registered unlock shows the shared prompt with `scanning` / `granted` / `denied` states;
a wrong finger marks *denied* but keeps the prompt open; cancel/close clears the unlock and
resolves the promise as not-matched.

## Continuous scanner & reader health

The garage box runs an always-on scan loop that blocks on a full-store identify and
broadcasts `biometric.scan` on every real touch. It is the **default owner** of the single
reader (arbiter kind `scan`, preempts nothing). Targeted enroll / manage requests
**preempt** it through the reader arbiter — they abort the in-flight identify via an
`AbortSignal` (which the helper catches to cancel the scan and release the device cleanly),
take the reader, then hand it back so the loop re-arms. Always-on arming therefore never
blocks enrollment; a preempt simply frees the reader sooner for the enroller.

The loop's only real risk is libfprint/uru4000 degrading over long uptime (each scan
open/closes the device — thousands of USB claim/release per day). Guardrails:

- **Escalating backoff (circuit breaker).** A faulting reader is **not** re-probed at the
  fast re-arm rate. Fault streaks (identify-error / throw) use a backoff that doubles per
  consecutive fault up to a ~30 s ceiling, so a wedged reader gets one gentle probe per
  cycle instead of a USB claim/release churn storm that leaks handles and hard-wedges it to
  "Resource busy."
- **Always-logged device error.** Every fault is logged with its underlying message and the
  consecutive-streak count (never a blind "identify-error"), and a periodic heartbeat proves
  the loop is alive over long uptime.
- **One-time wedge alert.** Once a streak crosses ~10 consecutive faults the loop emits a
  single prominent "reader likely wedged — restart the container" alert.
- **Reset on progress.** Any real reader progress (match / sensed touch / clean preempt)
  resets the streak and backoff.

Recovery from a true wedge is a `daylight-fitness` container restart. Judge reader health
from the loop's logs, not from a manual probe — a raw helper `identify` returns "Resource
busy" on a *healthy* reader because the always-on loop already holds it.

## Hardware-free testing
Set the simulation env on the garage container and drive scans without a physical reader:
`auto-match` / `auto-deny` resolve every request a fixed way; `interactive` holds requests
until a CLI resolves them. The continuous loop, enroll, and delete all short-circuit the
reader in sim mode. See `docs/runbooks/fingerprint-unlock-simulation.md`.

## Source map
- Backend identity pipeline: `backend/src/3_applications/fitness/` — the scan→identity relay
  (uuid→user index, user→authz, emergency pending-detection); the targeted unlock and
  enroll/delete request/result correlators and their live WS services; the management
  access policy (trust-on-first-use, self/admin gallery); the profile-write orchestrator.
- Backend API: `backend/src/4_api/v1/routers/fitness.mjs` — `/fingerprints*` and
  `/emergency/*` routes.
- Backend persistence: `backend/src/1_adapters/persistence/yaml/` — the user-profile
  datastore.
- Frontend identity + unlock: `frontend/src/modules/Fitness/identity/` (the identity
  provider / router and its unlock sub-API), with the unlock prompt overlay and
  governance-bypass helper under `frontend/src/modules/Fitness/player/`.
- Frontend gated surfaces: `frontend/src/modules/Fitness/nav/` (menu) and
  `frontend/src/modules/Fitness/player/` (show + player).
- Frontend manager: `frontend/src/modules/Fitness/widgets/FingerprintManager/`.
- On-box (all in the `daylight-fitness` container — host keeps no fingerprint stack):
  `_extensions/fitness/src/` — the WS server (subscribes to the request topics), the
  libfprint enroll/identify helper, the continuous scan loop, the single-reader arbiter, and
  the hardware-free sim. The image carries the libfprint runtime + fprint GI binding +
  python3-gi; compose bind-mounts the template store.
