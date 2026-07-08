# Fingerprint Unlock (Authorized-User Action Locks) — Design

**Date:** 2026-06-17
**Status:** Design (validated via brainstorming)
**Hardware:** DigitalPersona U.are.U 4500 USB fingerprint reader (vendor `05ba`, product `000a`)

## Goal

Gate certain FitnessApp actions behind a fingerprint scan so that only **authorized
users** can perform them. The headline case: a child cannot open **Dance Party** from
the menu; an authorized adult unlocks it by placing a finger on the reader.

The vocabulary is deliberately **abstract** — "lock", "unlock", "authorized user".
No "parent"/family terminology, because the same mechanism could gate a teacher,
gym staff, or business operator. Do **not** name code `ParentGate`/`parent*`.

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| What a match does | **Authorize a gated action** (not identity/sign-in, not content reward) |
| Which actions | Open Dance Party from menu (headline), bypass governance lock, admin/override, skip/force-advance |
| Authorization lifetime | **Per-action** — every gated action requires a fresh scan; no persisted "unlocked" mode |
| Locked-control UX | **Visible + prompt-on-tap** — control shows a lock badge; tapping opens an unlock prompt |
| Enrollment | **CLI script on the garage box** (over SSH), wrapping libfprint enroll |
| Match strategy | **libfprint identify** — one finger placement matched against a gallery of all authorized templates; returns which user |
| Multi-finger | **Supported** — multiple fingers per user (thumb/index/etc.), each its own uuid |

### Recommended (open — veto if wrong)
- **Capture/verify runs on the HOST, not in the `daylight-fitness` container.** `fprintd`
  + `libfprint` + the reader all live on the host; the container has no fprintd CLI. A
  tiny host-side helper avoids coupling to container rebuilds. *(Alt: install fprintd/CLI
  into the container image + DBus access — compose already mounts `/run/dbus`.)*
- **Two-leg transport (refined during planning):**
  - **Browser ⇄ backend: same-origin HTTPS** `POST /api/v1/fitness/unlock`. The app already
    calls `/api/v1/*` on its own https origin, so there is **no CORS / mixed-content**
    issue. (Mixed-content only bites browser→`http://localhost`; that direct-to-garage
    path is the trap to avoid.)
  - **Backend ⇄ garage: the existing WebSocket** the `daylight-fitness` container already
    holds. The backend resolves the lock's authorized users → fingerprint uuids, relays a
    correlated request to the garage, awaits the result (with timeout), and returns it.
  - This keeps lock policy + uuids **server-side** (browser never sees uuids) and is
    cleaner than a pure WS relay.

## Feasibility — confirmed on the box

- Garage host: Linux Mint 22.2, kernel 6.17, x86_64; SSH lands as **root**.
- `fprintd` 1.94.3 + `libfprint-2` 1.94.7 already installed (`fprintd-enroll`,
  `fprintd-verify` present). `libusb-1.0` present.
- **`libfprint-2.so` includes the `uru4000` driver and its device table explicitly
  lists "Digital Persona U.are.U 4000/4000B/4500"** — the 4500 is supported out of the
  box. No need to build vanilla libfprint or go raw-libusb.
- Reader is **not yet plugged in** (no `05ba:` in `lsusb`). Step 1 of implementation is
  physical connect + udev rule + confirm a live capture.
- The `daylight-fitness` container is privileged, mounts `/dev/bus/usb` and `/run/dbus`,
  and holds an outbound `/ws` to the backend (`wss://…/ws`).

## Architecture

```
[U.are.U 4500] --usb--> [garage host]
                          ├─ enroll-unlock.sh      (CLI: enroll a finger → uuid)
                          └─ unlock-helper          (identify gallery on demand)
                                   │ (local: host helper ⇄ daylight-fitness container)
                          [daylight-fitness container] --ws--> [backend /ws]
                                                                     │ relay
[FitnessApp in Firefox kiosk] <--ws (WebSocketService)-------------─┘
   useUnlock() / <UnlockPrompt>
```

### 1. On-box capture & verify (host)

- **Enrollment CLI** `enroll-unlock.sh <username> <finger>`:
  1. Generates a uuid.
  2. Captures the finger via libfprint (enroll), storing the template under the uuid in
     an on-box template store (e.g. `/var/lib/daylight-unlock/<uuid>.tpl`). Templates
     **never leave the box**.
  3. Appends `{ id: <uuid>, finger: <finger>, enrolled: <date> }` to that user's
     `data/users/<username>/profile.yml` → `identities.fingerprints[]`.
- **Unlock helper** (host service/script): on request, builds an **identify gallery**
  from the template files of the candidate uuids, captures one placement, and returns
  the matched uuid (or none). libfprint's identify matches one capture against many
  templates in a single placement → returns the owning uuid. Implementation likely a
  small Python `gi`/`Fprint` script or a libfprint example binary.

### 2. Transport (request/response over existing WS)

- Frontend → backend `/ws`: `{ type: 'unlock-request', requestId, lock: 'dance_party', candidateIds: [...] }`.
- Backend relays to the garage side; host helper runs identify against `candidateIds`.
- Response back the same path: `{ type: 'unlock-result', requestId, matched: bool, userId, uuid }`.
- Backend computes `candidateIds`: read `fitness.yml → locks[<lock>]` (authorized
  usernames) → resolve each user's `identities.fingerprints[].id` → that's the gallery.
  This keeps authorization policy server-side; the box only matches templates.

### 3. Data model

**`fitness.yml`** — new top-level `locks` map (lock name → authorized usernames):
```yaml
locks:
  dance_party:        [user_1, user_9]
  governance_bypass:  [user_1, user_9]
  skip_content:       [user_1, user_9]
```
*(Must also be added to the `unifyKeys` list in `FitnessApp.jsx` so the frontend config
normalizer surfaces it — same gotcha that hid `dance_party` historically.)*

**`data/users/<username>/profile.yml`** — fingerprints under `identities`:
```yaml
identities:
  fingerprints:
    - id: 3f9c1a2e-...
      finger: right-index
      enrolled: 2026-06-17
    - id: a71b0d44-...
      finger: left-thumb
      enrolled: 2026-06-17
```

### 4. Frontend integration

- **`useUnlock()` hook**: `requestUnlock(lockName)` → sends WS request, returns a promise
  resolving `{ matched, userId }`. Drives a shared `<UnlockPrompt>` overlay.
- **`<UnlockPrompt>` overlay**: "Place finger to unlock", live state
  (idle → scanning → matched/denied), cancel button, ~10s timeout auto-dismiss.
- **No persisted unlocked state** (per-action decision) — each affordance below opens a
  fresh prompt every time.

#### Integration point A — Dance Party menu item (headline acceptance test)
Render the menu item with a lock badge; `onPointerDown` calls `requestUnlock('dance_party')`
instead of launching. On `matched` → launch Dance Party.

#### Integration point B — `FitnessShow.jsx` (governed shows / sequential locks)
- The existing informational `🔒` `governed-lock-icon` (lines ~1151–1160) becomes (or gains
  an adjacent) **interactive unlock button**. When `isGovernedShow`, tapping it →
  `requestUnlock('governance_bypass')` → on match, allow play of the show's episodes
  (bypass the governance gate for this play, via the same runtime path `nogovern` uses).
- Sequentially-locked episodes (`lockedEpisodeIds`, line ~1843; inert cards at ~1233/1272):
  give the locked episode/card a small **unlock affordance** → `requestUnlock('skip_content')`
  → on match, treat that card as unlocked for this tap and run `handlePlayEpisode`.
- Manage the unlock→play sequence in `FitnessShow` so a denied/cancelled scan leaves the
  card locked (no play).

#### Integration point C — `GovernanceStateOverlay.jsx` (video locked during playback)
- Add a **"Skip / Unlock" button** to `GovernancePanelOverlay` (the locked panel). It is the
  only interactive control in that overlay today, so it needs a new `onUnlock` prop.
- Wire `onUnlock` from `FitnessPlayer` (owns governance state + the `nogovern` flag).
  Tapping → `requestUnlock('governance_bypass')` (or `'skip_content'` for force-advance) →
  on match, `FitnessPlayer` releases the lock / advances the queue. `FitnessPlayer` owns the
  unlock→bypass sequence; the overlay only signals intent and reflects scanning state.
- Keep the button hidden/disabled when no lock is active.

## Logging (framework, not raw console)

`unlock.requested {lock}`, `unlock.scanning`, `unlock.granted {lock,userId}`,
`unlock.denied {lock}`, `unlock.timeout {lock}`. Component child logger
`{ component: 'unlock' }`.

## Testing

- **On-box**: `fprintd-enroll` smoke once plugged in; enroll-then-identify round trip for
  a known uuid returns that uuid; unknown finger returns no match.
- **Backend**: unit-test `candidateIds` resolution from `fitness.yml` + profiles.
- **Frontend**: `useUnlock` resolves on `unlock-result`; `<UnlockPrompt>` state machine;
  Dance Party menu item opens prompt on tap and launches only on `matched`. Use
  `test-user`, never a real household identifier (PII).

## Open / follow-ups

- Host helper as **systemd --user** vs container install (recommended: host) — confirm.
- WS relay vs HTTP endpoint (recommended: WS relay) — confirm.
- udev rule for `05ba:000a` so the reader is accessible without root (mirror the existing
  `99-ant-usb.rules` pattern).
- Reader is shared with the ANT+/BLE bridge box; ensure identify captures don't fight the
  fitness sensor loop (separate USB device, should be fine).

## Out of scope (YAGNI)

- Time-windowed "unlock mode" (rejected — per-action chosen).
- Identity/sign-in via fingerprint (different feature).
- In-app enrollment UI (CLI chosen; could add later).
