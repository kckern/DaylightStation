# Rings, and weekly measures on the school board

Status: implemented; weekly boundary amended 2026-08-31.

Three independent projects. **A** renames a concept, **B** migrates the data
that concept is stored in, **C** wires the number onto the school status board.
They ship in the order A → B → C, but only B depends on A.

## 1. Why

Fitness awards a per-participant score derived from heart-rate zones. It is
currently called **coins**, which collides with the household currency — a real
append-only ledger, convertible to cash, spent as a metered drain in the arcade.
The economy reference already needs a callout box to tell them apart, and the
collision is the reason "an explicit exchange bridges them" has sat unbuilt.

They are not the same kind of thing. One is money; the other is a measure of
effort. The fix is to stop calling the measure a currency.

**The new name is `rings`** — Sonic rings are earned by moving, Olympic rings
are the athletics association, and a gold ring is legible as a disc on a wall
panel at a glance.

Separately, nobody can currently see how much a child has moved this week. The
number exists and is computed; it is simply never surfaced.

## 2. Terminology

| Term | Meaning |
| --- | --- |
| `coins` | The household currency. Unchanged. Ledger-backed, spendable. |
| `rings` | The fitness effort measure. Formerly "fitness coins". |
| measure | The abstract family `rings` belongs to. Not "points" — points implies they sum together, and future measures will not share a unit. |

---

# Project A — `coin` → `ring` across fitness

## 3. Scope

~832 occurrences across 76 files:

| Area | Files | Occurrences |
| --- | --- | --- |
| `frontend/src/hooks/fitness` | 27 | 332 |
| `frontend/src/modules/Fitness` | 30 | 270 |
| `backend/src/2_domains/fitness` | 13 | 196 |
| `backend/src/3_applications/fitness` | 6 | 34 |

Identifiers, API fields, CSS class names, comments and docs all rename.
`totalCoins` becomes `totalRings`; `coinsSeries` becomes `ringsSeries`;
`session-row__coins` becomes `session-row__rings`.

## 4. The persisted keys rename too

An earlier draft kept the on-disk keys as `coins` behind a serializer boundary.
That is reversed: the keys rename, and Project B migrates the data. The reason
is that the boundary would have been permanent — a third legacy-read branch on
top of the two the v2→v3 mapping already carries — to avoid changing a string
in files we control. Migrating once and deleting the shim is the smaller
long-term object.

**But the code ships dual-read first.** See §7.

## 5. It lands as one behaviour-free commit

The rename must not share a commit with any wiring change. 332 occurrences in
`hooks/fitness` alone means a bisect through a mixed commit cannot tell a
rename typo from a logic error.

---

# Project B — migrating the stored measure

## 6. The corpus

| Path | Files | Action |
| --- | --- | --- |
| `data/household/fitness/log/**.yml` (excl. `_index`, `_backups`) | **2,897** | migrate |
| `data/household/fitness/log/_index/*.json` | 131 | **rebuild from source** |
| `data/household/fitness/log/_backups/**` | 7 | migrate |
| `data/_deleteme/household-history-fitness/` | 2,911 | **skip** — retired |
| `data/users/kckern/lifelog` | 1 | **skip** — out of scope |
| `media/fitness/**` | 0 | nothing there |

Key shapes present in live data: `totalCoins` (1,083 hits), `<slug>:coins`,
and bare `coins:`.

`_index/*.json` are derived. Rebuilding them from the migrated sources proves
the migration is *coherent*; rewriting them textually would only prove it is
consistent.

## 7. THE HAZARD: match keys, never the word

**6,215 files under `data/` contain the string "coin". Roughly half are
Shakespeare quiz content** — *The Merchant of Venice*, "a risky bond",
"caskets and courtships".

A word-level `coin` → `ring` sweep would silently rewrite the children's
literature curriculum, and the damage would surface months later inside a quiz.

The migration matches **key shapes only**:

```
coins_total   <slug>:coins   totalCoins   ^\s*coins:
```

It never matches a bare `coin` in prose. Any migration tooling that cannot
express that constraint is the wrong tooling.

## 8. Sequence — no flag day

The app reads these files continuously, so the code and the data cannot change
in the same instant.

1. **Dual-read ships first.** Readers accept `coins*` and `rings*`; writers emit
   `rings*` only. Deploy. Old and new files coexist indefinitely and nothing
   breaks.
2. **Migrate at rest.** Key-targeted, idempotent, resumable, backed up first —
   the tree already has a `_backups/` convention to follow.
3. **Rebuild `_index/*.json`** from the migrated sources.
4. **Delete the legacy read branch** once a verification pass reports zero
   `coins*` keys outside `_deleteme`.

Step 4 is what makes this worth doing: it removes the shim rather than
enshrining it.

## 9. Operational constraints

- The data volume is root-owned. Writes go through `docker exec`, which runs as
  **root**, so every touched file is `chown node:node` afterwards.
- Nothing is deleted. Anything replaced moves to the existing `_backups/`
  convention, never `rm`.
- The migration reports counts per pass (scanned / changed / skipped) and is
  safe to re-run; a second run must change zero files.

---

# Project C — rings on the school status board

## 10. What v1 ships

A ring icon and a number on each card of `AgendaStatusBoard`. Nothing else.

No target, no quota configuration, no progress bar, no gate. Those are §14.

## 11. Three layers

**1. Surface what is already computed.** Add `rings` to each entry in
`participants[id]` on the session summary. `computeParticipantStats` already
derives it (`sessionSplit.mjs`); the summary simply does not return it — it
returns only a session-level `totalCoins`. Without this, a weekly total means
decoding every session's series on a board that repaints every five minutes.

**2. A one-method measure seam.**

```
total({ learnerId, from, to }) -> number
```

Registered by id (`fitness.rings`). v1 registers exactly one provider. This is
a registry and an interface — roughly thirty lines — not a framework. It exists
so the second measure is a new file rather than a refactor of the first, and so
everything measure-specific (how rings derive from zones) stays inside the
fitness provider.

**3. One roster-wide endpoint.**

```
GET /api/v1/measures/weekly?week=YYYY-MM-DD

{ "window": { "from": "2026-08-24", "to": "2026-08-30" },
  "learners": [ { "learnerId": "user_4",
                  "measures": [ { "id": "fitness.rings", "label": "Rings",
                                  "unit": "rings", "value": 40 } ] } ] }
```

Roster-wide, following the `teacherDay` digest pattern the board already uses —
four cards must not mean four round trips.

There is no `target` key in v1, and the shape has an obvious place for one.

## 12. The week

**Monday 04:00 → the following Monday 04:00**, using the same 4am study-day
boundary school already applies, so the house has one definition of "day" and
one hard weekly reset instead of a rolling seven-day window.

| Day | Role |
| --- | --- |
| Mon–Fri | The working window. A quota's deadline is end of Friday. |
| Sat–Sun | Catch-up if short; **payoff** if met. |

Nothing is discarded. Saturday and Sunday stay in the week that began the
previous Monday. Monday is the only weekly rollover.

## 13. Compute the week's state from day one

The model derives one of three states even though v1 renders none of them:

- **on track**
- **behind** — the weekend will be catch-up
- **met** — the weekend is payoff

This is the vocabulary the eventual gate needs. Deriving it later would mean
revisiting every layer; deriving it now costs a function and no UI.

## 14. Roadmap — deliberately not built

**A ring quota is a dated module whose completion test is a number instead of a
lesson list.** Same window semantics, same `catch_up` state, same obligation
vocabulary as Come Follow Me. When gating arrives it reuses
`evaluateDatedModule` rather than growing a parallel system. That is the
"enrollment-adjacent" thing this design was reaching for.

**The Saturday rule gates fun, not schoolwork.** "You may play games on
Saturday unless you are behind" has the same consumer as the existing Piano
Games unlock, which gates on `complete` / `no_work_today`. It is **not** a
`resolveDayCompletion` obligation. Written down here so it is not built as a
school-day obligation by mistake.

Also deferred: quota configuration, per-week targets, additional measures, and
the rings ↔ coins exchange.

## 15. The icon

Source: `media/fitness/ux/spinning-ring.svg`, brought **into the codebase** as
the canonical ring icon, authored as a JSX component. 512×512 viewBox, 10.6KB,
carries `<title>`, `<desc>` and `role="img"`.

### 15.1 What it already gets right

`plane-turn` samples cos(θ) across sixteen stops to fake a three-dimensional
turn using **only `scaleX`**. It is transform-only, so it composites on the GPU
and never triggers paint — the correct choice for a wall-mounted tablet, and it
avoids the animated-`filter` cost this codebase has been bitten by before. The
extrusion slices animate `type="translate"`, also transform-only.

Everything — CSS and SMIL alike — runs on **one 2.8s clock**.

### 15.2 Three fixes on the way in

**1. Unify the animation on CSS.** It currently animates two ways: 8 ×
`<animateTransform>` (SMIL) plus 6 × `@keyframes` in a `<style>` block, with no
reduced-motion handling anywhere. CSS `prefers-reduced-motion` stops keyframes
but **cannot stop SMIL**, so inlining as-is would leave the school board — a
surface that explicitly honours reduced motion — carrying the one element that
ignores it.

The 8 SMIL elements are plain translates on the same 2.8s clock, so porting
them to CSS keyframes is a faithful transcription, not a redesign. Afterwards a
single `@media (prefers-reduced-motion: reduce)` block and a single class each
stop all motion, and there is one mechanism that cannot drift out of sync with
itself.

**2. Static is a paused animation, not a second drawing.** `plane-turn` begins
at `0% { transform: scaleX(1) }` — the face-on, widest, most legible pose — so
`animation-play-state: paused` holds exactly the frame wanted at 16px. One
source of truth; no divergent static variant to maintain.

**3. Namespace every ID.** It declares eight: `depth-slice`, `description`,
`face-gloss`, `gold-band`, `gold-face`, `orange-band`, `ring-shadow`, `title`.
Four cards on the board means four duplicate IDs in one document and an
ambiguous `url(#orange-band)`. Each instance prefixes its IDs from React's
`useId()`, interpolated in JSX — **not** a raw SVG string rewritten by regex at
runtime, which would be fragile in exactly the way ID bugs are hard to see.

It is also **not a `currentColor` icon** — it is a fixed gold gradient
illustration — so it must not go through `School/home/icons/Icon.jsx`, whose
whole contract is raw SVG inheriting `currentColor` from its tile.

### 15.3 The API

```jsx
<RingIcon size={16} />                  // static, decorative — the school board
<RingIcon size={64} spin />             // continuous — the fitness app
<RingIcon size={24} spin="once" />      // one turn when the number changes
<RingIcon size={16} label="rings" />    // accessible when the icon IS the content
```

- `spin`: `false` (default) | `true` | `'once'`
- `label`: absent renders `aria-hidden`; present renders the namespaced
  `<title>` and `role="img"`
- **`prefers-reduced-motion` forces static regardless of `spin`.** The prop is a
  request; the OS setting is the authority.

Static is the default deliberately: the board is the surface with four
instances and a documented one-motion budget, so the safe presentation is what
a caller gets by not thinking about it.

`spin="once"` ships in v1 with no caller. It is the natural home for the "you
just earned rings" moment and costs one `animation-iteration-count`.

It also replaces the two hand-rolled `CoinIcon` definitions currently duplicated
in `FitnessSessionsWidget` and `FitnessSessionDetailWidget`.

## 16. The board's motion budget

`AgendaStatusBoard`'s docblock states that the green "breathe" on a cleared day
*"is the only motion on the panel"* — worth the animation budget because it is
the sole reward signal a child reads from across the room.

A permanently spinning ring on every card would compete with it. The static
presentation (§15) preserves the invariant, and the board's docblock is updated
to say so rather than leaving the next reader to rediscover the rule.

## 17. Tests

Project A: the rename is behaviour-free, so the existing fitness suites passing
unchanged **is** the test. No new assertions.

Project B:
- key-shape matcher accepts the four live shapes and **rejects prose** — a
  Shakespeare fixture containing "coin" must come through byte-identical
- migration is idempotent: a second pass changes zero files
- `_index` rebuilt from migrated sources equals the index the app derives live

Project C:
- the measure provider totals a known week from fixture sessions
- the Monday 04:00 boundary: a 03:00 Monday session lands in the *previous*
  week; 05:00 Monday lands in the next
- Saturday and Sunday count toward the week; the following Monday does not
- the endpoint returns one row per rostered learner, including learners with
  zero rings
- `RingIcon` renders static by default
- two `RingIcon`s in one document share no element ID (the four-cards case)
- `spin` renders static anyway under `prefers-reduced-motion: reduce`
- no `<animateTransform>` survives in the component — if one does, reduced
  motion is silently broken again and only this test would notice

## 18. Shared weekly projection

The Fitness home screen and the school board use the same Monday boundary and
the same persisted per-participant ring totals. State Gates remains the
external projection; Fitness reads the internal session summaries directly.
