# Two DDD ratchets went red, and it is real debt

**Date:** 2026-08-16
**Status:** resolved 2026-08-24.
**Gate:** `npm run audit:layers`

```
apps-success-false   60 (baseline 49)  REGRESSION   +11
domains-tojson       74 (baseline 67)  REGRESSION   +7
```

## It is not a stale baseline

That was my first guess and it is wrong. `domains-tojson` was ratcheting **down** correctly, one
domain per commit, exactly as the migration intended:

| Commit | Count | Baseline |
|---|---|---|
| `2637bd480` ratchet introduced | 72 | 72 ok |
| `180af1f7a` health | 69 | 69 ok |
| `8830b3821` feed | 68 | 68 ok |
| `929922385` barcode (2026-07-08) | 67 | 67 ok |
| …then | **74** | 67 **RED** |

So the gate did its job: violations were added after the migration had walked the number down, and
the baseline was correctly left alone. The window is `929922385` (2026-07-08) →
`c8c707828` (2026-08-16); nothing new has landed since.

**Do not run `--update`.** It would bless 18 real violations as the new floor and undo a migration
someone has been walking down commit by commit.

## Not blocking

The gate was already red before the piano chrome/addressing work (`b2dd4ccd1`) and that work moved
neither count — verified by running the audit at `2186b5d40`, the commit it was rebased onto.

---

## `domains-tojson` +7 (10 new definitions)

Entities must not define their storage format; datastores own hydration and dehydration.
Migration plan: `docs/_wip/plans/2026-07-08-serialization-ownership-migration.md`

**Almost all of it is one subsystem.** `automotive` landed as a unit without following the
convention:

```
2_domains/automotive/entities/Document.mjs:64
2_domains/automotive/entities/FuelLog.mjs:86
2_domains/automotive/entities/Journey.mjs:126
2_domains/automotive/entities/ServiceRecord.mjs:77
2_domains/automotive/value-objects/GeoFix.mjs:102
2_domains/automotive/value-objects/OdometerReading.mjs:80
2_domains/automotive/value-objects/Place.mjs:108
```

Three strays elsewhere:

```
2_domains/fitness/entities/Session.mjs:299
2_domains/lifeplan/entities/LifePlan.mjs:60
2_domains/notification/entities/NotificationIntent.mjs:23
```

**Tractability: medium, and the most tractable of the two.** One subsystem, an existing plan, and
four prior commits to copy the shape from. The risk is storage format — these entities are already
persisting through `toJSON`, so moving serialization into the datastore has to round-trip existing
files. A characterization test on the stored shape first (the pattern `foodCatalogStoredShape.char`
and `conversationStoredShape.char` already use) is what makes it safe.

## `apps-success-false` +11 (13 new returns)

The application layer should throw, not return a status object.

**All but one are nutribot, and all but one are guard clauses:**

```
3_applications/nutribot/usecases/GenerateDailyReport.mjs:164   `${pendingLogs.length} pending log(s)`
3_applications/nutribot/usecases/GenerateDailyReport.mjs:189   'No food logged for this date'
3_applications/nutribot/usecases/LogFoodFromScale.mjs:167      'bad grams'
3_applications/nutribot/usecases/LogScaleFoodFromText.mjs:63   'log not found'
3_applications/nutribot/usecases/LogScaleFoodFromText.mjs:64   'already processed'
3_applications/nutribot/usecases/LogScaleFoodFromText.mjs:73   'could not estimate'
3_applications/nutribot/usecases/SelectScaleContainer.mjs:39   'log not found'
3_applications/nutribot/usecases/SelectScaleContainer.mjs:40   'already processed'
3_applications/nutribot/usecases/SelectScaleDensity.mjs:30     'unknown level'
3_applications/nutribot/usecases/SelectScaleDensity.mjs:33     'log not found'
3_applications/nutribot/usecases/SelectScaleDensity.mjs:34     'already processed'
3_applications/nutribot/usecases/ShowScaleDensityHelp.mjs:27   'no message'
3_applications/nutribot/usecases/ShowScaleDensityHelp.mjs:31   'log not found'
```

**Tractability: low, and the riskier of the two.** Every one of these is behaviour a Telegram
handler branches on, in a bot that is used daily. Converting them means introducing typed errors AND
updating every caller — and two of them (`GenerateDailyReport`'s `skippedReason`) are not failures
at all, they are "nothing to report today", which is a legitimate result and arguably wants a
different shape rather than an exception.

Worth deciding before touching: is `{ success: false, skippedReason }` actually the rule's target, or
does the rule need to distinguish a refusal from an empty result?

## Suggested order

1. **Automotive `toJSON`** — contained, planned, four worked examples. Round-trip test first.
2. **The three stray `toJSON`** — one file each.
3. **Nutribot** — only after deciding the question above. Not a mechanical sweep.

## Resolution (2026-08-24)

- Automotive serialization moved to `YamlVehicleRecordDatastore`,
  `YamlPlaceDatastore`, the automotive router presenters, and the journey use
  case. All seven automotive domain `toJSON()` definitions were removed while
  preserving the existing YAML and response shapes.
- Nutribot scale guard clauses now throw coded `ApplicationError`s. The input
  adapter translates expected refusals back to its transport result, and the
  hardware bridge treats those same codes as a safe no-commit. Report
  “nothing to do” outcomes are explicitly successful skips rather than false
  failures.
- `npm run audit:layers` is green. The ratchets were tightened to
  `domains-tojson: 67` and `apps-success-false: 47`.

## Also fixed while diagnosing this

`tests/unit/applications/piano/GetCourseProgress.char.test.mjs` was failing in `npm run test:refactor`.
Stale fixture, not broken behaviour: it supplied profiles shaped `{ name }`, but `GetCourseProgress`
resolves `display_name || username || id` — deliberately, per its own comment, because a bare
`p.name` once shipped "undefined" labels. `GetRecentCourseActivity.test.mjs` already used
`display_name`. Fixture corrected; the production code was right.
