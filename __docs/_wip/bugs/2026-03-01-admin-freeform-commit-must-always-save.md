# Bug: Admin freeform commit must always save user input

**Date:** 2026-03-01
**App:** Admin (ContentSearchCombobox)
**Severity:** UX — blocks user intent

## Problem

When a user types a value into ContentSearchCombobox and commits (blur/Enter), the value should always be saved regardless of whether search results matched. The user is always right — they can see whether their entry resolves visually after the fact.

Currently, when `availableResults: 0` the freeform commit still saves (observed in logs), but this invariant must be preserved: **never gate freeform saves on search result availability**.

## Principle

- The user controls what goes into the field. Period.
- Zero search results does not mean the value is invalid.
- The UI should reflect whether the saved value resolves (e.g. thumbnail loads or not), but must never prevent the commit.

## Evidence

From session `2026-03-02T00-38-51.jsonl`:
- User typed `canvas:religious/stars.jpg`, blurred → `commit.freeform` fired with `availableResults: 0`
- Value saved correctly as freeform
- 5 seconds later the same value resolved as a proper selectable option (`key.enter.select`)
- The search was simply slow to populate — the user's input was correct all along

## Rule

**Never prevent a user from committing freeform text in ContentSearchCombobox.** If search returns 0 results, save anyway. The user decides what's valid.

## Resolution

- **Root cause:** In `ListsItemRow.jsx`'s inline combobox, `setHighlightedIdx(0)` on every
  keystroke (line 1852) caused Enter/Tab to select `displayItems[0]` instead of committing
  freeform text. The highlight was auto-set, not user-navigated.
- **Fix:** Added `userNavigatedRef` to distinguish auto-highlight (typing) from explicit
  navigation (ArrowUp/Down). Enter/Tab only selects highlighted item when user arrow-navigated.
  All programmatic `setHighlightedIdx` calls reset the ref to `false`.
- Regression tests: `tests/live/flow/admin/content-search-combobox/12-freeform-commit.runtime.test.mjs`
- Defensive comments in both `ContentSearchCombobox.jsx` and `ListsItemRow.jsx`
- Status: **Fixed**
