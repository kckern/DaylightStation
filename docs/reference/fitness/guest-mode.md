# Guest Mode Reference

How non-household participants (friends and extended family) join a fitness session — either by borrowing a household member's heart rate monitor, or by bringing their own.

This document is the umbrella overview. For the deep dives:
- [`assign-guest.md`](./assign-guest.md) — borrowed-device flow, lifecycle, continuous-usage threshold, entity transfer
- [`ble-heart-rate.md`](./ble-heart-rate.md) — Apple Watch / Polar / Garmin BLE discovery and matching
- [`display-name-resolver.md`](./display-name-resolver.md) — how guest names render in the sidebar and overlay

---

## Overview

The fitness app is built around a roster of household participants (primary + secondary users defined in `fitness.yml`). Guest mode extends the roster to include people not in the household — typically visiting friends or extended family — without permanently changing config.

A guest can join in one of two ways:

| Flow | What the guest brings | Pairing mechanism | When to use |
|------|----------------------|-------------------|-------------|
| **Borrow** | Nothing | Reassign a household device to the guest via the sidebar menu | Guest has no compatible HR monitor; or fastest path |
| **Own monitor** | Their BLE HR monitor (Apple Watch, Polar, Garmin) | Best-effort BLE auto-match against pre-registered friend/family user IDs | Guest already wears a monitor during the session |

Both flows funnel into the same downstream subsystems: zone tracking, coin awards, governance evaluation, timeline recording, session persistence. Once a guest is "in the roster" their data flows identically to a household user.

---

## User Categories

Users come from `fitness.yml` (the `users:` block) and `data/household/.../users.yml` (the broader directory). The fitness sidebar tags every candidate by category when building the guest picker:

```
usersConfigRaw
├── primary[]    — Always shown in sidebar. Household head-of-list (e.g. parents, kids in the household).
├── secondary[]  — Shown only when their device is active. Lower-frequency household members.
├── family[]     — Extended family. NOT shown in sidebar by default; surfaces in the "Family" tab of the guest picker.
└── friends[]    — Friends. Surfaces in the "Friends" tab of the guest picker.
```

The sidebar's `guestCandidates` memo (`FitnessSidebar.jsx:71-141`) tags each entry with its category:

```javascript
const family  = tag(usersConfigRaw?.family,  'Family');
const friends = tag(usersConfigRaw?.friends, 'Friend');
// + primaryReturnees (displaced primaries that can reclaim a device)
// + primaryGuestPool (primaries assignable to any device as guests)
```

The combined list — plus `allowWhileAssigned` flags and de-duplication by ID — becomes `context.guestCandidates`, consumed by `FitnessSidebarMenu` in `mode='guest'`.

---

## Flow A — Borrowed Device

The guest takes someone else's heart rate strap. The sidebar menu reassigns the device to the guest's profile.

```
1. User taps a device card in FitnessSidebar
2. FitnessSidebarMenu opens with mode='guest', targetDeviceId=<device>
3. Tab selector defaults to "Friends" (auto-falls back to "Family" if empty)
4. User picks a guest from the filtered list
5. assignGuestToDevice(deviceId, { name, profileId, candidateId, source, baseUserName })
6. GuestAssignmentService validates → creates session entity → updates ledger
7. UserManager re-routes deviceId → guest user; subsequent HR data flows to guest
8. DisplayNameResolver returns guest name (priority 1) for that device's card
```

**This flow is the subject of [`assign-guest.md`](./assign-guest.md)** — see it for:
- Constraint matrix (one-user-per-device, one-device-per-user, base-user preservation)
- Continuous-usage threshold absorption (`< T`, default 5 min / 300 s) of coins, timeline, start time — symmetric across all transition types
- Entity lifecycle (creation, replacement, drop, transfer)
- `allowWhileAssigned` override for shared accounts
- State machine diagrams

---

## Flow B — Guest Brings Their Own HR Monitor

The guest wears a BLE-broadcasting HR monitor (most commonly Apple Watch in Workout mode). The backend BLE scanner discovers it and matches it to a pre-registered friend/family user ID.

```
1. Guest's user ID must be pre-registered as a BLE HR user (env BLE_HR_USERS + fitness.yml entry)
2. Guest starts a Workout on their watch (Apple Watch only broadcasts HR during workouts)
3. BLEManager scan finds an unmatched device advertising HR Service 0x180D
4. Best-effort matching:
     - If device name matches a known mapping → assign
     - If exactly one unmatched device + one unmatched expected user → auto-pair
     - Otherwise: data arrives but is not routed to a user (logged)
5. BleHeartRateDecoder parses GATT 0x2A37 packets → BPM
6. WebSocket broadcast with type:'ant', profile:'HR', deviceId:'ble_<userId>'
7. Frontend DeviceEventRouter handles identically to ANT+ HR
8. User auto-appears in the sidebar once their device becomes active
```

**This flow is the subject of [`ble-heart-rate.md`](./ble-heart-rate.md)** — see it for:
- GATT 0x2A37 packet format
- `BLE_HR_USERS` env var and fitness.yml `ble_users:` block
- Scan-based discovery (no pairing, handles MAC rotation)
- Limitations: Apple Watch requires active Workout; multi-unknown-device matching is a known gap

### Config shape for own-monitor guests

```yaml
# data/household/.../fitness.yml (or equivalent)
devices:
  heart_rate:
    "11111": user-a             # ANT+ household monitor
    ble_friend_b: friend-b      # BLE — synthetic ID, auto-matched

ble_users:
  - friend-b                    # expected to connect via BLE

# Surfaces in the Friends tab of the guest picker for borrow flow too:
friends:
  - id: friend-b
    name: Friend B
    profileId: friend-b
```

The same user ID (`friend-b`) lets the friend be reached via either flow: their watch broadcasts directly, OR they can be assigned to a household device if they forget the watch.

---

## UI Presentation

### Sidebar device card

Resolution chain when rendering the participant card for a device:

```
deviceId → getDeviceAssignment(deviceId)
        → if assignment.occupantType === 'guest' → use occupantName + profileId
        → else → use device owner (UserManager.getUserByDeviceId)
        → DisplayNameResolver applies group-label heuristics for multi-user sessions
        → Avatar: /static/img/users/{profileId} (fallback to /user)
```

Visual treatment for guests is **intentionally the same as owners** — same card layout (`.fitness-device.card-horizontal` / `.card-vertical`), same zone badge (`.device-zone-info`), same HR display. The avatar and name change; nothing else signals "this is a guest." The only guest-specific UI is the menu's "guest summary" line and the "Original" restore option that appears when a guest is active.

### Menu indicators

In `FitnessSidebarMenu` with `mode='guest'`:

| Element | Behavior |
|---------|----------|
| Top option: "Original" | Appears ONLY when a guest is currently assigned; selecting it restores `baseUserName` |
| Top option: "Guest" | Generic anonymous placeholder; `allowWhileAssigned: true` so usable on multiple devices |
| Tabs | "Friends" / "Family"; auto-switches Friends→Family if Friends pool is empty |
| Grid | Filtered candidates from current tab; users assigned elsewhere are excluded unless `allowWhileAssigned` |
| "Remove User" | Calls `suppressDeviceUntilNextReading(deviceId)` — device drops from session until next HR reading re-registers it |

---

## Downstream Effects of a Guest Assignment

When a guest is assigned (either flow), the resolved user identity propagates through every subsystem keyed by user:

| Subsystem | Effect |
|-----------|--------|
| **ZoneProfileStore** | Uses guest's zone overrides (`metadata.zones`) if present; otherwise inherits device defaults |
| **TreasureBox** | Coins accumulate against guest's profile, not device owner's |
| **GovernanceEngine** | Lock/unlock evaluates against guest's current zone; guest counts toward `min_participants` thresholds |
| **FitnessTimeline** | Series keys (`{userId}:hr`, `{userId}:zone`, `{userId}:coins`) use guest's user ID |
| **DisplayNameResolver** | `guest` priority (1) trumps `groupLabel`, `owner`, `profile`, `fallback` |
| **EventJournal** | Emits `ASSIGN_GUEST`, `GUEST_REPLACED`, `SEGMENT_ABSORBED`, `CLEAR_GUEST` events (the live events carry `thresholdMs` for diagnostic correlation) |
| **SessionDatastore** | Guest appears in `participants:` block on save; their timeline series persists alongside primaries |

This means a guest is a **full first-class participant for the duration of the session** — they earn coins, contribute to governance, get a row in the saved session YAML.

---

## Lifecycle

### Session entry

A guest enters the session at the moment of assignment (borrow flow) or first HR reading (own-monitor flow). A new session entity is created with the guest's `profileId`; the entity's `start` timestamp anchors their timeline.

### Session exit

| Trigger | Effect |
|---------|--------|
| User selects "Original" in menu | `clearGuestAssignment(deviceId)` — entity ended (`status: 'ended'`), device reverts to base user |
| Different guest assigned, previous segment ≥ T (default 5 min / 300 s) | Previous entity ended (`status: 'dropped'`), new entity created. `GUEST_REPLACED` event logged. |
| Different guest assigned, previous segment < T | Sub-threshold absorption: previous entity data (coins, timeline, start time) migrates forward to new entity. `SEGMENT_ABSORBED` event logged. Applies symmetrically to Guest↔Mapped↔Mapped transitions (W1.C / OI-3). |
| User clicks "Remove User" | `suppressDeviceUntilNextReading(deviceId)` — device temporarily dropped from active set |
| Session ends | All active guest entities finalized; `PersistenceManager` runs the W1.B backfill pass to catch OI-1 (final sub-T segment), OI-2 (cycling), and Decision §5 (late-tag Pikachu merges) that the live pass couldn't see |
| Own-monitor guest disconnects (BLE) | DeviceManager flags device stale after timeout; ActivityMonitor moves user to idle, then dropped |

T = continuous-usage threshold from `fitness.yml → governance.usage_threshold_seconds`.
See [`assign-guest.md`](./assign-guest.md) § Continuous-Usage Threshold for the full
behavioral rules and live vs save-time split.

### Cleanup

- Guest entities persist into the saved session YAML — historical analytics can attribute coins to the right person
- The `deviceAssignments` ledger is **not** persisted across sessions; each session starts with clean assignments
- BLE matchings reset between scans; the next session will re-match using the current `BLE_HR_USERS` config

---

## Configuration Quick Reference

```yaml
# fitness.yml
users:
  primary:
    - { id: user-a, name: User A, hr: 11111 }
  secondary:
    - { id: user-b, name: User B, hr: 22222 }
  family:
    - { id: family-a, name: Family A, hr: ble_family_a }
  friends:
    - { id: friend-a, name: Friend A, hr: ble_friend_a }
    - { id: friend-b, name: Friend B, hr: 33333, allowWhileAssigned: true }  # rare: shareable identity

devices:
  heart_rate:
    "11111": user-a
    "22222": user-b
    "33333": friend-b
    ble_family_a: family-a
    ble_friend_a: friend-a

ble_users:                  # subset of user IDs reachable via BLE
  - family-a
  - friend-a
```

Env (BLE only):
```bash
BLE_HR_USERS=family-a,friend-a   # comma-separated; consumed by the fitness extension
```

---

## File Reference

| File | Role |
|------|------|
| `frontend/src/modules/Fitness/player/FitnessSidebar.jsx` | Builds `guestCandidates` from `family` + `friends` + primary returnees |
| `frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.jsx` | Guest picker UI (tabs, filtering, assignment trigger) |
| `frontend/src/hooks/fitness/GuestAssignmentService.js` | Validation, grace-period logic, entity creation |
| `frontend/src/hooks/fitness/DeviceAssignmentLedger.js` | `deviceId → occupant` ledger |
| `frontend/src/hooks/fitness/UserManager.js` | Resolves `deviceId → user`; multi-device arbitration |
| `frontend/src/hooks/fitness/DisplayNameResolver.js` | Guest-priority display name resolution |
| `frontend/src/context/FitnessContext.jsx` | Exposes `assignGuestToDevice`, `clearGuestAssignment`, `suppressDeviceUntilNextReading`, `guestCandidates` |
| `_extensions/fitness/src/ble.mjs` | BLE scan, HR Service 0x180D discovery, best-effort matching |
| `_extensions/fitness/src/decoders/heart_rate.mjs` | GATT 0x2A37 packet parser |

---

## See Also

- [Assign Guest](./assign-guest.md) — full borrow-flow specification (constraints, continuous-usage threshold, entity transfer, state machine)
- [BLE Heart Rate](./ble-heart-rate.md) — own-monitor flow technical reference
- [Display Name Resolver](./display-name-resolver.md) — name resolution priority chain
- [Governance Engine](./governance-engine.md) — how guests count toward `min_participants` and zone requirements
- [Fitness System Architecture](./fitness-system-architecture.md) — system-wide context
