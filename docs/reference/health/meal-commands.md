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
  protection fields along with the original values.

Versions must include every affected existing food and group parent. Selection
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
ungrouping never delete foods. Ordinary successful captures also receive durable
Undo tokens, including capture responses recovered after an interrupted request.

`POST /api/v1/health/nutrition/meal-suggestions` accepts `date`, `bucket`, and
`selectedIds`. It is read-only and returns proposals with expected versions for
explicit atomic application via `action: "groups"`.

Contextual capture retries read the durable inner command response before AI
interpretation or transcription, preventing a changed meal from being interpreted
as a fresh request after the inner command committed but the outer reply was lost.


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

The current local meal has a temporary empty section on today's page. Past dates
do not anticipate empty meals. The section retires when its window passes unless
it contains food or owns ongoing interaction, including an active recording,
retryable task, or clarification. Date navigation finishes a recording against its
original date and selected foods. Saved-audio retries preserve that context and
can return the same selectable clarification flow. Plus opens explicit capture choices;
text catalog suggestions appear only after choosing Type food. Each in-flight
capture has an estimated progress bar which switches to moving diagonal stripes
after its estimate expires. Only the request outcome completes it. Obsolete bot
status messages are not shown after committed success.

Food-row density displays actual kcal/g to one decimal (including 0.0); the nearest
of nine configured anchors chooses its color, with midpoint ties toward the higher
anchor. Default identity order is density, artwork, name; the existing after-name
preference remains available. Daily cards round numbers only for display and keep
units inline; food data and daily sums retain precision.

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
