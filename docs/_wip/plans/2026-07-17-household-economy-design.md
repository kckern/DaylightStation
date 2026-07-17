# Household Currency Economy — Design

**Date:** 2026-07-17
**Status:** Phase 1 implemented on `feature/household-economy` (2026-07-17), live-smoked, awaiting on-kiosk verification + merge
**Related:** `docs/reference/piano/README.md`, `frontend/src/modules/Emulator/`, `frontend/src/screen-framework/`

---

## Purpose

A household currency that kids earn (parent deposits, or automatically by completing
activities like piano lessons) and spend (in-system consumption like arcade play and
TV time, or parent-assisted cash-out for real money — ice cream truck, etc.).

**Intent:** motivation and behavior shaping first; mostly a closed play economy
(earn → spend on screen time, self-regulating); cash-out is a real but secondary
escape hatch. Because coins can become real dollars, accounting must be accurate
and auditable even though most of the UX is playful.

## Currency model

- The household currency is called **"coins"** (decided 2026-07-17). It owns the
  plain name in config, code, and kid-facing UI.
- **Fitness zone earnings are a separate currency**, native to the Fitness domain
  (earned from HR zones via `TreasureBox`). They get the qualified name —
  **"fitness coins"** / `fitness-coins` in config — and do NOT automatically
  become household coins. Existing fitness code keeps its internal `coins`
  vocabulary; the qualification only matters at the economy boundary.
- An optional **exchange** bridges them at a parent-configured rate
  (e.g. 10 fitness coins → 1 coin) as an explicit, opt-in transaction — never
  automatic spillover.

## Source of truth: append-only ledger

The backend is the single source of truth. Balances are never stored as a mutable
number; they are **derived by folding an immutable transaction log**. This gives a
tamper-evident audit trail (required for cash-out) and makes every credit traceable
to its source (which lesson, which arcade session).

**Files** (follows the piano date-segmented history precedent):

```
data/users/{userId}/apps/economy/ledger/{YYYY-MM-DD}.yml   # append-only transactions
data/users/{userId}/apps/economy/wallet.yml                # cached balance snapshot (reconcilable)
data/household/config/economy.yml                          # policy catalog (parent control panel)
```

Apps never touch balances directly — they call use cases:
`GetBalance`, `EarnFromActivity`, `SpendCoins`, `DepositCoins`, `CashOut`, `Exchange`.

## Transaction types

1. **Discrete** — one atomic ledger entry. Parent deposit, piano lesson reward,
   cash-out. Simple `±N` append.

2. **Metered / streaming** — arcade play, TV watching. Credits drain continuously
   as the timer runs. Uses **hold-and-settle** (bar-tab pattern):
   - On start: open a spend session, place a *hold* on the wallet (optimistic
     decrement — prevents double-spend elsewhere).
   - Frontend meters locally (the existing `createCreditAccumulator` /
     `EmulatorSession` poll loop), showing "N min of play left" = balance ÷ rate.
   - Every ~60s and on stop, the session **settles**: one ledger entry for actual
     consumption, hold released. A 25-minute session ≈ 1 ledger entry, not 1,500.
   - Counter hits zero → depleted state fires ("Out of credit — earn more!"),
     emulator pauses (seam already exists in `EmulatorSession.js`).
   - Crash/power-loss mid-session costs at most the un-settled tail (bounded by
     the settle interval); never the whole balance, never free play. Backend
     reconciles held-but-never-settled sessions on next read.

3. **Exchange** — paired debit+credit across the fitness and economy ledgers at
   the configured rate.

## Policy catalog (`economy.yml`)

Every earnable/spendable is an entry with parent-defined rules. Sketch:

```yaml
currency: { name: "coins", cashout_rate: 0.10 }   # 1 coin = $0.10

exchanges:
  - { from: fitness-coins, to: coins, rate: 0.1, self_serve: true }

earn:
  piano-lesson-complete:
    reward: 5
    per: completion
    daily_cap: 20
  piano-practice-qualified:
    reward: 1
    cooldown_min: 10

spend:
  arcade-play:
    cost: 2
    per: 10min            # metered drain rate
    self_serve: true
    auth: pin
    blackout: ["22:00-07:00"]
  tv-watch:
    cost: 3
    per: 20min
    self_serve: true
    auth: pin
  icecream-cashout:
    category: cashout
    auth: parent-mobile

users:                     # per-kid overrides, most-specific-wins
  jimmy:
    arcade-play:
      blackout: ["22:00-07:00", "15:00-17:00"]   # + homework hours
      daily_cap: 6
    tv-watch:
      self_serve: false
  susie:
    icecream-cashout:
      auth: pin            # earned autonomy
```

**Resolution:** `resolvePolicy(userId, action)` merges household default ← per-kid
override; every field is overridable (blackout, caps, cost, reward, self_serve,
auth). Overrides live household-scoped in `economy.yml` (one place for parents to
see the whole policy), resolved per-kid at call time. Precedent: per-user kid zone
overrides in `UserManager`.

- `blackout` windows block *opening* new metered sessions.
- Use cases enforce policy; apps only declare "user X wants action Y."

## Identity & authorization

Two distinct concepts:

- **Attribution** (*who is this for*) — ambient, low-stakes. Avatar-tap /
  "who is playing." Sufficient for **earning**.
- **Authorization** (*proof this person approved this spend*) — per-action,
  declared in policy as `auth:`. `SpendCoins` refuses to commit until satisfied.

Pluggable authenticators:

| Method | How | Fits |
|---|---|---|
| `trust` | active avatar (ambient) | earning; tiny self-serve spends |
| `pin` | kid's personal PIN at kiosk | most self-serve spends |
| `nfc` | scan personal token (barcode/relay ESP32 rig) | frictionless shared-kiosk spend |
| `biometric` | device fingerprint | later, where hardware allows |
| `parent-mobile` | async approval on parent's phone | cash-out, big-ticket |

**Async approval** (`parent-mobile`) reuses the hold pattern: spend creates a
**pending intent** (funds held, nothing committed) → request over the existing
notification stack (Telegram/journalist bot) → approve commits to ledger;
deny/timeout voids and releases the hold. Kid sees "waiting for Mom…" →
"approved!" / "not this time."

Start with `trust` + `pin` + `parent-mobile` (software-only); `nfc`/`biometric`
slot in later as plugins without touching use cases.

## Backend architecture (DDD slots)

Template: the `gratitude` domain (smallest self-contained example).

- `backend/src/2_domains/economy/` — entities `Wallet`, `Transaction`
  (amount, kind = deposit|earn|consume|withdraw|exchange, source, timestamp,
  auth record); services `BalanceCalculator` (fold ledger → balance); invariants
  (no negative balance, holds bounded by balance).
- `backend/src/3_applications/economy/` — use cases above + policy resolver +
  metered-session manager; datastore port.
- `backend/src/1_adapters/persistence/yaml/YamlEconomyDatastore.mjs` — templates:
  `YamlFinanceDatastore.mjs`, `YamlSessionDatastore.mjs`.
- `backend/src/4_api/v1/routers/economy.mjs` — thin HTTP shell; register in
  `5_composition`.

## Integration seams (already exist)

| App | Seam | Role |
|---|---|---|
| Piano lessons | `UserVideoProgressStore.mjs` — fires when `completedAt` first stamped | discrete **earn** |
| Piano practice | `useAutoMidiHistory.js` / `autoHistory.js` `qualified()` takes | discrete **earn** (cooldown-limited) |
| Emulator arcade | `fitnessGameGate.js` (currently `createOpenGate()` stub), `session.coins` placeholder in `EmulatorConsole.jsx`, `createCreditAccumulator` in `GovernanceGate.js` | metered **spend** |
| screen-framework TV | new coin-governance mode alongside the HR `GovernanceEngine` (`governedContent.js` label pattern) | metered **spend** (Phase 2) |
| Fitness coins | `TreasureBox.js` totals | **exchange** source (Phase 3) |

## Phases

**Phase 1 — the loop, end to end (MVP).** One earn, one spend, real ledger.
- Backend economy domain (ledger, wallet, policy resolver, discrete + metered
  use cases, API router).
- Earn: piano **lesson-complete** hook (completion rule already exists).
- Spend: **Emulator metered drain** (replace open gate + `session.coins` stub
  with wallet-backed credit session).
- Auth: `trust` to earn, `pin` to spend. Parent deposit via simple admin action.
- UI: balance chip (reuse `PianoUserChip`/avatar patterns) + "N min left /
  earn more!" overlay.
- Proves: practice → earn → arcade → drain → broke → practice again.

**Phase 2 — spend breadth & cash-out.** screen-framework TV metered spend;
`cashout` category with `parent-mobile` async approval over the notification stack.

**Phase 3 — richer identity & bridges.** NFC auth, biometric, fitness↔credit
exchange, parent dashboard / ledger history view, blackout & cap polish.

**Phase 4 — YAGNI-gated extras.** Allowance automation, interest, savings goals,
leaderboards. Build only on demonstrated demand.

## Known assumptions to verify

- **Piano earn hook rides on `/log` userId contract.** The lesson-complete earn
  fires from `POST /api/play/log` whenever `UserVideoProgressStore.record()`
  first stamps `completedAt` for a `userId`-attributed play. This assumes `/log`
  receives a `userId` only from the piano kiosk (the same condition the
  pre-existing piano progress write already depends on). If any non-piano surface
  ever logs playback with a `userId`, its completion would mis-fire a
  `piano-lesson-complete` earn. Bounded by the daily cap + per-ref dedup, but
  live-verify that only piano lessons pay out. If the contract ever loosens, add
  a play-`type`/collection guard around the earn.

## Known Phase-1 limitations (fix when economy is enabled on-kiosk)

- **Load-saver remount can race session open vs. close (economy-on only, money-safe).**
  In `EmulatorGameWidget`, loading a save game rebuilds the gate, so the lifecycle
  effect fires `stop()` (close session A) then `start()` (open session B) as two
  unordered fire-and-forget HTTP calls. If B's `openSession` lands before A's
  `close` commits, the single-session guard rejects B and the console shows a
  spurious depleted/blocked state on a funded wallet. **No accounting impact** —
  A still settles correctly and it self-heals on the next fresh launch. Fix when
  the load-saver flow is exercised with economy on: either await the close before
  reopening, or have `openSession` reclaim an existing same-user+same-action
  session instead of rejecting (do NOT weaken the guard for a different action —
  that's the double-spend protection).

## Open items

- PIN storage/verification mechanism (likely per-user auth file alongside
  `data/users/{u}/auth/`). MVP note: no PIN infrastructure exists anywhere in the
  repo, but the Fitness `IdentityProvider` (scan/fingerprint `registerIdentify`
  ceremony, already consumed by `EmulatorGameWidget`) is a working per-user
  verification surface — Phase 1 uses it as the spend authorizer (`auth: identify`)
  and defers PIN to Phase 2/3.
- Blackout window vocabulary (`school-hours` etc.) — named windows vs raw ranges.
- Whether parent deposit UI lives in existing admin surface or a new panel.
