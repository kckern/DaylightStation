# School Physical Console — Merge Review Guide

**Branch:** `feature/school-document-system` (worktree `.worktrees/school-docs`)
**Size:** 59 commits, 152 files, ~25,500 insertions
**Tests:** 1,502 school tests, 63 files, zero skips. `npm run school:smoke` → 23/23.

The branch is large, but almost all of it is **new files in new directories**.
This guide points at the small part that isn't — the places where it touches
code that already worked. Review those; skim the rest.

---

## 1. The actual risk surface (4 files)

Everything else added is new school code under new paths. These four modify
existing behaviour:

### `backend/src/3_applications/economy/EconomyService.mjs` — real money

Two additive changes:
- `earn()` gains an optional `amount`, so a caller whose own policy declares a
  reward (a school unit's `reward.amount`) can pay that instead of the catalog's
  flat rate. **Still bounded by `daily_cap`** — the household ceiling is not the
  caller's to raise. A non-positive or non-integer override is *ignored* rather
  than treated as zero, so a miswiring cannot silently cancel a real reward.
- Returns now carry `txnId`, including on the duplicate path (the already-paid
  id), so a caller holding its own durable record can store the same id on a
  retry instead of recording "paid, id unknown".

**Why it's safe:** the only pre-existing call site
(`4_api/v1/routers/play.mjs:204`, the piano lesson hook) passes no `amount`, so
its behaviour is unchanged. 24 economy tests pass, including the pre-existing
ones asserting specific return fields.

**What to check:** that you agree a caller may name its own amount at all. The
alternative was deleting `reward.amount` from the unit schema — a field that
silently did nothing was the third option and the wrong one.

### `backend/src/app.mjs` — the barcode relay branch

A `sch:`-prefixed branch added at the **top** of the relay's `onScan` router,
ahead of the nutribot and trigger branches.

**Why it's safe, and how it's enforced rather than asserted:** a test reads
`app.mjs` and pins the source order (school branch after `onScan:` opening,
before `route === 'nutribot'`, with `return;` guarding fall-through) and pins
that both existing branches are still verbatim. A second test asserts the
predicate rejects every code shape existing consumers produce — UPC-A/EAN-13/
UPC-E digits, `dl:`/`ct:`/`rs:` fridge-sheet codes, `plex:` ids, trigger values.
When the console is disabled, `handlesCode` is a constant `false`, so the branch
is provably a no-op on any deployment that hasn't opted in.

**What to check:** that a `sch:` prefix is genuinely unreachable by your
scanners. Real barcodes are digit-only, which is the argument, but you know the
hardware.

### `frontend/src/Apps/AdminApp.jsx` + `modules/Admin/AdminNav.jsx`

New Admin section entries. Additive routes/nav only.

### `.gitignore`

Ignores golden-diff PNGs (regenerated on every failing render run) and a root
scratch dir. Without this a careless `git add -A` commits debug artifacts as
source.

---

## 2. Two things that ship OFF

- `lifecycle.enabled` is not set, so `createSchoolLifecycle` returns
  `{ wired: false }` and nothing mounts. Merging changes no runtime behaviour.
- `lifecycle.economy.enabled` defaults false, so no coins move until you say so.

Enabling both is documented in
[`docs/runbooks/school-physical-console-deploy.md`](../runbooks/school-physical-console-deploy.md).

---

## 3. Fixes to pre-existing breakage that ride along

- `tests/isolated/application/school/plexShowSource.test.mjs` and
  `plexAlbumSource.test.mjs` were failing **on main**: commit `11e8ac1cf` added a
  `summary` field to plex material mapping and never updated the expectations.
  Fixed here (three `summary: null` additions). Confirmed pre-existing by
  `git merge-base --is-ancestor`.
- The full isolated suite fails fewer files here than on main (a strict subset).
  The remainder — nutribot dates, piano router, Immich, localContent, fitness —
  are untouched by this work.

---

## 4. Known gaps, deliberately not closed

| Gap | Consequence today |
|---|---|
| Playback not wired to real hardware | A media unit prints *"there is nowhere to play this"* rather than failing silently. Worksheet/OMR/quiz units unaffected. |
| Nothing has been printed on the real printer | **The largest unvalidated assumption.** If the Brother rescales or shifts margins, every OMR bubble moves and no software test can see it — our writer and reader share one form map and would agree with each other about coordinates that no longer match the ink. |
| Form map vs actual ink | Never independently verified. A drift affecting record and reader equally is invisible until a real scanner sees it. |
| Golden pixel gate at 0.5% | Adding the QR moved 0.33% of a page — under tolerance. Codes are covered by `codeMap` assertions; other small critical marks are not. |
| OMR hardware | Protocol solved; no assembled reader, no card that fits it. |
| Retry variants | A retry reprints the same questions under a new form letter. Real equivalent-problem generation is its own project. |

---

## 5. Suggested review order

1. `EconomyService.mjs` diff (~30 lines) — the only change touching money.
2. The `sch:` branch in `app.mjs` and
   `tests/isolated/composition/schoolLifecycleWiring.test.mjs`.
3. `backend/src/5_composition/modules/schoolLifecycle.mjs` — the whole subsystem's
   wiring and its fail-closed behaviour, in one file.
4. `tests/isolated/e2e/school/sabotage.test.mjs` — six deliberate defects, each
   asserted to turn the suite red. This is the fastest way to judge whether the
   tests would notice a regression.
5. Skim `docs/reference/school/README.md`'s new section for the design decisions.
