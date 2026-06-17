# Fingerprint Unlock (Authorized-User Action Locks) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or
> superpowers:subagent-driven-development) to implement this plan task-by-task.

**Goal:** Gate selected FitnessApp actions (open Dance Party, bypass governance lock,
skip/force-advance content) behind a fingerprint scan from an authorized user, using a
DigitalPersona U.are.U 4500 on the garage box.

**Architecture:** A host-side fingerprint helper on the garage box (libfprint, where the
reader + `fprintd` live) enrolls prints (uuid per finger, stored in each user's
`profile.yml`) and, on demand, **identifies** one finger-placement against a gallery of
authorized users' templates. The browser requests an unlock over a same-origin HTTPS
endpoint (`POST /api/v1/fitness/unlock`); the backend resolves the lock's authorized
users → their fingerprint uuids from config, relays the request to the garage over the
**existing backend↔garage WebSocket** (correlation id + timeout), and returns the match
result. The frontend exposes `useUnlock()` + a shared `<UnlockPrompt>` overlay; per-action
(no persisted unlocked state). Vocabulary is abstract — "lock/unlock/authorized-user",
never "parent".

**Tech Stack:** libfprint 1.94 (`uru4000` driver, confirmed present) + fprintd on Linux
Mint garage host; Python `gi`/`FPrint` (or C helper) for identify; Node `ws` in the
`daylight-fitness` container; Express (backend `4_api/v1/routers/fitness.mjs`) + the
WebSocket eventbus (`backend/src/0_system/eventbus/`); React + `WebSocketService` +
Mantine on the frontend; YAML config in the Dropbox data tree.

**Design doc:** `docs/_wip/plans/2026-06-17-fingerprint-unlock-design.md`

---

## Conventions & Guardrails (read once)

- **Logging:** Frontend MUST use the logging framework (`getLogger().child(...)`), never raw
  console. Events: `unlock.requested|scanning|granted|denied|timeout`.
- **No PII in tests:** use `test-user`, never `kckern`/real household identifiers.
- **Naming:** no `parent*`/`Parent*`. Use `unlock`/`lock`/`authorizedUsers`.
- **Don't commit automatically** unless a step says to — but this plan uses frequent
  per-task commits, which is the agreed exception for this branch.
- **Don't deploy** (`deploy.sh`) automatically — Phase 6 deploy steps are run by KC.
- **Worktree:** all repo work happens in `DaylightStation-fingerprint-unlock`
  (branch `feature/fingerprint-unlock`).
- **Data tree (NOT in repo):** `fitness.yml` and `profile.yml` live under the Dropbox
  data path: `data/household/config/fitness.yml`,
  `data/users/<username>/profile.yml`. Edits there are config, not code.
- **Run frontend tests:** `npx vitest run <path>` (check `package.json` for the exact
  runner; the repo uses vitest-style `*.test.js(x)`). **Backend tests:**
  `node --test backend/src/.../X.test.mjs`. **On-box helper tests:**
  `node --test _extensions/fingerprint/test/*.test.mjs`.

---

## Phase 0 — Hardware bring-up & identify capability spike (MANUAL, KC-driven, BLOCKING for Phases 1 & 6)

> These need the physical reader on the garage box and SSH (`ssh garage`, lands as root).
> Phases 2–5 (software) do NOT depend on this and can proceed in parallel with mocks.

### Task 0.1: Plug in the reader and confirm enumeration
- KC plugs the U.are.U 4500 into the garage box.
- Run: `ssh garage 'lsusb | grep -i 05ba'`
- Expected: a line containing `05ba:000a` (DigitalPersona). If absent, try a different USB
  port / hub and re-check.

### Task 0.2: udev rule for non-root access
- Mirror the existing ANT pattern (`_extensions/fitness/deploy.sh`).
- Run:
  ```bash
  ssh garage 'cat > /etc/udev/rules.d/99-fingerprint.rules << "EOF"
  # DigitalPersona U.are.U 4500 — allow plugdev access for libfprint
  SUBSYSTEM=="usb", ATTR{idVendor}=="05ba", ATTR{idProduct}=="000a", MODE="0666", GROUP="plugdev"
  EOF
  udevadm control --reload-rules && udevadm trigger --subsystem-match=usb'
  ```

### Task 0.3: Confirm libfprint actually captures (driver works, not just present)
- Run: `ssh garage 'fprintd-enroll -f right-index test-user'` and place a finger when prompted.
- Expected: "Enroll result: enroll-completed" (or repeated stage prompts then completed).
- If it reports "no devices available" with the device plugged in → the driver isn't
  binding; STOP and investigate (driver/permissions) before proceeding.
- Cleanup: `ssh garage 'fprintd-delete test-user'`.

### Task 0.4: Identify-mechanism spike (decides Phase 1 implementation)
- Goal: find a way to run libfprint **identify** (1 capture vs. a gallery of N templates).
- Check, in order, and document which is available:
  1. python-gi FPrint typelib:
     `ssh garage 'python3 -c "import gi; gi.require_version(\"FPrint\",\"2.0\"); from gi.repository import FPrint; print(FPrint)"'`
     — if this prints a module, **use the Python identify helper** (preferred).
  2. else install it: `ssh garage 'apt-get install -y python3-gi gir1.2-fprint-2.0'` and re-check.
  3. else `libfprint-2-dev` + a small C helper compiled on the box (`fp_device_identify`).
- **Fallback (document if 1–3 all fail):** iterate `fprintd-verify` per authorized user
  (multiple touches). The product chose single-touch identify; only fall back if forced,
  and `log()`/note the UX regression.
- **Deliverable:** append a "Chosen identify mechanism: …" note to the design doc and
  proceed to Phase 1 accordingly.

---

## Phase 1 — On-box fingerprint helper (`_extensions/fingerprint/`) (needs Phase 0)

New extension dir. Templates are stored on the box keyed by uuid; only uuids leave the box.

### Task 1.1: Scaffold the extension
**Files:**
- Create: `_extensions/fingerprint/README.md` (purpose, where it runs, how invoked)
- Create: `_extensions/fingerprint/package.json` (`{"name":"fingerprint-helper","type":"module"}` — only if the helper is Node; if Python per spike, create `requirements`/script instead)

**Step 1:** Write README describing: runs on garage HOST (not container), needs `fprintd`/
`libfprint`, template store at `/var/lib/daylight-unlock/<uuid>.tpl`, profile mapping in
`data/users/<user>/profile.yml`.

**Step 2:** Commit.
```bash
git add _extensions/fingerprint/ && git commit -m "feat(fingerprint): scaffold on-box helper extension"
```

### Task 1.2: uuid + profile-write logic (pure, unit-testable now — no hardware)
**Files:**
- Create: `_extensions/fingerprint/src/profileStore.mjs`
- Test: `_extensions/fingerprint/test/profileStore.test.mjs`

**Step 1: Failing test** — `profileStore.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert';
import { addFingerprintEntry } from '../src/profileStore.mjs';

test('addFingerprintEntry appends an entry under identities.fingerprints', () => {
  const profile = { username: 'test-user', identities: {} };
  const out = addFingerprintEntry(profile, { id: 'uuid-1', finger: 'right-index', enrolled: '2026-06-17' });
  assert.deepEqual(out.identities.fingerprints, [
    { id: 'uuid-1', finger: 'right-index', enrolled: '2026-06-17' }
  ]);
});

test('addFingerprintEntry preserves existing fingerprints and identities', () => {
  const profile = { identities: { telegram: { user_id: 'x' }, fingerprints: [{ id: 'a', finger: 'left-thumb' }] } };
  const out = addFingerprintEntry(profile, { id: 'b', finger: 'right-index', enrolled: '2026-06-17' });
  assert.equal(out.identities.fingerprints.length, 2);
  assert.equal(out.identities.telegram.user_id, 'x');
});
```
**Step 2:** `node --test _extensions/fingerprint/test/profileStore.test.mjs` → FAIL (module missing).
**Step 3: Implement** `profileStore.mjs`:
```js
// Pure helpers for reading/mutating a user profile's fingerprint list.
export function addFingerprintEntry(profile, entry) {
  const next = { ...profile, identities: { ...(profile.identities || {}) } };
  const list = Array.isArray(next.identities.fingerprints) ? [...next.identities.fingerprints] : [];
  list.push({ id: entry.id, finger: entry.finger, enrolled: entry.enrolled });
  next.identities.fingerprints = list;
  return next;
}

export function collectGalleryUuids(profilesByUser, authorizedUsernames) {
  // Returns [{ uuid, username }] for all enrolled fingers of the authorized users.
  const out = [];
  for (const username of authorizedUsernames) {
    const fps = profilesByUser[username]?.identities?.fingerprints || [];
    for (const fp of fps) if (fp?.id) out.push({ uuid: fp.id, username });
  }
  return out;
}
```
**Step 4:** Re-run test → PASS.
**Step 5:** Commit `feat(fingerprint): profile fingerprint-entry helpers`.

### Task 1.3: Enrollment CLI (needs hardware — integration)
**Files:**
- Create: `_extensions/fingerprint/enroll-unlock.sh` (or `.mjs`/`.py` per Phase 0 choice)

Behavior: `enroll-unlock <username> <finger>` →
1. generate uuid (`uuidgen` or crypto.randomUUID),
2. capture+store the template at `/var/lib/daylight-unlock/<uuid>.tpl` (libfprint enroll),
3. append `{id,finger,enrolled}` to `data/users/<username>/profile.yml` via `profileStore`
   + a YAML lib (use the repo's existing YAML approach — see how backend reads YAML),
4. print the uuid.

**Test (on box):** enroll `test-user` right-index → profile gains the entry, a `.tpl` exists.
Then identify (Task 1.4) returns that uuid. Cleanup test-user after.
**Commit:** `feat(fingerprint): enrollment CLI`.

### Task 1.4: Identify helper (needs hardware — integration; mechanism from Phase 0)
**Files:**
- Create: `_extensions/fingerprint/identify.{py|mjs|c}` per Phase 0 choice.

Behavior: `identify --uuids uuid1,uuid2,...` →
1. load those templates from `/var/lib/daylight-unlock/`,
2. capture ONE finger placement,
3. identify against the loaded gallery,
4. print JSON `{"matched":true,"uuid":"<uuid>"}` or `{"matched":false}`; non-zero exit on
   capture error; ~10s internal timeout.

**Test (on box):** enroll two test fingers (two uuids); identify with both uuids and touch
one → returns that uuid; identify with an unrelated uuid only → `matched:false`.
**Commit:** `feat(fingerprint): identify helper`.

### Task 1.5: Container ↔ host bridge for identify
The identify helper runs on the HOST; the request arrives at the `daylight-fitness`
**container** over the backend WS. Choose the lowest-friction bridge and document it:
- Preferred: helper exposes a tiny localhost HTTP endpoint on the host
  (e.g. `127.0.0.1:8770/identify?uuids=...`) via a small systemd service; the container
  (host network mode — see `docker-compose.yaml`) calls `http://127.0.0.1:8770/identify`.
- Alt: container shells to the host helper (needs host bin mounted) — messier.

**Files:**
- Create: `_extensions/fingerprint/service.{py|mjs}` (the localhost HTTP wrapper)
- Create: `_extensions/fingerprint/daylight-unlock.service` (systemd --user or system unit)

**Commit:** `feat(fingerprint): localhost identify service + systemd unit`.

---

## Phase 2 — Backend unlock endpoint + WS relay (buildable NOW, mock the garage)

### Task 2.1: Lock-policy resolution (pure, unit-test first)
**Files:**
- Create: `backend/src/3_applications/fitness/unlockPolicy.mjs`
- Test: `backend/src/3_applications/fitness/unlockPolicy.test.mjs`

**Step 1: Failing test:**
```js
import { test } from 'node:test';
import assert from 'node:assert';
import { resolveCandidateUuids } from './unlockPolicy.mjs';

const fitness = { locks: { dance_party: ['test-user', 'other-user'] } };
const profiles = {
  'test-user': { identities: { fingerprints: [{ id: 'u1' }, { id: 'u2' }] } },
  'other-user': { identities: { fingerprints: [{ id: 'u3' }] } },
  'kid': { identities: {} }
};

test('resolves uuids for authorized users of a lock', () => {
  const r = resolveCandidateUuids(fitness, profiles, 'dance_party');
  assert.deepEqual(r.map(x => x.uuid).sort(), ['u1', 'u2', 'u3']);
});
test('unknown lock → empty', () => {
  assert.deepEqual(resolveCandidateUuids(fitness, profiles, 'nope'), []);
});
```
**Step 2:** `node --test backend/src/3_applications/fitness/unlockPolicy.test.mjs` → FAIL.
**Step 3: Implement** (reuse `collectGalleryUuids` logic):
```js
export function resolveCandidateUuids(fitnessConfig, profilesByUser, lockName) {
  const authorized = fitnessConfig?.locks?.[lockName];
  if (!Array.isArray(authorized)) return [];
  const out = [];
  for (const username of authorized) {
    const fps = profilesByUser?.[username]?.identities?.fingerprints || [];
    for (const fp of fps) if (fp?.id) out.push({ uuid: fp.id, username });
  }
  return out;
}
```
**Step 4:** PASS. **Step 5:** Commit `feat(fitness): unlock lock-policy resolution`.

### Task 2.2: Garage WS relay correlation (unit-test the correlation logic)
**Files:**
- Create: `backend/src/3_applications/fitness/unlockBroker.mjs`
- Test: `backend/src/3_applications/fitness/unlockBroker.test.mjs`

Behavior: `requestUnlock({ publish, lockName, candidateUuids, timeoutMs })` →
generates a `requestId`, calls `publish('fitness.unlock.request', {requestId, lockName, candidateUuids})`,
returns a promise; `resolveResult({requestId, matched, userId})` settles it; timeout →
`{ matched: false, reason: 'timeout' }`. Inject a fake clock/timeout for the test.

**Test:** request → resolveResult with matching id resolves `{matched:true,userId}`;
mismatched id is ignored; no resolve before timeout → `{matched:false,reason:'timeout'}`.
**Commit:** `feat(fitness): unlock WS broker with correlation+timeout`.

### Task 2.3: Wire broker into the WS eventbus
**Files:**
- Modify: `backend/src/0_system/eventbus/adapters/WebSocketAdapter.mjs` (read first — route
  `fitness.unlock.request` to subscribers incl. the garage client; deliver
  `fitness.unlock.result` from the garage to the broker)
- Modify: `backend/src/0_system/eventbus/WebSocketEventBus.mjs` as needed.

**Step:** Read both files fully before editing. Subscribe the broker to
`fitness.unlock.result`. Ensure published `fitness.unlock.request` reaches connected
ws publishers (the garage). Add a focused test if the adapter has a test harness; else
verify via Task 2.4's endpoint test with a fake bus.
**Commit:** `feat(eventbus): route fitness unlock request/result frames`.

### Task 2.4: HTTP endpoint `POST /api/v1/fitness/unlock`
**Files:**
- Modify: `backend/src/4_api/v1/routers/fitness.mjs` (follow the existing router patterns;
  see `fitness.dance.test.mjs` for the test style)
- Test: `backend/src/4_api/v1/routers/fitness.unlock.test.mjs`

Endpoint reads body `{ lock }`, loads fitness config + profiles (via the same
ConfigService/data-loading the router already uses — read the file to match), calls
`resolveCandidateUuids`, then `unlockBroker.requestUnlock`, and responds
`{ matched, userId }` (or `{matched:false, reason}`). Validate `lock` is a known key;
empty candidate list → `{matched:false, reason:'no-enrolled-users'}` (don't even scan).

**Test:** mock the broker; POST with a known lock → 200 `{matched:true,userId:'test-user'}`;
unknown lock → 400; lock with no enrolled users → `{matched:false,reason:'no-enrolled-users'}`.
**Commit:** `feat(fitness): POST /unlock endpoint`.

---

## Phase 3 — Frontend unlock hook + prompt (buildable NOW, mock fetch)

### Task 3.1: `useUnlock` hook
**Files:**
- Create: `frontend/src/modules/Fitness/hooks/useUnlock.js`
- Test: `frontend/src/modules/Fitness/hooks/useUnlock.test.js`

Behavior: returns `{ requestUnlock, state, activeLock }`. `requestUnlock(lockName)` sets
state `scanning`, POSTs `/api/v1/fitness/unlock` `{lock}`, resolves to `{matched,userId}`;
on matched → state `granted`; else `denied`; network error/timeout → `denied`. Uses the
logging framework (`getLogger().child({component:'unlock'})`) for
`unlock.requested|scanning|granted|denied`.

**Test (vitest):** mock `fetch`/`DaylightAPI`; matched response resolves truthy + state
transitions; denied response → state `denied`; rejected fetch → `denied`.
**Commit:** `feat(fitness): useUnlock hook`.

### Task 3.2: `<UnlockPrompt>` overlay
**Files:**
- Create: `frontend/src/modules/Fitness/player/overlays/UnlockPrompt.jsx`
- Create: `frontend/src/modules/Fitness/player/overlays/UnlockPrompt.scss`
- Test: `frontend/src/modules/Fitness/player/overlays/UnlockPrompt.test.jsx`

Props: `{ open, state, lockLabel, onCancel }`. Renders "Place finger to unlock", reflects
`scanning|granted|denied`, a Cancel button, auto-dismiss after ~10s (timeout → onCancel).
Use Roboto Condensed (canonical font — get emphasis from color/glow/motion, no new font).

**Test:** renders prompt text when `open`; Cancel fires `onCancel`; shows denied state.
**Commit:** `feat(fitness): UnlockPrompt overlay`.

---

## Phase 4 — Wire locks into the three UI surfaces (buildable NOW)

### Task 4.1: Dance Party menu item (headline acceptance test)
**Files:**
- Modify: the Dance Party nav/menu entry. FIRST locate it — search `dance_party` /
  `DancePartyWidget` launch in `frontend/src/modules/Fitness/nav/` and `FitnessApp.jsx`
  `handleNavigate` (`module_direct`/`module`). Determine where the menu renders the
  Dance Party item.
- Test: co-located `*.test.jsx`.

Behavior: render the item with a lock badge; intercept its `onPointerDown` → open
`<UnlockPrompt>` via `useUnlock('dance_party')`; on `granted` → proceed with the original
launch (`handleNavigate('module_direct', {module_id:'dance_party'})` or equivalent). On
denied/cancel → do nothing.

**Test:** tapping the locked item opens the prompt and does NOT launch; simulating a
`granted` result triggers the launch. **Commit:** `feat(fitness): gate Dance Party menu behind unlock`.

### Task 4.2: `FitnessShow.jsx` governed-show + sequential-lock unlock
**Files:**
- Modify: `frontend/src/modules/Fitness/player/FitnessShow.jsx`
  - The informational `🔒` at lines ~1151–1160 (`isGovernedShow`) → add an interactive
    "Unlock" button beside it → `requestUnlock('governance_bypass')`; on granted, set a
    local `bypassed` state so subsequent play calls skip the gate (pass through the same
    runtime path `nogovern` uses — trace how `nogovern` reaches `FitnessPlayer`).
  - Sequentially-locked cards (`lockedEpisodeIds` ~line 1843; inert handlers ~1233/1272):
    add a small unlock affordance on a locked card → `requestUnlock('skip_content')`; on
    granted, run `handlePlayEpisode` for that card.
  - Render `<UnlockPrompt>` driven by the hook state. Denied/cancel leaves locks intact.
- Test: `FitnessShow.unlock.test.jsx` (mock `useUnlock`).

**Test:** governed show shows Unlock button; granted → play allowed; locked episode stays
inert until granted. **Commit:** `feat(fitness): unlock affordances in FitnessShow`.

### Task 4.3: `GovernanceStateOverlay.jsx` skip/bypass button + `FitnessPlayer` wiring
**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/GovernanceStateOverlay.jsx`
  - Add an optional `onUnlock` prop to `GovernanceStateOverlay` and `GovernancePanelOverlay`;
    render a "Skip / Unlock" button in the locked panel (`GovernancePanelOverlay`,
    around the header ~line 410) only when a lock is active. Tapping calls `onUnlock`.
  - Add PropTypes for `onUnlock`.
- Modify: `FitnessPlayer.jsx` (owns governance + `nogovern`) — FIRST locate where it
  renders `GovernanceStateOverlay`. Pass `onUnlock={() => requestUnlock('governance_bypass').then(r => r.matched && releaseGovernanceLock())}`.
  Wire `releaseGovernanceLock`/force-advance to the same mechanism `nogovern` triggers.
  Render `<UnlockPrompt>` from the player.
- Test: `GovernanceStateOverlay.unlock.test.jsx`.

**Test:** when locked + `onUnlock` provided, the button renders and fires `onUnlock`; hidden
when no lock active. **Commit:** `feat(fitness): unlock/skip button in governance overlay`.

---

## Phase 5 — Config & data model (config edits, not code)

### Task 5.1: Add `locks` to fitness config + frontend normalizer
**Files:**
- Modify (data tree): `data/household/config/fitness.yml` — add:
  ```yaml
  locks:
    dance_party:        [kckern, elizabeth]
    governance_bypass:  [kckern, elizabeth]
    skip_content:       [kckern, elizabeth]
  ```
- Modify (code): `frontend/src/Apps/FitnessApp.jsx` line ~989 `unifyKeys` array — add
  `'locks'` so the config normalizer surfaces it to `FitnessContext`.
- Verify the backend `/api/v1/fitness` response includes `locks` (the unlock endpoint reads
  config directly, but the frontend needs `locks` to know which menu items to badge).

**Test:** add an assertion in an existing fitness config test (or the dance test) that
`locks` survives normalization. **Commit:** `feat(fitness): locks config + unifyKeys`.

### Task 5.2: Document the `profile.yml` fingerprint schema
**Files:**
- Modify: `docs/reference/...` (find the profile/user-data reference doc; if none, add a
  short section to the design doc) documenting `identities.fingerprints[] = {id,finger,enrolled}`.
- No real prints committed; example uses `test-user` placeholders.
**Commit:** `docs(fitness): document profile fingerprint schema`.

---

## Phase 6 — End-to-end on hardware + deploy (MANUAL, KC-driven; needs Phases 1–5)

### Task 6.1: Enroll real authorized users
- `ssh garage` → run `enroll-unlock kckern right-index`, etc. Confirm uuids land in each
  `profile.yml` (Dropbox tree). Enroll a couple of fingers each (thumb+index).

### Task 6.2: Deploy
- On-box helper/systemd: install per Task 1.5 unit. Container: rebuild/redeploy
  `daylight-fitness` if its WS message handling changed (`_extensions/fitness/deploy.sh`).
  Backend + frontend: KC runs the normal deploy.
- **KC runs `deploy.sh` manually** — do NOT auto-deploy.

### Task 6.3: Live acceptance test
- On the garage Firefox kiosk: tap Dance Party in the menu → `<UnlockPrompt>` appears →
  touch an enrolled finger → Dance Party launches. Touch an UNenrolled finger → denied,
  no launch. Repeat for governance-bypass (in a governed show / locked video) and
  skip_content. Confirm `unlock.*` events appear in the session log.
- Verify per-action: a second gated action prompts again (no lingering unlocked state).

---

## Risk register
- **Identify mechanism (Phase 0.4):** highest risk. If python-gi/C identify is infeasible,
  fall back to iterate-verify (multi-touch) and note the UX cost.
- **Backend↔garage WS routing (Task 2.3):** the eventbus may need a small change to deliver
  request frames to the garage publisher; read the adapter before assuming pub/sub fan-out.
- **`nogovern` reuse (Tasks 4.2/4.3):** trace the existing bypass path rather than inventing
  a new one — reuse it so behavior matches the URL-param escape hatch.
- **Container has no fprintd:** identify runs on the host; the container only relays
  (Task 1.5 bridge).
```
