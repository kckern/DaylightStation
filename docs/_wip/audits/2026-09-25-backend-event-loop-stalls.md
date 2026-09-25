# Backend event-loop stalls — profile findings (2026-09-25)

`system.event-loop.lag` showed the backend blocking >1 s almost every minute,
even overnight (232 of 239 windows over 4 quiet hours). Every request that
landed in a stall waited behind it, including Health opening. Three CPU
profiles of the live container (method: memory
`reference_backend_cpu_profile_live`) found the causes in turn.

## Fixed

| Stall | Cause | Fix | Commit |
|---|---|---|---|
| 2–6 s, ~once a minute | `GetPlayableUnits` → `requirementStatuses` → `YamlPianoAttemptStore.list` re-parsing every attempt file (hundreds per learner) per kiosk poll | mtime+size parse cache in the store | 34f84884 |
| ~0.7 s every 30 s | `NutritionCleanup.tick` re-reading the 1.9 MB agent-state file and the month's food archive | `FileIO.loadYamlCached` (re-parse on mtime/size/inode change, clone per call) | 0324fbd2 |

Result: the per-minute worst stall fell from 1.1–3.2 s to about 210–320 ms.

## Still open

Both remaining causes are shared code, and fixing them means a design change
rather than a local patch.

1. **State Gates writes: 0.6–0.9 s, several times per 5 minutes.**
   `YamlStateGatesStateEngine.#write` runs `plain` + `mapKeys` and
   re-serialises the projection and the whole journal (up to 500 entries,
   retention 7 days) into `current.yml` on every commit, `markPublished`
   included. Cheap writes need the journal split into an append-only file, or
   a coarser commit cadence. Either one touches the durability contract that
   `stateGatesPersistence.matrix.test.mjs` pins, so it needs its own design.
2. **Entropy report: ~0.8 s per request.**
   `GET` home-automation entropy → `EntropyService.getReport` →
   `YamlEntropyReader` → `dataService.user.read('lifelog/<source>')` parses
   each full lifelog dataset per request. A parse cache belongs in the data
   service's read path (`loadYamlCached` is ready for it), and that read path
   is shared by every app. A TTL on the report does not help: it is requested
   about every 5 minutes.

Correction (Fable review, 2026-09-25): State Gates writes measure 70–126 ms
in the container, not 0.6–0.9 s. They inflate the minutes that contain
commits (550–1175 ms worst lag during a workout, against a ~200 ms floor).
The ~600 ms peak about every 5 minutes contains no State Gates commit: it is
the entropy report. The State Gates fix is specified in
`docs/_wip/plans/2026-09-25-state-gates-json-persistence-design.md`.
