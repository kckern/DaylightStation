# Guest Assignment UX Lifecycle & Usability Audit

**Date:** 2026-06-09
**Author:** Claude
**Predecessor:** [`2026-05-26-guest-mode-ux-audit.md`](./2026-05-26-guest-mode-ux-audit.md) — this audit re-walks the guest experience after the W1/W2 implementation wave, scores what shipped, and evaluates two persona axes the prior audit didn't: **adult vs kid guests** and **registered vs unregistered guests** (placeholder avatar tiers).

---

## Scope

- The guest assignment process end-to-end, evaluated as a *user experience lifecycle* — what the host and the guest each see, do, and feel at every stage
- Persona lenses: registered adult / registered kid / unregistered adult / unregistered kid
- Placeholder avatar system: today everything falls back to one image (Pikachu `user.jpg`); evaluate tiered placeholders (e.g. Pikachu for untagged devices, a second mascot — "Squirtle" — for tagged-but-anonymous Guests, distinct adult vs kid marks)
- Optimizations and best practices not yet implemented
- Anything confusing or jarring, flagged for improvement

Out of scope: persistence schema, governance evaluation mechanics, BLE GATT internals (all covered in `docs/reference/fitness/`).

---

## Part 1 — Scorecard: What Shipped Since 2026-05-26

The prior audit ended with seven decisions and a priority list. Current state, verified against code:

| Directive / gap | Status | Evidence |
|---|---|---|
| **§7 Continuous-usage threshold** (replace 60s grace) | ✅ Shipped | `governance.usage_threshold_seconds` (default 300s) → `GuestAssignmentService` live pass + `PersistenceManager._applyBackfill` save pass; OI-1/OI-2/OI-3 rules in `sessionBackfill.js` |
| **§5 Late-tag Pikachu merge** | ✅ Shipped | `sessionBackfill.js:181-198` Rule 1 (`late-pikachu-tag`, duration-independent); test `PersistenceManager.lateTagMerge.test.js` |
| **§2 Generic Guest = per-device alias** | ✅ Shipped, ⚠️ with a new gap | `FitnessSidebarMenu.jsx:306-307` synthesizes `guest_<deviceId>` — but the picker still only allows ONE live generic Guest at a time (see **N2**; gap fixed 2026-06-09, `feature/guest-ux-fixes`) |
| **§4 Inactive cards excluded from governance** | ✅ Shipped | INACTIVE filtering in `GovernanceEngine.js:~2036-2043` reduces the `active: all` denominator |
| **§1 Assignment persists across 30s removal** | ✅ Confirmed working | Ledger keeps the binding; card returns under tagged identity |
| **§3 Sticker color visibility** | ✅ **Shipped** (2026-06-09, `feature/guest-ux-fixes`) | `strapColors.js`: matching heart emoji (full palette incl. purple/beige/teal), saturated 3px inset avatar ring, "Purple strap" color-name labels, deterministic hash-color ring for unconfigured IDs (resolves **N1**) |
| G1 Pre-session lobby | ❌ Open | No change |
| G2 New-device toast/affordance | ❌ Open | FlipMove 300ms slide-in only |
| G6 BLE silent drop | ⏸ Deferred (per §6, no BLE hardware in use) | No change |
| G10 In-app promotion to config | ❌ Open | Still SSH + edit YAML + container restart |
| G11 Stray Pikachu counts toward governance | ❌ Open | Untagged devices still gate `active: all` immediately |
| G16 Returnee surfacing | ❌ Open | `allowWhileAssigned` pool works; zero proactive UI |
| G17 Graceful guest exit | ❌ Open | Strap-off is the only "exit" |
| G18 Named Pikachu (photo missing) | ❌ Open | Same fallback as untagged |

**Net assessment:** the *data-correctness* layer (threshold, merge, device-keyed identity) is now in good shape — wrong-attribution mistakes self-heal. The *human-facing* layer (can a person in the room tell the cards apart, does a guest know what to do) received almost nothing. This audit therefore focuses on the visual/interaction layer.

---

## Part 2 — The Guest Lifecycle, Walked as an Experience

Each stage scored: ✅ smooth · ⚠️ friction · ❌ confusing/jarring.

### Stage 1: Arrival — "How do I join?"

The guest has no entry point of their own. Everything is mediated by the host finding a strap and (maybe) the sidebar.

- ⚠️ **There is no joining affordance anywhere on screen.** The fitness UI never says "to add a person, put a strap on them and tap the card." Guest onboarding is oral tradition.
- ❌ **A guest with an Apple Watch gets silence** (deferred, but worth restating: the failure mode of the *best* guest experience — bring your own device — is *nothing happens*).
- ⚠️ No pre-session check-in (G1). With 3 guests arriving for a group ride, the host plays whack-a-Pikachu as straps come online mid-countdown.

### Stage 2: Appearance — "Which card is me?"

A strap broadcasts; a card slides in (300ms FlipMove, no toast, no sound).

- ❌ **Three simultaneous guests = three identical Pikachus.** Labels are `#10366`, `#11521`, `#10266` — meaningless numbers. The *one* signal designed for this moment (physical sticker color → `device_colors.heart_rate`) renders as a ~1em heart emoji, and **the configured guest colors don't even exist in the emoji map** (see N1). Nobody in the room can answer "which one is me?" without a process of elimination.
- ⚠️ The card appearing is easy to miss during video playback (G2 carry-over). A guest strapping on mid-video has no idea whether the system saw them.
- ❌ **Jarring for borrowers:** a guest putting on Alice's strap sees *Alice's face and name* on their own heartbeat. Until someone retags, the guest is impersonating a household member on a 65" screen. There is no "this might not be you" cue.

### Stage 3: Tagging — the picker

Host taps the card; `FitnessSidebarMenu` opens in guest mode.

- ✅ The picker itself is decent: avatars, Friends/Family tabs, "Original" restore, idle auto-close, tap-ack flash.
- ⚠️ **Header shows `#99999`** for unknown devices — no explanation of what this is or what picking a person will do (G7 carry-over). First-time hosts hesitate: "will this mess up the data?"
- ⚠️ **Friends tab silently auto-switches to Family when empty** (`FitnessSidebarMenu.jsx:275-279`). The user taps Friends, the UI flips to Family with no explanation — reads as a glitch.
- ⚠️ **"Original" vs "Remove User" semantics are expert-only.** "Original" *assigns* the base user (it's a tag, not an undo); "Remove User" *suppresses until next reading* (the card comes back when the strap chirps again — which feels like the removal "didn't work"). Neither label says what will actually happen.
- ⚠️ **No feedback about data attribution.** The threshold rule means a sub-5-min wrong segment will be absorbed — genuinely great behavior — but the UI never says "User_5's last 3 minutes will transfer to Guest." Hosts who know the old 60s rule still rush; hosts who don't know any rule worry they've lost data. Silent correctness reads as uncertainty.
- ❌ **You cannot tag a second anonymous Guest** while one generic Guest exists (N2). The host taps the second Pikachu, scans the picker, and "Guest" simply isn't there — no explanation. This is the single most confusing dead-end in the flow, because the mental model ("everyone can be a Guest") is correct and the UI contradicts it.

### Stage 4: Working out — "Am I being counted?"

- ✅ Once tagged, the guest is a first-class participant: zones, coins, governance, chart lane. The core loop works.
- ⚠️ **Generic Guests are visually interchangeable.** Both cards say "Guest" with the same Pikachu face. With two anonymous guests, neither can tell which zone badge is theirs. (Identity is correctly distinct under the hood — the UI just doesn't show it.)
- ⚠️ **A kid guest inherits adult zone thresholds.** Guests without `metadata.zones` inherit the device's default zone profile. A 9-year-old on dad's strap (max HR ≈ 205) evaluated against dad's thresholds (max HR ≈ 180) will live in `fire`, mint coins at the top rate, and trivially satisfy governance. The reverse (adult on a kid's strap) under-credits. Nothing in the tag flow asks "kid or adult?" (see Part 4).
- ⚠️ **Stray straps still take governance hostage** (G11). A forgotten broadcasting strap on a shelf is a Pikachu that gates `active: all`. The fix is tribal knowledge ("Remove User it").

### Stage 5: Interruption & hand-back

- ✅ Water-break resilience is right: assignment survives the 30s removal window; the card returns tagged.
- ✅ Sub-threshold swaps self-correct; "Original" restores the owner.
- ❌ **Silent strap swaps remain undetectable** (G3, still the biggest data-integrity hole). The threshold absorbs only *short* mistakes; a 20-minute untagged swap is permanently misattributed with zero signal.

### Stage 6: Exit & afterlife

- ⚠️ No exit gesture (G17): a departing guest just takes the strap off. No "done — here's your summary." A guest who worked hard for 40 minutes gets no closing moment; their coins evaporate into a YAML they will never see.
- ⚠️ In session-detail reports, guests are rendered **identically to household members** — no `is_guest` badge, no marker for when a device changed hands. Two weeks later, "who is `guest_48291` with 412 coins?" is unanswerable.
- ✅ Late-tag merge means no more phantom `#99999` rows in saved sessions — a real cleanup win.

---

## Part 3 — Persona Matrix

| | Registered (friends/family in fitness.yml) | Unregistered |
|---|---|---|
| **Adult** | ✅ Best case: real name + photo after one tap (or zero taps via BLE/mapped strap). Zone overrides possible via config. | ⚠️ Pikachu card → tap → "Guest" → correct data, anonymous identity, Pikachu face forever. Indistinguishable from a second unregistered adult. |
| **Kid** | ⚠️ Name + photo work; zones only correct if the config entry carries kid `zones:`/`birthyear` AND the kid wears *their own mapped strap*. On a borrowed adult strap: adult thresholds (wrong). | ❌ Worst case: Pikachu face, adult zone thresholds, no way to even *say* "this is a child." Coins/governance silently mis-calibrated. |

Two structural observations:

1. **The registered/unregistered axis is an avatar problem.** Registered guests have faces; unregistered ones are all the same Pikachu. The system has three *semantically different* anonymous states (untagged device / tagged generic Guest / registered-but-photo-missing) collapsed into one image.
2. **The adult/kid axis is a zone-calibration problem wearing an avatar costume.** Different placeholder emojis for kid Guests would be nice for scanning, but the load-bearing fix is that "Guest (kid)" should select a kid zone profile. The avatar is how you make that choice visible and verifiable at a glance.

---

## Part 4 — Proposal: Tiered Placeholder Identity System

Today: every fallback path lands on `user.jpg` (Pikachu). Proposal — make the placeholder *encode the identity class*, so a glance at a card tells you its state:

| Identity class | Today | Proposed | Why |
|---|---|---|---|
| Untagged device (nobody claimed it) | Pikachu | **Pikachu** (keep — it's established household lore for "who is this?") | Pikachu = "needs tagging" stays a single unambiguous signal |
| Generic Guest, adult | Pikachu | **Squirtle** (second mascot) or 🧑 silhouette tile | "Claimed but anonymous" must look different from "unclaimed" — right now tagging a Guest produces *no visible change* except the label, which reads as the tap not working |
| Generic Guest, kid | Pikachu | **Distinct kid mark** (e.g. Togepi / 🧒 tile) | Visual confirmation that the kid zone profile is active (see below) |
| Registered user, photo missing | Pikachu (with their real name — the "named Pikachu" bug-lookalike) | **Initials-on-color avatar** (G18) | A real person with a config entry should never share a face with strangers |
| Registered user with photo | Photo | Photo | — |

Implementation notes:

- The fallback is currently a single hardcoded retry to `/static/img/users/user` (`FitnessSidebarMenu.jsx:475-490`, same pattern on cards). Replace with a small resolver: `placeholderFor({ identityClass, ageClass })` → distinct static assets under `/static/img/users/_placeholders/`. Config-driven map in `fitness.yml` so the household can pick its own mascots.
- **Adult/kid selection at tag time:** split the picker's top option into **"Guest"** and **"Guest (kid)"** (or a one-tap age toggle on the Guest row). `Guest (kid)` carries a `zones:` override from a new `fitness.yml → guest_profiles.kid` block (and `guest_profiles.adult` for symmetry). This is ~the same metadata plumbing that `metadata.zones` already supports (`GuestAssignmentService.js:318-327`, `ZONE_OVERRIDE_APPLIED` event) — the override mechanism exists and is currently unused by any UI.
- Persist the age class (`guest_profile: kid`) in the saved participants block so reports can interpret zone/coin data correctly.
- Numbered display names for simultaneous generics — "Guest 1" / "Guest 2" (or color-keyed: "Guest (purple)") — so two anonymous cards are distinguishable. Identity is already distinct (`guest_<deviceId>`); only the label collapses them.

---

## Part 5 — Findings

New findings numbered **N1–N12**; prior-audit carry-overs referenced by their G-numbers.

### Critical

**N1. The §3 color directive is unimplemented — and the emoji map is missing the guest colors specifically.** *(fixed 2026-06-09, `feature/guest-ux-fixes` — strapColors.js lib — emoji map covers the full palette, plus inset avatar ring, color-name labels, and hash fallback.)*
Device color surfaces *only* as a small heart emoji via `heartColorIcon` (`FitnessUsers.jsx:470-474`). The map (`CONFIG.heartRate.colorIcons`, `FitnessUsers.jsx:82-90`) contains `red, yellow, green, blue, watch, orange` — but the configured guest visitor slots are **purple, beige, teal** (`device_colors.heart_rate`), none of which exist in the map, so **all three guest straps render the identical fallback 🧡**. The one mechanism meant to disambiguate simultaneous guests is a no-op for exactly the guest devices. Zero of the §3 scope shipped: no saturated border/avatar ring, no color-name label ("Purple strap" instead of `#10366`), no deterministic hash-color fallback for unconfigured IDs.
*Fix path:* (1) one-line quick win — add 💜🤎🩵 (or colored-circle emojis 🟣🟤🔵) to `colorIcons`; (2) the real fix — avatar ring + color-name label per §3. Note `unknown-hr-monitors.md` claims a "colored border" renders; the code shows only the icon — correct the doc or implement the border.

**N2. Generic Guest is a singleton in the picker, contradicting the W2 identity model.** *(fixed 2026-06-09, `feature/guest-ux-fixes` — 'guest' / 'guest-kid' added to multiAssignableKeys unconditionally in guestOptionsBuilder.js.)*
Once any generic Guest is assigned, its `candidateId: 'guest'` enters the global exclusion set (`FitnessSidebarMenu.jsx:186-197`) with no `allowWhileAssigned` bypass (the generic option isn't a `guestCandidates` entry), and the top option is gated by `!seen.has('guest')` (`:230`). Result: the second Pikachu's picker simply has no "Guest" option — a silent dead-end in the most common multi-guest scenario the W2 work was built for.
*Fix path:* treat `'guest'` as inherently multi-assignable (skip it when building block keys, or check `seen` against the synthesized `guest_<deviceId>` instead of the raw `'guest'` id).

**G3 (carry-over). Silent strap swap remains undetectable.** Threshold absorption fixed short mistakes; long swaps still misattribute silently. HR-baseline anomaly detection remains the only credible fix.

### High

**N3. Two generic Guests are visually identical.** *(fixed 2026-06-09, `feature/guest-ux-fixes` — numbered display names via nextGenericGuestName — "Guest", "Guest 2", … counting adult and kid generics jointly.)* Same "Guest" label, same Pikachu, same everything except live HR values. Distinct identities under the hood deserve distinct presentation: numbered labels ("Guest 1/2") at minimum; color-keyed labels + distinct placeholder art ideally (Part 4).

**N4. No adult/kid distinction; kid guests get adult zone thresholds.** *(fixed 2026-06-09, `feature/guest-ux-fixes` — "Guest (kid)" picker option driven by fitness.yml guest_profiles.kid.zones; overrides flow through metadata.zones (types.js now accepts the array shape) and persist as guest_profile: kid.)* A kid on a borrowed adult strap is evaluated against the owner's zone profile — wrong zones, inflated coins, distorted governance. The `metadata.zones` override path exists and is wired (`ZONE_OVERRIDE_APPLIED`) but no UI ever sets it. Add "Guest (kid)" with a configured kid zone profile (Part 4). This is a *data correctness* issue dressed as a UX nicety.

**N5. Tagging a generic Guest produces almost no visible change.** *(fixed 2026-06-09, `feature/guest-ux-fixes` — generic Guests resolve to guest-adult / guest-kid placeholder avatars (Pikachu fallback until assets exist).)* Card label changes `#10366` → "Guest"; the face stays Pikachu. Hosts double-tap because the first tap "didn't seem to work." A distinct claimed-anonymous placeholder (Squirtle tier) makes success visible.

**N6. The threshold rule is invisible — silent correctness reads as uncertainty.** *(fixed 2026-06-09, `feature/guest-ux-fixes` — picker shows "{name}'s last N min on this strap will transfer to whoever you pick" when the active segment is sub-threshold.)* Nobody is told that the wrong-owner-for-3-minutes mistake will self-correct, so hosts either rush to tag (unnecessary) or distrust the data (unwarranted). One line of microcopy in the picker fixes this: *"Heads-up: the last N min on this strap will transfer to the new person."* Show it only when a sub-threshold segment exists — it doubles as an explanation of the rule exactly when it's relevant. (Re-scoped from old G4.)

**G11 (carry-over). Stray untagged straps still gate governance.** Now that INACTIVE exclusion shipped, the remaining hole is an *active* stray (left on a bench, still broadcasting picks up nothing… actually a shelf strap reads nothing — but a strap on a non-participating person reads HR and gates). Default-exempt untagged Pikachus from `active: all` until tagged, with a sidebar note "1 untagged device (not affecting playback)".

### Medium

**N7. "Original" / "Remove User" labels don't say what they do.** *(fixed 2026-06-09, `feature/guest-ux-fixes` — "⛔ Ignore This Strap" (was Remove User); Original option badged "Give back".)* Rename toward outcomes: "Give back to Alice" (Original) and "Ignore this strap" or "Hide until next reading" (Remove User). The current labels require knowing the implementation.

**N8. Friends→Family auto-tab-switch is disorienting.** When the Friends pool is empty the tab flips on its own (`FitnessSidebarMenu.jsx:275-279`). Better: keep the tab, show an empty-state line ("All friends are already assigned"), and badge the Family tab.

**N9. Pikachu menu header is unexplained.** *(fixed 2026-06-09, `feature/guest-ux-fixes` — explainer line in the picker when the device has no base user.)* Header shows `#99999` raw. Add a sentence: "Unrecognized heart-rate strap. Pick who's wearing it — or Guest if they're visiting." (G7 carry-over, one string fix.)

**N10. Guests are invisible as guests in reports.** *(fixed 2026-06-09, `feature/guest-ux-fixes` — muted "guest" text marker beside guest avatars in the session-detail timeline; sessionDataAdapter.js exposes isGuest/guestProfile. Lifecycle-event persistence NOT done.)* `is_guest: true` is persisted but never rendered; session-detail shows no badge and no hand-off markers (guest lifecycle events die with the in-memory EventJournal). Minimal fix: a "guest" chip next to the name in the session-detail roster; better: persist `ASSIGN_GUEST`/`GUEST_REPLACED` into the saved timeline events so the chart can mark hand-offs.

**N11. Registered-but-photo-missing = named Pikachu** (G18 carry-over). With a tiered placeholder system this becomes an initials avatar for free.

**G10 / G16 / G17 (carry-overs).** Promotion-to-config still requires SSH+restart; returnee surfacing still passive; no guest exit/summary moment. All unchanged.

### Low

**N12. Avatar 404s re-fire on every remount.** The onError fallback dance (`FitnessSidebarMenu.jsx:475-490`) re-requests known-missing images per render cycle of the picker. Cache negative results per profileId for the session. Cosmetic/network noise only.

---

## Part 6 — Prioritized Recommendations

Quick wins (hours, high leverage):
1. **N1a** — add purple/beige/teal (and a generic fallback set) to `colorIcons`; until the ring ships, at least the emoji matches the sticker. *(✅ fixed 2026-06-09, `feature/guest-ux-fixes`)*
2. **N2** — make generic "Guest" multi-assignable in the picker (singleton exclusion bug). *(✅ fixed 2026-06-09, `feature/guest-ux-fixes`)*
3. **N3** — numbered/color-keyed generic Guest labels ("Guest 1", "Guest 2"). *(✅ fixed 2026-06-09, `feature/guest-ux-fixes` — shipped as "Guest", "Guest 2", …)*
4. **N9** — explanatory header line in the guest picker for unmapped devices. *(✅ fixed 2026-06-09, `feature/guest-ux-fixes`)*
5. **N7** — outcome-based menu labels. *(✅ fixed 2026-06-09, `feature/guest-ux-fixes` — "⛔ Ignore This Strap", "Give back")*

Medium (a focused work session each):
6. **N4 + Part 4** — "Guest (kid)" option + `guest_profiles.{adult,kid}` zone blocks + age-class persistence. The zone plumbing already exists; this is mostly picker UI + config. *(✅ fixed 2026-06-09, `feature/guest-ux-fixes` — `guest_profiles.kid.zones` → "Guest (kid)" option → metadata.zones → `guest_profile: kid` persisted; required a types.js fix so array-shaped overrides actually apply)*
7. **Part 4 placeholder tiers** — Pikachu (untagged) / Squirtle (anonymous adult Guest) / kid mark (anonymous kid Guest) / initials (registered, photo missing). Resolves N5, N11/G18, and half of N3 in one coordinated pass. *(◐ partially fixed 2026-06-09, `feature/guest-ux-fixes` — N5 shipped via `guest-adult` / `guest-kid` placeholder image ids, Pikachu fallback until assets exist; initials avatar for N11/G18 NOT done)*
8. **§3 proper** — avatar ring/border in saturated sticker color + color-name labels ("Purple strap") + hash-color fallback for unconfigured IDs. *(✅ fixed 2026-06-09, `feature/guest-ux-fixes` — 3px inset avatar ring)*
9. **N6** — sub-threshold transfer microcopy in the picker. *(✅ fixed 2026-06-09, `feature/guest-ux-fixes`)*
10. **N10** — guest chip in session detail; persist guest lifecycle events into saved timeline. *(◐ partially fixed 2026-06-09, `feature/guest-ux-fixes` — muted "guest" marker shipped; lifecycle-event persistence NOT done)*

Large (design-first):
11. **G1** — pre-session lobby / expected-participants pre-allocation (still the biggest leap; would also give BLE failures a place to surface when that hardware returns).
12. **G3** — HR-baseline anomaly detection for silent swaps.
13. **G10** — in-app "save as friend/family" promotion writing back to `fitness.yml`.

---

## Appendix — Best-Practice Deltas

Patterns standard in comparable "shared device, ambient display" UX that guest mode lacks:

| Practice | Status here |
|---|---|
| **State changes produce visible feedback** | Partially — tag ack flash exists in the menu, but card-level change for generic Guests is nearly invisible (N5) |
| **Empty states explain themselves** | Missing — empty Friends tab silently switches (N8); missing "Guest" option gives no reason (N2) |
| **Labels describe outcomes, not mechanisms** | Missing — "Remove User", "Original" (N7) |
| **Distinct semantics get distinct visuals** | Missing — one Pikachu for three states (Part 4) |
| **Physical↔digital mapping at a glance** | Missing — sticker colors not surfaced (N1) |
| **Onboarding affordance for newcomers** | Missing — no "how to join" hint anywhere (Stage 1) |
| **Calibration follows the person, not the hardware** | Missing — zones follow the strap unless config overrides (N4) |
| **A closing moment** | Missing — no guest summary/exit (G17) |

---

## See Also

- [`2026-05-26-guest-mode-ux-audit.md`](./2026-05-26-guest-mode-ux-audit.md) — journeys A–K, permutation matrix, original gap list (G1–G20), decisions §1–§7
- [`guest-mode.md`](../../reference/fitness/guest-mode.md) — current-state lifecycle/UX reference (updated 2026-06-09)
- [`assign-guest.md`](../../reference/fitness/assign-guest.md) — threshold rules, entity lifecycle
- [`unknown-hr-monitors.md`](../../reference/fitness/unknown-hr-monitors.md) — Pikachu mechanics, ANT+/BLE admission
