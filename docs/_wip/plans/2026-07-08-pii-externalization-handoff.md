# Handoff: Externalize household PII from committed code

**Status:** Scrub DONE, verified, and committed on a branch. **NOT yet on `main`, NOT pushed.**
The only thing left is landing the clean history onto `main` and pushing — blocked purely by
`main` being a continuously-moving target during this session (see Blocker).

---

## Objective (from the user)
This repo is **public**. Real household PII was embedded throughout committed **code**
(overwhelmingly test fixtures + docs): family first-names used as user IDs, hardware strap
device IDs, the head-of-household id/email. Goal: **no real PII in committed code — real
values live only in gitignored `data/**` yml; use generic aliases in code.** The app already
resolves real names from yml at runtime (`ConfigService.getHeadOfHousehold/getUserProfile`,
`UserService.resolveDisplayName` ← `data/users/*/profile.yml`), so **no new resolver is
needed** — code just stops hardcoding real values.

The exact tokens that must disappear from committed code = the push guard's patterns in
**`.claude/secret-patterns.local.txt`** (gitignored): 7 family first-names, the two
grandparent ids, 7 numeric strap device IDs, and the head-of-household email. (`kckern` alone
is the repo-owner's public GitHub/Docker handle and is **NOT** a guard pattern.)

## Alias scheme (bijective, case-aware, whole-word)
- head-of-household id `kckern` → `user_1` **in identity contexts ONLY** (preserve infra:
  hostnames `kckern-server`, domains `kckern.net`, docker/github `kckern/…`, package
  `net.kckern.*`, filesystem paths `/Users/kckern/…`).
- head-of-household display `KC Kern` → `User_1`; head-of-household email → `user_1@example.com`.
- the 7 first-names (in the order listed in `secret-patterns.local.txt`) → `user_2 … user_8`.
- spouse → `user_9`; the two grandparent ids → `user_10`/`user_11`.
- the 7 device IDs (in `secret-patterns.local.txt` order) → `90001 … 90007`.
- **Keep** the media title "Felix Lullabye" (not PII — the guard itself whitelists it).
- Real names in gitignored `data/**` are the SSOT — **left untouched**.

## Reusable tooling (durable, gitignored) — `.pii-scrub/`
- `.pii-scrub/pii-scrub.mjs` — the scrub script. `node .pii-scrub/pii-scrub.mjs` (dry-run) or
  `--apply`. Case-aware, whole-word, bijective; skips `data/`, `.claude/`, `node_modules`,
  lockfiles, binaries, `dev.log*`; `kckern` uses a lookbehind so infra tokens survive.
- `.pii-scrub/filter-repo-map-guard.txt` — `git filter-repo --replace-text` map covering ONLY
  the guard-pattern tokens (what history must be clean of). Kept separate from `kckern` on
  purpose (kckern isn't guard-flagged).
- `.pii-scrub/known-induced-test-files.txt` — the 14 tests the rename breaks (see Fixes).
- `.gitignore` now ignores `.pii-scrub/` (contains the real→alias map — never commit it).

## Where the finished work lives
- **`chore/pii-p3`** — the scrub applied on top of `main` as it was at Merge-Phase-P3
  (`e1e1616bf`). One commit `chore(pii): externalize household PII…`. Tree is fully green.
- `chore/pii-externalize` — the same scrub on the older P2 `main` (`7e09dc410`); superseded by
  `chore/pii-p3`, keep as reference or delete.
- Safety tags: `backup/main-prescrub` (P2 main), `backup/main-p3` (P3 main), `backup/p3-prescrub`.

## Verification already done (both P2 and P3 snapshots)
- After scrub: `git grep` for the guard patterns over tracked code (excluding `data/`,
  `.claude/`, `dev.log*`, and the "Felix Lullabye" title) → **empty**.
- Full `vitest run` diffed against a pre-scrub baseline → **0 net-new failures** (the blanket
  vitest run has ~567 PRE-EXISTING failures unrelated to the scrub — music/extension/adapter
  suites that need the repo's custom harnesses; ignore them, diff is the signal).
- `git-filter-repo` procedure **validated on a throwaway clone**: 61-commit history preserved,
  PII-bearing added lines 7 → 0, rewritten tip tree **byte-identical** to the green scrub tree,
  base commit preserved (so the push is a fast-forward).

## Fixes the rename requires (already applied in `chore/pii-p3`; re-apply if you re-scrub)
Root cause: some tests derive values from the id string, or my `kckern` infra-exclusion
preserved an *identity* use. All are in `.pii-scrub/known-induced-test-files.txt`.
1. **Sorted-id assertions flip** — aliases sort differently than names. 3 files
   (`groupSessions.test.mjs`, `CycleGameProvider.test.mjs`, `SessionGroupingService.detail.test.mjs`):
   put the expected `.sort()`ed arrays in the new alphabetical order (`user_2,user_3,user_4`…).
2. **Identity-`kckern` leaked through** (participant keys `participants.kckern`, API URLs
   `/users/kckern`, uppercase `KCKERN`, regex `/kckern/`) — my infra-exclusion kept these while
   the driving data became `user_1`. Fix: whole-word case-aware `kckern→user_1` in ~11 test
   files (they contain no infra `kckern`). See the file list.
Non-issues confirmed: `assignIdentityColors` (participantColors) uses relative assertions;
config-mapped strap colors stay stable; only `hashColorForDevice` fallback would move (no test
asserts it).

## THE BLOCKER — why it isn't pushed
`main` moved **4+ times during the session** (P2 `7e09dc410` → P3 `e1e1616bf` →
`0ac303265` → `99459e214`…) via concurrent commits (another session / homeserver sync). Every
prepared clean-history rewrite goes stale before it can be pushed, and each new commit tends to
re-introduce PII. **The push cannot land until `main` is genuinely frozen.**

## Remaining procedure to finish (run when `main` is FROZEN)
Do it atomically against the *current* `main` tip (`$TIP`), start-to-finish, no interruptions:
```
# 0. confirm nothing else is committing to main
# 1. re-apply the scrub to current main
git switch -c chore/pii-final <current-main-sha>
node .pii-scrub/pii-scrub.mjs --apply
#    re-apply the 14 test fixes (see Fixes above) + untrack dev.log.1 + gitignore dev.log*
git rm --cached dev.log.1 2>/dev/null; grep -qxF 'dev.log*' .gitignore || echo 'dev.log*' >> .gitignore
#    (verify: git grep -iwE '<patterns from secret-patterns.local.txt>' over tracked code == empty)
#    (verify: npx vitest run  → diff vs a fresh baseline == 0 net-new)
git add -u && git commit -m "chore(pii): externalize household PII from committed code"
# 2. rewrite the unpushed history clean (validated), then fast-forward main
BASE=$(git rev-parse origin/main)     # the published base (ancestor of your tip)
git filter-repo --replace-text .pii-scrub/filter-repo-map-guard.txt --refs $BASE..chore/pii-final --force
git branch -f main chore/pii-final && git switch main
#    (verify: git log -p origin/main..main | grep '^+' | grep -iwE '<patterns>'  == empty)
# 3. push (fast-forward; guard now scans a clean HEAD)
git push origin main
```
Notes / gotchas:
- The push **guard hook scans the working repo's `origin/main..HEAD`**, so you must be **on a
  branch whose history is already clean** when you push (that's why step 2 rewrites `main`).
- After rewriting `main`, the already-merged branches `refactor/ddd-compliance-p3`,
  `design/self-indexing-loops`, `piano/theory-panel-standardization` will point at pre-rewrite
  commits (their work is preserved inside `main`) — delete or reset them per branch policy.
- `git-filter-repo` is installed (`/opt/homebrew/bin/git-filter-repo`).
- Vitest gotchas: a blanket `npx vitest run` pulls in playwright `_deleteme/*` tests and many
  infra-dependent suites that fail natively — ALWAYS judge by the diff vs a baseline, never the
  raw fail count.

## Also worth knowing (separate finding this session)
The **sheet-music notehead light-up** change (recolor the engraved OSMD notehead instead of
overlaying rectangles) is ALREADY in `main` (it rode in via the Phase-P2 merge). That was the
original task; it's done. Files: `NoteHighlightLayer.jsx`, `osmdRender.js` (`noteheadEl`/
`boxOfEl` + `steps[].notes[].el`), `PianoApp.scss` (`.piano-note-lit`/`.piano-note-hit`).
