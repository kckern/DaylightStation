# Fingerprint Action-Unlock

Gates selected FitnessApp actions behind a fingerprint scan from an **authorized user**.
Headline: a child cannot open Dance Party from the menu; an authorized adult unlocks it by
placing a finger on the garage reader (DigitalPersona U.are.U 4500). Vocabulary is abstract —
"lock / unlock / authorized user", never role-specific.

## Data model

### Lock policy — `data/household/config/fitness.yml` → `locks`
Maps each lock name to the usernames authorized to unlock it. A lock is **active** iff its
value is a **non-empty array**; absent/empty ⇒ the gated control behaves as before (no gate).

```yaml
locks:
  dance_party:        [kckern, elizabeth]   # open Dance Party from the menu
  governance_bypass:  [kckern, elizabeth]   # bypass the HR/effort governance lock
  skip_content:       [kckern, elizabeth]   # play a sequentially-locked episode
```

`locks` must be listed in `unifyKeys` in `frontend/src/Apps/FitnessApp.jsx` so the config
normalizer surfaces it to `FitnessContext` (same gotcha that once dropped `dance_party`).

### Enrolled fingerprints — `data/users/<username>/profile.yml` → `identities.fingerprints`
A **list** (multiple fingers per user). Each `id` is the on-box libfprint template uuid;
identify resolves a scan to that uuid → this user. Templates never leave the box; only uuids
live in the profile.

```yaml
identities:
  fingerprints:
    - id: 3f9c1a2e-...      # libfprint template uuid (real enrolled finger)
      finger: right-index   # standard finger name (left-thumb … right-little)
      enrolled: 2026-06-17   # enrollment date (metadata; presence of `id` is the signal)
    - id: sim-kckern-0001   # a `sim-` uuid is a SIMULATED finger for hardware-free testing
      finger: right-index
      enrolled: 2026-06-17
      simulated: true
```

> **Freshness:** profiles are loaded into `config.users` at app/container **startup**. A
> newly enrolled fingerprint is not visible until a config reload/restart (same rule as
> `devices.yml`).

## Enrollment

Enrollment captures a finger into an on-box libfprint template and registers its uuid
against the user. It runs **entirely in the `daylight-fitness` container** (libfprint +
`gir1.2-fprint-2.0` + `python3-gi` baked into the image). The host carries **no** fingerprint
stack — it only passes the USB reader through (`/dev`) and bind-mounts the template store.
Host `fprintd` is **masked** so the container is the sole libfprint claimant (the reader
allows one claimant at a time).

### Storage
- **Template:** `/var/lib/daylight-unlock/<uuid>.tpl` — the libfprint-serialized `FpPrint`,
  written on the garage box (host bind mount → survives image rebuilds). The uuid is baked
  into the template's `username` field, so an identify match resolves straight back to the
  uuid (and thus the user) with no side lookup.
- **Registry:** `data/users/<username>/profile.yml → identities.fingerprints[]` (see Data
  model). The template never leaves the box; only the uuid is registered.

### On-box helper — `_extensions/fitness/src/fingerprint_helper.py`
A single JSON-on-stdout CLI (human progress goes to stderr so stdout stays parseable):

| Command | Effect |
|---|---|
| `enroll --uuid <uuid> --finger <name>` | 5 presses (U.are.U 4500), writes `<uuid>.tpl`, prints `{enrolled, uuid, finger, path, bytes}` |
| `identify --uuids a,b,c [--timeout S]` | one press, prints `{matched:true, uuid}` or `{matched:false}`; ~10s default timeout |
| `list` | device info (name, enroll stages, scan type) + stored template uuids |

> **Implementation gotcha:** keep the `FPrint.Context` referenced for the device's entire
> lifetime. If it is garbage-collected while the device is open, libfprint **segfaults**
> (SIGSEGV) on the next device call. `open_device()` returns `(ctx, dev)` for this reason.

### Manual enrollment sequence (what the WS API automates)
```bash
# One-time per box (done on garage): free the reader + create the template store.
ssh garage 'systemctl stop fprintd && systemctl mask fprintd && mkdir -p /var/lib/daylight-unlock'

# 1. Allocate a uuid, capture the finger (user presses 5×), write <uuid>.tpl.
ssh garage 'UUID=$(cat /proc/sys/kernel/random/uuid); echo "uuid=$UUID";
  docker exec daylight-fitness python3 src/fingerprint_helper.py enroll --uuid "$UUID" --finger right-index'

# 2. Verify the round-trip (user presses once).
ssh garage 'docker exec daylight-fitness python3 src/fingerprint_helper.py identify --uuids <uuid>'

# 3. Register the uuid under the user (pure helper: profileStore.addFingerprintEntry):
#    append { id:<uuid>, finger, enrolled } to data/users/<username>/profile.yml
#    → identities.fingerprints, then reload config so the backend offers it as a candidate.
```

**Currently enrolled — `kckern`:** `right-index`, `left-index`, `right-thumb` (3 real
templates on the box; the `sim-kckern-0001` entry remains for hardware-free testing).

### WebSocket enrollment API (to build)
Mirror the unlock request/result topics (`unlockBroker`/`unlockService`) so the kiosk can
enroll without SSH. The **backend allocates the uuid** (keeps the uuid namespace and the
`profile.yml` write server-side) and registers it on success; the container only captures.

- **`fitness.enroll.request`** — backend → container: `{ requestId, username, finger, uuid }`
  (backend-allocated `uuid`). Handler spawns `fingerprint_helper.py enroll --uuid --finger`.
- **`fitness.enroll.progress`** — container → backend, streamed per capture:
  `{ requestId, stage, totalStages }` (parsed from the helper's `capture N/5` stderr) → relay
  to the UI as "3 of 5".
- **`fitness.enroll.result`** — container → backend: `{ requestId, enrolled:true, uuid, finger,
  bytes }` or `{ requestId, enrolled:false, reason }`. On success the backend appends the entry
  to `profile.yml` (`addFingerprintEntry`) and triggers the config reload.
- **`fitness.enroll.cancel`** — backend → container: `{ requestId }` (mirrors the unlock
  timeout/abort). Enrollment should carry its own ~60s timeout (5 presses).

The container's `fitness.enroll.request` handler is the symmetric twin of the existing
`fitness.unlock.request` handler in `_extensions/fitness/src/server.mjs`.

## Flow

1. Frontend `useUnlock()` POSTs `{ lock }` to **`POST /api/v1/fitness/unlock`** (same-origin
   HTTPS — no CORS/mixed-content). `<UnlockPrompt>` shows "Place finger to unlock".
2. Backend resolves the lock's authorized users → their fingerprint uuids
   (`resolveCandidateUuids`, `3_applications/fitness/unlockPolicy.mjs`); empty ⇒
   `{matched:false, reason:'no-enrolled-users'}` without scanning. Lock policy + uuids stay
   server-side; the browser never sees uuids.
3. Backend relays a correlated request over the **existing WebSocket** to the garage
   `daylight-fitness` container (`unlockBroker` + `unlockService`, 15s timeout).
4. The container runs libfprint **identify** against the candidate gallery (or the
   `FINGERPRINT_SIM` path pre-hardware) and replies `fitness.unlock.result`.
5. Backend returns `{ matched, userId }`; the frontend launches the gated action on a match.
   **Per-action** — no persisted "unlocked" state. On every match `useUnlock` plays a success
   chime (`apps/fitness/ux/unlock.mp3`) via `useGovernanceAudioDuck.playCueOnce` on the shared
   cue-audio element; the element is primed from the unlock tap gesture (so it also plays in
   the menu, where no `FitnessPlayer` is mounted to install the gesture-unlock listener).

## UI gates

| Surface | Lock | Behavior |
|---------|------|----------|
| Dance Party menu item (`FitnessModuleMenu.jsx`) | `dance_party` | Lock badge; tap → prompt → launch on match |
| Governed show + sequential episode (`FitnessShow.jsx`) | `governance_bypass`, `skip_content` | Interactive unlock button / locked-episode affordance; resets on show change |
| In-player governance lock overlay (`GovernanceStateOverlay.jsx` + `FitnessPlayer.jsx`) | `governance_bypass` | "Skip / Unlock" button; on match releases the lock for the current item (`shouldBypassGovernance`) |

## Hardware-free testing
See `docs/runbooks/fingerprint-unlock-simulation.md` — set `FINGERPRINT_SIM` on the garage
container and drive scans from `_extensions/fitness/simulate.mjs` over SSH.

## Code map
- Backend: `backend/src/3_applications/fitness/{unlockPolicy,unlockBroker,unlockService}.mjs`; endpoint in `backend/src/4_api/v1/routers/fitness.mjs`.
- Frontend: `frontend/src/modules/Fitness/hooks/useUnlock.js`, `.../player/overlays/UnlockPrompt.jsx`, `.../player/governanceBypass.js`.
- On-box (all in the `daylight-fitness` container — host keeps no fingerprint stack): `_extensions/fitness/src/server.mjs` (WS unlock handler), `fingerprint_helper.py` (libfprint enroll/identify), `profileStore.mjs` (uuid/profile helpers), `unlockSim.mjs` + `simulate.mjs` (hardware-free sim). Dockerfile carries `libfprint-2-2` + `gir1.2-fprint-2.0` + `python3-gi`; compose bind-mounts `/var/lib/daylight-unlock`.
- Design/plan: `docs/_wip/plans/2026-06-17-fingerprint-unlock-{design,plan}.md`.
