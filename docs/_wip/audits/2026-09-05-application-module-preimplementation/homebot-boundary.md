# Homebot command boundary and household projection contrasts

Status: selected command design with original-source characterization. No
application edits, candidate execution or migration approval. The follow-on
[household boundary](household-boundary.md) specifies its core source/interface;
package adoption and extraction proof remain open.
Machine specification: [homebot-boundary.json](homebot-boundary.json).

## Selected command and ownership

Gratitude's existing public composition entry returns one bound operation:
`createGratitudeServices(...).gratitudeCommands.addSelections`. It delegates to
the **same** `GratitudeService` instance used by HTTP, with exactly five positional
arguments: household ID, category, user ID, original items array, timestamp.
The ordinary forwarding function returns the original promise without wrapping,
retrying, publishing or transforming its entities/errors. There is no additional
`@daylight/gratitude/server/commands` package entry or private service export.

The installed backend passes that operation as `addGratitudeSelections` to
`createHomebotServices`. That composition factory constructs a Homebot-owned
`GratitudeSelectionCommandAdapter`, which **extends** Homebot's
`IGratitudeSelectionGateway`. The container and assignment use case receive it
as `gratitudeSelectionGateway`. The adapter imports only its own port; neither
it nor Homebot's application imports Gratitude's implementation. The container
still constructs and caches the use case lazily; it never imports the adapter.

This preserves D1/D3/D7 and the distinction between composition authority and
an application operation. Neither product's domain rank changes. New port and
adapter metadata identify owner `homebot`, product, server, their genuine
application/adapter layer, and null domain context/rank—not a new rank exemption.

## Exact source scope and staging

The Gratitude rehearsal explicitly retains Homebot at its current location.
Two new Homebot-private files therefore join that owner there:

| Rehearsal file | Final Homebot destination |
|---|---|
| `backend/src/3_applications/homebot/ports/IGratitudeSelectionGateway.mjs` | `modules/homebot/server/application/ports/IGratitudeSelectionGateway.mjs` |
| `backend/src/1_adapters/homebot/GratitudeSelectionCommandAdapter.mjs` | `modules/homebot/server/adapters/gratitude/GratitudeSelectionCommandAdapter.mjs` |

These are single implementations, not compatibility copies. The adapter's
rehearsal import is `#apps/homebot/ports/IGratitudeSelectionGateway.mjs`, resolved
within the existing backend package. Its eventual owner-local import is
`../../application/ports/IGratitudeSelectionGateway.mjs`; both targets are
specified and checked. Relocate these files with Homebot before final cutover;
do not leave a permanent old-tree dependency, invent a second public Homebot
package just for the rehearsal, or add a `deprecated/` tree.

Five existing files have eleven exact edit groups in the machine specification:

1. `AssignItemToUser.mjs`: rename the injected dependency, including its validation
   message and documentation; preserve the method call and all workflow logic.
2. `HomeBotContainer.mjs`: rename the captured/forwarded dependency and its
   documentation; preserve getter timing and cached instance identity.
3. `bootstrap.mjs`: add one explicit bridge import; narrow only the Homebot
   factory input; instantiate and inject its bridge. Retain its household
   adapter, other dependencies, output objects and unrelated factories.
4. `app.mjs`: change only Homebot's broad-service argument to the returned command.
5. The retained `tests/isolated/flow/homebot/AssignItemToUser.test.mjs`: change only
   constructor dependency keys and the corresponding required-dependency message.
   Its behavior assertions/imports stay authoritative; no test is removed.

The additional production target is the already-planned Gratitude composition
factory. Its canonical **full proposed source** lives in `feed-boundary.json`,
including both the Feed query and Homebot command; this document does not create
a competing factory. Nine existing import edges to the Homebot container/use
case have explicit retained-or-edited dispositions. These are not all Homebot
imports or authorization for Homebot's complete relocation.

The preparation baseline driver and existing new rendering/registration cases
also need a future candidate binding that supplies the new gateway. Their
original-code branch remains intact. Do not change behavior or normalize
observed results to hide a difference between baseline and candidate.

## Behavior that must survive

The operation sequence is:

`state → default household → timestamp → await batch → await optional name →
unawaited broadcast → await message update → await state deletion`.

Eleven linked original-source Homebot/batch cases now establish:

- Expired state/absent items only update the message and return failure; state
  is not cleared. State/household lookup failures propagate.
- Explicit timezone—including `UTC`—uses locale formatting. Omitted timezone
  uses `nowTs24`. Invalid timezone is caught by the save-error branch before
  calling the command. No timestamp repair or format change is proposed.
- The saved/event category is `category || 'gratitude'`; the result retains the
  original raw category, even undefined. Only exact lowercase `hopes` changes
  the success-message label. The bridge adds no category validation.
- The existing **batch** permits duplicate IDs, creates new selections, forwards
  category unchanged, and does not transfer/remove options. `addSelection` has
  different duplicate/transfer behavior and cannot replace it. Per-item writes
  are sequential; failure can leave earlier writes, and a retry can repeat them.
- False save/store results are not a rejection. Save/timestamp errors produce
  the current failure message/DTO without clearing state. If delivery of that
  failure message itself fails, execution rejects with that delivery error.
- Display lookup remains `(null, username)` and falls back to username for an
  absent method or falsy result. Errors after saving are not compensated.
- Broadcast uses the exact existing `gratitude/item_added`, projected item IDs/
  text and `source: 'homebot'` payload. Its return value is not awaited. A thrown
  broadcast error propagates; no success message or deletion follows it.
- Directly supplied response context remains bound and receives two update
  arguments. Gateway fallback receives conversation, message, text. The existing
  event-router callback forwards neither timezone nor response context.

These findings characterize existing behavior, including defects; they do not
certify transactionality, retries, messaging delivery or live persistence.
Original single-item/batch/HTTP behaviors are not made artificially uniform.

Intentional internal differences are explicit: the dependency key and its error
message change; the factory receives a function and invalid functions fail at
bridge construction; Gratitude's factory returns an additional property. Valid
installed activation order, service identity and external contracts stay fixed.

Four negative controls are specified but **not executed**: publish before batch
completion, replace batch with single-item commands, clear state after failed
batch, and await the broadcast result. They are not part of the seven existing
red/restored pairs. Actual bridge/port inheritance, promise/receiver identity,
native exports, factory startup and candidate parity remain execution gates.

## Initial household extraction constraints

Three additional baseline cases compare the original Gratitude helper and
Homebot ConfigHouseholdAdapter against real in-memory ConfigService and failing
injected providers:

| Concern | Preserve the distinction |
|---|---|
| Roster versus confirmation names | Roster uses display name/name/capitalized ID; confirmation prefers group label. Homebot's roster has `userId/displayName/groupLabel/group`; Gratitude's has `id/name/group_label`. |
| Membership | Declared order and duplicates survive. Homebot accepts object roster entries; Gratitude's string fallback can throw for those entries. Do not silently widen/narrow both APIs together. |
| Falsy user | Gratitude returns `Unknown` before any profile lookup. Homebot looks up the profile first, even for null. |
| Timezone | Gratitude's optional provider gets an additional truthy `UTC` fallback. Homebot's required accessor can return an empty string. ConfigService itself uses nullish household/system/default precedence. |
| Cache | Both reproject supplied cached config each call; neither creates its own result cache nor reloads disk. Mutations/reload visibility must remain with the existing provider. |
| Category | String/coercion/lowercase-without-trim validation stays in Gratitude. It is not a generic identity responsibility or a new Homebot command validation step. |

The follow-on [household boundary](household-boundary.md) now specifies the
shared application projection/port/config translation and public composition/
browser wiring, with nine server and five browser-consumer cases including
timestamp/refresh/failure behavior. It retains the current bootstrap URL. Its
global metadata/target/package/build and native candidate gates remain separate;
these three initial comparison cases do not certify the entire extraction.
