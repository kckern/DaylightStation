# Notification Governance — Dedupe Ledger + Quiet Hours + Parent Admin View

**Date:** 2026-07-17
**Status:** Design approved; ready for implementation plan.
**Origin:** 2026-07-17 Life UX audit §4 (P2 #6) — "Add a notification ledger (per user + dedupe-key) checked in `NotificationService.send` — one send per key per cooldown window; plus household quiet hours." Deferred during the beautiful-and-usable merge; the client-side `PriorityList` dismiss covers only the in-app card, not the delivery pipeline.

---

## Goal

Stop the notification pipeline from re-sending the same nudge within a cooldown window (dedupe), and silence non-critical notifications during a household quiet-hours window — enforced once, app-wide, at the single `NotificationService.send()` choke point — with a parent-facing Admin page to configure it and watch what was sent vs suppressed.

## Non-goals (explicit YAGNI)

- **Defer-and-replay** during quiet hours. A non-critical notification that lands inside quiet hours is **suppressed (dropped)**, not queued for replay at window end. The dedupe ledger is the primary anti-spam mechanism; quiet hours is a secondary guard for off-schedule sends. Defer-and-replay is a documented future enhancement (would need a persisted outbound queue + a drain task).
- **Per-user quiet-hours schedules.** Quiet hours is a single household-wide window. (Per-user override is a possible future extension; the config shape leaves room but the first version is household-only.)
- **Per-user channel enable/mute UI.** Out of scope for this feature; channel routing stays as-is (`NotificationPreference.getChannelsFor`).
- **Rewriting the existing `NotificationPreference` category→channel routing.** Untouched.

## Design decisions (resolved during brainstorming)

1. **Scope:** app-wide at `NotificationService.send()` (governs all categories; any future sender inherits it).
2. **Ledger persistence:** persisted YAML store (survives container restarts, so a redeploy / the known zombie-scheduler pattern cannot re-send within a cooldown).
3. **Quiet hours:** single household-wide schedule; `critical` urgency bypasses.
4. **Admin view:** a new **SYSTEM › Notifications** page (household-level, parent-facing).

---

## Architecture

One app-wide policy check inserted into the existing shared choke point. The decision is a **pure domain function**; all I/O (ledger read/write, config load) is injected. This keeps the send/suppress logic trivially testable and the persistence swappable.

```
sender ──▶ NotificationService.send(intent)
                │
                ├─ resolve dedupeKey + username
                ├─ load config (quiet hours + cooldown)      ← configLoader (notifications.yml)
                ├─ getLastSent(username, dedupeKey)           ← YamlNotificationLedgerStore
                ├─ NotificationPolicy.evaluate(...) ──▶ {send, reason}   (PURE)
                │
                ├─ suppress ─▶ recordSuppressed(...) ─▶ return [{delivered:false, suppressed:true, reason}]
                └─ send ─────▶ (existing adapter routing) ─▶ recordSent(...) + update lastSentAt
```

### Decision flow (inside `NotificationService.send`)

Before the existing adapter-routing loop:

1. **Resolve** `dedupeKey` = `intent.dedupeKey` if set, else derived `${category}:${username||'-'}:${title}`; and `username` = `intent.metadata?.username || null`.
2. **Load** the household notification config (quiet hours + the cooldown for `intent.category`, falling back to `cooldowns.default`) and `lastSentAt = ledgerStore.getLastSent(username, dedupeKey)`.
3. **Evaluate** `NotificationPolicy.evaluate({ intent, lastSentAt, now, quietHours, cooldownMs })` → `{ send: boolean, reason: 'ok' | 'cooldown' | 'quiet_hours' }`. `now` is a single household-local `Date` (the container runs `TZ=America/Los_Angeles` per `CLAUDE.local.md`, so a plain `new Date()` is already household-local); `evaluate` uses `now.getTime()` for the cooldown math and `now`'s hour/minute for the quiet-hours check. `lastSentAt` is epoch ms.
   - **Quiet hours:** `quietHours.enabled && quietHours.isWithin(now) && intent.urgency !== 'critical'` → `{send:false, reason:'quiet_hours'}`.
   - **Cooldown:** `lastSentAt && (now.getTime() - lastSentAt) < cooldownMs` → `{send:false, reason:'cooldown'}` (applies to all urgencies, including critical).
   - Else `{send:true, reason:'ok'}`.
   - Quiet-hours check precedes cooldown (a quiet-hours suppression is reported even if it would also be within cooldown).
4. **Suppress:** `ledgerStore.recordSuppressed(username, dedupeKey, reason, now)`; return `[{ delivered:false, suppressed:true, reason, channel:null }]` without routing.
5. **Send:** run the existing adapter-routing loop; then `ledgerStore.recordSent(username, dedupeKey, now)` (updates `lastSentAt`) and append a sent event. Return the adapter results as today (plus the recorded event feeds the ledger view).

**Degrade-open:** any throw from `configLoader` or `ledgerStore` is caught, logged (`warn`), and treated as `{send:true}` — a governance bug must never block a real notification.

---

## Components

### Domain (pure, no I/O)

**`backend/src/2_domains/notification/services/NotificationPolicy.mjs`**
- `evaluate({ intent, lastSentAt, now, quietHours, cooldownMs }) → { send: boolean, reason: string }`. Pure. No clock read inside — `now` is passed in.

**`backend/src/2_domains/notification/value-objects/QuietHours.mjs`**
- Constructed from `{ enabled, start, end }` where `start`/`end` are `"HH:MM"` household-local.
- `isWithin(localDate) → boolean`, correctly handling overnight windows (e.g. `21:00`→`07:00` spans midnight) and the degenerate `start === end`.
- Timezone: household-local. `now` reaches `evaluate` already as the household-local `Date`; `QuietHours` compares its minutes-of-day. (Household timezone comes from the same config source the rest of lifeplan uses.)

### Persistence (adapter)

**`backend/src/1_adapters/persistence/yaml/YamlNotificationLedgerStore.mjs`**
- `getLastSent(username, dedupeKey) → number | null` (epoch ms).
- `recordSent(username, dedupeKey, atMs)` — upsert `lastSentAt` + append a `sent` event.
- `recordSuppressed(username, dedupeKey, reason, atMs)` — append a `suppressed` event (does **not** update `lastSentAt`).
- `recentEvents(limit = 50) → Array<{ at, username, category, dedupeKey, delivered, suppressed, reason }>` (newest first).
- Backed by `data/household/state/notification-ledger.yml`:
  ```yaml
  cooldowns:                      # per (username, dedupeKey) last-sent
    "kckern|ceremony:unit_intention:2026-07-17": 1721217600000
  events:                         # bounded rolling log (cap ~200, oldest trimmed)
    - { at: 1721217600000, username: kckern, category: ceremony, dedupeKey: "...", delivered: true,  suppressed: false, reason: ok }
    - { at: 1721217500000, username: kckern, category: drift,    dedupeKey: "...", delivered: false, suppressed: true,  reason: cooldown }
  ```
- The events log is bounded (trim to the newest ~200) so the file can't grow unbounded.
- Written via the container user (mount-permission gotcha); reads may use the host path. Follows the existing `Yaml*Store` patterns.

### Config

**`data/household/config/notifications.yml`** (new):
```yaml
quiet_hours:
  enabled: true
  start: "21:00"     # household-local
  end:   "07:00"
cooldowns:           # minutes per notification category
  ceremony: 1200     # 20h — at most one ceremony nudge per ~day
  drift:    1440     # 24h
  default:  60       # fallback for any other category
```
- Loaded via `configService.getHouseholdAppConfig(null, 'notifications')` (NOT `getAppConfig` — the household-accessor gotcha returns null otherwise).
- Cached at startup like other app config; the Admin PUT writes the file and triggers a reload so changes take effect without a restart.

### Wiring

**`NotificationService`** constructor gains `policy`, `ledgerStore`, `configLoader` (a `() => { quietHours, cooldowns }` reader). The send method consults them as above. If `policy`/`ledgerStore` are absent (e.g. a test that doesn't wire them), `send` behaves exactly as today (no governance) — additive and back-compatible.

**`bootstrapNotifications`** constructs `NotificationPolicy`, `YamlNotificationLedgerStore`, and the `configLoader` (reading `notifications.yml` + household timezone), and injects them into the service. Also passes the clock.

### Intent change

**`NotificationIntent`** gains an optional `dedupeKey` field (echoed in `toJSON`). Senders that have a natural key set it explicitly:
- `CeremonyScheduler` → `dedupeKey: "ceremony:${type}:${periodId}"` (already dedupes per-period via `hasRecord`; the ledger cooldown is a second, delivery-level guard).
- `CadenceCheck` agent nudges (`send_action_message`) → `dedupeKey: "cadence:${todayLocalDate}"`.
- Any sender that sets none → the derived fallback (`category:username:title`).

---

## Admin surface

### API — `backend/src/4_api/v1/routers/admin/notifications.mjs`

> Must be registered in `api.mjs`'s `routeMap` (new v1 routers are not auto-iterated — known gotcha).

- `GET  /api/v1/admin/notifications` → `{ quiet_hours, cooldowns }` (current config).
- `PUT  /api/v1/admin/notifications` → validate + write `notifications.yml` + reload. Body: `{ quiet_hours: {enabled, start, end}, cooldowns: {<category>: minutes} }`. Validation: `start`/`end` match `^\d{2}:\d{2}$` with valid H/M; cooldown values are non-negative integers.
- `GET  /api/v1/admin/notifications/ledger?limit=50` → `{ events: [...] }` from `ledgerStore.recentEvents(limit)`.

### Frontend — `frontend/src/modules/Admin/Notifications/`

- **Nav:** add `{ label: 'Notifications', icon: IconBell, to: '/admin/system/notifications' }` to the SYSTEM section in `AdminNav.jsx`; route in the Admin router.
- **`NotificationsIndex.jsx`** (parent-facing), three cards, matching existing Admin styling/patterns:
  1. **Quiet hours** — enable Switch + `start`/`end` time inputs; Save (PUT).
  2. **Cooldowns** — editable table (category → minutes), including `default`; add-row for a new category; Save (PUT).
  3. **Recent activity** (live ledger) — table of `recentEvents` (time · user · category · delivered/suppressed + reason), a manual Refresh, and a legend. Read-only.
- Errors surface via the Admin app's existing notification/alert pattern; saves confirm success.

---

## Error handling

- **Ledger or config I/O failure** → caught in `NotificationService.send`, logged `warn` (`notification.governance.degraded`), treated as send-allowed. Never blocks delivery.
- **Missing `notifications.yml`** → defaults: quiet hours disabled, `cooldowns.default = 60`.
- **Malformed config values** (bad time, non-integer cooldown) → the loader ignores the bad field and uses the default for it; the Admin PUT rejects invalid input up front with a 400.
- **Ledger file growth** → events log trimmed to the newest ~200 on every write.

---

## Testing

- **Domain unit** (`tests/isolated/domain/notification/`):
  - `QuietHours.isWithin` — same-day window, overnight window (21:00→07:00, assert 23:00 in / 12:00 out), `enabled:false` always out, degenerate `start===end`.
  - `NotificationPolicy.evaluate` — sends when no lastSent & outside quiet hours; suppresses within cooldown; suppresses non-critical in quiet hours; `critical` bypasses quiet hours but still respects cooldown; quiet-hours reason wins over cooldown.
- **Adapter unit** (`tests/isolated/adapters/`): `YamlNotificationLedgerStore` round-trip (recordSent → getLastSent), recordSuppressed does not move lastSentAt, `recentEvents` newest-first + bounded trim.
- **Integration** (`tests/isolated/` or `tests/integrated/notification/`): `NotificationService.send` — a 2nd identical intent within cooldown returns `suppressed:true reason:cooldown` and does NOT hit adapters; a non-critical intent during quiet hours is suppressed; a `critical` intent during quiet hours is delivered; a throwing ledger store degrades open (delivers) and logs.
- **API** (`tests/isolated/api/routers/`): GET returns config; PUT validates (400 on bad time) + persists; ledger GET returns events.
- **Frontend** (`*.test.jsx`): `NotificationsIndex` renders config + ledger, edits + saves quiet hours (PUT called with the new values), renders suppressed vs delivered rows.

---

## File manifest

**New (backend):** `2_domains/notification/services/NotificationPolicy.mjs`, `2_domains/notification/value-objects/QuietHours.mjs`, `1_adapters/persistence/yaml/YamlNotificationLedgerStore.mjs`, `4_api/v1/routers/admin/notifications.mjs`.
**Modified (backend):** `3_applications/notification/NotificationService.mjs` (policy/ledger/config injection + decision flow), `2_domains/notification/entities/NotificationIntent.mjs` (`dedupeKey`), `5_composition/modules/notifications.mjs` (wiring), `3_applications/lifeplan/services/CeremonyScheduler.mjs` + the CadenceCheck nudge path (set `dedupeKey`), `4_api/v1/routers/api.mjs` (routeMap entry).
**New (frontend):** `modules/Admin/Notifications/NotificationsIndex.jsx` (+ test).
**Modified (frontend):** `modules/Admin/AdminNav.jsx` (SYSTEM nav item) + the Admin router.
**New (config/data):** `data/household/config/notifications.yml` (seed), `data/household/state/notification-ledger.yml` (created on first write).

---

## See also
- [2026-07-17 Life UX audit](../../_wip/audits/2026-07-17-life-app-ux-fullscale-audit.md) §4 — the origin.
- `docs/reference/life/life-domain-architecture.md` — notification stack (app/telegram/push adapters + `NotificationPreference`).
