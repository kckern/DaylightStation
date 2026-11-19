# Meal food commands

`POST /api/v1/health/nutrition/meal-command` accepts `date`, `bucket`, explicit
`selectedIds`, `operationId`, and `expectedVersions` (entry ID to version), plus:

- `action: "group"`, `name`: group at least two selected foods.
- `action: "groups"`, `groups: [{name, selectedIds}]`: atomically apply disjoint
  proposals within the overall selection.
- `action: "membership"`, `groupId`, optional `name`: replace complete membership
  with the selection. An empty selection retires the parent.
- `action: "ungroup"`, `groupId`: release all children and retire the parent.
- `action: "amend"`, `changes: {entryId: fields}`, optional `additions`: change
  selected foods or add validated ingredients. An addition's `parentId` targets
  a selected food/group. Targeting an ungrouped food creates a group containing
  the unchanged original food and the new ingredient. Quantity-only amendments
  scale existing nutrients with full precision. Amount-based serving changes
  preserve their serving unit while scaling known grams too; validated explicit nutrient
  overrides then take precedence. Changed and scaled fields are marked as manual
  corrections so automatic cleanup cannot overwrite them. Undo restores those
  protection fields along with the original values. A food with a broken dish link
  (a part stranded in another meal, or a `parentId` that names no dish) can be amended:
  its link stays as it is and the row it names is not checked. An amend checks dish
  links only around the rows it touches, so a broken row elsewhere does not block it.

Versions must include every affected existing food and the dish of any real part. Selection
must resolve within the user's requested day and meal. Membership changes cannot
nest groups or move foods across meals. Group parents store zero nutrients;
children contribute exactly once. Stored daily totals sum original finite
nutrients; presentation rounds values separately.

Responses include `committed`, `entryIds`, `affectedIds`, `items`, `date`, `bucket`,
and `undoToken`. The changed IDs include retired parents. Group IDs and Undo tokens
are deterministic for an operation. The ledger journal commits audit snapshots
and the recoverable response alongside food and daily summary changes. Repeating
an operation ID with different input returns 409.

`POST /api/v1/health/nutrition/meal-undo` accepts `undoToken` and a new
`operationId`. It restores only command-affected raw snapshots, incrementing
versions and preserving absent fields, metadata, and nutrient precision. It
rejects intervening edits or graph changes that would leave orphaned children.
Undo of an addition removes only that command's new foods. Manual grouping and
ungrouping never delete foods, and only a dish header is retired when it empties, so a
plain food named by a broken link stays. Ordinary successful captures also receive durable
Undo tokens, including capture responses recovered after an interrupted request.

`POST /api/v1/health/nutrition/meal-suggestions` accepts `date`, `bucket`, and
`selectedIds`. It is read-only and returns proposals with expected versions for
explicit atomic application via `action: "groups"`.

Contextual capture retries read the durable inner command response before AI
interpretation or transcription, preventing a changed meal from being interpreted
as a fresh request after the inner command committed but the outer reply was lost.

## Day-level commands

These two commands work across a day instead of inside one meal. What the person
sees is in the Health reference: [day input](README.md#day-input-dayinputbarjsx),
[moves to another day](README.md#moving-food-to-another-day) and the
[capture toast](README.md#capture-toast).

### Moving foods: `foods-move`

`POST /api/v1/health/nutrition/foods-move` accepts `date`, `selectedIds`,
`expectedVersions`, `operationId`, and a destination: `toDate`, `toMeal`, or both.
All rows commit together or none do. The response adds `toDate`, `toMeal`,
`movedCount`, and one `undoToken` that `meal-undo` accepts.

- **What can be selected.** Every ID must be a row on `date`: a top-level food, a
  dish, or a food with a broken dish link. A food counts as a dish part only when its
  `parentId` resolves to a group on the same day and in the same meal. A part cannot
  move alone: selecting one is a 400.
- **Dish links.** A `parentId` may name its dish by `uuid` or by short `id`. When one
  value matches both, the row with that `uuid` wins.
- **What travels.** A dish brings every row linked to it that day, including a part
  stranded in another meal, which rejoins the dish. A plain food brings only rows
  linked to it in its own meal, and those rows lose the link.
- **Broken links.** Any link that is not a valid dish part is broken. A selected food
  with one moves on its own and its `parentId` is cleared. A row left behind with an
  already broken link to a moved row, such as a part on another day, stays as it is.
- **Versions.** `expectedVersions` must hold the current version of every row the move
  carries, or the move is a 409.
- **Nothing to do.** A move that changes nothing is a 400 ("These foods are already
  there"). A selected food counts as moving when its day or meal changes, or when a
  stranded part rejoins it.
- **Today belongs to the server.** A `toDate` after the server's today is a 400. A
  `today` sent by the client is ignored.

**Undo** restores the exact earlier rows, broken links included. The audit lists in
`brokenLinkIds` every carried row whose link was not a valid dish link and every row
left behind with a broken link to a moved row. Undo accepts a listed row's broken link
only if Undo restores that row or the link is still broken. A row left behind that has
since become a valid part makes Undo a 409, because restoring would split its dish, and
so does any other new breakage. Undo checks only links touching the rows the move
changed, so an unrelated broken row elsewhere does not block it.

### Day input: `day-input`

`POST /api/v1/health/nutrition/day-input` carries one instruction about a day, in
words: new food, a move, or a correction.

| Field | Contract |
|---|---|
| `type` | `text` or `voice` |
| `content` | The words, up to 2000 characters after trimming, or for `voice` a recording as a base64 data URL |
| `audioRef` | `voice` only, in place of `content`: retry from a recording the server already saved |
| `date` | The day the instruction is about (`YYYY-MM-DD`) |
| `operationId` | Required: 1 to 128 letters, digits, `_` or `-`. Repeating it with the same body returns the first result, and with a different body is a 409 |
| `resolved` | Optional answer to a clarification: non-empty `foodId` and `toDate` strings. A day answer may instead keep the foods the question named, with `toDate`, `foodIds` (1 to 200 unique entry IDs, stored sorted so a retry matches) and `fromDate` (an ISO date). `foodIds` and `fromDate` come together and replace `foodId`. Any other shape is a 400 |

The server supplies today. Every reply carries `outcome`, and `instructionText` when
the words are known:

| `outcome` | Meaning | Also returned |
|---|---|---|
| `committed` | The work is done | `kind` (`added`, `moved` or `changed`), `message`, the command's result, and its `undoToken` when there is one |
| `clarification` | Nothing changed; one answer is needed | `clarification: {kind: "food" \| "day", question, choices: [{id, label}]}`. A `day` question also has `foodIds` and `fromDate`: the foods it is about and their day |
| `no-change` | Nothing changed, and the sentence says why | `message` |
| `no-food` | The parser found no food in the words | `message` |

#### How the words are read

`DayInstructionReader` puts one set of fixed-option questions to `IDecisionGateway`.
Answers are options, never free text, and a malformed answer stops the request with a
503 rather than acting on it.

| Question | Options |
|---|---|
| `intent` | `add`, `move`, `change`, `other` |
| `target` | `latest` (the most recent capture), `whole_day`, `meal`, `named`. There is no `unclear` option |
| `fromMeal` | Each meal, or `none` |
| `toMeal` | `same`, or each meal |
| `toDay` | `same`, `older`, or one of the seven days ending today, leaving out the day being viewed. When the latest capture is on another day, the viewed day is offered too, so "move that to today" can bring it here |
| `compound` | Yes or no: does this ask for two or more separate changes? |

A compound request changes nothing and asks for one change at a time. Reporting several
foods is one request, and so is sending several foods to one place. `other` also
changes nothing. `named` targets, and corrections with several candidates, get one more
yes-or-no question per candidate food.

The words are read even when the viewed day has no counted food, with
`foods_on_this_day` empty, because they may correct food logged elsewhere. New food is
the usual answer there. If the gateway is unavailable the request is a 503, as on any
other day.

The server then checks every target against the day's rows. Weight-derived estimates
and rows that are not counted are never targets. Top-level foods follow the same dish
rule as `foods-move`, so a broken-link row stands alone.

#### Answering "which day?"

The first reading decides which foods move. The `day` question returns their IDs and
source day, and the answer sends them back, so the words are not matched against foods a
second time.

The server checks the kept foods against the ledger as it stands. Each ID must still be a
counted top-level row on `fromDate`, and `fromDate` must be the viewed day or within the
last seven days. Otherwise the request is a 422 and nothing moves. The words are still
read, for the destination meal. If they no longer read as a move the reply is `no-change`
("Please say that again."). Replies, Undo and retries under the same operation ID work as
for any other move.

#### What "that" means

`latest` is the most recent capture, which may be on another day: "I had pizza last
night" files the food on Yesterday while Today stays on screen, and "that was actually a
calzone" then means the pizza.

- **On a day with food.** "That" means that day's newest capture. It follows a capture on
  another day only if the capture was made on the viewed calendar day, was filed
  elsewhere, and is newer than the viewed day's foods. Viewing Yesterday's soup while
  coffee was logged today, "that" is the soup.
- **On an empty day.** The newest capture from today back through six days.
- **Which rows count.** Counted foods with a `createdAt`. Reconstructed and uncounted rows
  are left out, and a tie stays on the viewed day.
- **Capture times.** Times are compared as household wall-clock time. The ledger's
  `YYYY-MM-DD HH:mm:ss` is already that, and a time with a zone is converted first.
- **Rows with no time.** On the viewed day they keep ledger order, the last row being the
  latest. A capture that meets the first rule beats them.
- **What one capture is.** Rows sharing a `logId`, or under a shared ID such as `QUICKADD`
  the rows that also share a `createdAt`. A part moves with its whole dish.
- **Where the work happens.** A move takes that day as its source, and a correction
  amends the row on its own date and meal. The food keeps its `createdAt`, so a second
  "move that" follows it.
- **What the reply says.** It names the day when that is not the viewed day: "Moved Pizza
  from Yesterday to Today", "Changed Pizza to Calzone for Yesterday".

A **named** food is looked for on the viewed day first. With no match there, it is looked
for in the latest capture when that is on another day under the rules above. A match is
acted on and the reply names its day. With no match, the question lists the viewed day's
foods and the latest capture's foods, the latter labelled with their day.

On an empty viewed day, a move or correction that points at the latest capture acts on
it. One about a meal or the whole day has nothing to act on there, so it asks, offering
the latest capture's foods. With no food in the seven days it changes nothing and says so.

#### Acting, and when it asks

The service acts on its best reading without asking first, and the reply's Undo is the
way back. It asks only when it cannot identify the food or the destination:

- `kind: "food"`, with the candidates as `choices`, when a move matches no food or a
  correction does not match exactly one.
- `kind: "day"`, with no `choices`, when a move names an older day it cannot pin down,
  or names neither a day nor a meal.

The browser answers by sending the same words with `resolved` under a new
`operationId`, and the server reads them again. A `foodId` must be an eligible food on the
viewed day or on a day from today back through six days, and the work happens on that
row's own date, on that food alone. Any other `foodId` is a 422. An answer to words that now read as new food changes nothing.

Moves go through `foods-move`, and corrections through `meal-command`'s `amend` for
that food's meal, so each has that command's Undo.

#### New food: capture and placement

New food goes through the normal text parser with the meal interpreter and revision
flow turned off, because the words have already been judged to be new food. The parser
may still file it on another day when the words say so. The gateway then assigns each
top-level food to a meal, a dish's parts follow it, and a food whose meal the words do
not give stays where the capture put it. Undo removes the whole capture.

Placement never fails the request, because the food is already logged. If the gateway
cannot place the foods they keep their capture meals. If placement cannot commit, for
example because a row has been edited since, the capture gets its own Undo instead.

Each step commits under an ID derived from `operationId`. A retry first looks for
finished work: a finished move, correction or placement is returned as it stands, and a
capture that committed resumes at placement without reading the words again. This
matters because a day that already holds the food would read differently. A voice retry
does this before transcribing. If a commit fails after the rows reached the ledger, the
food counts as logged.

#### Corrections and pinned fields

A correction applies to one food, which may be a food with a broken dish link. A revision proposal is cut down to the fields that
may be written. Fields in `manualFields` or `cleanupFields` are pinned, unless they are
also in `revisedFields`.

- `grams`, `amount` and `unit` are one quantity and stay or change together. If the
  quantity is pinned, the proposal's nutrients are scaled to the mass being kept.
- If the quantity changes while a nutrient is pinned, that nutrient keeps its value.
- If every proposed field is pinned, nothing changes and the reply says so. If only some
  are, the reply says the hand-set details were kept.

The write is an `amend` with the server-only `voiceCorrection` option, which the HTTP
body cannot set. Changed fields join `manualFields`, so the cleanup auditor leaves them
alone, and also `revisedFields`, so a later voice correction may replace them. A person's
own edit takes the fields it changes off `revisedFields`, which pins them again.

#### Failures

| Status | `code` | When |
|---|---|---|
| 400 | `DAY_INPUT_TOO_LONG` | Typed words are over the limit, refused before the parser runs |
| 400 | `AUDIO_REF_INVALID` | `audioRef` is malformed, sent with `content`, or sent for `text` |
| 404 | `AUDIO_NOT_FOUND` | The saved recording is gone |
| 422 | `DAY_INPUT_TOO_LONG` | Transcribed words are over the limit, with `audioRef` |
| 422 | `TRANSCRIBE_EMPTY` | The recording held no words, with `audioRef` |
| 422 | `INVALID_DAY_INSTRUCTION` | No words to act on, or an answer naming a food not on the day |
| 502 | `TRANSCRIBE_FAILED` | Transcription failed, with `audioRef`. The message is "Could not hear that recording", since the words may be new food |
| 503 | `DAY_INPUT_UNAVAILABLE` | The gateway, or a provider behind the capture or correction, failed or is not configured. The provider's own status is never passed on |

Other malformed requests are a plain 400. Refusals from `foods-move` and `amend` keep
their own 400 or 409, and an unexpected failure is a 500. To retry a
recording, send `audioRef` in place of `content` with the same `operationId`: the saved
recording is read back and no new one is written. Every failure after a recording was
saved returns its `audioRef`. That failure, like a 404, frees an `operationId` that
committed nothing, so the changed request body is accepted.

#### Calibrating the reader

`cli/day-instruction-calibrate.mjs` checks that the gateway reads realistic phrasing as
intended. It runs each phrase in
`__app_modules/wellness/health/cli/fixtures/day-instruction-calibration.json` through
`DayInstructionReader` against a fixed list of foods, and prints `ok` or `MISS` per
phrase and a total. It exits non-zero on any miss. A phrase may set its own `foods` and
`latest`, which is how the empty-day cases are written, and `latestDate` to put the latest
capture on another day, which offers the viewed day as a destination.

```sh
DAYLIGHT_BASE_PATH=<content-base> node cli/day-instruction-calibrate.mjs
DAYLIGHT_BASE_PATH=<content-base> node cli/day-instruction-calibrate.mjs --only empty-dump,empty-correct
```

`--only` runs the named phrases, for trying a wording change cheaply. Only a full run
counts toward the bar.

It makes **paid** Jev gateway calls, one per phrase, recorded in the AI usage ledger
under the feature `day-instruction-calibration`. It writes no food data.

The bar is every phrase passing on two consecutive runs, because a model can pass once
by luck. Run it after changing the reader's questions or options. Fix a miss in that
wording, not by changing a fixture to match a wrong answer.

## Meal capture UI

Each meal has one microphone for additions, amendments, and grouping. Selected
foods narrow instruction context; otherwise the interpreter loads the whole meal
and recent source utterances. It uses the existing AI gateway and transcription
adapter. Clear edits apply immediately with Undo. Ambiguous responses return
`{instructionText, clarification:{question, choices:[{id,label}]}}`; selecting a
choice resubmits text with the same day/meal/selection, `clarification: choiceId`,
and a new operation ID. Smart grouping is always a preview; selected IDs limit it,
otherwise all meal foods are eligible. The preview supports naming and membership
adjustments, then applies all groups atomically.

### Editing a dish in place

An open dish can be edited from its own rows, without the "Edit groups" panel
(`today/dishMembership.js`, wired in `LogTable.jsx`):

- Each ingredient row has a **take out** control (−) next to its confirm. The food
  leaves the dish and stays in the meal as a loose food. It is not deleted; its own
  X deletes it after that. Taking out the last ingredient retires the dish header.
- The dish's last line is an **Add food to {dish}…** picker listing every other food
  in the meal. An ingredient of another dish is labelled `(from {dish})`; picking it
  moves it, and a dish emptied that way is retired.

Both send `action: "membership"` with the dish's complete next member list and
every row's version, so a stale view is rejected (409) and the change gets the
usual meal Undo. The error shows under the dish it belongs to. Neither control
appears in the Ungrouped section or while foods are being selected.

All four meals are always shown, an empty one as its header and add row. Date
navigation finishes a recording against its
original date and selected foods. Saved-audio retries preserve that context and
can return the same selectable clarification flow. Every meal ends in an add row: type
to search saved foods or to have a sentence parsed, or use its photo, barcode and
saved-meal buttons. A successful add clears the row and keeps focus for the next
food. Each in-flight
capture has an estimated progress bar which switches to moving diagonal stripes
after its estimate expires. Only the request outcome completes it. Obsolete bot
status messages are not shown after committed success.

Food-row density displays actual kcal/g to one decimal (including 0.0). Mass is the known grams, else a stored weight (kg, oz, lb, exact) or volume (ml, cl, dl, L, fl oz, cup 240 ml, tbsp 14.787 ml, tsp 4.929 ml) at 1 g/ml via `foodMass`; the row still shows its stored unit. A row with no calories, or only a count unit (serving, piece, slice, can, bowl…), shows —; counts are never guessed into mass. The nearest
of nine configured anchors chooses its color, with midpoint ties toward the higher
anchor. Default identity order is density, artwork, name; the existing after-name
preference remains available. Daily cards round numbers only for display and keep
units inline; food data and daily sums retain precision.

### Inline numeric edit — the order holds still

Meals sort heaviest-first, and dragging a portion, calorie or macro value
previews the new calories live. A section therefore **keeps the entry order it
had when the draft began** for as long as the draft is live — `usePortionControl().draft`
is non-null from `begin` through saving, saved-until-the-read-model-catches-up and
error — so the dragged row never moves out from under the pointer. Values still
update every frame; only the order (top-level entries and a group's children) is
frozen, and an entry that appears meanwhile goes after the frozen ones. When the
draft ends (commit caught up, cancel, Escape, discard), the real order returns.
(`today/sectionOrder.js`: `useFrozenOrder`, `applyFrozenOrder`.)

Whenever a section's top-level order changes — the unfreeze above, an add, an
edit, a delete, a reload — the entries that moved glide from their old position
to the new one (FLIP, `useFlipMoves`: positions measured relative to the section
on every commit, animated only on a commit whose order changed, an inline translate, then the `health-flip-moving` class
transitions it home on the `--ds-motion-base` / `--ds-motion-easing` tokens).
Only rows whose position changed are touched, and nothing animates under
`prefers-reduced-motion`.

## Verification

Focused unit suites cover command transactions, temporary YAML snapshots, context
interpretation, retry recovery, clock transitions, selection, progress and display.
The full browser journey can be run against an isolated built frontend preview:

```sh
HEALTH_WORKFLOW_PREVIEW_URL=<preview-url> node tests/live/flow/health/meal-workflow.verify.mjs
```

All browser API traffic is intercepted. Grouping and amendments use a temporary
YAML datastore, never household nutrition data. The journey checks manual/smart/
voice grouping, preview before mutation, potatoes amendments, choices, Undo,
indeterminate progress, retry operation identity, and desktop/mobile screenshots.


## Concurrent browser commands

The browser tracks operations separately from their affected foods. A group,
membership change, or bulk move reserves its complete dependency set before
sending; a command intersecting another pending operation cannot partially
acquire targets. Independent groups may save concurrently, including in the
same meal. A food move is one atomic command that reserves exactly the rows it
carries. It is checked against these reservations before the screen changes, so a
gesture refused here leaves the earlier change and its Undo offer alone. A 4xx answer
other than 408, 425 or 429 frees the foods at once, because nothing happened. After a
network error, a 5xx or one of those three the outcome is unknown, so the foods stay
reserved until Retry or Dismiss. Retry resends the same operation ID, and a successful
Retry still offers Undo.

Contextual captures may supply `expectedVersions` from the submitted day.
`MealInstructionService` forwards those versions to the final meal command; it
does not silently rebase the intended mutation on rows changed during analysis.
Without supplied versions, its canonical pre-analysis snapshot remains the
baseline. Explicit selected IDs still constrain the model's target scope.

Capture retries retain their operation ID; independent identical captures use
separate IDs. Delete and restore HTTP requests also accept operation IDs for
replaying a lost successful response. Undo reserves the affected IDs recorded
with its originating operation. Server transaction checks remain authoritative
across clients; no browser-wide loading flag substitutes for them.


Applying suggested groups reserves the union of proposed members and their group
dependencies, not every food in the meal. Ordinary parsed text captures return
the resolved log date through the adapter so the browser can refresh the actual
destination and explain entries filed on another day.
