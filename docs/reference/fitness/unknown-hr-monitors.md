# Unknown Heart Rate Monitors

How the fitness app reacts when an HR sensor broadcasts a signal that isn't pre-registered in `fitness.yml`. Covers the **Pikachu fallback avatar**, the difference between ANT+ and BLE handling, and how to claim an unknown device mid-session.

For pre-registered guest flows, see [`assign-guest.md`](./assign-guest.md) and [`guest-mode.md`](./guest-mode.md). For BLE pairing technicals, see [`ble-heart-rate.md`](./ble-heart-rate.md).

---

## Three Tiers of Recognition

The system treats an inbound HR signal at one of three recognition tiers, depending on what's in the config:

| Tier | Config presence | Card appears? | Avatar | Name |
|------|----------------|---------------|--------|------|
| **1. Mapped** | `devices.heart_rate: {id: userId}` AND user has profile | Yes | User's profile photo | User's name |
| **2. Color-allocated** | `device_colors.heart_rate: {id: color}` only, no user mapping | Yes | **Pikachu** | `#<deviceId>` |
| **3. Wild** | Not in config at all | ANT+: yes / BLE: no | **Pikachu** | `#<deviceId>` |

Tier 2 is a pattern for recurring visitors — the device gets a stable color (so the human eye can identify "the orange one") without committing the device ID to a permanent user. From `fitness.yml`:

```yaml
device_colors:
  heart_rate:
    # GUEST DEVICES
    10366: purple   # guest1
    11521: beige    # guest2
    10266: teal     # guest3
```

These three IDs have colors but no `devices.heart_rate` entry — they're reserved slots for "someone visiting wearing an unknown strap." Cards render with a recognizable color border but a Pikachu face.

---

## The Pikachu Fallback

The fallback avatar for any HR device that can't resolve a `profileId` is `/static/img/users/user.jpg` — which is literally a Pikachu face. There's no special code path; this is just the contents of the generic fallback image file.

**Where the fallback fires** (`FitnessUsers.jsx:896-907`):

```javascript
const profileId = isHeartRate
  ? (guestAssignment?.metadata?.profileId
      || guestAssignment?.metadata?.candidateId
      || guestAssignment?.occupantSlug
      || participantEntry?.profileId
      || participantEntry?.id
      || userIdMap[deviceIdStr]
      || getConfiguredProfileId(...)
      || resolvedUser?.id
      || 'user') // Fallback to generic avatar instead of slugifying
  : (equipmentInfo?.id || 'equipment');
```

When everything in the resolution chain returns null, `profileId = 'user'`, and the avatar URL becomes `/static/img/users/user.jpg` — Pikachu.

**The Pikachu signal:** any time you see Pikachu on a card, it means the device is broadcasting HR but the system has no idea whose chest it's on. The device is real and the data is flowing into the session; it's just unattributed.

**Asset location:** `data/household/.../media/img/users/user.jpg`. Replacing this file changes the fallback for the whole household.

---

## When Does Pikachu Appear?

Pikachu shows up whenever the avatar URL resolves to `/static/img/users/user.jpg`. That happens in three distinct situations:

**1. Unmapped ANT+ HR device** (the main case)
The device broadcasts but has no entry in `devices.heart_rate`. The `profileId` resolution chain at `FitnessUsers.jsx:896-907` falls through to the literal `'user'` fallback. Card label shows `#<deviceId>`. This is the only case that creates a *new* Pikachu card from nothing.

**2. Color-allocated visitor slots**
Same mechanism as #1 — IDs like `10366` / `11521` / `10266` are in `device_colors.heart_rate` but NOT in `devices.heart_rate`. Card gets a colored border but no user, so the avatar Pikachus.

**3. Mapped user with a missing avatar file**
The `profileId` resolves correctly (e.g. `family-a`), the URL `/static/img/users/family-a.jpg` is requested, the file 404s, and the `<img onError>` handler swaps to `user.jpg`. The card's *name* is still correct — only the avatar Pikachus. This is the "silent" Pikachu: easy to miss because the label looks fine.

**Where Pikachu does NOT appear:**
- Unmapped BLE devices — dropped at `ble.mjs:~415` (`if (!userId) return;`) before reaching the frontend. No card, no Pikachu.
- Non-HR equipment with no mapping — falls back to `equipment`, not `user`.
- Before the first HR reading from a device — cards are only rendered after `DeviceManager.registerDevice()` fires.

In plain terms: **Pikachu = "an ANT+ HR strap is broadcasting and I have no idea whose chest it's on, OR I know whose chest it is but their photo is missing."**

---

## ANT+ vs BLE: Different Defaults for Unknown Devices

The two HR transports diverge in how aggressively they admit unknown devices into the UI.

### ANT+ (FitSyncAdapter)

ANT+ devices broadcast a numeric device ID over the wireless protocol. The backend doesn't filter — every HR-profile broadcast becomes a `{type: 'ant', profile: 'HR', deviceId, ...}` WebSocket message. The frontend's `DeviceManager.registerDevice()` accepts any device ID and creates a tracking entry.

**Result for an unknown ANT+ device:**
- A device card appears in the sidebar immediately on the first reading
- Avatar = Pikachu (`user.jpg`)
- Name = `#<deviceId>` (e.g. `#99999`)
- Zone, coin awards, and timeline recording all work — the device gets a synthetic user identity keyed off the device ID
- The device counts toward the participant roster and toward governance evaluation

This means an ANT+ stranger wandering past with an HR strap will literally show up as a Pikachu in your session. (In practice this is mostly an indoor concern — ANT+ range is short.)

### BLE (BLEManager)

BLE handling is the opposite — best-effort matching happens BEFORE data is broadcast to the frontend, and unmatched devices are dropped:

**The matching cascade** (`_extensions/fitness/src/ble.mjs`):
1. **Known device name** matches `ble_users` entry → assign
2. **One unmatched device + one unmatched expected user** → auto-pair
3. **Multiple unmatched devices** → log warning, drop data (`if (!userId) return;` at line ~415)
4. **All expected users already matched** → ignore

**Result for an unknown BLE device:**
- No card appears in the sidebar
- No data reaches the frontend
- A warning is logged: `⚠️ BLE HR device {addr} found but N unmatched users — cannot auto-assign`

The asymmetry is intentional: BLE devices (Apple Watches, phones) are common in the ambient environment and you don't want every neighbor's watch creating phantom Pikachu cards. ANT+ devices are deliberately worn for fitness, so admitting them by default is reasonable.

---

## Mid-Session Identity Changes

The avatar on a device card updates in real time as soon as the device's assignment changes. The interesting questions are about what gets *recorded* and what doesn't get *caught*.

### Pikachu → tagged user

Tap a Pikachu card → `FitnessSidebarMenu` opens in `mode='guest'` (header shows `#<deviceId>` from `FitnessSidebarMenu.jsx:62`) → pick a candidate from Friends/Family or generic "Guest" → the card immediately swaps to the assigned person's avatar and name.

Saved-session attribution depends on the 1-minute grace window (see [`assign-guest.md`](./assign-guest.md) § Grace Period Transfer):

- **Tagged within 1 min** → the new user inherits the Pikachu's coins, timeline, and start time. The Pikachu identity vanishes from the saved YAML.
- **Tagged after 1 min** → the Pikachu becomes a permanent entry in `participants:` (typically keyed by device ID) with whatever stats it earned. The new user's series starts fresh at the moment of assignment.

A Pikachu that lingered ten minutes before being tagged will show up in the saved session as a phantom participant alongside the real user. Tag promptly to avoid this.

### Tagged user → different tagged user

Standard guest reassignment via the sidebar menu — covered in [`assign-guest.md`](./assign-guest.md). Avatar swaps immediately; the same grace-period rules govern data attribution.

### Tagged user → silent owner swap (no menu action)

If Alice hands her strap to Bob without anyone touching the sidebar menu, **the system has no way to detect this.** HR data keeps flowing under Alice's identity. The card still shows Alice's photo. Bob's effort gets attributed to Alice in the timeline, the coins, and the saved session.

This is a known footgun. The only human-visible signals are:
- An out-of-character HR pattern (e.g. Alice's 70 bpm baseline suddenly jumping to 140 bpm at rest)
- The absence of an `ASSIGN_GUEST` event in the session's `events:` log around the apparent change point

There's no automatic detection. Mitigation is procedural: tag the swap in the menu before handing off the strap.

### Tagged user with broken avatar mid-session

If a user's profile photo gets deleted or moved while a session is live, the next time the `<img>` element re-renders (component remount, page reload), the avatar will fall through to Pikachu via the `onError` handler. The name stays correct; the timeline/coins/governance are unaffected. The fix is to restore the file — the card recovers on next remount.

---

## Promoting a Recurring Visitor to Pre-Registered

If the same recurring visitor keeps showing up wearing the same ANT+ strap and you're tired of tagging them every visit, add them to `fitness.yml`:

```yaml
devices:
  heart_rate:
    99999: family-a       # orange strap, mapped directly

device_colors:
  heart_rate:
    99999: orange         # visual identifier

users:
  family:
    - name: Family A
      id: family-a
      zones:
        active: 80
        warm: 110
        hot: 130
        fire: 150
      birthyear: 1950
```

Three changes:
1. **`devices.heart_rate`** — bind the physical device ID to a user slug
2. **`device_colors.heart_rate`** — give the card a recognizable color
3. **`users.family`** (or `users.friends`) — define the user's display name and zone overrides

Drop a matching `data/household/.../media/img/users/family-a.jpg` and the Pikachu is replaced by their photo next time the device broadcasts.

**Config reload:** changes to `fitness.yml` require a backend restart (`docker restart {env.docker_container}`) to take effect — config is loaded at container startup.

For BLE Apple Watches, add the synthetic ID instead and list the user in `ble_users:`:

```yaml
devices:
  heart_rate:
    ble_grannie: grannie

ble_users:
  - grannie
```

---

## Things to Know (Footguns)

- **"Type: unknown" is a different concept.** `FitnessUsers.jsx:38` and `FitnessSidebar.scss:838` reference an `unknown` class — that's for device payloads of an *unrecognized sensor type* (not heart_rate, not cadence, not power), styled with a gray `📡` icon. It is NOT the same as "HR device with unknown owner." The latter is Pikachu, the former is `📡`.
- **Pikachu cards count toward governance.** An ANT+ stranger walking past will be evaluated for the `active: all` base requirement and can prevent the video from unlocking. If this happens, tag the device as "Guest" (`allowWhileAssigned: true`) to clear the noise, or use "Remove User" to suppress it until the next reading.
- **`device_colors` works on un-mapped devices.** You don't need a `devices.heart_rate` entry to set a color — Tier 2 (color-only) is a valid config state and is used intentionally for visitor slots.
- **The Pikachu image is shared with non-fitness apps.** `user.jpg` is the general household fallback avatar — replacing it affects every place a user avatar can fall through to the default (Gratitude, governance overlays, etc.).
- **BLE silence is real silence.** If you expect a registered user's Apple Watch to show up and it doesn't, the failure mode is "no card at all," not "Pikachu card." Check the fitness extension logs (`_extensions/fitness/src/ble.mjs` output) for `BLE HR device ... found but ...` warnings.
- **Apple Watch requires an active Workout** to broadcast HR over BLE. A registered `ble_users` entry won't help if the watch isn't in a workout.

---

## Lifecycle

| Trigger | Effect |
|---------|--------|
| First HR reading from unknown ANT+ ID | Pikachu card appears immediately |
| User taps card → assigns identity | Card switches to assigned person's avatar/name; data from this point attributes to them |
| User taps "Remove User" | Card disappears until next HR reading from same device |
| No HR data for `ant_devices.timeout.inactive` (10s in current config) | Card grays out |
| No HR data for `ant_devices.timeout.remove` (30s in current config) | Card removed |
| BLE device fails best-effort match | Never shown; logged as warning, data discarded |
| Session ends | Pikachu identity persists in saved session YAML as `participants["#<deviceId>"]` with whatever stats it accrued |

---

## File Reference

| File | Role |
|------|------|
| `FitnessUsers.jsx:896-907` | The `profileId || 'user'` fallback that triggers the Pikachu avatar |
| `FitnessSidebarMenu.jsx:62` | `#<deviceId>` label shown in the menu header for unmapped devices |
| `DeviceManager.js` | Accepts any device ID; registers tracking entry on first reading |
| `UserManager.js` | `resolveUserForDevice()` returns null for unmapped IDs; `#ensureUserFromAssignment()` creates synthetic users on guest assignment |
| `DisplayNameResolver.js` | Priority chain that falls through to device ID when nothing else matches |
| `_extensions/fitness/src/ble.mjs:~415` | The `if (!userId) return;` that drops unmatched BLE data |
| `data/household/.../media/img/users/user.jpg` | The Pikachu image itself |
| `data/household/config/fitness.yml` | `devices.heart_rate`, `device_colors.heart_rate`, `ble_users`, `users.friends`, `users.family` |

---

## See Also

- [Guest Mode](./guest-mode.md) — umbrella overview of friend/family participation
- [Assign Guest](./assign-guest.md) — borrowed-device flow, grace period, entity lifecycle
- [BLE Heart Rate](./ble-heart-rate.md) — BLE matching cascade, GATT parsing, Apple Watch limitations
- [Display Name Resolver](./display-name-resolver.md) — priority chain for the name shown on a card
