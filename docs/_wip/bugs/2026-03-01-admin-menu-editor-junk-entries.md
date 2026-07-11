# Admin Menu Editor Creates Junk Entries

**Date:** 2026-03-01
**Severity:** Low (data corruption, not crash)
**Status:** Fixed (2026-07-09)

## Symptom

Junk entries appeared in `tvapp.yml` menu config:

```yaml
- active: true
  input: star wars
  label: star wars
- active: true
  input: star wars
  label: star wars
- label: star
  input: star
  action: Play
  active: true
```

These entries have no `uid`, no valid `input` format (missing source prefix like `plex:`), and appear to be raw text typed into the admin menu editor without proper validation.

## Impact

- Invalid menu items render in the TV app UI
- No `uid` means they can't be tracked or managed properly
- They "show up everywhere" — likely the list adapter treats them as generic items

## Immediate Fix

Removed the three junk entries from `tvapp.yml` and restarted the Docker container to clear the list cache.

## Root Cause (TODO)

Investigate the admin menu editor — it should:
1. Validate that `input` follows the `source:id` format (e.g., `plex:12345`)
2. Auto-generate a `uid` for new entries
3. Prevent saving entries with free-text input that doesn't resolve to a content source

## Resolution (2026-07-09)

Root cause was a two-step chain in the inline combobox (`frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx`):

1. **Blur-commit of exploratory text** — `handleBlur` called `commitFreeformText('blur')` for ANY typed text that differed from the current value, so search-and-walk-away persisted raw text like `star wars`.
2. **EmptyItemRow auto-add-on-input** — in the new-item row, the combobox `onChange` is `setInput`, and a `useEffect([input])` immediately POSTed whatever landed in `input`. The blur-commit above fed it, producing junk entries without validation.

Fixed by two gates, both built on `isContentIdLike` / `shouldAutoAdd` from `contentSearchLogic.js` (single source of truth for the `source:id` shape):

- **Blur gate** — blur commits only id-like text (intentional direct-id entry); exploratory text reverts to the prior value. Explicit gestures (Enter/Tab) still commit freeform per the 2026-03-01 always-save invariant. Commit `c17853179`.
- **Auto-add gate** — EmptyItemRow's effect auto-adds only when `shouldAutoAdd(input)` (dropdown pick or pasted content id); freeform text stays staged and is added only via explicit Enter. Commit: `fix(admin): EmptyItemRow auto-adds only id-like input — closes 2026-03-01 junk-entries bug` (this doc lands in that commit).

Regression-pinned by Playwright suite `tests/live/flow/admin/content-search-combobox/18-inline-row-commit-policy.runtime.test.mjs` (blur-revert, id-like commit-once, no junk auto-add), added in `98dac046e`.
