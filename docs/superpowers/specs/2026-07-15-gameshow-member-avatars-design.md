# GameShow Member Avatars + Contextual Names — Design

**Date:** 2026-07-15
**Status:** Design (proceeding on recommended defaults — user stepped away mid-scoping; assumptions flagged **[ASSUMED]** for course-correction at the spec-review gate)

## Problem

The GameShow TeamSetup screen — and every surface that shows team members — renders members as plain text names (e.g. "Felix ×", "KC Kern ×"). The user wants:
1. **Member avatars** shown in TeamSetup and **throughout the game**.
2. Names resolved **with household context**, so parents show as **"Mom" / "Dad"** instead of given names.

## Key finding: the data already exists

- `GameShowService.#hydrateMember` (`backend/src/3_applications/gameshow/GameShowService.mjs:22`) already resolves every preset member to `{ id, name, avatar }`, where `avatar = /api/v1/static/users/{id}` — a real image endpoint. All six current preset members (felix, milo, alan, soren, kckern, elizabeth) return `200 image/jpeg`. The frontend simply **discards** the avatar and renders only the name.
- The frontend flow preserves the field: `teamSetupReducer.fromPreset` spreads member objects, `ASSIGN_MEMBER` re-spreads them, and confirmed teams pass through `flow.teams` into the game — so `team.members[].avatar` is available on every play surface. Guests added in-UI get `avatar: null`.
- The **contextual label** ("Mom"/"Dad") is the profile field **`group_label`**. Verified: `kckern → Dad`, `elizabeth → Mom`; the four kids have **no** `group_label`. So the rule "use `group_label` when present, else `display_name`" yields Mom/Dad for parents and given names for kids — exactly the request. `UserService` already has this exact fallback (`getGroupLabel`-style: `group_label || display_name || username`).

So this feature is mostly **frontend rendering** plus a **one-line backend name change** — no new data, no new endpoint.

## Decisions

| # | Decision | Value |
|---|----------|-------|
| D1 | Contextual name rule | `group_label || display_name || id` in `#hydrateMember`. Applies everywhere member names appear (all surfaces read `member.name`). |
| D2 | **[ASSUMED]** Avatar surface scope | **Everywhere**: TeamSetup chips, Scoreboard team cards, buzz-in banner, Results, host companion header. (User's words: "throughout the game.") |
| D3 | **[ASSUMED]** No-image fallback | **Initial letter on the team color** (reusing the design system's `onColor()` for contrast). Cohesive, always intentional. Guests and any 404 user get this. |
| D4 | Avatar component | New GameShow-local `MemberAvatar` — NOT the Fitness `CircularUserAvatar` (that's coupled to HR/zones/gauges). Keeps the module self-contained. |
| D5 | Degradation | Every surface renders text-only when a member has no avatar image (fallback handles it) and renders nothing extra when a team has no `members` array. No surface breaks on missing data. |

## Component: `MemberAvatar`

`frontend/src/modules/GameShow/shell/components/MemberAvatar.jsx` (+ `.scss`, + test)

- **Props:** `member` (`{ id, name, avatar }`), `teamColor` (string, for the fallback fill + ring), `size` (px, default 40), `showName` (bool, default false — some surfaces want avatar-only), `className`.
- **Render:** a circular element with a subtle ring in `teamColor`.
  - If `member.avatar` is set: `<img>` from that URL. On `onError` (image 404s despite a URL), swap to the initial fallback.
  - Fallback: a circle filled with `teamColor`, showing `member.name[0]` uppercased, text color from `onColor(teamColor)` (imported from the existing `shell/teams/teamColors.js`).
  - When `showName`, the name renders beside the circle (used by TeamSetup chips).
- **Accessibility:** `alt`/`title` = `member.name`.
- Tokenized: ring/border/typography via `--gs-*` tokens; no hex literals.

## Surface-by-surface changes (all frontend, all degrade gracefully)

1. **TeamSetup** (`TeamSetup.jsx` + `TeamSetup.scss`) — the screen the user is on.
   - Assigned-member chips (`gs-chip--member`, currently "Felix ×"): `<MemberAvatar size={28}>` + name + `×`. Still a button that removes on click.
   - Pool chips (`gs-chip--pool`, "+ Felix"): small avatar + "+ name" for recognition.
   - Guest chips: fallback initial (guest has no image).

2. **Scoreboard** (`Scoreboard.jsx` + `.scss`) — persistent during play.
   - Under the team name, a compact row of `MemberAvatar size={24}` for `team.members`. Team color already themes the card; avatars add faces. If `members` is empty/absent, the row is omitted (unchanged look).

3. **Buzz-in banner** (`ClueScreen.jsx` `.jp-clue__locked`).
   - Prepend the buzzing team's member avatars (small row) before "{team.name} buzzed in!". `lockedTeam.members` is available (it's a full team object). Degrades to text-only if no members.

4. **Results** (`Results.jsx` + `.jp-results` in `Jeopardy.scss`).
   - Each ranked `<li>` gains a member-avatar row beside "{team.name}: {score}".

5. **Host companion** (`GameShowHost.jsx` `.gsh__score` + `.scss`).
   - Tiny avatars (`size={20}`) in each team's score chip. **Best-effort**: renders only if `session.teams[].members[].avatar` is present in the persisted session. If the backend session doesn't carry member avatars, the host silently shows text (no breakage) — a follow-up can thread it through, but this is out of the critical path.

## Backend change (one line + test)

`GameShowService.#hydrateMember`: `name: profile.group_label || profile.display_name || id`.
- Update `GameShowService.test.mjs` to add a member whose mock profile has a `group_label` and assert the label wins; keep an assertion that a member without `group_label` still resolves to `display_name`.

## Testing

- **`MemberAvatar.test.jsx`** (TDD): renders `<img>` with the avatar URL when present; renders the initial-on-team-color fallback when `avatar` is null; `onError` swaps img→fallback; `showName` renders the name; `alt`/`title` = name.
- **`GameShowService.test.mjs`**: group_label-wins + display_name-fallback assertions.
- **TeamSetup**: existing `teamSetupReducer.test.js` is unaffected (asserts ids/slots/members, not rendering). No new reducer logic.
- Full module suite (`npx vitest run src/modules/GameShow`) + `npx vite build` green at each step.

## Out of scope

- Threading member avatars into the **persisted backend session** for the host companion (host avatars are best-effort from whatever the session already carries).
- Any avatar upload/management UI (images already exist on disk).
- The input/flow blockers from the prior audit (remote focus nav, DD wager, etc.).
- Changing team names or the preset structure.

## Reversibility

All changes are additive rendering + one backend name line; fully reversible via git. No data migration.
