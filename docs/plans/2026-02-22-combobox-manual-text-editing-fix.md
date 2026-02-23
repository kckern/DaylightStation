# Fix Manual Text Editing in ContentSearchCombobox

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to manually edit content IDs in the combobox input (e.g. change `app:family-selector/soren` to `app:family-selector/dad`) without the `freshOpenRef` mechanism steamrolling their edits.

**Architecture:** Remove the `freshOpenRef` Backspace override entirely. The browser's native selection behavior already handles the "type to replace selected text" UX. The original auto-selection (lines 1178-1189) is good — it selects the suffix so typing replaces it. The problem is the Backspace intercept that nukes the entire input instead of just deleting the selected text normally.

**Tech Stack:** React, Mantine Combobox

---

### Task 1: Remove `freshOpenRef` Backspace Override

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx:1261-1274`

**Step 1: Remove the Backspace intercept and the freshOpenRef clearing logic**

In `handleKeyDown`, delete the `freshOpenRef` Backspace block (lines 1262-1274). These 13 lines:

```javascript
    // On fresh open, Backspace clears the entire input (prefix + selected suffix)
    // so the user can start with a completely different content type.
    if (e.key === 'Backspace' && freshOpenRef.current) {
      e.preventDefault();
      freshOpenRef.current = false;
      setSearchQuery('');
      setHighlightedIdx(0);
      return;
    }
    // Any non-navigation key clears the fresh-open state
    if (freshOpenRef.current && !['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      freshOpenRef.current = false;
    }
```

Replace with nothing. The function should go straight from the opening `async (e) => {` into the `const items = displayItems;` line.

After edit, lines 1261+ should read:

```javascript
  const handleKeyDown = async (e) => {
    const items = displayItems;

    // Handle Enter/Escape/Tab before the items-length guard so manual
    // input is always accepted, even when no results match.
    if (e.key === 'Enter') {
```

**Step 2: Remove `freshOpenRef` declaration and all remaining references**

In the same file, remove these pieces:

1. **Declaration** (line 716): `const freshOpenRef = useRef(false);`
2. **Set true in handleStartEditing** (line 1180): `freshOpenRef.current = true;`
3. **Reset in resetComboboxState** (line 732): `freshOpenRef.current = false;`

After removing line 1180, the `handleStartEditing` auto-selection block (lines 1178-1189) becomes:

```javascript
    const colonIdx = q.indexOf(':');
    if (colonIdx >= 0) {
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el) {
          const selStart = colonIdx + 1;
          // skip the space after colon if present
          const trimmedStart = q[selStart] === ' ' ? selStart + 1 : selStart;
          el.setSelectionRange(trimmedStart, q.length);
        }
      });
    }
```

The auto-selection still works — the browser handles Backspace on selected text natively (deletes just the selection).

**Step 3: Verify no remaining references to freshOpenRef**

Run: `grep -n 'freshOpenRef' frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx`
Expected: No output (zero matches).

**Step 4: Verify the app builds**

Run: `cd /Users/kckern/Documents/GitHub/DaylightStation && npx vite build 2>&1 | tail -5`
Expected: Build succeeds with no errors.

**Step 5: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "fix: remove freshOpenRef that prevented manual text editing in combobox

The freshOpenRef mechanism intercepted Backspace on fresh open and
cleared the entire input, making it impossible to manually edit
content IDs (e.g. changing family-selector/soren to /dad).

Browser native selection behavior already handles this correctly —
the auto-selection of the suffix after the colon means typing
replaces it, and Backspace deletes just the selected portion."
```

---

## Behavior After Fix

| Action | Before (broken) | After (fixed) |
|--------|-----------------|---------------|
| Open → Backspace | Entire input cleared | Selected suffix deleted, prefix preserved |
| Open → Click to reposition → Backspace | Entire input cleared | Single character deleted at cursor |
| Open → Type `dad` | Works (replaced selection) | Works (same — unchanged) |
| Open → Arrow Right → Backspace | Entire input cleared | Single character deleted at cursor |
| Open → Escape | Closes (unchanged) | Closes (unchanged) |
