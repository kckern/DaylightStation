# Household Coin Economy — Reference

**Status:** Phase 1 implemented on `feature/household-economy` (2026-07-17).
**Design & plan:** `docs/_wip/plans/2026-07-17-household-economy-design.md`, `…-implementation.md`.

Kids earn a household currency — **coins** — by completing piano lessons (or via
parent deposits) and spend it as a metered drain playing the Fitness arcade
(EmulatorGame). Coins are convertible to real money (cash-out, Phase 2), so the
ledger is append-only and auditable.

> **"coins" vs "fitness coins":** the household currency is `coins`. The Fitness
> HR-zone earnings are a *separate* currency ("fitness coins") that does not
> auto-convert. An explicit exchange bridges them (Phase 3, not yet wired).

## Currency model & source of truth

The backend is the single source of truth. Balance is **derived by folding an
append-only transaction ledger** — never stored as a mutable number. `wallet.yml`
is a rebuildable cache re-derived on every mutation.

### Data layout (under `data/users/{userId}/apps/economy/`)

```
ledger/{YYYY-MM-DD}.yml   # append-only transactions, sharded by txn date
wallet.yml               # { balance, as_of, session } — cache, reconcilable from ledger
```

Household policy lives at `data/household/config/economy.yml` (auto-loaded as the
`economy` household app config).

### Transaction shape

```yaml
- id: txn_ab12cd34ef
  at: "2026-07-17T20:15:00.000Z"
  kind: earn            # deposit | earn | spend | withdraw | adjust
  delta: 5              # signed integer; sign must match kind
  action: piano-lesson-complete
  source: piano
  ref: "plex:12345"     # traceability handle (dedup key for earns)
```

## Transaction types

- **Discrete** — one atomic entry: parent deposit, piano lesson reward.
- **Metered** — arcade play. Uses **hold-and-settle**: `openSession` places a
  hold (one open session per user = the double-spend guard); the client meters
  locally and `settleSession` charges consumed coins periodically; `closeSession`
  settles the tail and clears the session. A ~25-min run is a handful of ledger
  entries, and a crash costs at most the un-settled tail.
  - **Settle is a cumulative high-water-mark:** the client sends the *total* coins
    consumed since the session opened (monotonic), and the server charges only
    newly-crossed whole coins. This makes settles idempotent (safe to retry) and
    immune to sub-coin flushing.
- **Exchange** — fitness coins ↔ coins (Phase 3, not built).

## Policy catalog (`economy.yml`)

Every earnable/spendable is an entry with parent rules; `users:` holds per-kid
overrides (most-specific-wins). See the committed example
`data/household/config/economy.yml` for the full annotated schema. Key fields:

- earn: `reward`, `per`, `daily_cap` (per UTC day)
- spend: `cost` + `per` (→ drain rate), `self_serve`, `auth`, `blackout` (local-time windows)

**Config is cached at backend startup** — edits require a dev-server restart
before they take effect.

## API (`/api/v1/economy`)

| Method / Path | Body | Returns |
|---|---|---|
| GET `/users/:userId/wallet` | — | `{ userId, balance, session }` |
| POST `/users/:userId/deposit` | `{ amount, note? }` | `{ userId, balance }` |
| POST `/users/:userId/earn` | `{ action, source, ref? }` | `{ userId, earned, capped, duplicate, balance }` |
| POST `/users/:userId/sessions` | `{ action, source }` | `{ userId, sessionId, balance, drainPerSecond }` |
| POST `/users/:userId/sessions/:sessionId/settle` | `{ coins }` (cumulative) | `{ userId, balance, depleted }` |
| POST `/users/:userId/sessions/:sessionId/close` | `{ coins? }` (cumulative) | `{ userId, balance }` |

Domain errors map to HTTP: `ValidationError` → 400 (bad amount, blackout, no
balance, existing session), `EntityNotFoundError` → 404 (unknown user).

## Integration points

- **Earn (piano):** `POST /api/play/log` fires `economyService.earn(...,
  { action: 'piano-lesson-complete', ref: 'plex:{id}' })` fire-and-forget the
  first time `UserVideoProgressStore` stamps `completedAt`. An economy failure
  never breaks progress recording. (Assumes `/log` `userId` is piano-kiosk-only —
  see the design doc's "Known assumptions".)
- **Spend (arcade):** `frontend/.../EmulatorGame/coinMeteredGate.js` opens a spend
  session and drains coins as the timer runs, surfacing the balance in the
  EmulatorConsole overlay (`session.coins`) and its `depleted` state
  ("Out of coins — earn more!"). Off by default — enabled per-widget via
  `config.economy.enabled`.

## Backend architecture (DDD)

- `2_domains/economy/` — `Transaction` (factory + `foldBalance`), `policy`
  (`resolvePolicy`/`inBlackout`/`drainPerSecond`). Pure, no I/O.
- `3_applications/economy/EconomyService.mjs` — all balance math + policy
  enforcement (deposit/earn/openSession/settleSession/closeSession/getBalance).
- `1_adapters/persistence/yaml/YamlEconomyDatastore.mjs` — dumb ledger/wallet
  storage.
- `4_api/v1/routers/economy.mjs` + `5_composition/modules/economyApi.mjs` —
  thin HTTP shell; registered in `app.mjs` (`v1Routers.economy`) and the
  `api.mjs` routeMap (`'/economy': 'economy'`).

## Not yet built (later phases)

TV/screen-framework metered spend, cash-out + parent-mobile approval, PIN/NFC/
biometric auth, fitness↔coins exchange, parent dashboard, deposit admin UI
(Phase 1 deposits are API-only).
