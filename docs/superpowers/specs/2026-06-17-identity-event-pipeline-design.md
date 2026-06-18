# Identity Event Pipeline — Design

**Date:** 2026-06-17
**Status:** Approved (forks chosen via brainstorming)

## Goal

Replace the two competing reader consumers — the per-request `/unlock` scan and the
always-armed backend emergency detector — with a single continuous broadcaster on the
garage, a backend relay/enricher, and a frontend IdentityManager that routes events by
context. This removes reader contention *by construction* (one consumer of the reader)
and moves all "what does this scan mean" logic to the frontend.

## Why

The garage has a single physical fingerprint reader. Today two backend-driven channels
fight over it:

- **Foreground unlock**: frontend opens a modal → `POST /unlock {lock, candidates}` →
  garage identifies against candidate UUIDs → returns matched/no-match.
- **Emergency detector**: a backend loop keeps an `emergency` scan armed → on an admin
  match broadcasts `fitness.emergency.detected` → frontend runs the shutdown ceremony →
  `POST /emergency/commit` → HA garage shutdown.

When both want the reader, they collide. Observed failure (2026-06-17 22:18): the
emergency detector matched and broadcast `fitness.emergency.detected` *while a
dance_party unlock modal was open*; the contexts collided and the shutdown ceremony never
cleanly committed (no `/emergency/commit` ever reached the backend). The reader-arbiter
(commits 803eef961…160844da7) made them take turns at the reader, but the root problem is
architectural: **the backend should not decide "emergency vs unlock" — the frontend
should, from its own context.**

## Architecture (three layers)

### 1. Garage (hardware) — dumb continuous broadcaster

- A continuous scan loop owns the reader: `identify` against the **full local template
  store** (every `<uuid>.tpl`), looping forever.
- Every recognized touch → broadcast ONE event `biometric.scan`:
  - match: `{ modality: 'fingerprint', matched: true, uuid }`
  - sensed-but-unrecognized: `{ modality: 'fingerprint', matched: false }`
  - idle timeout (no touch): silently re-arm (do NOT broadcast — avoids spam).
- After a match, settle ~1.5s before re-arming so one press isn't emitted repeatedly.
- The continuous scanner is the **default reader owner**. Enroll (and any future
  on-demand capture) **preempts** it via the existing `readerArbiter` + SIGTERM
  cancellation in `fingerprint_helper.py`. After enroll/delete completes, continuous scan
  resumes. (This repurposes the Task 1–2 arbiter work: its mandate shifts from
  emergency-vs-unlock to continuous-scan-vs-enroll.)
- Keep `fitness.enroll.request` and `fitness.fingerprint.delete.request` (explicit operations).
- **Discovered during planning (deviation):** `fitness.unlock.request` cannot be removed
  *entirely* — the FingerprintManager enroll/delete admin-auth gate
  (`gateManageAccess` → `manage:<username>`) still relies on the request/response
  identify path. It survives **narrowly for manage-auth only**, routed through the
  (now generalized) `readerArbiter` as a preempting `manage` kind. The automatic /
  contextual unlock uses of it (dance_party, governance_bypass, skip_content) are
  removed and move to the continuous-broadcast + IdentityManager model.

### 2. Backend — relay + enricher + pending-detection guard

- New relay subscribes to the garage `biometric.scan` topic. On a match it maps
  `uuid → { userId, finger }` from user profiles (reuse the existing profile/candidate
  lookup). It also derives the user's **authorization facts** so the frontend stays a pure
  router and policy stays server-side (single source of truth):
  - `authz: { emergency: boolean, locks: [lockId, …] }`
- Rebroadcast `fitness.identity.detected { modality, matched, userId|null, finger|null,
  authz, at }`. On `matched:false` (or unknown uuid), broadcast with `matched:false` and
  null identity.
- Maintain a short-lived **pending emergency detection** (TTL ~30s) whenever it relays an
  `emergency`-authorized identity — exactly the guard the old detector provided — so
  `/emergency/commit`, `/emergency/abort`, `/emergency/release` keep their server-side
  "a real admin scanned recently" check. These three endpoints **consume the pending
  detection** instead of issuing their own `scanEmergency` request/response.
- **Remove**: `createEmergencyDetector` loop + its wiring in `app.mjs`; the `/unlock`
  request/response scan path; the `unlockService` foreground bracketing
  (`beginForeground`/`endForeground`) and `isForegroundActive` — there is no detector left
  to stand down.
- **Keep unchanged**: `TriggerEmergencyLockdown` (HA `script.turn_on` garage shutdown →
  persist → broadcast `fitness.emergency.locked`), `ReleaseEmergencyLockdown`, the
  lockdown state machine, and the `/emergency` GET state endpoint.

### 3. Frontend — IdentityManager (central observer/router)

- New module subscribes to `fitness.identity.detected`. Generalizes beyond fingerprints
  (modality field) to future biometrics/keys. Holds app context:
  - Active unlock modal? which lock is open?
  - Emergency phase (`normal` / `triggering` / `locked`) from `useEmergencyLockdown`.
- Routing per detection (decision uses `event.authz`, never re-derived policy):
  - **Modal open** → if `lock ∈ event.authz.locks` → resolve unlock success for that lock;
    else → "not recognized for this lock" feedback.
  - **No modal, phase=normal, `event.authz.emergency`** → start the shutdown ceremony
    (phase → triggering).
  - **phase=triggering, `event.authz.emergency`** → confirm cancel (`POST /emergency/abort`,
    which consumes the pending detection).
  - **phase=locked, `event.authz.emergency`** (press-and-hold UI) → release
    (`POST /emergency/release`, consumes pending).
  - **unknown / unauthorized** → ignore (optional subtle feedback only if a modal is open).
- `UnlockPrompt` and `EmergencyLockdownOverlay` become consumers of IdentityManager
  decisions. `useUnlock`'s `POST /unlock` request/response is removed: opening the modal
  now just registers the active lock with IdentityManager and waits for its verdict.

## Data flow

```
finger press
  → garage identify(all templates)
  → biometric.scan { uuid }                       (garage broadcasts; dumb)
  → backend enrich uuid→{userId,finger,authz}
  → fitness.identity.detected {...}               (+ stamp pending if authz.emergency)
  → frontend IdentityManager routes by context:
       modal open?         → unlock that lock (authz.locks)
       no modal + admin?   → shutdown ceremony
       triggering + admin? → confirm cancel
       locked + admin?     → release
  → [ceremony] POST /emergency/commit
  → consume pending → TriggerEmergencyLockdown → HA garage shutdown
```

## Error handling

- Garage scan-loop error → log, brief backoff, re-arm. The loop never dies.
- Enroll preempts the continuous scan (cancel in-flight identify via SIGTERM), resumes
  after.
- Backend enrichment miss (uuid in no profile) → relay `matched:false` / null identity.
- `commit`/`abort`/`release` with no valid pending → reject (`no-pending-detection`);
  frontend falls back to normal (already implemented in `useEmergencyLockdown`).
- HA call fails on commit → 500, lockdown NOT persisted (existing behavior preserved).

## Testing

- **Garage** (`node --test`): continuous loop emits on match, settles, resumes; enroll
  preempts then resumes; idle timeout re-arms silently. Reuse `readerArbiter.test.mjs`.
- **Backend** (`vitest`): relay enrichment (uuid→{userId,finger,authz}); unknown uuid →
  matched:false; admin detection stamps pending; `commit`/`abort`/`release` consume
  pending; HA-failure path unchanged.
- **Frontend** (jest/RTL): IdentityManager routing matrix — modal→unlock
  authorized/denied; no-modal+admin→triggering; triggering→abort; locked→release;
  unknown→ignore.

## Removed / repurposed / kept

- **Removed**: `emergencyDetector` loop, backend `/unlock` scan route + `scanEmergency`,
  `useUnlock` request/response (all three contextual consumers migrate to IdentityManager),
  `unlockService` foreground bracketing, dead policy modules (`unlockPolicy`,
  `emergencyPolicy`'s `resolveEmergencyCandidates`).
- **Repurposed**: `readerArbiter` + SIGTERM cancellation → generalized exec-based
  arbitration (continuous-scan ↔ enroll ↔ manage-auth).
- **Kept**: lockdown state machine, `commit → HA garage shutdown`, enroll/delete channels,
  and `unlockService` + `fitness.unlock.request` **narrowly for the manage-auth gate**
  (see Garage deviation note above).

## Scope

One cohesive feature (the identity event pipeline) spanning three layers. Single spec →
single implementation plan with tasks grouped by layer (garage → backend → frontend →
integration verify).
