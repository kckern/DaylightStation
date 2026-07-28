# Universal scan vocabulary — design

**Date:** 2026-07-28
**Status:** Design agreed, not implemented
**Scope:** Backend scan dispatch across content, playback control, nutrition, and school

## Problem

Any barcode or QR scanner in the house should handle any code the house generates.
Today it cannot, because there is no top-level namespace — four grammars share one
flat space and only two of them declare themselves.

| Domain | Shape | Example | Self-identifying? |
|---|---|---|---|
| School | `sch:<opaque>` | `sch:a7f3k2` | yes |
| Nutrition | `dl:` / `ct:` / `rs:` | `dl:4`, `ct:mug` | yes |
| Content | `[screen:][action:]source:id[+opts]` | `living-room:plex:594036+shuffle` | **no** |
| Playback command | `[screen:]command[:arg]` | `pause`, `office:volume:30` | **no** |
| Product | digit-only | `041260010682` | n/a |

Content and commands are recognized *positionally* — by matching segments against
known screen names, sources, actions, and commands. Two consequences:

1. **A reader has to be told what a code means.** `barcode.route` (`content` |
   `nutribot`) decides how an ambiguous code is read, so a content barcode scanned
   on a nutribot-routed reader falls through to a UPC lookup and answers with a
   nonsense food or nothing. This is a live defect, not a hypothetical.
2. **Two grammars are one bad name away from colliding.** `ScanVocabularyService`
   carries an explicit warning to keep screen names out of the `dl`/`ct`/`rs` set.
   Naming a screen `dl` would break every density scan in the house.

## Decisions

Three forks were settled before designing:

| Fork | Decision |
|---|---|
| Migration | **Accept both, prefer new.** The prefixed grammar is canonical; un-prefixed legacy forms stay recognized as a deprecated fallback. Nothing already printed breaks. |
| Prefix shape | **Domain-first, flat.** The prefix names the owner; the body stays each domain's existing grammar. Rejected: a house-wide sentinel (`ds:…`, costs length on every printed Code128) and action-first verbs (ambiguous when two domains want `play:`). |
| Un-prefixed codes | **Shape first, per-reader default.** Detect what is detectable (ISBN-13 is 978/979-prefixed); fall back to the reader's `route` only for what remains. |

**On step 4's exact scope** (corrected 2026-07-28 during Task 4, restoring the
decision as originally taken). Shape detection claims **ISBN-13 only**. A bare
UPC/EAN is *not* claimed by shape — it falls to step 5 and means whatever its
reader is configured for.

The distinction is behavioral, not cosmetic. Claiming all digit-only codes as
`product` would make a UPC scanned on a **content** reader log food, where today
it reaches `BarcodePayload.parse`, fails to parse, and does nothing. That breaks
Phase 1's zero-behavior-change criterion. Routing it through step 5 preserves
both readers exactly: nutribot → the UPC food lookup, content → nothing.

`product` is therefore a **route-fallback target, not a shape**. It is reachable
only via `routeFallback: { nutribot: 'product' }`. ISBN is different because a
book is identifiable from the code itself, which is the whole point of detecting
what is detectable.

## 1. The grammar

A closed registry maps a prefix to its owning domain. A domain must register to
receive codes; anything unregistered is unknown by construction.

| Prefix | Owner | Body grammar | Example |
|---|---|---|---|
| `go:` | Content | `[screen:][action:]source:id[+opts]` | `go:living-room:plex:594036+shuffle` |
| `cmd:` | Playback control | `[screen:]command[:arg]` | `cmd:office:volume:30` |
| `nut:` | Nutrition | `dl:` / `ct:` / `rs:` | `nut:dl:4` |
| `sch:` | School | opaque token body | `sch:a7f3k2` |

Each domain keeps the grammar it already has — the prefix only says who parses the
rest. School is unchanged. Nutrition's three prefixes become sub-prefixes under
`nut:`.

Behind `go:`, content segments no longer have to be globally distinctive, which
retires the screen-name/nutrition-tag collision hazard and lets that warning be
deleted.

**Registry rules:**

- Case-sensitive.
- No registered prefix may be a prefix of another, so parsing is a single split on
  the first colon. Enforced by test, not convention.
- `ct:` is owned by nutrition (containers). No other domain may claim it.

## 2. Components

Dispatch currently lives as a chain of `if` branches inline in `app.mjs` (~2761).
Adding a fifth namespace there compounds the problem, and those branches are not
reachable from the other scanner ingress points.

**`2_domains/scan/ScanCode.mjs`** — pure, no I/O. Parses a raw string into
`{ namespace, body, form, legacy }`. Owns the prefix table, the legacy fallbacks,
and shape detection. Purity is what makes the vocabulary testable as a table of
strings.

**`3_applications/scan/ScanDispatcher.mjs`** — holds the `namespace → handler`
registry, resolves through `ScanCode`, calls the owner, returns a uniform Outcome.

**`5_composition/modules/scanDispatch.mjs`** — registers the handlers and injects
the reader's route as a fallback.

All scanner ingress converges here: the BLE relay (`barcodeRelay.mjs`), the USB
cradle (`MQTTBarcodeAdapter`), and `VirtualScannerAdapter`. School already asserts
a code works from any scanner in the house; this makes that true for every domain.

## 3. Resolution order

First match wins.

1. **Registered prefix** — `go:` `cmd:` `nut:` `sch:`
2. **Legacy self-identifying** — bare `dl:` `ct:` `rs:` → nutrition
3. **Legacy positional** — any remaining code containing a colon → content
4. **Shape** — ISBN-13 (978/979) → books. **Other digit-only codes are NOT claimed
   here** and fall to step 5.
5. **Reader's `route`** — last resort for anything still unresolved
6. **Unknown** — explicit outcome

Steps 2 and 3 are the deprecation shelf; deleting them later does not touch 1, 4,
or 5.

`route` degrades from "what this reader is for" to "what this reader assumes when
the code says nothing". The firmware keeps sending it unchanged.

## 4. Data flow and domain contract

```
scanner (BLE relay | USB/MQTT cradle | virtual)
    → { code, device, route }
    → ScanDispatcher.dispatch()
    → ScanCode.parse() → { namespace, body, form, legacy }
    → registry[namespace].handle({ body, device })
    → Outcome → feedback
```

A domain registers two things:

**Handler** — `{ namespace, handle({ body, device }) → Promise<Outcome> }`. The body
arrives stripped of the prefix; a handler never re-parses its own tag.

**Encoder** — whatever generates or prints codes for that domain, routed through a
shared `encode(namespace, body)` that validates against the registry.

The encoder half is what keeps the vocabulary from decaying back into four private
grammars. `ScanVocabularyService` already establishes the rule — its encoders
validate against the same constants the parser uses and throw on invalid input, so
a code that would parse to `null` cannot reach paper. One table behind both sides
means a printed artifact and the parser cannot drift.

**Outcome** adopts school's existing shape, the most demanding consumer (it has to
make paper come out):

```js
{ status, domain, message,
  physical: 'worksheet' | 'receipt' | 'none',
  printed: boolean,
  effect: object | null }
```

Content and commands use `physical: 'none'` and put the dispatch id in `effect`.
Nutrition returns its refusal reason in `message`, which the scale prompt's `⚠️`
line already renders.

## 5. Failure handling

Every dispatch returns an Outcome. `status: 'unknown'` is a real value, never a
fall-through. This generalizes the invariant school enforces today: a scan never
dead-ends, and every path ends in something a person can act on.

**Claim ≠ success.** A handler that recognizes a code but rejects it returns
`claimed: true, ok: false`, and dispatch stops. This is nutrition's existing
`handled`-not-`ok` distinction, which exists so a typo'd `ct:teapot` is refused
rather than passed to a product lookup that answers with a nonsense food.
Generalized, it stops any domain's malformed code leaking into another's.

**Steps 3 and 4 are disjoint by construction.** Legacy positional parsing requires
at least one colon; shape detection requires digit-only. They cannot both match, so
their ordering is not a judgment call.

**Step 3 is a colon-only catch-all, revised 2026-07-28 during implementation.**
An earlier draft had it run `BarcodePayload.parse` against the known screen,
action and command lists. That is not buildable at this layer — those lists come
from config, and `ScanCode` is a pure `2_domains/` module that imports nothing.

Routing every remaining colon-bearing code to content is faithful to today's
behavior rather than a new risk: `app.mjs` already hands any non-school,
non-nutribot code to `TriggerEvent` → `BarcodePayload.parse`, which returns null
when it cannot read it. Two consequences worth stating plainly:

- `unknown` narrows to colon-free, non-digit input. It stays reachable and
  explicit, but it is no longer where most malformed codes land.
- A mis-cased code like `SCH:a7f3k2` resolves to content rather than unknown.
  This is survivable only because claim ≠ success — the content parser refuses
  what it cannot read instead of guessing.

**A colon-free legacy command (`pause`) resolves to `unknown`** and therefore
depends on step 5. That is not a regression: on a content-routed reader the
fallback sends it to content exactly as today, and on a nutribot-routed reader it
goes to the product lookup exactly as today. It does mean step 5's fallback map
is required for Phase 1's zero-behavior-change criterion, not optional.

The dispatcher does not own feedback. It returns the Outcome; composition picks the
channel (school prints a slip, nutrition edits the Telegram prompt, content flashes
the relay LED). The guarantee is that there is always something to render.

## 6. Migration

| Phase | Work | Exit criterion |
|---|---|---|
| 1 | Build `ScanCode` + dispatcher, register the four existing handlers, legacy steps live | Every existing code string routes exactly as it does today |
| 2 | Switch encoders to emit prefixed forms; reprint the fridge sheet | New artifacts carry `nut:`/`go:`; school unchanged (`sch:` already canonical) |
| 3 | Delete legacy steps 2–3 | No un-prefixed artifacts remain in circulation |

## 7. Tests

- **Vocabulary table** — string → expected namespace, covering all four domains,
  both legacy forms, digit-only, and garbage.
- **Registry invariant** — no registered prefix is a prefix of another. This is what
  makes single-split parsing safe.
- **Encoder/parser round-trip** — per domain, `parse(encode(x)) === x`.
- **No fall-through** — fuzz arbitrary strings; dispatch never returns undefined.
- **Regression** — the content-code-on-a-nutribot-reader case resolves to content,
  not a UPC lookup.

## Deferred

- **ISBN/book logging.** Step 4 reserves the shape; the books handler is not built.
- **Third-party QR collisions.** A house-wide sentinel (`ds:`) was rejected for
  length. If a real collision ever appears, it can be added as an outer layer
  without disturbing the registry.

## Related

- `_extensions/food-scale-relay/README.md` — the DS2278 BLE HID relay that
  prompted this
- `backend/src/2_domains/school/sessions/tokens.mjs` — `sch:` prefix, the pattern
  being generalized
- `backend/src/2_domains/nutrition/services/ScanVocabularyService.mjs` — the
  encoder/parser discipline being generalized
- `backend/src/2_domains/barcode/BarcodePayload.mjs` — the positional grammar
  moving behind `go:`
