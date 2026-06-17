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
- On-box: `_extensions/fitness/` (container WS handler + `unlockSim.mjs` + `simulate.mjs`); `_extensions/fingerprint/` (host enroll/identify helper).
- Design/plan: `docs/_wip/plans/2026-06-17-fingerprint-unlock-{design,plan}.md`.
