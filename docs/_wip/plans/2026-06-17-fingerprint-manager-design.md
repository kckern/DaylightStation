# Fingerprint Manager (In-App Enrollment & Management) — Design

**Date:** 2026-06-17
**Status:** Design (validated via brainstorming)
**Builds on:** the merged Fingerprint Action-Unlock feature
(`docs/_wip/plans/2026-06-17-fingerprint-unlock-design.md`), which explicitly deferred an
"in-app enrollment UI (CLI chosen; could add later)". This is that "later".
**Hardware:** DigitalPersona U.are.U 4500 on the garage box (confirmed plugged in:
`05ba:000a`; `fprintd` 1.94.3 + `libfprint-2` 1.94.7 present, `uru4000` driver supports it).

## Goal

A fitness widget — sibling to `CycleGame` — that manages fingerprint enrollment end-to-end:
list every user that has a profile, show each user's enrolled fingers, and add/remove
fingerprints against the real reader. Enrollment of a user's **first** finger is open
(trust-on-first-use); every subsequent management action requires authenticating as that
user (**self**) or as an **admin**. Admin status is declared in the user's own
`profile.yml` and is **not** editable from the app.

Vocabulary stays abstract — "user", "admin", "authorized" — never family/role terms
(no `parent*`). Mirrors the unlock feature's naming discipline.

## Ownership split (critical — two agents)

The garage-host side (reader, libfprint, template store, the enroll/identify/delete
capture) is owned by **another agent**. This design covers **only the DaylightStation
side**: the frontend widget, the backend HTTP API, the `profile.yml` write path, and the
**WebSocket message contract** the garage helper implements against. The contract in §4 is
the coordination artifact between the two sides.

| Concern | Owner |
|---|---|
| Reader, libfprint, `.tpl` template store (keyed by uuid), uuid generation, capture/identify/delete | **Garage host (other agent)** |
| `profile.yml` (uuid↔user map, finger metadata, `admin` flag), access policy, HTTP API, profile-cache reload | **Backend (this design)** |
| Manager widget, enroll/auth UX, progress streaming | **Frontend (this design)** |

**Templates never leave the box; only uuids appear in `profile.yml`.** The browser never
sees uuids at all.

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Enrollment backend | **Real hardware** (no sim path in this feature) |
| Opening the app | **Open to anyone** — no gate to view |
| Add first print (user has 0) | **Allowed with no scan** — trust-on-first-use bootstrap |
| Add further prints / delete | **Requires a scan** matching the user's own prints (self) **or** any admin's prints |
| Admin designation | **`profile.yml → identities.admin: true`** — config-only, never toggled by the app |
| WS protocol surface | **Reuse `fitness.unlock.*` for auth; add `fitness.enroll.*` and `fitness.fingerprint.delete.*`** (Approach A) |

## Data model

### `data/users/<username>/profile.yml → identities`
```yaml
identities:
  admin: true                 # OPTIONAL. This user may authorize managing ANY user's prints.
                              # Edited out-of-band only; the app never writes this field.
  fingerprints:               # written by the app (append on enroll, remove on delete)
    - id: 3f9c1a2e-...        # libfprint template uuid (owned by the garage box)
      finger: right-index     # standard finger name (left/right × thumb/index/middle/ring/little)
      enrolled: 2026-06-17    # enrollment date (metadata)
```

- A user is **"enrolled"** iff `identities.fingerprints` is a non-empty array.
- **Freshness:** profiles load into `config.users` at startup. After a write the backend
  **invalidates/reloads the affected profile** so the new gallery is visible to the next
  auth without a restart (the unlock feature deferred this; the manager requires it).

### Admins
The set of admins = every user whose profile has `identities.admin === true`. The
fingerprint-management `gallery` for managing user X is **X's own uuids ∪ every admin's
uuids**. (Note: this `admin` flag is independent of `fitness.yml → locks`, which governs
the separate action-unlock feature.)

## Access model (backend-enforced — the browser is never trusted)

| Action | Gate |
|---|---|
| `GET` list users + fingers | **Open.** Returns finger name + enrolled date + count + admin flag. **No uuids/templates.** |
| Add print to X where X has **0** prints | **Allowed, no scan** (TOFU bootstrap) |
| Add print to X where X has **≥1** print | Identify against `gallery(X)`; allow on match |
| Delete a print from X | Identify against `gallery(X)`; allow on match |
| Toggle `admin` | **Not exposed by the app** |

`gallery(X) = X.fingerprints[].id ∪ ⋃(admins).fingerprints[].id`, each tagged with its
owning username. On a match the backend gets `{matched, userId}` and authorizes iff
`userId === X` (self) **or** `userId` is an admin. First-admin bootstrap is automatic: an
admin with no prints is "unenrolled", so their first finger enrolls freely under TOFU.

> **Accepted residual risk (per product decision):** while an admin profile has zero
> prints, anyone at the screen could enroll a finger onto it under TOFU and gain admin
> authority. Mitigation is operational — set the `admin` flag and enroll that finger before
> exposing the screen. This matches the chosen "open to anyone / only unenrolled users can
> add" model.

## Architecture

```
[U.are.U 4500] --usb--> [garage host helper]   (OTHER AGENT)
                          ├─ enroll  (capture N placements → uuid, store <uuid>.tpl)
                          ├─ identify(gallery uuids) → matched uuid/username
                          └─ delete  (rm <uuid>.tpl)
                                 │  speaks the WS contract (§4)
                          [daylight-fitness container] --ws--> [backend /ws]
                                                                    │ relay + policy + profile.yml
[FitnessApp (garage Firefox)] <--https POST--> [backend /api/v1/fitness/fingerprints/*]
[FitnessApp] <--ws progress (clientToken)----- [backend rebroadcast of enroll.progress]
   FingerprintManager widget
```

## 4. WebSocket contract (backend ⇄ garage helper)

Same transport as unlock: backend `eventBus.broadcast(topic, payload)` outbound; the garage
client subscribes to the request topics and replies with a client message
`{ topic, requestId, ... }` that `eventBus.onClientMessage` routes back to a broker.

### Authentication — REUSE existing unlock path
- Out: `fitness.unlock.request` `{ requestId, lockName, candidateUuids: [{uuid, username}] }`
  — the manager sets `lockName = "manage:<username>"` purely as a label; the box treats it
  as opaque and just identifies against `candidateUuids`.
- In: `fitness.unlock.result` `{ requestId, matched, userId }`.

### Enroll — NEW
- Out: `fitness.enroll.request` `{ requestId, finger, username }` (`username` for box-side
  logging only; the box does not read or write `profile.yml`).
- In (streamed, 0..N): `fitness.enroll.progress` `{ requestId, stage, stagesTotal }`.
- In (final): `fitness.enroll.result` `{ requestId, success, uuid, error? }`.
  On success the box has stored `<uuid>.tpl` and returns the uuid; the backend then writes
  `profile.yml`.

### Delete — NEW
- Out: `fitness.fingerprint.delete.request` `{ requestId, uuid }`.
- In: `fitness.fingerprint.delete.result` `{ requestId, success, error? }`.
  Backend removes the `profile.yml` entry only after `success: true` (avoids a profile
  entry pointing at a missing template, which would silently drop out of every gallery).

### Timeouts
Enroll ~60s (multiple placements + retries); delete and identify ~15s (reuse the unlock
default). The enroll broker uses a longer timeout and forwards `enroll.progress` events.

### Browser progress streaming
The enroll `POST` body carries a browser-generated `clientToken`. The backend tags its
rebroadcast of `enroll.progress` to browser clients with that `clientToken`; the widget
subscribes via the existing frontend WebSocket (`frontend/src/hooks/useWebSocket.js`) and
filters by its own token to drive the "place finger… N of M" UI. The `POST` itself
long-polls and resolves with the final result.

## 5. Backend (DaylightStation)

### HTTP API — `backend/src/4_api/v1/routers/fitness.mjs` (mirrors `/unlock`)
- `GET /api/v1/fitness/fingerprints`
  → `[{ username, displayName, admin: boolean, fingerprints: [{ finger, enrolled }] }]`.
  Never includes uuids.
- `POST /api/v1/fitness/fingerprints/enroll` `{ username, finger, clientToken }`
  → access gate (TOFU vs identify); relay `fitness.enroll.*`; on success append to
  `profile.yml`, reload that profile, return `{ success, finger }`. Gate failure → 403
  `{ error: 'auth-required' | 'auth-denied' }`; unknown user → 400; service down → 503.
- `DELETE /api/v1/fitness/fingerprints` `{ username, uuid }`
  → access gate; relay delete; on success remove the `profile.yml` entry + reload.

### New modules
- **`manageAccessPolicy.mjs`** (`3_applications/fitness/`, pure, unit-tested): given
  `(targetUsername, profilesByUser)` → `{ requiresAuth: boolean, gallery: [{uuid, username}] }`.
  `requiresAuth` is false iff the target has zero prints. `gallery` = target uuids ∪ admin
  uuids. Mirrors `unlockPolicy.resolveCandidateUuids`.
- **Profile-write path** (a focused service; persists via the YAML datastore used for user
  profiles): `addFingerprint(username, {id, finger, enrolled})` and
  `removeFingerprint(username, uuid)` — re-read → mutate `identities.fingerprints[]` →
  write `data/users/<username>/profile.yml` → invalidate the in-memory profile cache so the
  next read/gallery reflects it. Reuses the pure `addFingerprintEntry` helper already in
  `_extensions/fingerprint/src/profileStore.mjs` where practical.
- **Enroll/delete brokers**: extend the unlock broker pattern
  (`3_applications/fitness/`) with `fitness.enroll.*` (longer timeout + progress passthrough)
  and `fitness.fingerprint.delete.*`. Auth reuses the existing `unlockService`.

## 6. Frontend — `frontend/src/modules/Fitness/widgets/FingerprintManager/`

Sibling to `CycleGame`. `index.jsx` exports the default container + `manifest`
(`{ id: 'fingerprint-manager', name: 'Fingerprints', icon: '🔏', description: '…' }`),
registered in `frontend/src/modules/Fitness/index.js` under key
`fitness:fingerprint-manager` (+ legacy id map entry).

```
┌─ Fingerprints ────────────────────────────────┐
│  kc (admin)            👍 right-index   [+ Add]│
│  elizabeth (admin)     — no prints —    [+ Add]│
│  felix                 👍 right-index          │
│                        👍 left-thumb    [+ Add]│
└────────────────────────────────────────────────┘
```

- **+ Add**: if the target is unenrolled → open the enroll modal directly; else → auth
  prompt (reuse `<UnlockPrompt>` look/state machine) → on match, open the enroll modal.
- **Enroll modal**: pick a finger (standard finger names, default right-index) → live
  progress from the WS stream ("Lift and place again — 3 of 5") → success or failure, then
  refresh the list.
- **Delete**: each print chip has a delete affordance → auth prompt → delete → refresh.
- **Input/UX**: D-pad/gamepad navigable per the garage-display input rules; logging
  framework throughout (`{ component: 'fingerprint-manager' }`, events
  `manager.opened|enroll.start|enroll.progress|enroll.done|delete.start|delete.done|auth.required|auth.granted|auth.denied`).

## 7. Logging (framework, not raw console)

Frontend child logger `{ component: 'fingerprint-manager' }`. Backend events under
`fitness.fingerprint.*` (`enroll.request|progress|result`, `delete.request|result`,
`access.tofu|access.requires-auth|access.granted|access.denied`, `profile.write`).

## 8. Testing

- **Backend (no hardware):** `manageAccessPolicy` (TOFU vs requires-auth, gallery
  composition incl. admins); profile-write service (append/remove + cache invalidation);
  router tests mirroring `fitness.unlock.test.mjs` with a fake unlock service + fake
  eventbus for the enroll/delete brokers. Use `test-user`, never real identifiers (PII).
- **Frontend:** widget renders the user list (no uuids); +Add on an unenrolled user skips
  auth; +Add on an enrolled user opens auth first; the progress stream advances the modal;
  delete requires auth.
- **End-to-end:** the garage leg is mocked here; real hardware E2E happens when the other
  agent's helper connects and speaks the §4 contract.

## Out of scope (YAGNI)

- Any sim enrollment path (real hardware only).
- Toggling the `admin` flag from the app (config-only).
- Building the garage-host helper, udev rules, or libfprint binding (other agent).
- Renaming a finger / re-assigning a print to another user (delete + re-enroll covers it).

## Directory pointers

- Frontend widget: `frontend/src/modules/Fitness/widgets/FingerprintManager/`
- Backend: `backend/src/4_api/v1/routers/fitness.mjs`,
  `backend/src/3_applications/fitness/{manageAccessPolicy,...}.mjs`
- Sibling/prior art: the action-unlock design + plan
  (`docs/_wip/plans/2026-06-17-fingerprint-unlock-*.md`), reference doc
  (`docs/reference/fitness/fingerprint-unlock.md`).
