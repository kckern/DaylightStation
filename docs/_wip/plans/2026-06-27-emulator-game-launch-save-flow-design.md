# Emulator Game Launch & Save Flow — Design

**Date:** 2026-06-27
**Status:** Design (pre-implementation)
**Scope:** `frontend/src/modules/Emulator/`, `frontend/src/modules/Fitness/widgets/EmulatorGame/`, `frontend/src/modules/Fitness/identity/`, `backend/src/4_api/v1/routers/emulator.mjs`

---

## 1. Summary

Rework the "Video Games" arcade flow around an **admin-gated session** with **post-launch,
optional, per-user saving**. This inverts today's model (fingerprint *up front*, scanner
*becomes* the player, auto-resume). The new model:

- **Browsing is open.** Anyone opens Games and navigates consoles/covers.
- **Launching is admin-gated, once per session.** The first game launch requires an admin
  fingerprint; that unlocks the arcade until it exits or idles out. All games gate — including
  `none`-save arcade titles.
- **Games boot fresh and anonymous.** Identity is no longer required to play.
- **Saving is opt-in and post-launch.** A save-enabled game shows a transient identity surface:
  "Continue as…" avatars (users who already have a save) + a "Save my game" action. Picking a
  player fixes it for that launch and turns on **continuous autosave**. Anonymous play is fully
  ephemeral — nothing touches disk, no exit prompt.

---

## 2. Decisions (locked)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Admin gate scope | **Once per session** — admin unlocks the arcade; games launch freely until exit/idle re-lock |
| D2 | Do `none`-save games gate? | **Yes — gate everything** |
| D3 | Anonymous exit | **No prompt.** Anonymous play is ephemeral |
| D4 | Saving mechanism | **Continuous autosave** (~15s, configurable) for save-enabled games once a player is set, plus on exit |
| D5 | Claim conflict (fresh game, identify as a user who already has a save) | **Warn then overwrite** — single confirm, then autosave takes over |
| D6 | Identity surface presentation | **Transient at boot + corner re-open** (while still anonymous) |
| D7 | Hot-seat / mid-game player switch | **No — player is fixed once set per launch** |
| D8 | Battery-game autosave payload | **Both `.srm` + state snapshot.** Resume prefers the newer snapshot; `.srm` survives as the cartridge save |

---

## 3. The "current player" model

There is exactly **one current-player slot** per launch. It starts `null` (anonymous) and is set
**once** (D7). Two entry paths converge on it:

- **Load** — tap a saver's avatar → verify the scanned finger *is* that user → **restart** the
  emulator with their blob injected → player fixed.
- **Claim** ("Save my game") → identify yourself (any recognized finger) → **keep the running
  game** (no restart — restarting would discard the fresh progress being claimed) → autosave on →
  player fixed.

Once the slot is set: the identity surface disappears, the now-playing avatar shows, autosave runs
every ~15s + on exit, and the reset hotspot clears *that player's* save. Anonymous sessions never
write to disk.

---

## 4. Flow

```
Browse Games (open to all)
  └─ tap a game
       ├─ arcade unlocked this session?
       │     ├─ no → ADMIN GATE (admin finger)
       │     │         ├─ cancel → back to grid
       │     │         └─ ok → unlock arcade (until exit / idle re-lock)
       │     └─ yes → proceed
       └─ boot game FRESH + anonymous (ALL save modes)
            ├─ saveMode == none → play · no identity surface · ephemeral
            └─ saveMode == battery|state →
                 transient identity surface at boot:
                   • "Continue as…" = users WITH a save for this game
                   • "Save my game (this is me)"
                   • dismiss → keep playing anonymous (corner re-open while anonymous)
                 LOAD (tap avatar Ux):
                   identify finger →
                     • matched == Ux       → restart as Ux + inject blob → FIXED · autosave on
                     • recognized != Ux    → "That's not {Ux}" (retry / cancel)
                     • unrecognized/cancel → stay anonymous
                 CLAIM ("Save my game"):
                   identify finger → player = Uy
                     • Uy already has a save → WARN "replaces {Uy}'s save" →
                          confirm → enable autosave on CURRENT game (no restart) · FIXED
                          cancel  → stay anonymous
                     • Uy has no save → enable autosave on CURRENT game (no restart) · FIXED
                 once FIXED → autosave ~15s + on exit · reset clears player's save
```

---

## 5. Permutation matrix

| saveMode | saves exist | player path | outcome |
|---|---|---|---|
| `none` | n/a | admin → boot | Play anonymous. No identity surface, no save. Exit = nothing. |
| save-enabled | none yet | just play | Anonymous fresh. "Continue as…" empty; only "Save my game" offered. |
| save-enabled | none yet | claim | Identify → player Uy → autosave on (fresh game). |
| save-enabled | some | load Ux | Verify Ux finger → restart + inject → autosaves to Ux. |
| save-enabled | some | load cancelled / wrong finger | Stay anonymous-fresh. |
| save-enabled | some | ignore, claim as NEW user | Identify Uy (no save) → autosave on (fresh). |
| save-enabled | some | ignore, claim as EXISTING user | **Warn overwrite** → confirm → autosave overwrites their save. |

---

## 6. Save model (D8)

Save modes in the catalog stay `none | battery | state`, but the blob semantics expand:

- **`state`** — resume blob is an emulator **state snapshot**. Autosave snapshots every ~15s.
  Load injects the snapshot.
- **`battery`** — resume persists **both** a state snapshot **and** the cartridge `.srm`. Autosave
  writes both every ~15s. **Resume prefers the newer snapshot**; the `.srm` is retained as the
  authoritative cartridge save (and is what a non-snapshot-aware path would read).
- **`none`** — never persists.

Implications:
- **Enumeration** ("who has a save"): a user has a save for a battery game if a `.srm` **or** a
  snapshot exists; for a state game if a snapshot exists.
- **Load priority**: snapshot first, `.srm` fallback (battery).
- **Reset / clear**: must remove **both** blobs for battery.
- **Engine**: needs distinct capture/load for `.srm` vs snapshot (e.g. `captureBattery()`,
  `captureState()`, `loadBattery(bytes)`, `loadState(bytes)`), orchestrated per mode by the
  save client / console.

---

## 7. Component & data changes

### Frontend

- **`EmulatorGameWidget.jsx`**
  - Add `arcadeUnlocked` session state. First launch → admin gate; success unlocks the arcade.
    Re-lock on arcade exit (`onClose`) and on idle (`idleRelockMinutes`).
  - Remove the per-game up-front fingerprint. Always boot fresh + anonymous.
  - Host the post-launch identity surface (new `PlayerSelect` overlay) for save-enabled games.
  - Fetch the savers list (new API) to populate "Continue as…".
  - **Load** path → remount `EmulatorConsole` (keyed) with identity + active persistence so the
    blob injects on boot. **Claim** path → flip the persistence prop in place (no remount) so the
    fresh progress survives, then autosave starts.
- **`core/launchModel.js`** — invert: fresh-by-default; resume only via explicit load. Launch is no
  longer gated on identity (gate is admin/session). Keep the pure load-vs-fresh decision.
- **`EmulatorConsole.jsx`**
  - Autosave-interval effect keyed on `(persist, userId, saveMode, autosaveSeconds)`; tears down on
    unmount; skips writes when the captured blob is unchanged.
  - Support persistence going **active post-mount** (claim path) without a remount — start autosave
    when `(persist && userId)` transitions true.
  - Now-playing overlay updates when a player is claimed mid-session.
- **`Fitness/identity/IdentityProvider.jsx`** — add an `adminOnly` option to `registerUnlock` that
  authorizes on `msg.authz?.admin` (the admin gate). Keep `registerIdentify` (any finger) for
  load/claim; the widget compares the returned `userId` to the tapped avatar for the load check.
- **New `PlayerSelect` overlay** (under `modules/Emulator/ui/`) — saver avatars + "Save my game"
  action + corner toggle; host-agnostic, handlers injected.

### Backend

- **New `GET /api/v1/emulator/saves/:system/:gameId`** → `{ users: [userId, …] }`. Scans
  `saves/{user}/{gameId}.srm` and `states/{user}/{gameId}/` per the game's `saveMode`
  (battery = union of both). Add an `emulatorFs` helper to enumerate user dirs; reuse `safeSegment`.
- **Save/state CRUD** already exists (`/save/...`, `/state/.../:slot`); battery "both" uses both
  endpoints per write.

### Config

Add to emulator config (e.g. `consoles.yml` top-level settings or a sibling settings block):
- `autosaveSeconds` — default **15**.
- `idleRelockMinutes` — default **10**.
- `adminGate` — on/off toggle (default **on**; off = open kiosk / dev).

---

## 8. Edge cases & notes

- **Admin ≠ player.** The admin who unlocks the arcade is not the player; player identity is set
  separately, post-launch.
- **Guests** (no enrolled finger) play anonymously; they can't load or claim. Consistent with
  fitness guest-exemption.
- **Reset hotspot**: clears the current player's save (both blobs for battery) then restarts.
  Anonymous reset = plain restart (nothing to clear).
- **Battery autosave between in-game saves**: the snapshot captures it; the `.srm` only updates when
  the game writes SRAM. Resume-prefers-snapshot means the player resumes exactly where they left
  off, while the `.srm` stays correct for cartridge-accurate behavior.
- **Dev / off-kiosk**: with `adminGate` off, the arcade is open and games still boot fresh; claim/
  load require a fingerprint device so they're effectively kiosk-only.

---

## 9. Testing

- `launchModel` specs — invert to fresh-by-default; load decision; `none` never persists.
- New `/saves/:system/:gameId` endpoint + `emulatorFs` enumeration (battery union, state-only).
- Autosave interval behavior in `EmulatorConsole` (fake timers; unchanged-blob skip; teardown).
- Claim-path persistence-activates-without-remount; load-path remount injects blob.
- `PlayerSelect` overlay (saver list, claim, corner toggle, wrong-finger message).
- Admin gate (`adminOnly` authz) in `IdentityProvider`.
- `fitnessGameGate` stays an open gate (unchanged — no governance regression).

---

## 10. Open items

None blocking. Config defaults (`autosaveSeconds=15`, `idleRelockMinutes=10`) are proposals — adjust
in the live config without code changes.
