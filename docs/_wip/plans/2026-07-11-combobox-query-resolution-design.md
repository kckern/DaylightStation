# ContentCombobox — Query-to-ID Resolution Design

**Date:** 2026-07-11
**Status:** Design (validated with KC via brainstorming)
**Follows:** `2026-07-11-content-combobox-ux-risk-audit.md` (F11/F12/F14 context), the combobox UX overhaul (merged `1aa5120db`).
**Prompted by:** typing `singalong:bread of life` commits the literal query as a dead content id instead of resolving it.

---

## The mental model

The ContentCombobox is a **rendering pipeline, not a validator.** A human types fuzzy text; the search (and browse) exists precisely to *render* that text into a resolvable content id. Consequences that drive every decision below:

1. **The typed string is a query, never a value.** It is not expected to be a valid id on its own. Resolving it into an id is the tool's entire job.
2. **Not every input resolves, and that is normal** — not an error to reject. Some inputs are valid-but-unsearchable ids (`webcam:garage`, `app:fitness`); some are typos. The tail where rendering doesn't land is handled by keeping the raw text, not by blocking the user.
3. **Resolution can land at any level of the content lineage, and the level is the human's choice — never the tool's.** `bluey` can resolve to the *show* (`plex:<show>`, e.g. for a shuffle-the-series behavior) or, by drilling, to a *season* or a specific *episode* (`plex:<episode>`). Same lineage, different depth; both are correct. The tool presents the choice (F7 dual affordance + browse); it must not decide depth for the user.

**One-line statement:** the combobox renders human text into a content id; the human owns which lineage level is right; the tool auto-finishes only when there is genuinely no choice to make.

---

## Behavior spec

### The two arms of the pipeline
- **Search arm** — type text → scoped or global search → results.
- **Browse arm** — drill a container (chevron) → seasons/episodes/tracks → pick at any level. Already built (breadcrumbs, drill/up).

Both terminate the same way: **the human picks a row at whatever lineage level they want, and that row's id commits.**

### Commit resolution order (Enter / blur / click)
Evaluated top-down; first match wins:

1. **Explicit pick** — the user arrowed to a row (`highlight.userNavigated`) and pressed Enter, or clicked a row → commit that row's id. *The primary path.* (Container vs. leaf per F7: row/Enter selects the container as-is; the chevron drills.)
2. **Unambiguous leaf render** — results are loaded and the intent is unambiguous: exactly **one** result, or an exact **id-lookup** hit (`plex:642197`, `singalong:i am a child` → one hymn) **AND that result is a leaf** (not a container) → auto-render: commit that id on Enter/blur.
3. **Container hit — even if it is the only result** (`bluey` → the show) → **do not guess the level and do not auto-drill.** Keep the dropdown open so the human chooses: take it show-level (select) or drill (chevron). Enter does not silently freeze anything.
4. **Multiple hits, nobody picked** → **do not guess.** Keep results open for the human to resolve.
5. **Results not loaded yet** (typed + Enter before the 300 ms debounce settles) → fire a `take=1` scoped resolve; if it returns a single leaf/exact hit, commit it (rule 2); otherwise open the results (rules 3/4).
6. **Nothing renders at all** → **keep the literal `source:term`/text as the value + flag it** (warn toast: *"Couldn't resolve '…' — saved as raw id"*). Preserves valid-but-unsearchable ids and surfaces typos. (KC decision, 2026-07-11.)

### What this deletes
The current code treats any `source:nonspace` string as a committable id via three divergent gates:
- `contentSearchLogic.js` `CONTENT_ID_LIKE = /^[\w-]+:\s?\S+/` (commit-on-close / freeform Enter)
- `useAutoResolve.js` `CONTENT_ID_RE = /^[^:]+:\s*.+$/` (skips resolving anything with a colon)
- these make `singalong:bread of life` commit literally and never resolve.

Under this design those gates no longer decide "is this a final value." Commit always runs the resolution order above. The regexes survive only where they answer a different question (e.g. "is this shaped like an id, for the raw-fallback flag" / backend prefix parsing).

---

## Where it lives (architecture)

**Frontend-only.** The backend already does the right thing and needs no change:
- scoped search + **parallel id-lookup** (`ContentQueryService` runs `#lookupById` and text search together; an exact id resolves to itself with `matchReason: 'id-lookup'`),
- **prefix aliases** (`hymn:`, `movie:`) from `content-prefixes.yml`.

Resolution moves into the combobox **hook** (`useContentCombobox.js`), which already owns `state.results` and the search transport. This is the key change from today's row-level `useAutoResolve` (wired only into `ListsItemRow`/`EmptyItemRow`): putting it in the hook means **every** consumer resolves uniformly — inline rows, the empty-add row, the **modal editor** (`ListsItemEditor`), and **PlaybackHub** — not just two surfaces.

New hook responsibility — a single `commit(reason)` decision that the component's Enter/blur/select handlers call, implementing the resolution order. It can:
- read `state.results` + `state.highlight` synchronously for rules 1–4,
- issue a `take=1` scoped resolve for rule 5 (reusing the existing search endpoint / the `useAutoResolve` fetch shape),
- fall back to literal + `showUndoToast`/warn for rule 6.

`useAutoResolve` (the async, post-commit, row-level resolver) becomes **redundant for the combobox path** and is retired or reduced to a safety net for programmatic value changes — decided during planning to avoid double-resolution.

### Leaf vs. container
`isContainer(item)` already exists in `ContentCombobox.jsx` (type ∈ show/album/artist/playlist/…, or `itemType==='container'`). Rules 2–3 use it to distinguish an auto-committable leaf from a level-choice container.

---

## Edge cases & decisions

| Input | Renders to | Notes |
|---|---|---|
| `hymn:faith` | top "Faith" hymn if unambiguous leaf; else open to pick | alias prefix → singalong/hymn scope |
| `singalong:i am a child` | one hymn → auto-render | scoped, single leaf |
| `movie:Hulk` | **open to pick** (2003 vs 2008) | ambiguous → human decides |
| `plex:home on the range` | the film (leaf) → auto-render if single | scoped |
| `plex:642197` | itself, via id-lookup (leaf) → auto-render | exact id resolves to itself |
| `bluey` | **open**: select show-level OR drill to episode | container = level choice (F7) |
| `webcam:garage` | no results → **literal + flag** | valid unsearchable id preserved |
| `hymn:asdfgh` | no results → **literal + flag** | typo surfaced, not silent |

**Non-goals (YAGNI):** no backend changes; no new "confirm dialog"; no ranking/relevance tuning (trust backend order); no auto-drill; no attempt to *infer* the user's intended lineage level.

---

## Testing strategy

Unit/component (Vitest), one case per row of the table above, plus:
- rule 1 (explicit pick commits that id, container or leaf),
- rule 5 (Enter before debounce → take=1 resolve path),
- rule 6 (literal + flag toast fires; value is the raw text),
- regression: an exact id (`plex:642197`) still commits (via id-lookup, not literal fallback),
- regression: browse/drill commit still works (F7 dual affordance untouched).

Live/visual verification deferred (shared dev env in use by the parallel piano agent), same as the overhaul — to be run when a dev env is free.

---

## Rollout
Branch `feat/combobox-query-resolution` (isolated worktree) → TDD via subagents → merge to `main` (integrate any parallel work, **pause before push** per standing policy).
