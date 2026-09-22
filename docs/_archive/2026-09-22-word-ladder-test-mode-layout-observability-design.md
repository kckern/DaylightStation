# Word ladder: learner door, read-only test mode, card layout, session trace

> **Superseded 2026-09-22** by `docs/_wip/plans/2026-09-22-word-ladder-mastery-redesign.md`.

Status: design, awaiting review (2026-09-22)
Builds on: `docs/reference/school/word-ladder.md`,
`docs/_wip/plans/2026-09-22-korean-vocab-word-ladder-design.md`

## Why

The `korean-vocab` package now has real pictures and native audio. Before a
child meets it we need to (1) open it as a specific child, today, without
touching their history, (2) have cards that look right whether or not a word
has a picture and whether the word is 풀 or 이름이 뭐예요?, (3) have decided —
not inherited — what happens in every situation a child can be in, and
(4) be able to read back, from logs alone, exactly what a sitting was like.

Media today (`language/korean-vocab/words/week-01-classroom/`): 19 words,
all with `term.mp3` + `gloss.mp3`; 15 with `image.jpg`. The four greetings
(`annyeong`, `annyeong-haseyo`, `annyeonghi-gyeseyo`, `ireumi-mwoyeyo`) have
no picture, by intent.

## 1. The door: a learner-scoped URL

```
/school/go/<learner>/word-ladder              the real session (writes)
/school/go/<learner>/word-ladder/test         the same session, read-only
/school/go/<learner>/word-ladder/<pkg>[/test] when the learner has >1 package
```

This extends the existing admin door (`/school/go/<learner>/<program>[/<instance>]`,
`IssueDirectLaunch`) instead of adding a second URL scheme: same roster check,
same `warn`-level `school.direct-launch.issued`, same `onPortalLaunch` mount.

**No deck in the URL.** A new `word-ladder` entry in the launcher registry
resolves the deck from the learner's CURRENT word-ladder enrollment
(`programs[]` with `policy.mode: word-ladder`) — the same row the Portal tile
launches — so the URL follows the enrollment across weekly rollovers. With
exactly one word-ladder enrollment the instance is optional; with several,
the instance is the package slug and a bare URL 404s listing the choices.
"Today" is the School study day (4am→4am, household timezone), computed by
the server as it is now.

**`/test` is a reserved final segment.** `parseSchoolPath` strips it into a
`test: true` flag on the launch target; it is never read as an instance.
A program that does not implement test mode REFUSES a `/test` URL with
"Test mode isn't available for <program>" — a test URL must never fall
through to a live, writing session.

## 2. Test mode (read-only, server-enforced)

### Approach: a shadow status store

Considered:

- **A. Shadow store (chosen).** A second `WordLadderStudyService` instance,
  wired with a `ShadowWordLadderStatusStore` and a discarding recordings sink,
  served under `/api/v1/school/word-ladder/test/*`. Identical rules run —
  grading, misses feeding study, credit, the review run — against an
  in-memory copy. Nothing it holds can reach disk.
- B. A client-side fake API: duplicates grading, ships answers to the
  browser, and drifts from the server.
- C. A `dryRun` flag on every endpoint: every write path grows a branch, and
  one missed branch writes a child's history.

A is the only option where "nothing is saved" holds by construction rather
than by care.

### Behaviour

- **Snapshot on open.** `POST /word-ladder/test/open` reads the learner's
  real `status.yml` once, deep-copies it into the shadow keyed by the test
  session id, and runs the ordinary `open()` against the copy (fold, freeze,
  session row — all in memory). If today's plan is already frozen for real,
  the test shows THAT plan and progress, i.e. what the child sees if they
  open the tile now.
- **Writes go to the shadow only.** Answers are graded and move the shadow
  ladder; marks, recordings and review views update the shadow. The real
  store adapter is never handed to the test service; its only access is a
  read-only `snapshot(userId, pkg)`.
- **Recordings** are accepted (so the recorder, speech floor and playback
  run for real), counted, and dropped. The client plays the take from its
  local blob as it already does.
- **Lifetime.** Shadow sessions live in process memory, 3 h TTL, capped at
  20 (oldest evicted). A restart or eviction 404s the session; the client's
  existing 404→reopen path opens a fresh test session.
- **Seeds (`?scenario=`)** replace the snapshot so every state can be seen
  on demand:

  | scenario | shadow status | what it shows |
  |---|---|---|
  | `today` (default) | real snapshot | exactly today |
  | `fresh` | empty | every deck word NEW → the study pass |
  | `checks` | every deck word CLAIMED on the previous study day | a check for every word, in all three directions, including picture→term fallback for the four picture-less words |
  | `done` | today's plan complete | the review run |

- **Enforcement.** Test session ids are `test.<package>.<id>`; the live
  router rejects them (404) and the test router rejects live ids — a client
  bug cannot cross the line. Term-grid credit, `dayStatus` and the teacher
  surfaces read the real store and never see a test session.
- **Visible.** A fixed "TEST — nothing is saved" banner on every screen.
- **Logs.** Same event names as live, with `mode: "test"`, so the trace tool
  (§5) reads a test run exactly as it would a real one.

## 3. Cards that adapt to their media

Each card picks a **layout** from what it can actually show, not from what
the plan promised:

| Card | Layout | Regions |
|---|---|---|
| Study front, picture | `picture` | picture · term · Hear it |
| Study front, no picture (or picture failed to load) | `text` | term (hero, larger region) · pronunciation (phrases) · Hear it |
| Study back | `back` | gloss (hero) · pronunciation |
| Check, picture prompt | `prompt-picture` | picture · 4 choices |
| Check, audio prompt | `prompt-audio` | big Hear it · 4 choices |
| Check, text prompt | `prompt-text` | term · 4 choices |
| Miss correction | `correction` | the word's own card face + gloss |

- A missing asset is a different layout, never a hole. A picture that
  **fails at runtime** (`onError`) switches the card to `text` and logs
  `media.failed`.
- An **audio prompt that fails** (error, not an autoplay block) cannot be
  answered by ear. The card switches to a text prompt showing the GLOSS
  (the choices are terms, so this does not give the answer away) and logs
  `media.failed` + `check.prompt-fallback`. The server still grades the same
  word; the direction logged stays `audio_to_term` with `fallback: "gloss"`.
- **Autoplay blocked** leaves the large Hear it button (already there) and is
  logged at `info` — today it is `debug`, which never reaches the log store.
- No audio at all: no Hear it button; the server already never picks
  `audio_to_term` for such a word.

## 4. Layout manager: every word fits

### Rules

1. **Never break inside a word.** `word-break: keep-all` (Korean breaks only
   between words, not between syllables), `overflow-wrap: normal`,
   `hyphens: none`. Lines break only at spaces.
2. **Fit, then cap lines.** Text is sized to the largest font that fits its
   region in at most N lines (term 2, gloss 3, choice 2), between a min and
   a max per role.
3. **Choices share one size** — the smallest any of the four needs — so a
   long decoy is not visibly different from the answer and the grid stays
   even.
4. **Last resort, loudly.** If the min size still overflows, allow
   `overflow-wrap: anywhere` and log `layout.clamped` at `warn` with the text
   and region size. It must never clip silently.

### Mechanics

- A fixed card stage sized to the viewport (the Portal is 1280×800), CSS
  grid with named areas per layout (§3), so a region's box is known before
  text is fitted.
- `fitFontSize({ measure, min, max, maxLines })` — pure binary search over
  font size against a `measure(px) → { width, height, lines }` callback.
  Unit-tested with a fake measure (jsdom cannot lay out).
- `<FitText role text lang>` and `<FitGroup>` (shared size for choices) —
  measure the real element (`scrollWidth/Height` against the region), refit
  on `ResizeObserver` and after `document.fonts.ready` (the Korean font
  arriving late changes every width).
- The fitted size and the layout name go into `card.shown` (§5), so a
  squeezed card is findable in the logs without a screenshot.

### Proof

A Playwright spec at 1280×800 on the `/test` door (and a stubbed-plan
**stress deck**: 1-character term, 40-character phrase, a long single English
word such as "Encyclopedia", a 4-line gloss) screenshots every card in
`fresh`, `checks` and `done` and asserts for every text element that it is
contained in its region (`scrollWidth ≤ clientWidth`,
`scrollHeight ≤ clientHeight`) and that no word was split. Screenshots are
also looked at, not just asserted.

## 5. Observability: reading a sitting back

### Correlation

Every frontend event carries `traceId` (minted at mount, so pre-open failures
correlate), `sessionId` (once open returns), `seq` (monotonic per trace),
`t` (ms since mount), `learnerId`, `deckId`, `package`, `mode`
(`live` | `test`). All word-ladder events normalise on `learnerId` (the
frontend currently sends `userId`). Backend events add `mode`.

Order within a trace is by `seq`, not `_time` (the store's `_time` is known to
be local time mislabelled as UTC).

### Events (all at `info` unless marked; `debug` never ships)

| Event | Payload | Answers |
|---|---|---|
| `session.opened` | day, counts, folded, doneToday, scenario | what the day was |
| `card.shown` | wordId, step (check/study/review-quiz/review-run), direction, layout, hasImage, hasAudio, fontPx{term,gloss,choices} | what was on screen, how it looked |
| `audio.played` | kind (native/prompt/take), outcome (ended/error/blocked), ms | did sound actually happen |
| `media.failed` (warn) | kind, assetId | broken asset |
| `check.prompt-fallback` (warn) | wordId, from, to | audio check turned text |
| `card.flipped` | wordId, msOnFront | did they look at the answer |
| `check.answered` | + choice, correct, msToAnswer | what they tapped, how fast |
| `card.marked` | + msOnCard, flipped, recording | self-assessment |
| `recording.*` | + attempt, durationMs, verdict | where recording got hard |
| `card.stalled` (warn) | wordId, step, idleMs (at 45 s, then 120 s, once each) | where they got stuck |
| `notice.shown` (warn) | what, status | "That didn't save" seen |
| `visibility` | hidden/visible | screen off / tablet asleep |
| `layout.clamped` (warn) | role, text, region | text that didn't fit |
| `session.closed` | reason (done/leave/unmount/idle), elapsedMs, remaining | how it ended |

Rough volume: ~6 events per card, ~120 per 19-word sitting.

### `school word-ladder trace`

```
node cli/school.mjs word-ladder trace --learner {learner} [--day 2026-09-22 | --session <id>] [--mode live|test|all]
```

Reads the log store at `$DAYLIGHT_LOGSTORE` (default `http://localhost:9428`,
the convention the idle scripts use), groups by `traceId`, orders by `seq`,
merges backend events in by session, and prints:

```
{learner} · korean-vocab · 2026-09-22 · live · trace 7f3a… · 6m12s · left early (3 to study)
 0:00  opened      4 checks · 12 to study · folded 1 (demoted yeonpil)
 0:02  check  가위   picture→term   [picture]   answered 바위 ✗  (7.1s)
 0:10  study  가위   [picture]      audio ✓  recorded (2 tries: too-quiet)  flipped 4.0s  → still learning
 0:41  study  안녕   [text 88px]    audio blocked → tapped Hear it  flipped 2.2s  → I know it
 1:05  study  이름이 뭐예요? [text 64px]  ⚠ stalled 2m03s on front (no taps)
 3:11  closed      leave · 3 study remaining
```

Formatting is a pure `formatTrace(events)` with unit tests; the CLI is only
the query plus that formatter. Stalls are flagged from `card.stalled` and
from any gap ≥ 30 s between events on one card; the card a sitting ended on
without finishing is marked `✗ left here`.

## 6. Scenarios (decided behaviour)

| # | Situation | Behaviour | Proven by |
|---|---|---|---|
| 1 | First day, all NEW | study pass; the review quiz comes only on a later study day whose frozen plan has nothing to check or study (today's rule) | `fresh` + e2e |
| 2 | All words due for checks | checks in all 3 directions; picture-less words fall back per `resolveDirection` | `checks` + e2e |
| 3 | Word has no picture | `text` layout on every card; never `picture_to_term` | unit + e2e |
| 4 | Picture fails at runtime | switch to `text`, `media.failed` | component test |
| 5 | Audio prompt fails | text prompt with the gloss, `check.prompt-fallback` | component test |
| 6 | Autoplay blocked | Hear it button, `audio.played outcome:blocked` at info | component test |
| 7 | No microphone / denied | flip-and-mark, `recording: unavailable` (today's rule) | existing tests |
| 8 | Recording too quiet/short, repeatedly | "Record again" copy; each try logged with verdict | component test |
| 9 | Network drop mid-answer | "That didn't save", refetch heals (today's rule) + `notice.shown` | existing + log |
| 10 | Session crosses 4 am | 404 → reopen into the new day (today's rule), logged `session.reopened` | existing |
| 11 | Reopen after done | review run, flip-only | `done` + e2e |
| 12 | Paper quiz demoted a word overnight | fold on open → word back in study; `session.opened.folded` names it | unit |
| 13 | Enrollment moved to a new deck | door follows the enrollment; carried LEARNING words appear | unit (launcher) |
| 14 | Child leaves partway | `session.closed reason:leave`, trace marks the card | trace unit test |
| 15 | Child walks away, tablet sleeps | `card.stalled` then `visibility hidden` | component test |
| 16 | `/test` on a program without test mode | refused with a message, nothing opens | SchoolApp test |
| 17 | Test session after backend restart | 404 → fresh test session | e2e |
| 18 | Learner with two packages, bare URL | 404 listing the packages | launcher unit |
| 19 | Very long / very short text | fits per §4, never splits a word; else `layout.clamped` | stress e2e |

Test mode's own guarantee is proven by a backend test that runs a full test
sitting (open, answer, record, mark, review) and asserts the real store's
file is byte-identical before and after, and that no recording file was
written.

## Scope

In: the `word-ladder` launcher + door parsing, the test service/router/shadow
store, seeds, the card layouts + FitText/FitGroup, the event set + trace
context, `trace` CLI, Playwright layout/stress spec, docs
(`word-ladder.md`: door, test mode, layouts, events, trace; `teacher.md`:
the door).

Out: a teacher-console trace view (can sit on the same events later); any
change to ladder rules, grading or credit; test mode for other programs.
The extra audition files in `words/week-01-classroom/gawi/` (`term-v2…v6`,
`gloss-v2/v4`) and `words/week-01-classroom/_deleteme/` are left alone —
nothing reads them (the lexicon drives every lookup).

## Verification before hand-off

1. Unit + component + backend suites green (`test:unit:vitest` gate).
2. Deploy (gate first), then open `/school/go/{learner}/word-ladder/test` with
   each scenario in a headless browser at 1280×800; look at every card.
3. Confirm the learner's `status.yml` checksum unchanged across those runs and no
   file under `recordings/word-ladder/`.
4. `school word-ladder trace --learner {learner} --mode test` reproduces each run
   faithfully.
