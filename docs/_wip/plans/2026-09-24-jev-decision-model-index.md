# Jev decision model — plan index (2026-09-24)

The typed-decision port (`IDecisionGateway`) and the TypeSafe Jev adapter are on
main (`29a46ff9d`), with three consumers already built: the nearest-icon chooser,
nutrition audit triage in shadow mode, and the card-ladder shadow judge. See
`docs/reference/core/configuration.md` ("Typed decisions"). This page indexes the
next six consumers. Each has its own TDD plan.

**Prerequisite for all of them:** `api_key` in `system/auth/jev.yml`. Until it is
set, `decisionGateway` is `null` and every consumer below runs its legacy path.

**Shared rules** (from the planning brief): shadow first wherever Jev would change
an existing decision; confirm or review wherever it adds a new capability; a Jev
failure always means the legacy behaviour; questions live in the application layer
and provider limits live in the adapter.

## Build order

| # | Plan | Tasks | Kind | Why this position |
|---|---|---|---|---|
| 1 | [Sentence Ladder meaning score](2026-09-24-jev-sentence-ladder-meaning-score.md) | 8 | new data, gates nothing | Smallest and safest. Compares English with English. Real rows show the problem ("today the weather is nice" scores 0.4 today). |
| 2 | [Finance categorization](2026-09-24-jev-finance-categorization.md) | 11 | shadow → promote | **Task 1 is a live bug fix that needs no Jev** (see below). Includes a replay CLI, because prod volume (about 26 per week) is too low to judge from logs. |
| 3 | [Headlines clustering and labels](2026-09-24-jev-headlines-clustering.md) | 7 | shadow → promote | Runs at harvest time, never on the request path. The current 0.72 threshold found 1 multi-source story in 239. |
| 4 | [Life events](2026-09-24-jev-lifeplan-signals.md) | 9 | new capability, confirm-to-apply | The keyword detector has no caller. The plan adds coach tools that write only after the user confirms. Evening captures are a later phase: there is nothing structured to map them onto yet. |
| 5 | [Content filter cue review](2026-09-24-jev-content-filter-cues.md) | 8 | review file, never applied | Child-facing policy, so the output is a review queue. Task 5 moves `srt-mutes` onto `bad-words.yml`, which changes which words are muted. Review that task on its own. |
| 6 | [Voice trigger routing](2026-09-24-jev-voice-trigger-routing.md) | 9 | new modality, confirm mode default | Voice doesn't exist yet, not even exact keywords. Speech-to-text is out of scope. Task 1 is updated for the registry fix below. |

## Found while planning

Fixed already:
- **Trigger registry, all-or-nothing load.** Any single bad source or tag (for
  example a `modality: voice` line) emptied the whole registry at boot, which
  unregistered every NFC tag. Fixed on main (`04872101a`): a bad entry is now
  skipped and logged as `trigger.config.entry.skipped`.

Covered by a plan task:
- **Finance hourly re-categorization loop.** 197 of 223 `categorization.success`
  events in 7 days were the same transaction. The LLM renames it "Direct Deposit",
  which still matches the raw `/^Direct/i` pattern, so it goes back to the LLM
  every hour and its tag flips between Income and Payroll in Buxfer. Finance plan
  Task 1; no Jev needed.
- **Finance prompt teaches invalid categories.** Its examples use "Health",
  "Dining" and "Car Rental", none of which is in `validTags`, and "leave it blank"
  produced `Invalid category: ""`. Finance plan Task 8 (data).
- **Finance preview and apply choose different rows.** Finance plan Task 5.
- **SRT cue at t=0 when a line's end time does not parse.** Content-filter plan
  Task 2.
- **`bad-words.yml` is read by nothing;** `srt-mutes` has its own 13-word list.
  Content-filter plan Task 5.
- **Life-event detector output doesn't fit `LifeEventType`, and one item can
  produce several suggestions.** Life-events plan Task 1.

Not covered by any plan (life plan, separate from Jev):
- The weekly retro's rule-effectiveness step reads `r.effectiveness`, which never
  exists, and nothing calls `Rule.recordTrigger`. `CeremonyService.mjs:76`,
  `RetroService.mjs:41`.
- `LifeEventProcessor` reads `state` / `occurred_date`, but `LifeEvent` has
  `status` / `actual_date`. It is unwired today, but once wired it would never
  resolve goal dependencies.

Reference-doc drift the plans' docs tasks correct: trigger file layout and module
names (`events.md`); headline clustering placed in the frontend
(`feed-system-architecture.md`); life-plan capture claims (`user-journey.md:132`);
cue severity described as required (`content-filter.md`).
