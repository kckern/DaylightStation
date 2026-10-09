# Curated exercise-taxonomy records

These files are **hand-authored**, not part of the scraped corpus. They live here because the
corpus itself sits in the media tree (`media/library/exercise/`), which is not version
controlled — without this copy, a re-scrape or a sync accident would destroy work that has to
be written by hand, not regenerated.

## Why they exist

The scraped corpus had a taxonomy hole. Measured 2026-08-11 against all 1,296 exercise records:

```
190 of 1,296 exercises (15%) resolved to NO muscle group
  157  their only resolvable muscle was `abs`
   26  no target_muscles at all
    7  every target muscle was dangling
```

Two separate causes:

**1. There was no abdominal muscle group.** The 11 scraped groups were back, cardio, chest,
deltoids, forearms, hips, lower-legs, neck, shoulders, upper-arms, upper-legs — nothing for the
trunk. Yet `muscles/abs.yaml` declares `group: core`, and the Hevy video filenames use `_Waist`
as a body part. The region was simply missed by the scrape. Adding `muscle_groups/core.yaml`
alone recovered 157 exercises.

**2. Thirteen muscles were referenced but never scraped.** Not only by exercises — the
*muscle-group records themselves* listed them. `back` claimed `lower-traps`, `lower-back`, and
`teres-major`; `hips` claimed `hip-flexors`; `neck` claimed both SCM entries. That made the
corpus self-documenting about what was missing, and each muscle's correct group could be read
straight off whichever group listed it. The three that no group claimed — `obliques`,
`abs-lower`, `transverse-abdominis` — are core, and are listed in the new `core.yaml`.

After both fixes: **0 exercises resolve to no group**, and the `unknown-group` and
`unknown-muscle` warning kinds disappeared from the index build entirely.

## What is here

| Path | Count | What |
|---|---|---|
| `muscle_groups/core.yaml` | 1 | The missing trunk group |
| `muscles/*.yaml` | 13 | The referenced-but-absent muscle records |
| `cardio-exercises.txt` | 26 | Slugs patched in place — see below |

`cardio-exercises.txt` is a record of an **edit to existing files**, not new files. Those 26
exercises (burpee, bear-crawl, mountain-climber, run, treadmill/stepmill/bike variants) had
`target_muscles: []` and `target_groups: []`. Both were set to `[cardio]`, which is what they
are — the `cardio` muscle and `cardio` group already existed in the scrape.

## Restoring after a re-scrape

Copy `muscles/` and `muscle_groups/` into `media/library/exercise/`, re-apply the cardio slugs
from the text file, then confirm with:

```bash
npm run exercise:validate    # must exit 0 — "every exercise resolves to at least one muscle group"
```

## Provenance warning

The `full_description` fields here were **written for this project**, whereas every other
record's essay came from the scrape. They are ordinary anatomy — origin, insertion, action,
and which movements load the muscle — but they have not been reviewed by anyone with a
relevant qualification.

School renders `full_description` as reader content. Before any of this backs graded
schoolwork, someone should read it. That caveat applies to the scraped essays too (they read as
generic generated prose), but it applies to these with the added wrinkle that their author was
an LLM writing to fill a gap it had just found.
