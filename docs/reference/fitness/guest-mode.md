# Guest Mode Reference — Lifecycle and UX

How non-household participants (friends, extended family, and total strangers wearing HR straps) join a fitness session, what they experience in the UI, how their data flows through every subsystem, and what survives after the session ends.

This document is the umbrella overview and the canonical lifecycle/UX narrative. For the deep dives:
- [`assign-guest.md`](./assign-guest.md) — borrowed-device flow, continuous-usage threshold, entity transfer, state machines
- [`unknown-hr-monitors.md`](./unknown-hr-monitors.md) — Pikachu fallback, ANT+ vs BLE admission, claiming an unknown strap mid-session
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

## Guest Identity Classes

Not all guests are the same kind of identity. There are three classes, and which one a participant lands in determines their name, avatar, and how their data is keyed in the saved session.

| Class | Identity (profileId) | Name shown | Avatar | How it arises |
|-------|---------------------|------------|--------|---------------|
| **Named guest** | Configured user ID (e.g. `friend-b`) | Their configured name | `/static/img/users/{id}` (their photo) | Picked from the Friends/Family tabs, or BLE auto-match |
| **Generic Guest** | `guest_<deviceId>` (device-keyed alias, W2) | "Guest" — numbered when simultaneous ("Guest 2", "Guest 3", …) | `guest-adult` / `guest-kid` placeholder (falls back to Pikachu `user` until the assets exist) | "Guest" top option in the picker (adult, or the kid variant badged "Kid") |
| **Untagged (Pikachu)** | Synthetic — `#<deviceId>` card label; `guest-<timestamp>` if GuestAssignmentService receives no profileId | `#<deviceId>` | Pikachu fallback | Unknown ANT+ strap broadcasts; nobody has tagged it |

### Generic Guest is a per-device alias (W2)

The generic "Guest" option carries no `profileId` in the picker. At assignment time, `FitnessSidebarMenu.handleAssignGuest` synthesizes `guest_<deviceId>`, so two simultaneous Guests on different devices are **distinct anonymous participants** — each with their own session entity, timeline series, coins, and saved-YAML row. Governance `min_participants` counts each as a separate person.

The picker matches the identity model: `'guest'` (and `'guest-kid'`) are inherently multi-assignable (`guestOptionsBuilder.js` adds them to `multiAssignableKeys` unconditionally), so the "Guest" option stays available on every device no matter how many anonymous Guests already exist — only the device where a Guest is *currently* assigned hides it. To keep simultaneous Guests distinguishable, display names are numbered at assign time: the first is "Guest", then "Guest 2", "Guest 3", … (`nextGenericGuestName`, which counts adult and kid generics jointly since both display as "Guest").

### Guest (kid) — configured zone profile

When `fitness.yml → guest_profiles.kid.zones` is configured, a second generic option appears in the picker — it displays the name "Guest" with a **"Kid"** source badge. Selecting it carries the configured kid zone thresholds into the assignment `metadata.zones` (converted from the map form to the `[{ id, min }]` array form by `zonesMapToArray`), which UserManager applies as zone overrides — so a child on a borrowed adult strap is evaluated against kid zones, not the strap owner's. The identity is still `guest_<deviceId>`; the age class is persisted as `guest_profile: kid` in the saved participants block.

### Untagged ≠ Guest

A Pikachu card (unknown ANT+ strap) is **not** a guest assignment — it's an unattributed device earning data under a synthetic identity. It becomes a guest (or a household user) only when someone taps the card and tags it. Until then it persists into the saved YAML keyed by device ID if it earns ≥ T of continuous data. Full treatment: [`unknown-hr-monitors.md`](./unknown-hr-monitors.md).

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
// + primaryGuestPool (displaced primaries, allowWhileAssigned: true so they can reclaim)
```

The combined list — plus `allowWhileAssigned` flags and de-duplication by ID — becomes `context.guestCandidates`, consumed by `FitnessSidebarMenu` in `mode='guest'`.

Displaced primaries get `allowWhileAssigned: true` automatically (`FitnessSidebar.jsx:114`) — when a guest takes Alice's strap, Alice enters the candidate pool for *every* device so she can reclaim hers (or take another) even while her name is technically "assigned."

---

## When a Guest Shows Up — End-to-End Walkthrough

The decision tree at the front door:

```
A guest arrives wanting to join the workout
│
├─ Wearing their own BLE monitor (Apple Watch etc.)?
│   ├─ Pre-registered in ble_users + fitness.yml?
│   │   → They start a Workout on the watch. BLE auto-match fires.
│   │     Their card appears under their own name. Done — zero UI taps.
│   └─ Not registered?
│       → Nothing happens (BLE unknowns are silently dropped — no card).
│         Fall through to borrowing a strap, or register them for next time.
│
└─ Borrowing a household ANT+ strap?
    → They put the strap on. Within seconds a card appears:
      ├─ Strap is mapped to a household user → card shows THAT user's
      │   name/photo (wrong person!). Tap the card → pick the guest.
      ├─ Strap is a color-allocated visitor slot → Pikachu card with the
      │   matching heart emoji, a sticker-color avatar ring, and a
      │   "Purple strap" label. Tap → tag it.
      └─ Strap is totally unknown → Pikachu card labeled #<deviceId>,
          avatar ring in a deterministic hash color. Tap → tag it.
```

Step-by-step for the common borrow case:

1. **Strap on.** First HR reading registers the device; a card appears in the sidebar (`DeviceManager.registerDevice()`).
2. **Tap the card.** `FitnessSidebarMenu` opens in `mode='guest'`; the header shows the current occupant (or `#<deviceId>` for unmapped straps).
3. **Pick an identity.** Top options: "Original" (only if a guest currently displaces the owner, badge "Give back"), generic "Guest", and a second "Guest" badged "Kid" when `guest_profiles.kid` is configured. Below: Friends/Family tabs of configured candidates with avatars. Friends tab auto-falls-back to Family when empty. Unmapped straps get an explainer line ("Unrecognized heart-rate strap #id…"); if the current occupant's segment is younger than the continuous-usage threshold, a note says their last N minutes will transfer to whoever you pick.
4. **Assignment lands.** `assignGuestToDevice(deviceId, { name, profileId, candidateId, source, baseUserName })` → `GuestAssignmentService` validates, creates a session entity, updates the `DeviceAssignmentLedger`. The card swaps to the guest's name/avatar immediately.
5. **They just work out.** HR → zones → coins → governance → timeline, identical to a household member.
6. **Hand-back / leave.** Either tap the card → "Original" to restore the owner, tap "⛔ Ignore This Strap" to suppress the device, or just take the strap off (card grays at ~10 s, drops at ~30 s — the assignment survives, see Lifecycle below).
7. **Session ends.** The save-time backfill resolves any sub-threshold segments and late tags; the guest gets a `participants:` row in the saved YAML.

**The timing footgun:** if the owner turns the strap on first and *then* hands it over, the owner's brief segment auto-corrects — any segment shorter than the continuous-usage threshold `T` (default 5 min) is absorbed forward into the guest. No UI action needed. The reverse mistake (guest forgets to tag at all) is unrecoverable by automation: data accrues to whoever the device maps to. See [`unknown-hr-monitors.md`](./unknown-hr-monitors.md) § "Tagged user → silent owner swap".

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
- `allowWhileAssigned` override for displaced primaries
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
        → Avatar: /static/img/users/{profileId} (fallback to /user — Pikachu)
```

Visual treatment for guests is **intentionally the same as owners** — same card layout (`.fitness-device.card-horizontal` / `.card-vertical`), same zone badge (`.device-zone-info`), same HR display. There is **no on-card "guest" badge**; the signals are the avatar (generic Guests show the `guest-adult`/`guest-kid` placeholder), the name (numbered "Guest N" for generics), and the strap-color ring that follows the device. The rest of the guest-specific UI lives inside the menu (the "Give back" restore option and the source badges in the picker).

### Display name

`DisplayNameResolver.js:17-48` resolves first-match-wins:

| Rank | Source | Condition |
|------|--------|-----------|
| 1 | **guest** — `assignment.occupantName` | device has an `occupantType === 'guest'` assignment |
| 2 | groupLabel — owner's short name | `preferGroupLabels` and 2+ active HR devices |
| 3 | owner — `ownership.name` | device mapped to a configured user |
| 4 | profile — `profile.displayName` | user profile exists |
| 5 | fallback — the device ID | nothing else matched (renders as `#<deviceId>`) |

A guest assignment short-circuits the chain at rank 1 — group-label logic never applies to guests.

### Avatar resolution

Avatar `profileId` for an HR card resolves through (`FitnessUsers.jsx:896-907`):

```
guestAssignment.metadata.profileId      ← guest's identity (e.g. friend-b, guest_48291)
  || guestAssignment.metadata.candidateId
  || guestAssignment.occupantSlug
  || participantEntry.profileId
  || participantEntry.id
  || userIdMap[deviceId]
  || getConfiguredProfileId(...)
  || resolvedUser.id
  || 'user'                             ← final fallback = Pikachu (user.jpg)
```

Before loading, generic-Guest profileIds (prefix `guest_`) are swapped to a placeholder tier image (`guestPlaceholders.js`): `guest-adult` or `guest-kid` per the assignment's age class. The `<img>` then loads `/static/img/users/{imageId}` with an `onError` retry to `/static/img/users/user` (picker grid and cards share the pattern). Consequences:

- **Named guests with a photo on disk** show their photo everywhere (card, picker, overlays).
- **Generic Guests show the guest placeholder** — `/static/img/users/guest-adult` or `guest-kid`, visually distinct from untagged Pikachu cards. Until those asset files are dropped in, the `onError` chain degrades to Pikachu (`user`).
- **Untagged devices still show Pikachu** — the fallback now specifically means "nobody has claimed this" (or a named user's photo is missing).
- **Named guests with a missing photo** silently Pikachu while keeping the correct name.

### Color

The physical-sticker mapping (`device_colors.heart_rate`) surfaces in three coordinated ways, all driven by the `strapColors.js` lib (single source of truth):

1. **Matching heart emoji** on the card — the full configured palette resolves (purple 💜, beige 🤎, teal 🩵, …). Previously only six colors mapped and the guest visitor slots all fell back to 🧡.
2. **Saturated avatar ring** — a 3px *inset* outline around the avatar in the configured sticker color (inset because the horizontal card's `overflow: hidden` clips an outward ring). The ring follows the device, not the occupant — a guest wearing the "purple strap" keeps the purple ring whoever they are. Fully unidentified devices (no mapped user, no assignment) get a deterministic per-device **hash color** instead, so simultaneous unknown straps are visually distinct.
3. **Color-name card label** — when nothing else resolves a name (DisplayNameResolver falls through to its device-ID fallback), a configured sticker color renders as "Purple strap" instead of `#10366`.

Guests have no static color of their own beyond the strap ring. Card/zone color remains **zone-driven** (live HR → zone → zone color), identical to household users. Design intent (2026-05-26 audit §3): sticker color must stay prominently visible so a human can match physical strap → on-screen card at a glance.

### Menu (picker) UI

In `FitnessSidebarMenu` with `mode='guest'`:

| Element | Behavior |
|---------|----------|
| Header | Current occupant name, or `#<deviceId>` for unmapped straps |
| Unrecognized-strap hint | When the device has no base user: *"Unrecognized heart-rate strap **#id**. Pick who's wearing it — or 'Guest' if they're visiting."* |
| Transfer note | When the active assignment segment is younger than the continuous-usage threshold: *"{name}'s last N min on this strap will transfer to whoever you pick."* |
| Top option: "Original" | Appears ONLY when a guest is currently assigned AND differs from the base user; source badge **"Give back"**; selecting it assigns the base user back (it's an assignment, not a clear) |
| Top option: "Guest" | Generic anonymous identity; synthesizes `guest_<deviceId>` at assign time (W2). Available on every device regardless of how many Guests exist (`'guest'` is inherently multi-assignable in `guestOptionsBuilder.js`); hidden only on the device where a Guest is currently assigned. Simultaneous Guests get numbered names via `nextGenericGuestName` ("Guest", "Guest 2", …) |
| Top option: kid Guest | Displays "Guest" with source badge **"Kid"**; appears when `fitness.yml → guest_profiles.kid.zones` is configured. Same `guest_<deviceId>` identity, but carries kid zone thresholds into assignment `metadata.zones` and persists `guest_profile: kid` |
| Tabs | "Friends" / "Family"; auto-switches Friends→Family when the Friends pool is empty |
| Grid | Filtered candidates from the current tab, each with avatar + name + source badge (`Friend` / `Family` / `Give back` / `Guest` / `Kid`). Excludes: anyone assigned to any device (unless `allowWhileAssigned`), anyone actively broadcasting on their own HR monitor (Bug 06 fix), and the currently selected occupant — exclusion logic lives in `guestOptionsBuilder.js` |
| "⛔ Ignore This Strap" | (was "Remove User") Calls `suppressDeviceUntilNextReading(deviceId)` — device drops from session until the next HR reading re-registers it |
| Idle close | Menu auto-closes after inactivity (`MENU_IDLE_CLOSE_MS`); selections flash an acknowledgment before closing |

---

## Downstream Effects of a Guest Assignment

When a guest is assigned (either flow), the resolved user identity propagates through every subsystem keyed by user:

| Subsystem | Effect |
|-----------|--------|
| **ZoneProfileStore** | Guest can carry zone overrides via assignment `metadata.zones` (logged as `ZONE_OVERRIDE_APPLIED`, `GuestAssignmentService.js:318-327`); otherwise inherits the device's default zone profile. Zone state is tracked by `trackingId = entityId || userId` |
| **TreasureBox** | Coins accumulate against the guest's identity, not the device owner's; per-user map keyed by userId |
| **GovernanceEngine** | Lock/unlock evaluates the guest's current zone; guest counts toward `min_participants`. INACTIVE devices (signal-silent ≥ 10 s) are excluded from live governance counts — a grayed-out guest doesn't gate the video |
| **FitnessTimeline** | Series keys (`{userId}:hr`, `{userId}:zone`, `{userId}:coins`) use the guest's identity (e.g. `friend-b:hr`, `guest_48291:hr`) |
| **DisplayNameResolver** | `guest` priority (1) trumps `groupLabel`, `owner`, `profile`, `fallback` |
| **EventJournal** | Emits `ASSIGN_GUEST`, `GUEST_REPLACED`, `SEGMENT_ABSORBED`, `CLEAR_GUEST` (payloads carry `thresholdMs`). In-memory ring buffer only — see "What does NOT persist" below |
| **SessionDatastore** | Guest appears in `participants:` block on save with `is_guest: true`; their timeline series persists alongside primaries |

This means a guest is a **full first-class participant for the duration of the session** — they earn coins, contribute to governance, get a row in the saved session YAML.

---

## Reports & Persistence

### Saved session YAML

`PersistenceManager.buildParticipantsForPersist` (`PersistenceManager.js:162-209`) keys each participant by their identity and flags them:

```yaml
# data/household/history/fitness/{date}/{id}.yml
participants:
  user-a:
    display_name: User A
    is_primary: true            # default when neither flag is set
    hr_device: "11111"
  friend-b:
    display_name: Friend B
    is_guest: true
    hr_device: "22222"
    base_user: User A           # whose strap they borrowed
  guest_48291:                  # generic Guest, device-keyed
    display_name: Guest
    is_guest: true
    hr_device: "48291"
  guest_10366:                  # second simultaneous generic Guest — numbered name
    display_name: Guest 2
    is_guest: true
    guest_profile: kid          # tagged via the kid Guest option — kid zone overrides applied
    hr_device: "10366"
timeline:
  series:
    friend-b:hr: ...            # compact v2 keys: {slug}:hr / :zone / :coins
    friend-b:zone: ...
    friend-b:coins: ...
```

`is_guest` and `is_primary` are mutually exclusive; entries with neither flag default to `is_primary: true` (registered users aren't guests). `guest_profile` records the age-class profile (from `guest_profiles`) the guest rode under, so reports can interpret zone/coin data correctly. Occupants fully absorbed by the save-time backfill (sub-threshold segments, late-tagged Pikachus) are **excluded entirely** — no phantom rows.

### Session detail / history UI

- **Session lists** (`FitnessSessionsWidget`): guests contribute to the roster but don't affect the session title (title comes from media/Strava/activity label).
- **Session detail** (`FitnessSessionDetailWidget` + `FitnessTimeline.jsx`): every participant — guest or not — gets an HR lane, zone coloring, name label, and summary stats (HR stats, zone time, coins via `buildSessionSummary.js`). Guests additionally get a muted "guest" text marker beside their lane avatar; `sessionDataAdapter.js` exposes `isGuest` / `guestProfile` from the persisted flags.
- **Timeline markers**: only `media`, `challenge`, and `voice_memo` events render as markers. Guest lifecycle events (`ASSIGN_GUEST` etc.) do **not** appear in the session-detail timeline.

### Strava / webhook enrichment

Enrichment is session-level, not per-participant ([`webhook-enrichment.md`](./webhook-enrichment.md)). Guests don't change the activity title or description; the `strava:` block is written back under the **primary** participant who triggered the webhook. A guest never gets a Strava activity from DaylightStation.

### Race session grouping

Roster union is part of the grouping key ([`race-session-grouping.md`](./race-session-grouping.md)) — a session with a guest has a different roster than one without, so guest presence can split otherwise-adjacent sessions into separate groups. The same guest across consecutive sessions groups normally.

### What does NOT persist

| Artifact | Fate |
|----------|------|
| EventJournal guest events (`ASSIGN_GUEST`, `GUEST_REPLACED`, `SEGMENT_ABSORBED`, `CLEAR_GUEST`) | In-memory ring buffer (~200 entries); **not** written to the session YAML. Gone at session end |
| Cross-session guest identity | None. `guest_<deviceId>` is minted per session; there is no way to query "all sessions for Guest Joe." Named guests (configured friend IDs) are queryable only by grepping saved YAMLs |
| Health dashboard / lifelog | Per-registered-user only; guests never appear |
| Cross-session coin totals | Coins are session-scoped series; no lifespan aggregation for anyone, guests included |
| `deviceAssignments` ledger | Reset every session; each session starts with clean assignments |
| BLE matchings | Reset between scans; next session re-matches from current `BLE_HR_USERS` |
| Voice memos | Session-level artifacts, not attributed to any participant — a guest's spoken memo is indistinguishable from anyone else's |

---

## Lifecycle

### Session entry

A guest enters the session at the moment of assignment (borrow flow) or first HR reading (own-monitor flow). A new session entity is created with the guest's `profileId`; the entity's `start` timestamp anchors their timeline. If they replaced a sub-threshold segment, they inherit its start time, coins, and series.

### Mid-session

| Event | Effect |
|-------|--------|
| Guest's HR keeps flowing | Normal participation — zones, coins, governance |
| No HR for ~10 s (`ant_devices.timeout.inactive`) | Card grays out; excluded from live governance counts (`active: all`, `min_participants`). Still in the roster for session totals |
| No HR for ~30 s (`ant_devices.timeout.remove`) | Card removed from the sidebar. **The assignment survives** — the `deviceAssignments` ledger keeps the binding, so when the strap comes back on, the card returns under the guest's identity automatically. Don't re-tag after a bathroom break |
| Guest hands strap to someone else silently | Undetectable — data keeps attributing to the guest. Tag the swap in the menu |

### Session exit

| Trigger | Effect |
|---------|--------|
| User selects "Original" in menu | Base user assigned back (an explicit assignment, not a clear); guest entity ended |
| `clearGuestAssignment(deviceId)` | Entity ended (`status: 'ended'`), device reverts to base user |
| Different guest assigned, previous segment ≥ T | Previous entity ended (`status: 'dropped'`), new entity created. `GUEST_REPLACED` |
| Different guest assigned, previous segment < T | Sub-threshold absorption: coins, timeline, start time migrate forward. `SEGMENT_ABSORBED`. Symmetric across Guest↔Mapped↔Mapped transitions (W1.C / OI-3) |
| User taps "⛔ Ignore This Strap" | `suppressDeviceUntilNextReading(deviceId)` — device dropped until its next reading |
| Session ends | All active guest entities finalized; `PersistenceManager` runs the W1.B backfill to catch OI-1 (final sub-T segment), OI-2 (cycling), and Decision §5 (late-tag Pikachu merges) that the live pass couldn't see |
| Own-monitor guest disconnects (BLE) | Device flagged stale after timeout; ActivityMonitor moves user to idle, then dropped |

T = continuous-usage threshold from `fitness.yml → governance.usage_threshold_seconds` (default 300 s).
See [`assign-guest.md`](./assign-guest.md) § Continuous-Usage Threshold for the full behavioral rules and live vs save-time split.

### Cleanup

- Guest entities persist into the saved session YAML — historical analytics can attribute coins to the right person
- The `deviceAssignments` ledger is **not** persisted across sessions; each session starts with clean assignments
- BLE matchings reset between scans; the next session will re-match using the current `BLE_HR_USERS` config

---

## Considerations & Footguns

- **Tag before strap-on when possible.** The threshold model forgives owner-then-guest handoffs under 5 minutes; it cannot forgive an untagged full workout. The picker's transfer note now tells you when a sub-threshold segment will move.
- **Simultaneous Guests are numbered, not described.** "Guest" vs "Guest 2" plus the sticker-color avatar ring is usually enough to tell cards apart, but the numbers carry no meaning across sessions — if two strangers work out together regularly, prefer tagging them as named friends.
- **Kid guests need `guest_profiles` configured.** Without a `fitness.yml → guest_profiles.kid.zones` block, the kid Guest option doesn't appear and a kid on a borrowed adult strap inherits the owner's adult zone thresholds (wrong zones, inflated coins).
- **A guest can block the video.** Pikachu/guest cards count toward governance `active: all`. An idle strap someone left on the shelf (still broadcasting) can hold the session hostage — use "⛔ Ignore This Strap".
- **No guest badge on live sidebar cards.** Sidebar cards render guests identically to household members (intentional); the guest distinction surfaces in the session-detail timeline ("guest" marker) and in the saved data (`is_guest`, `guest_profile`).
- **Guest transitions are invisible in reports.** If a device changed hands mid-session, the saved chart shows each honored identity's lane but no marker explaining when/why the swap happened — the events that recorded it died with the EventJournal.
- **Strava attribution goes to the primary.** A session where a guest did most of the work still enriches the primary user's Strava activity.
- **Recurring visitors should be promoted.** If the same person keeps showing up, register them under `users.friends`/`users.family` (and `ble_users` for a watch) — see [`unknown-hr-monitors.md`](./unknown-hr-monitors.md) § Promoting a Recurring Visitor. Config changes require a backend restart.

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

device_colors:
  heart_rate:
    "10366": purple    # color-allocated visitor slot — heart emoji + avatar ring + "Purple strap" label, no user mapping
    "11521": beige

ble_users:                  # subset of user IDs reachable via BLE
  - family-a
  - friend-a

guest_profiles:             # enables the kid Guest picker option (badge "Kid")
  kid:
    zones: { active: 95, warm: 130, hot: 155, fire: 175 }   # kid zone thresholds (map form)

governance:
  usage_threshold_seconds: 300   # continuous-usage threshold T
```

Env (BLE only):
```bash
BLE_HR_USERS=family-a,friend-a   # comma-separated; consumed by the fitness extension
```

---

## File Reference

| File | Role |
|------|------|
| `frontend/src/modules/Fitness/player/FitnessSidebar.jsx` | Builds `guestCandidates` from `family` + `friends` + displaced primaries (`allowWhileAssigned`) |
| `frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.jsx` | Guest picker UI (W2 `guest_<deviceId>` synthesis, numbered names, kid zone metadata, hint/transfer-note copy, idle close) |
| `frontend/src/modules/Fitness/lib/guestOptionsBuilder.js` | Pure option-list builder: exclusion sets, multi-assignable generics, `nextGenericGuestName`, kid Guest option, `zonesMapToArray` |
| `frontend/src/modules/Fitness/lib/guestPlaceholders.js` | Placeholder avatar tiers — `guest-adult` / `guest-kid` image ids for generic-Guest profileIds |
| `frontend/src/modules/Fitness/lib/strapColors.js` | Sticker-color SSOT: heart emoji, CSS ring color, deterministic hash color, "Purple strap" labels |
| `frontend/src/modules/Fitness/player/FitnessUsers.jsx` | Card rendering: avatar profileId chain, strap ring + color labels, zone colors, display name lookup |
| `frontend/src/hooks/fitness/GuestAssignmentService.js` | Validation, continuous-usage threshold logic, entity creation, event emission |
| `frontend/src/hooks/fitness/types.js` | `normalizeZoneOverrides` accepts both map and `[{id, min}]` array shapes (kid guest zones arrive as the array) |
| `frontend/src/hooks/fitness/DeviceAssignmentLedger.js` | `deviceId → occupant` ledger (session-scoped) |
| `frontend/src/hooks/fitness/UserManager.js` | Resolves `deviceId → user`; synthesizes users from assignments |
| `frontend/src/hooks/fitness/DisplayNameResolver.js` | Guest-priority display name resolution |
| `frontend/src/hooks/fitness/ParticipantRoster.js` | Roster entries with `isGuest` flag, zone lookup by trackingId, `#<deviceId>` naming |
| `frontend/src/hooks/fitness/PersistenceManager.js` | `is_guest`/`is_primary`/`base_user` persistence, W1.B backfill, occupant exclusion |
| `frontend/src/hooks/fitness/sessionBackfill.js` | OI-1/OI-2/OI-3/§5 rules incl. late-tag Pikachu merge |
| `frontend/src/context/FitnessContext.jsx` | Exposes `assignGuestToDevice`, `clearGuestAssignment`, `suppressDeviceUntilNextReading`, `guestCandidates` |
| `_extensions/fitness/src/ble.mjs` | BLE scan, HR Service 0x180D discovery, best-effort matching, unknown-device drop |
| `_extensions/fitness/src/decoders/heart_rate.mjs` | GATT 0x2A37 packet parser |

---

## See Also

- [Assign Guest](./assign-guest.md) — full borrow-flow specification (constraints, continuous-usage threshold, entity transfer, state machine)
- [Unknown HR Monitors](./unknown-hr-monitors.md) — Pikachu fallback, ANT+/BLE admission asymmetry, mid-session claiming
- [BLE Heart Rate](./ble-heart-rate.md) — own-monitor flow technical reference
- [Display Name Resolver](./display-name-resolver.md) — name resolution priority chain
- [Governance Engine](./governance-engine.md) — how guests count toward `min_participants` and zone requirements
- [Webhook Enrichment](./webhook-enrichment.md) — why guests don't appear in Strava output
- [Race Session Grouping](./race-session-grouping.md) — roster-union grouping and guest impact
- [Fitness System Architecture](./fitness-system-architecture.md) — system-wide context
