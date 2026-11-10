# Presence Gate (admin unlock while the supervising adult is away)

While the household's supervising adult is **not home**, the garage fitness kiosk
requires an **admin fingerprint** — the existing `registerAdmin` unlock (any user
in `users.admin`, see [fingerprint-unlock.md](fingerprint-unlock.md)) — before it
will **open a show** (`FitnessShow`) or **start a video** (`FitnessPlayer`). It
stops unsupervised spam-browsing and playing. When the adult is home, nothing
changes.

The gate is **off by default**. With no `presence_gate` block, or
`enabled: false`, or no `entity`, both surfaces behave exactly as before and the
backend never queries Home Assistant.

## Config — household fitness config → `presence_gate`

```yaml
presence_gate:
  enabled: true              # off unless true
  entity: <presence entity>  # an HA binary_sensor / device_tracker / person; live config only
  cache_seconds: 30          # backend caches one HA read per window; kiosk polls at this rate (min 15s)
  gate: [play, show]         # which entries are gated while away (default both)
  unlock_minutes: 30         # how long one admin unlock keeps the kiosk open
```

The entity id lives only in the live household config — never as a code default.
`presence_gate` is one of the top-level keys `FitnessApp` folds into the nested
`fitness` config the context reads.

## Home / away

Only an explicit `on` or `home` state is **home**. Everything else is **away**:
`off`, `not_home`, `unknown`, `unavailable`, an entity HA can't return, a thrown
gateway error, no HA gateway at all, or the kiosk failing to reach the backend.
"Could not tell whether he is home" is not "he is home" — the gate fails closed.

## Backend — `GET /api/v1/fitness/presence`

`PresenceGateService` (`server/application/services/`) reads the entity through
the household `home_automation` gateway (`gateway.getState(entity)`, the same HA
gateway the device adapters use). Concurrent callers inside one cache window share
one read.

```json
{ "enabled": true, "home": false, "state": "off", "reason": null,
  "gate": ["play", "show"], "unlockMinutes": 30,
  "checkedAt": "…", "cached": true }
```

Disabled: `{ "enabled": false }`. `reason` is non-null when the sensor could not
give a usable answer (`unavailable`, `unreadable`, `error`, `no_gateway`).

## Frontend

- `hooks/usePresenceGate.js` — one page-wide store: fetches on mount of a gated
  surface, polls while any is mounted, holds the unlock grant (`unlock_minutes`).
  `decidePresenceGate` is the pure policy. Kiosk-only (`isKioskEnv()`), like the
  other fitness locks — the reader is in the garage, so a gate elsewhere could
  never be unlocked.
- `player/usePresenceGatePrompt.js` — per-entry admission. An entry (show id /
  queue item id) is **admitted** the first moment the gate doesn't require an
  unlock and stays admitted until the key changes. A blocked entry opens the
  existing `UnlockPrompt` once (lock name `presence_gate`, 30s timeout). A match
  grants the unlock; cancel/timeout goes back (show → `onBack`, player →
  `handleClose`). If the adult comes home while the prompt is up, it closes and
  the entry proceeds.
- `FitnessShow` renders none of the show's contents while blocked.
- `FitnessPlayer` treats a blocked item as a hold (`GATE_ID.PRESENCE` in the
  pause arbiter, no autoplay), alongside governance and the playback budget.
- **Leaving mid-video never interrupts it.** Only the *next* show or item is
  gated.
- `PresenceGateNotice` — the cover shown after a dismissed prompt: "Unlock"
  re-opens the prompt, "Back" leaves. Large touch targets on pointerdown, with
  Enter/Space (gamepad A) fallbacks.

## Logs (`context.component: presence-gate`)

| Event | Level | When |
|-------|-------|------|
| `fitness.presence_gate.checked` | info on change, else debug | each presence read (`home`, `state`, `reason`, `cached`) |
| `fitness.presence_gate.blocked` | info | an entry was blocked and the prompt opened (`kind`, `key`, `reason`) |
| `fitness.presence_gate.unlocked` | info | an admin unlock was granted (`userId`, `kind`, `minutes`, `until`) |
| `fitness.presence_gate.dismissed` | info | the prompt was cancelled or timed out |
| `fitness.presence_gate.sensor_unavailable` | warn | backend or kiosk could not get a usable state (also logged by the backend) |

## Source map

- `__app_modules/wellness/fitness/server/application/services/PresenceGateService.mjs` (+ test)
- `__app_modules/wellness/fitness/server/api/fitness.mjs` — `GET /presence`
- `__app_modules/wellness/fitness/server/composition/fitnessApi.mjs` — wiring
- `__app_modules/wellness/fitness/browser/hooks/usePresenceGate.js` (+ test)
- `__app_modules/wellness/fitness/browser/player/usePresenceGatePrompt.js`
- `__app_modules/wellness/fitness/browser/player/overlays/PresenceGateNotice.jsx`
- Tests: `player/FitnessPlayer.presenceGate.test.jsx`, `player/FitnessShow.presenceGate.test.jsx`
