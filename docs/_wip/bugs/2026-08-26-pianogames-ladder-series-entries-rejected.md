# Piano Games — the opponent ladder rejects its own series entries — 2026-08-26

**Status:** found, not fixed. Needs its own task.
**Severity:** unknown blast radius — see §4. Not urgent enough to block the scan fix it was found alongside.
**Found by:** the C2 decision gate in
`docs/_wip/plans/2026-08-26-scan-ceremony-completion-and-kiosk-shutdown.md`,
while deciding whether `pianoGames.test.mjs` could safely be excluded from
vitest's glob.

---

## 1. Why nobody noticed

`backend/src/5_composition/modules/pianoGames.test.mjs` is written for Node's
built-in `node:test` runner, not vitest. The project's vitest gate collects it
by directory glob anyway and reports:

```
Error: No test suite found in file .../pianoGames.test.mjs
```

That message reads as a harmless collection artefact, so the file sat in the
gate's failing list looking like noise. **It is not noise.** Run under its own
runner, the file fails real assertions:

```bash
node --test backend/src/5_composition/modules/pianoGames.test.mjs
# 2 pass, 3 fail
```

This is the failure mode the C2 task existed to catch: excluding the file from
vitest — the obvious "fix" for the reporting noise — would have buried a real
bug behind a config change. It was deliberately **not** excluded. Its sibling
`nfcTapIngress.shutdown.test.mjs` genuinely does pass under `node --test` and
was excluded.

## 2. The failures

Reproduced independently twice (implementer and reviewer):

1. **`OpponentLadder: series entries require { result, counted }`** — thrown
   from `PianoGamesContainer.recordGame` at
   `backend/src/3_applications/piano-games/PianoGamesContainer.mjs:53`, via
   `backend/src/2_domains/gaming/entities/OpponentLadder.mjs:7`. Two of the
   three failures are this.
2. **A naming mismatch** — a native game registers as `'Level 1'` where the
   test expects `'Diglett'`.

## 3. Age and origin

`git log` puts the cause at **`13a90577d`**, which is upstream of the base of
the branch this was found on. It is genuinely pre-existing and entirely
unrelated to OMR scanning, print documents, or the school ceremony work.

## 4. What is NOT yet known

Nobody has established whether this breaks the piano games feature **in
production** or only under the test's particular construction. That is the
first question for whoever picks this up, and it decides the severity:

- If `recordGame` throws for real gameplay, the opponent ladder cannot record
  results at all and the feature is broken for children using it.
- If the test constructs a series entry in a shape the real caller never
  produces, this is a stale test and the fix belongs in the test.

Do not assume either. Drive `PianoGamesContainer.recordGame` with a real
recorded game before deciding which.

## 5. Suggested first steps

1. `node --test backend/src/5_composition/modules/pianoGames.test.mjs` — read
   all three failures in full.
2. Read `OpponentLadder.mjs:7`'s invariant and find every caller that builds a
   series entry. Establish which shape is correct — the entity's or the
   caller's.
3. Check the log store for `OpponentLadder` errors in production to settle §4:
   `query="OpponentLadder" AND _time:30d`.
4. Fix whichever side is wrong, then decide whether the file should be
   converted to vitest or left on `node:test` and excluded from the glob like
   its sibling.
