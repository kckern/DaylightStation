# Media redesign — batch 1 reconciliation and closure brief

**Purpose:** restart from the existing scoped evidence, preserve interrupted work, and close one P0 story rather than create foundations. This is a dispatch brief, not an acceptance decision.

## Snapshot and boundaries

- Ledger totals: **82 stories / 288 AC; 0 accepted stories; 13 partial stories; 22 partial AC; 266 unverified AC**. A scoped pass never accepts its parent story.
- Evidence at `5a054a11cdd4c23bf03ead5e96bc2d1b47ef7f7e`: native 11/11, HLS 12/12, phone 7/7, tablet 7/7 green; `/tmp/media-redesign-controls-queue-search-regression.log` ends **7 passed (1.9m)**. These are reusable revision-specific evidence, not blanket acceptance.
- Worktree is dirty: the Player/Media/session/screen-framework edits are interrupted **F3e** work; untracked `backend/src/3_applications/devices/services/DeliveryAttemptAuthority.{mjs,test.mjs}` are unfinished **Task8b**. Preserve and park all of them. The immutable `5a054a11c` preview reported by root is usable only for existing-evidence/RED confirmation; **new-code GREEN must run from an exact new clean snapshot containing this packet and excluding parked changes**. Do not depend on either parked set without an explicit re-scope.
- Live state recorded 2026-09-19: `HEAD 5a054a11c`; 13 tracked modified files (ledger plus F3e files) and the two Task8b untracked files. No deployment or physical mutation is authorized.

## Partial-story reconciliation

`P` means evidence exists but is insufficient; `U` means no conclusive evidence. The AC lists are complete for each partial story; evidence citations abbreviate the ledger's `JOURNEY-*` records.

| Story | All ACs / current evidence | Specific full-acceptance gap |
|---|---|---|
| FIND.1a | AC1–4 U; AC5 P — `JOURNEY-SEARCH` phone ordinary Play preserves query/narrowing/dialog with real advancing video (`8303c16b0`) | AC1–4, plus Add and Play-on retention and phone/tablet/laptop parity for AC5 |
| PLAY.6a | AC1 P — desktop keyboard/pointer Add→held queue→explicit Play and receiver route; AC2 P — paused/Add and advancing exact-node evidence (`26262`, `0c0c37e77`); AC3 U | every surface, aim and device/remote parity; confirmation item/ordinal/screen |
| PLACE.1a | AC1–2 U; AC3–4 P — `JOURNEY-PEEK-AIM` local playback remains local while Office controls open | all play/line-up surfaces and sizes, naming/room labels, all verbs/aims |
| PLACE.2a | AC1 U; AC2/3/5 P — `JOURNEY-AIM-IDLE` phone reload/persistence, 2h expiry and post-expiry local aim; AC4/6 U | picker reachability, active-play exemption, closed-app reopen, all actions/surfaces |
| PLACE.2b | AC1 P — `JOURNEY-AIM` phone; AC2 P — search/reopened-picker update; AC3 U | tablet/laptop, every displayed aim, Start-fresh offer |
| STEER.1a | AC1–2 U; AC3 P — `JOURNEY-SINGLE-CONTROLS` desktop actual node/Back; AC4–5 U | all app surfaces/sizes, open+queue, last remote target, lock-screen/notification path |
| STEER.2a | AC1–2 P — desktop + `JOURNEY-RESPONSIVE-CONTROLS` phone/tablet actual viewport, exact-node/no-pause shrink/Back; AC3 U | audio expanded picture/title and the remaining entry-point/format parity |
| STEER.3a | AC1 P — `JOURNEY-LOCAL` real local pause/resume; AC2–4 U | skip, 2-second state/not-sent behavior and remote parity |
| STEER.4a | AC1 P — `JOURNEY-PAUSED-SEEK` actual desktop decoder completion; AC2 P — `JOURNEY-LOCAL` local ±10s; AC3 U | remote, formats/devices, live label/go-live |
| STEER.5a | AC1 P — `JOURNEY-VOLUME-STEPS` local video; AC2 P — `JOURNEY-RATE-PERSISTENCE` local 1.25× restart; AC3 U | responsive/remote, spoken word, and change-on-steered-screen proof |
| STEER.6a | AC1 P — `JOURNEY-STOP-RESTART` local Stop; AC2 P — `JOURNEY-STOP-FEEDBACK` visible retained count/reopen; AC3–4 U | same semantics remotely/surfaces, separate clear, supported screen-off |
| STEER.7a | AC1 U; AC2 P — local post-Stop reopen/restart; AC3–5 U | handle and remote one-step access, queue shape/count/next, photo/live rules, played-earlier |
| RELY.10a | AC1–2 U; AC3 P — retained-search desktop Escape/real-provider second Back (`26262`) | device/on-screen Back, destination labels, all popup types and device-size parity |

**Proposed ledger changes now:** none. Every P row still states a named cross-surface, device, format, remote, or required AC gap; no evidence conclusively satisfies an entire AC beyond its current Partial status.

## Selected P0 closure: STEER.2a — expand/shrink

This is the nearest meaningful closure: its two video ACs already have actual desktop/phone/tablet evidence at the exact retained revision, and its single wholly missing requirement is local audio presentation. It does **not** weaken entry-point or format coverage.

| Exact acceptance criterion | Reusable evidence | Closure evidence required |
|---|---|---|
| AC1: Video expands to fill the screen/display in one step. | `JOURNEY-RESPONSIVE-CONTROLS`, `5a054a11c`: desktop, phone 7/7, tablet 7/7; ordinary clicks and viewport bounds. | Rerun the existing focused video journey from normal search entry at desktop/phone/tablet; preserve actual player and in-bounds controls. |
| AC2: Shrinking keeps it playing without pause/restart. | Same run: exact attached node/source and zero pause events through shrink/Back. | Same three viewports/entry path; assert attached node, source and advancing time after shrink and Back. |
| AC3: Audio-only playback shows a picture and title when expanded. | None; current `NowPlayingView` only offers expand for `isVideo`. | Implement and test an accessible one-step audio expand/shrink in the same local surface; actual audio entry must show recognisable art/placeholder and title, remain reachable/in bounds, and retain playback through shrink/Back at desktop/phone/tablet. |

### Small, executable packet

**Candidate implementer:** Terra, medium, one narrow UI/integration pass. Scope only `frontend/src/modules/Media/shell/NowPlayingView.jsx`, `NowPlaying.scss`, `NowPlayingView.test.jsx`, and an additive, ordinary-input audio case in `tests/live/flow/media/media-app-playback-journey.runtime.test.mjs`. Do not edit Player, LocalSessionController, PlayerBridge, screen-framework, ledger, or Task8b files.

1. RED: add the AC3 component contract and a real local audio journey; extend the existing AC1/2 journey matrix to desktop/phone/tablet only if it lacks a recorded normal entry path. No fabricated session state, forced/synthetic clicks, or device writes.
2. GREEN: make audio expansion present picture/placeholder and title while retaining the local host/playback; retain existing video semantics. If this requires a parked F3e/Task8b seam or an unsupported audio source, stop and re-scope rather than broaden foundations.
3. Focused commands (run only after implementation): `npx vitest run frontend/src/modules/Media/shell/NowPlayingView.test.jsx`; then run the added audio case and only the existing `[STEER.2a/AC1][STEER.2a/AC2]` case at the named viewport(s) from an exact new clean snapshot containing this packet and excluding parked changes. The immutable `5a054a11c` preview may establish existing behavior/RED only. Record exact revision, command, title/source, and native observations. Acceptance remains pending until the required matrix is green and independently reviewed.

## Approved operating policy

- Terra medium for coordination/ordinary integration; Luna for narrow mechanical work; Sol for bounded difficult escalation; Astra only with user approval.
- At most two implementation workers and one browser lane; exact short packets, no history fork; one independent reviewer; reuse exact-revision evidence.
- Maximum two failed repair cycles, then reassess. At each batch checkpoint record accepted/partial/unverified and `usage: unknown` when unavailable.
- No deployment, physical mutations, or global Codex configuration changes. This owner-approved policy overrides any skill instruction requiring expensive broad continuous work or five repair rounds.
