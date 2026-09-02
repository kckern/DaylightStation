# Media event `durationSeconds` is divided by 1000 a second time

**Date:** 2026-09-01
**Surface:** Fitness session timeline events → Strava descriptions, primary-media fallbacks
**Status:** Root cause confirmed, not yet fixed
**Severity:** 216 of 455 non-audio media events on record (47%) carry a corrupt duration

---

## Symptom

Session `20260901100054`'s cardio-challenge media event records
`durationSeconds: 2` for a video that played for 1941 seconds (32m 21s):

```yaml
type: media
data:
  contentId: plex:370720
  title: Modified—Cardio Challenge
  durationSeconds: 2          # ← the whole defect
  start: 1788282059998
  end:   1788284001507        # end - start = 1 941 509 ms
```

Every affected event lands in the 1–11 range regardless of the real length.

---

## Root cause

`PlayableItem.duration` is **seconds**. `Playable.mjs:19` says so explicitly
(`@param {number} [props.duration] - Duration in seconds`), and `PlexAdapter`
produces it by dividing Plex's native milliseconds:

`backend/src/1_adapters/content/media/plex/PlexAdapter.mjs:914`
```js
duration: item.duration ? Math.floor(item.duration / 1000) : null,
```

`normalizeDuration` then guesses the unit from the magnitude and divides again:

`frontend/src/modules/Player/utils/mediaIdentity.js:39-44`
```js
const toSeconds = (v) => {
  if (v == null) return null;
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1000 ? Math.round(n / 1000) : Math.round(n);   // ← seconds treated as ms
};
```

**Any video longer than 1000 seconds (16m 40s) is divided by 1000 a second
time.** A 32-minute workout (1941 s) becomes `2`. The threshold is why the
corruption looks arbitrary — it fires on exactly the items that matter (real
workouts) and spares the short ones.

`FitnessPlayer.jsx:1499` is the call site:

```js
const durationSeconds = normalizeDuration(
  media.duration,          // already seconds → mangled
  media.length,
  media.metadata?.duration
);
```

### The arithmetic, checked against the data

For an item played to completion, `durationSeconds` should equal
`round(playedSeconds / 1000)` if the hypothesis holds. Across every affected
event played ≥10 minutes:

| result | count |
|---|---|
| exact match | 78 |
| within 1 (partial play rounds down) | 20 |
| larger gap | 35 |

All 35 in the last row are games and long rides (Mario Kart Tour, F-Zero,
Bavarian cycling routes) that were **not** played to completion — their nominal
length exceeds what was played, so `round(nominal/1000)` correctly exceeds
`round(played/1000)`. E.g. Mario Kart Tour records `6`, i.e. a ~6000 s nominal
item, played 1763 s. No counterexamples.

### When it started, and why it *looks* like it started in March

The heuristic itself is old — `635fdfc81` (2025-12-08) — and unchanged in
substance since. It was correct when written, and it broke without being
touched, because **its input changed units underneath it**.

Two independent effects conspire to make the record look clean before March, and
an earlier draft of this report wrongly read that as the two-pass commit
`4d91402a4` (2026-02-28) causing the defect. It did not; the same
`> 1000 ? /1000` line exists on both sides of that commit. What actually happened:

**1. Everything before March was written by a different author.** Grouping every
media event by `data.source` shows the pre-March record is almost entirely
backfill-authored, and the live logger takes over completely from March:

```
2025-10 → 2026-01   backfill_enrich / media_memory_crossref /
                    backfill_media_memory / backfill_browser_history   (live: 0)
2026-02             backfill × 25,  live × 12
2026-03 onward      live only  (66, 62, 48, 84, 68, 36, 8)
```

The backfill tools compute the field correctly from Plex milliseconds, so
comparing their output to the live logger's and calling the difference a
regression compares two writers, not two code versions.

**2. The live logger's input flipped from milliseconds to seconds.** Live events
from 2026-02-23 to 2026-03-06 store *correct* four-digit durations — `1887`,
`1888`, `1961`, `2095`, `16725` — which is only possible if the value arriving
at `normalizeDuration` was in milliseconds, i.e. the heuristic was doing exactly
its job. From 2026-03-07 onward the pattern inverts cleanly and has held ever
since:

| stored | played | verdict |
|---|---|---|
| 658 | 667 s | correct — under the 1000 threshold, passes through untouched |
| 621 | 614 s | correct |
| 2 | 1942 s | **mangled** — over the threshold, divided again |
| 2 | 2433 s | **mangled** |

Every recent event under ~1000 seconds is right and every one over it is wrong.
That is a single code path feeding seconds into a millisecond-guesser — not two
competing paths. The defect began when the `PlayableItem` seconds contract
reached the kiosk, somewhere in the 2026-03-03…03-07 window (the days either
side of it alternate, which fits a stale bundle on one screen — the garage
kiosk serves its old bundle until hard-reloaded).

### Why the February fix missed it

`4d91402a4` saw this exact symptom a week before the flip completed and
diagnosed it as Plex metadata leaking a **season number**:

> // This skips Plex metadata placeholders (e.g. season number "2") that can
> // appear in media.duration before the HTML5 player reports the real value.

The `2` was never a season number. It was 1941 seconds divided by 1000. The
commit added a two-pass filter that rejects sub-10s candidates on the first
pass — but the second pass accepts "any positive value" as a fallback for
genuinely short media, and when *every* candidate is the mangled value (the
common case, since they all derive from the same `PlayableItem`), the fallback
hands back the corruption it just rejected. The guard is real; it guards against
the wrong thing and then defeats itself.

---

## Who reads the corrupt field

The summary path is immune — `buildSessionSummary` computes `durationMs` as
`event.end - event.start`, which is why the session-detail header and the
session list were correct all along. Two consumers rank on the raw field:

1. **`buildActivityDescription`** → the Strava activity name and description.
   It calls the event-based `selectPrimaryMedia`, which sorts on
   `data.durationSeconds`. A 32-minute workout scoring `2` is below every floor
   in the cascade, so it drops out of T1/T2/T3 and the Strava title goes to
   whatever else played.
2. **`YamlSessionDatastore.mjs:482`** — the event-path fallback used to build a
   session's list-card summary when no `summary.media` block exists.
3. **`NextUpStrategy.mjs:45`**, indirectly. It keys on
   `session.media?.primary?.grandparentId`, which for a session with no
   `summary.media` comes from that same corrupt cascade — so "next up" can
   continue the wrong show. (Its own `durationMinutes` comes live from Plex and
   is fine, as is the resume path, which uses `watchSeconds`/`playhead`.)

All three silently pick the wrong item; none errors.

A fourth site is not a consumer but blocks the fix:
`tests/isolated/modules/Player/normalizeDuration.test.mjs` **enshrines the
heuristic as intended behaviour**, including a case that spells out the exact
corruption —

```js
// 1800 is > 1000 so treated as 1800ms -> 2s, NOT as 1800 seconds
```

That suite has to be rewritten alongside any producer-side fix, not merely kept
passing.

---

## Fix

Three changes, in priority order. The first alone fixes every affected session,
past and future.

### 1. Consumer-side: rank on the played span (the whole fix, effectively)

The summary path was never wrong, and the reason is instructive — it ranks on
`end - start` (`buildSessionSummary.js:81`), a value every media event already
carries and which no heuristic can corrupt. The event-path `selectPrimaryMedia`
ranks on `data.durationSeconds` instead, and that is the only reason the
corruption is visible anywhere.

Point it at `(end - start)`, falling back to `durationSeconds` when the span is
unavailable. This repairs both named consumers plus `NextUpStrategy` across all
216 historical events **and** all future ones, with no migration and no
dependency on the producer fix landing first. It also makes the two selectors
agree on what "duration" means, which they currently do not.

This matches the repo's standing preference for fixing in the consumer rather
than in shared code, and it is the change to make first.

### 2. Producer-side: stop guessing units

The magnitude heuristic is unfixable in principle — no threshold separates
"1941 seconds" from "1941 milliseconds", because both are legal values of the
same field. Since every live candidate is now seconds (`media.duration` per the
`Playable` contract; `media.length` and `media.metadata?.duration` are not
populated by any current producer), the honest fix is to drop the `/1000`
guess and take the input as seconds — or better, read the HTML5 element's own
`duration`, which is ground truth and is loaded by the time the 10-second
media_start debounce fires (`FitnessPlayer.jsx:1493`).

If the helper is kept general, make the unit explicit at the call site
(`fromSeconds(...)` / `fromMs(...)`) rather than inferred. The two-pass
plausibility filter goes away with the guess — it exists only to paper over it.

Add the invariant that would have caught this on day one: `durationSeconds`
must never be wildly *below* the item's own played span. Assert it at
consolidation (`PersistenceManager.js:~470-485`), where both numbers are known —
not at media_start, where the span does not exist yet.

### 3. History repair — optional, and only for data hygiene

With (1) done, no consumer trusts the field, so the 216 stored events are inert
rather than harmful. Repair is then a tidiness decision, not a correctness one.
If it is done: re-fetch nominal durations from Plex by `contentId`, fall back to
`end - start`, and null the field where neither is available, recording which
of the three produced each value.

**Do not reuse `media enrich-plex` for this.** Its write mode does
`session.timeline.events = mediaEvents` (`cli/lib/fitness/enrichPlex.mjs:140`) —
a wholesale replacement that would destroy every challenge, governance and
voice-memo event in the file. A repair pass must edit media events in place.

## Open question

Whether `durationSeconds` should be stored at all. Every current consumer wants
"how long did this play", which `end - start` answers exactly; nominal length is
re-fetchable from Plex by `contentId` whenever it is genuinely needed, and
`NextUpStrategy` already gets it live rather than from the stored field. Once
(1) lands and nothing ranks on it, the field is informational — keep it or drop
it, but it should not be load-bearing again.
