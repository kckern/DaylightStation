# Runbook: Fingerprint Unlock — Hardware-Free Simulation

Exercise the **entire** fingerprint action-unlock chain — kiosk tap → backend
`POST /api/v1/fitness/unlock` → eventbus → garage `daylight-fitness` container → result →
UI unlock — **without** the physical DigitalPersona reader. Only the on-box *identify* step
is simulated; everything else is the real wiring.

> Design: `docs/_wip/plans/2026-06-17-fingerprint-unlock-design.md`
> Plan: `docs/_wip/plans/2026-06-17-fingerprint-unlock-plan.md` (Phase 1.5)

## Prerequisites

1. The feature is deployed (backend + frontend built; `daylight-fitness` container updated).
2. The fitness config has the `locks` map (e.g. `dance_party: [<user>]`) — see
   `data/household/config/fitness.yml`.
3. At least one authorized user has an enrolled (or simulated) fingerprint in
   `data/users/<user>/profile.yml` under `identities.fingerprints[]`. The seed entry
   `sim-kckern-0001` exists for this purpose. **Config is loaded at container/app startup —
   a newly added fingerprint needs a config reload/restart to be visible** (same rule as
   `devices.yml`).

## 1. Put the garage container into simulation mode

Set `FINGERPRINT_SIM` on the `daylight-fitness` container (see the env in the extension's
`docker-compose.yaml` on the garage box) to one of:

| Value | Behavior |
|-------|----------|
| `interactive` | Hold each unlock request pending; you resolve it from the CLI (most realistic — mimics "present a finger"). |
| `auto-match` | Immediately match (prefers a `sim-` uuid among the candidates). Good for fast/automated wiring checks. |
| `auto-deny` | Immediately reject every request. |
| _(unset)_ | Real on-box identify (requires the hardware + Task 1.4 helper). |

On the garage box, set the env and restart the container, e.g.:

```bash
ssh {env.prod_host_garage}   # the garage box that runs daylight-fitness
# edit /opt/fitness-controller/docker-compose.yaml → environment: FINGERPRINT_SIM=interactive
cd /opt/fitness-controller && docker compose up -d
```

## 2. End-to-end test recipe (interactive mode)

1. On the kiosk (garage Firefox), open the Fitness app and tap a gated control — e.g.
   **Dance Party** in the module menu. The `<UnlockPrompt>` overlay appears ("Place finger
   to unlock"). The request is now pending in the container (the prompt waits ~15s).
2. From your workstation (or on the box), simulate the scan within that window:

   ```bash
   # success (picks the sim-/first candidate):
   ssh {env.prod_host_garage} 'node /opt/fitness-controller/simulate.mjs match'

   # success for a specific enrolled uuid:
   ssh {env.prod_host_garage} 'node /opt/fitness-controller/simulate.mjs match sim-kckern-0001'

   # rejection:
   ssh {env.prod_host_garage} 'node /opt/fitness-controller/simulate.mjs deny'

   # inspect what's pending:
   ssh {env.prod_host_garage} 'node /opt/fitness-controller/simulate.mjs pending'
   ```

   (`FP_HOST`/`FP_PORT` env override the default `127.0.0.1:3000` if needed.)
3. On `match`, the prompt flips to "Unlocked" and Dance Party launches. On `deny`, it shows
   "Not recognized" and does not launch.
4. Repeat for the other locks: open a governed show / a sequentially-locked episode
   (`governance_bypass` / `skip_content`), or the in-player governance lock overlay's
   "Skip / Unlock" button.

For a no-CLI smoke test, set `FINGERPRINT_SIM=auto-match` instead — every gated tap simply
unlocks. `auto-deny` confirms the denied path.

## 3. Verify

- The kiosk launches the gated action only after a `match`.
- Backend logs show `fitness.unlock.request` / `fitness.unlock.result`; the frontend session
  log shows `unlock.requested` → `unlock.granted`/`unlock.denied`.
- Per-action: a second gated action prompts again (no lingering unlocked state).

## 4. Flip back to real hardware

Once the reader is connected and the on-box identify helper (Task 1.4) is in place:

1. **Unset `FINGERPRINT_SIM`** on the container and restart it. The unlock handler falls
   through to the real `libfprint` identify path.
2. Optionally remove the `sim-…` entry from the test user's `profile.yml` (or leave it — a
   `sim-` uuid never matches a real capture).

## Troubleshooting

- `simulate.mjs` reports a failed request / `no-pending-request`: no request is currently
  pending (the prompt timed out, or the container isn't in `interactive` mode), or the
  container is down. Check `simulate.mjs pending` and the container's `/status`.
- Prompt never appears on tap: the lock isn't configured/loaded — confirm `locks.<name>` in
  `fitness.yml` and that the config was reloaded; confirm the authorized user has a
  fingerprint entry and the config was reloaded since it was added.
- Match resolves but nothing unlocks: confirm the matched `userId` is in the lock's
  authorized list (the backend resolves candidates only for authorized users).
