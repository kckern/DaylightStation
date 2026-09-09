# Reading Shelf Visual Remediation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the 19 catalogued visual defects on the child's reading shelf (`School/books/`), and make the history view scroll vertically on its own terms rather than by inheriting a leaked rule.

**Architecture:** The shelf's problems are almost all in two places: `ShelfTile`'s fixed-height 4-row grid (which slices titles) and `School.scss:1982-2283` (which reuses the ISBN keypad's button class, the launch card's poster placeholder, and stacks two contradictory layout classes on one element). We restructure the tile's text into its own flex column so nothing has a fixed height fighting variable text; we split the conflated `__grid`/`__row` and `__grid`/`__scroll` class pairs so the horizontal shelf and the vertical history each own their scrolling; and we stop borrowing classes across component boundaries. No new dependencies, no new components except one text wrapper element.

**Tech Stack:** React 18 + SCSS (`School.scss`, hand-rolled `--school-*` tokens, no design-system import), Vitest + Testing Library (`jsdom`). jsdom has no layout engine, so every test here pins DOM structure, class names, and text — the pixel outcomes are verified by a screenshot at the end.

---

## Before you start

**This checkout is behind the deployed tree.** Per `CLAUDE.local.md`, prod is built from `homeserver.local:/opt/Code/DaylightStation`, and as of 2026-09-09 that tree has three School commits that are not on `origin/main`:

```
5a185e7f7 refactor(school): one answer to "is this a real panel?", not four
0465f33d6 fix(school): the book door belongs on every School panel, browser mount included
e7a5d8670 feat(school): three fewer walls between a child and their reading log
```

They touch `School.scss`, `BookShelf.jsx`, `useBookShelf.js`, and add `docs/reference/school/reading-shelf.md`. **Task 0 integrates them. Do not skip it** — every line number in this plan is stated against the post-integration tree, and building on the stale tree guarantees conflicts in `School.scss`.

Verified: those commits do **not** touch `.school-books__row`, `.school-books-tile`, `.school-books__grid`, or the `Shelf()` render function. The defects below survive the merge intact.

### Commands you will use

```bash
# One test file
npx vitest run --config vitest.config.mjs frontend/src/modules/School/books/ShelfTile.test.jsx

# Every colocated frontend spec (the sweep this module lives in)
npm run test:isolated -- --only=frontend

# SCSS still compiles
npm run check:scss
```

### Rules from CLAUDE.md that apply here

- Docs live in `/docs`; update `docs/reference/school/reading-shelf.md` when behaviour changes (Task 16).
- Never use raw `console.*`.
- Commit after every task.

---

## Task 0: Integrate the deployed tree

**Files:** none authored — this is a merge.

**Step 1: Confirm you are behind**

```bash
git fetch origin
ssh homeserver.local 'cd /opt/Code/DaylightStation && git log --oneline origin/main..HEAD | head -5'
```

Expected: the three `5a185e7f7 / 0465f33d6 / e7a5d8670` commits listed above (or newer ones on top of them).

**Step 2: Fetch and merge the deploy tree**

```bash
git fetch homeserver.local:/opt/Code/DaylightStation main
git merge FETCH_HEAD
```

Expected: a clean merge. If `School.scss` conflicts, take **both** sides — the deploy tree's additions are in the `.school-lock-split__board` / `.school-book-scan` regions (lines ~2743 and ~3099), nowhere near `.school-books__*`.

**Step 3: Prove the tree is green before you change anything**

```bash
npm run test:isolated -- --only=frontend
```

Expected: PASS. Record the test count — you will compare against it in Task 17.

**Step 4: Commit the merge if one was created**

```bash
git status   # if the merge was a fast-forward there is nothing to commit
```

---

## Task 1: The tile's text stops being sliced

**The defect:** all four cards in the screenshot have their second title line cut through the x-height. `.school-books__row .school-books-tile` pins `height: 9.5rem` (`.school-books__recent` overrides to `8.5rem`), and the text is laid out in `grid-template-rows: auto auto 0.5rem auto` — a four-row track that reserves a slot for a progress bar finished books never have, so the caption lands in a `0.5rem` row and the whole stack fights a fixed height. Combined with `-webkit-line-clamp: 2` at `line-height: 1.2`, the title has no slack.

**The fix:** the tile becomes a two-column grid — cover, then a text column that owns its own vertical rhythm. No shared rows, no phantom bar slot, `min-height` instead of `height`.

**Files:**
- Modify: `frontend/src/modules/School/books/ShelfTile.jsx:69-96`
- Modify: `frontend/src/modules/School/School.scss:2265-2283`
- Modify: `frontend/src/modules/School/School.scss:2052-2054` (title line-height)
- Test: `frontend/src/modules/School/books/ShelfTile.test.jsx`

**Step 1: Write the failing test**

Append inside the top-level `describe('ShelfTile', ...)` in `ShelfTile.test.jsx`:

```javascript
  describe('the text column', () => {
    it('wraps title, author, bar and caption in one text column beside the cover', () => {
      const { container } = render(<ShelfTile item={item()} onSelect={() => {}} />);
      const text = container.querySelector('.school-books-tile__text');
      expect(text).not.toBeNull();
      expect(text.querySelector('.school-books-tile__title')).not.toBeNull();
      expect(text.querySelector('.school-books-tile__author')).not.toBeNull();
      expect(text.querySelector('.school-books-tile__bar')).not.toBeNull();
      expect(text.querySelector('.school-books-tile__caption')).not.toBeNull();
    });

    it('keeps the cover outside the text column, so the two are grid siblings', () => {
      const { container } = render(<ShelfTile item={item()} onSelect={() => {}} />);
      const text = container.querySelector('.school-books-tile__text');
      expect(text.querySelector('.school-books-tile__cover')).toBeNull();
      expect(container.querySelector('.school-books-tile__cover')).not.toBeNull();
    });
  });
```

**Step 2: Run it and watch it fail**

```bash
npx vitest run --config vitest.config.mjs frontend/src/modules/School/books/ShelfTile.test.jsx
```

Expected: FAIL — `expect(received).not.toBeNull()`, because `.school-books-tile__text` does not exist yet.

**Step 3: Add the text wrapper**

In `ShelfTile.jsx`, replace the whole `const body = (...)` expression (currently lines 69-96) with:

```jsx
  const body = (
    <>
      <BookCover book={item} className="school-books-tile__cover" loading="lazy" />
      <div className="school-books-tile__text">
        <span className="school-books-tile__title" title={title}>{title}</span>
        {presentation.author && (
          <span className="school-books-tile__author" title={presentation.allAuthors}>{presentation.author}</span>
        )}
        {showBar && (
          <div
            className="school-books-tile__bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label={`${percent}% read`}
          >
            <div className="school-books-tile__fill" style={{ width: `${percent}%` }} />
          </div>
        )}
        <span className="school-books-tile__caption">{onHistory ? outcomeFor(item) : captionFor(item)}</span>
        {!onHistory && incompatibleMetric && (
          <span className="school-books-tile__tag">{`doesn't count toward ${METRIC_WORDS[incompatibleMetric] ?? incompatibleMetric}`}</span>
        )}
      </div>
    </>
  );
```

**Step 4: Run the test to verify it passes**

```bash
npx vitest run --config vitest.config.mjs frontend/src/modules/School/books/ShelfTile.test.jsx
```

Expected: PASS, 24 tests.

**Step 5: Restyle the row**

In `School.scss`, replace the whole block from `.school-books__row {` (line 2265) through `.school-books__recent .school-books-tile__cover { height: 6.5rem; }` (line 2283) with:

```scss
// A horizontal shelf of compact cards. NOTHING here may fix a card's height:
// titles are two clamped lines of arbitrary text and a fixed height slices
// them (the defect this replaced). The card sizes to its text column, and the
// row stretches every card to the tallest — so a row stays even without any
// card being told what it must measure.
.school-books__row {
  display: flex; flex: none; gap: 0.7rem; overflow-x: auto; overflow-y: hidden;
  padding: 0.4rem 0 0.65rem; min-height: 0; align-items: stretch;
  .school-books-tile {
    flex: 0 0 17rem; min-height: 9.5rem;
    display: grid; grid-template-columns: 5rem minmax(0, 1fr);
    align-items: start; column-gap: 0.75rem;
  }
  // 5 x 7.5rem IS 2:3 — the same ratio the cover slot letterboxes into, so a
  // missing-cover placeholder occupies exactly the box a real cover would and
  // the row keeps one left edge.
  .school-books-tile__cover { width: 5rem; height: 7.5rem; align-self: start; }
  .school-books-tile__title { font-size: 1rem; }
  .school-books-tile__author { font-size: 0.8rem; -webkit-line-clamp: 1; }
  .school-books-tile--add { display: flex; min-height: 9.5rem; }
}
// The text column owns its own rhythm. The bar is present or it is not; there
// is no reserved slot for one, which is what used to push the caption into a
// 0.5rem-tall grid row on every finished book.
.school-books-tile__text {
  display: flex; flex-direction: column; gap: 0.3rem; min-width: 0;
}
```

Note what this deletes: the `grid-template-rows` track, the `grid-row`/`grid-column` placements, the `font-family: inherit` caption override (handled in Task 12), the `.school-books__empty` override (that element goes away in Task 9), and both `.school-books__recent` height overrides — the finished row and the reading row are now the same card.

**Step 6: Give the clamped title room to breathe**

In `School.scss:2052-2054`, change `line-height: 1.2` to `line-height: 1.35`:

```scss
.school-books-tile__title {
  font-weight: 600; line-height: 1.35;
  overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
```

(The weight drop from 700 to 600 is Task 13's concern but lands here to avoid touching the same three lines twice.)

**Step 7: Verify SCSS compiles and the module is green**

```bash
npm run check:scss
npx vitest run --config vitest.config.mjs frontend/src/modules/School/books/
```

Expected: SCSS build OK; all book specs PASS.

**Step 8: Commit**

```bash
git add frontend/src/modules/School/books/ShelfTile.jsx frontend/src/modules/School/books/ShelfTile.test.jsx frontend/src/modules/School/School.scss
git commit -m "fix(school): a book title is two lines, not two sliced lines"
```

---

## Task 2: The shelf row stops wearing two layout systems

**The defect:** `BookShelf.jsx:88` renders `className="school-books__grid school-books__row"`. `__grid` declares `display: grid; flex: 1 1 auto; overflow-y: auto`; `__row` declares `display: flex; flex: none; overflow-y: hidden`. Source order picks the winner and the losing half stays as dead declarations. The "Recently finished" row wears only `__row`, so the two shelves on one screen are laid out by different rule sets.

**Files:**
- Modify: `frontend/src/modules/School/books/BookShelf.jsx:88`
- Modify: `frontend/src/modules/School/books/BookShelf.test.jsx:206-210`

**Step 1: Rewrite the existing test that pins the defect**

`BookShelf.test.jsx:206-210` currently asserts the grid class is present. Replace that whole `it(...)` with:

```javascript
    it('the shelf row is a horizontal row and nothing else — one layout system per element', () => {
      arm();
      mount();
      const row = screen.getByTestId('book-shelf-grid');
      expect(row).toHaveClass('school-books__row');
      expect(row).not.toHaveClass('school-books__grid');
    });
```

**Step 2: Run it and watch it fail**

```bash
npx vitest run --config vitest.config.mjs frontend/src/modules/School/books/BookShelf.test.jsx
```

Expected: FAIL — `expect(element).not.toHaveClass("school-books__grid")`.

**Step 3: Drop the class**

`BookShelf.jsx:88`:

```jsx
        <div className="school-books__row" data-testid="book-shelf-grid">
```

**Step 4: Run it and watch it pass**

```bash
npx vitest run --config vitest.config.mjs frontend/src/modules/School/books/BookShelf.test.jsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/modules/School/books/BookShelf.jsx frontend/src/modules/School/books/BookShelf.test.jsx
git commit -m "fix(school): the shelf row is a row, not a row and a grid"
```

---

## Task 3: History scrolls vertically on its own terms

**The defect and the ask:** `History.jsx:50` renders `className="school-books__grid school-books-history__scroll"`. The only reason history scrolls today is that `__scroll` does not redeclare `flex`/`min-height`/`overflow-y`, so those three leak through from `__grid`. That is scrolling by accident: the moment `__grid` is cleaned up (Task 4) history stops scrolling. KC asked for history to be vertically scrollable — this makes it so, explicitly, and pins it.

**Files:**
- Modify: `frontend/src/modules/School/books/History.jsx:50`
- Modify: `frontend/src/modules/School/School.scss:2076`
- Test: `frontend/src/modules/School/books/BookShelf.test.jsx` (the `describe('History', ...)` block at line 350)

**Step 1: Write the failing test**

Add inside `describe('History', ...)` in `BookShelf.test.jsx`:

```javascript
    it('the month list is the scroll container, and it owns that outright', () => {
      arm({ items: [DONE_AUG, DONE_JULY, ASIDE_JULY] }, { view: 'history' });
      mount();
      const scroll = screen.getByTestId('book-history-scroll');
      expect(scroll).toHaveClass('school-books-history__scroll');
      expect(scroll).not.toHaveClass('school-books__grid');
    });
```

Check the surrounding `arm(...)` calls in that describe block and match their exact signature — the block at line 350 already arms a history view, so copy that call rather than inventing one.

**Step 2: Run it and watch it fail**

```bash
npx vitest run --config vitest.config.mjs frontend/src/modules/School/books/BookShelf.test.jsx
```

Expected: FAIL — `Unable to find an element by: [data-testid="book-history-scroll"]`.

**Step 3: Make history own its scroll**

`History.jsx:50`:

```jsx
        <div className="school-books-history__scroll" data-testid="book-history-scroll">
```

**Step 4: Give the class the rules it was borrowing**

`School.scss:2076`, replace the one-line `.school-books-history__scroll` rule with:

```scss
// THE vertical scroll container for a child's whole reading year. It used to
// scroll only because it also wore `.school-books__grid` and inherited that
// class's `flex`/`min-height`/`overflow-y` — scrolling by leak. It declares
// them itself now. `min-height: 0` is what lets a flex child shrink below its
// content and actually scroll; without it the list grows and the panel clips.
.school-books-history__scroll {
  flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain;
  display: flex; flex-direction: column; gap: clamp(0.6rem, 1.6vh, 1rem);
  padding-right: 0.35rem;
}
```

**Step 5: Run the test to verify it passes**

```bash
npx vitest run --config vitest.config.mjs frontend/src/modules/School/books/BookShelf.test.jsx
npm run check:scss
```

Expected: both PASS.

**Step 6: Commit**

```bash
git add frontend/src/modules/School/books/History.jsx frontend/src/modules/School/books/BookShelf.test.jsx frontend/src/modules/School/School.scss
git commit -m "feat(school): reading history scrolls because it says so, not because a class leaked"
```

---

## Task 4: Delete the dead grid class

**Files:**
- Modify: `frontend/src/modules/School/School.scss:2012-2017`

**Step 1: Prove it is dead**

```bash
grep -rn "school-books__grid" frontend/src
```

Expected: exactly one hit — the SCSS definition itself. If any `.jsx` still references it, stop and finish Task 2 or 3.

**Step 2: Delete the rule**

Remove the whole `.school-books__grid { ... }` block (School.scss:2012-2017). Also update the section comment at `School.scss:1977` — it says "the GRID is the scroll container", which is no longer true. Replace that sentence with:

```scss
// the SHELF ROW scrolls sideways and the HISTORY LIST scrolls down; the header
// and the footer stay put.
```

**Step 3: Verify**

```bash
npm run check:scss
npx vitest run --config vitest.config.mjs frontend/src/modules/School/books/
```

Expected: both PASS.

**Step 4: Commit**

```bash
git add frontend/src/modules/School/School.scss
git commit -m "refactor(school): drop the shelf grid class nothing renders any more"
```

---

## Task 5: Scrollbars stop out-shouting the books

**The defect:** the horizontal scrollbar under the shelf is a full-width light-grey bar on black — the highest-contrast object on a screen whose subject is book covers. `School.scss` has no scrollbar styling at all, while `frontend/src/modules/Admin/Admin.variables.scss:91` already defines a `ds-scrollbar` mixin the household uses elsewhere. We do not import that (School owns its own tokens, per the file header) — we mirror it locally.

**Files:**
- Modify: `frontend/src/modules/School/School.scss` (add mixin near the top, apply in two places)

**Step 1: Define the mixin**

Insert immediately after the closing `}` of the `.school-app { ... }` token block (find it: the block opening at `School.scss:17` — put the mixin *before* it, at file scope, so it is defined before use):

```scss
// A scroll affordance that does not outrank the content it scrolls. The shelf
// is book covers on a dark field; a default native scrollbar is a bright bar
// across the full width and wins that contrast fight outright.
@mixin school-scrollbar {
  scrollbar-width: thin;
  scrollbar-color: var(--school-border) transparent;
  &::-webkit-scrollbar { width: 8px; height: 8px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb {
    background: var(--school-border); border-radius: 999px;
    border: 2px solid transparent; background-clip: padding-box;
  }
}
```

**Step 2: Apply it**

Add `@include school-scrollbar;` as the first line inside `.school-books__row { ... }` (Task 1's block) and inside `.school-books-history__scroll { ... }` (Task 3's block).

**Step 3: Verify the sheet still compiles**

```bash
npm run check:scss
```

Expected: PASS. A failure here means the mixin was defined after its use — move it higher.

**Step 4: Commit**

```bash
git add frontend/src/modules/School/School.scss
git commit -m "style(school): the scrollbar stops being the loudest thing on the shelf"
```

---

## Task 6: The footer stops floating in 600px of nothing

**The defect:** `.school-books__collections` is `flex: 1 1 auto`, so it inflates to fill the panel whatever it holds, and pins "See all history" to the floor — in the screenshot roughly 600px below the last book, alone in a corner, styled transparent-on-transparent so it also reads as disabled.

**Files:**
- Modify: `frontend/src/modules/School/School.scss:2262` (`__collections`)
- Modify: `frontend/src/modules/School/School.scss:2019-2023` (`__history-link`)

**Step 1: Stop the collections growing**

Replace `School.scss:2262` with:

```scss
// `0 1 auto` deliberately: GROW OFF, SHRINK ON. With grow on, two short rows
// inflated to fill an 800px panel and exiled the history link to the floor.
// With shrink on, a tall shelf still gives way and scrolls instead of pushing
// the footer off the bottom.
.school-books__collections { flex: 0 1 auto; min-height: 0; overflow-y: auto; }
```

**Step 2: Make the history link look like a control**

Replace `School.scss:2019-2023` with:

```scss
.school-books__history-link, .school-books__back {
  @extend .school-selfservice__key;
  min-height: 52px; font-family: inherit; font-size: 1.05rem; font-weight: 600;
  color: var(--school-fg); background: transparent;
  border-color: var(--school-border); padding: 0 1.1rem;
}
```

**Step 3: Verify**

```bash
npm run check:scss
npx vitest run --config vitest.config.mjs frontend/src/modules/School/books/
```

Expected: both PASS.

**Step 4: Commit**

```bash
git add frontend/src/modules/School/School.scss
git commit -m "style(school): the shelf ends where the books end"
```

---

## Task 7: The add button stops being the error-retry button

**The defect:** `BookShelf.jsx:86` gives "+ Add a book" `className="school-books__retry"` — literally the class on "Try again" at `BookShelf.jsx:66`. The primary create action wears the error-recovery costume, which is why it has the same weight as "Done" and less presence than either.

**Files:**
- Modify: `frontend/src/modules/School/books/BookShelf.jsx:86`
- Modify: `frontend/src/modules/School/School.scss` (add `__add-action`, restyle `__done`, restyle `__row-heading`)
- Test: `frontend/src/modules/School/books/BookShelf.test.jsx`

**Step 1: Write the failing test**

Add inside `describe('the shelf', ...)` in `BookShelf.test.jsx`:

```javascript
    it('+ Add a book is a primary action, not the retry button wearing a new label', () => {
      arm();
      mount();
      const add = screen.getByRole('button', { name: '+ Add a book' });
      expect(add).toHaveClass('school-books__add-action');
      expect(add).not.toHaveClass('school-books__retry');
    });
```

**Step 2: Run it and watch it fail**

```bash
npx vitest run --config vitest.config.mjs frontend/src/modules/School/books/BookShelf.test.jsx
```

Expected: FAIL — `expect(element).toHaveClass("school-books__add-action")`.

**Step 3: Give it its own class**

`BookShelf.jsx:86`:

```jsx
          <button type="button" className="school-books__add-action" disabled={awaitingShelf} onClick={actions.startAdd}>+ Add a book</button>
```

**Step 4: Style it, and demote Done**

In `School.scss`, add after the `.school-books__retry` block (~line 2011):

```scss
// The one loud thing on this screen. Everything else here — Done, See all
// history, Try again — is quiet chrome; a child came to add or open a book.
.school-books__add-action {
  @extend .school-selfservice__key;
  min-height: 52px; font-family: inherit; font-size: 1.1rem; font-weight: 700;
  padding: 0 1.3rem;
  background: var(--school-accent); color: var(--school-accent-ink);
  border-color: var(--school-accent);
}
.school-books__add-action:disabled { opacity: 0.5; cursor: default; }
```

Replace `.school-books__done` (School.scss:1995-1998) with:

```scss
// An exit, not an action. It used to be the highest-contrast object on the
// screen, outranking the books and the add.
.school-books__done {
  @extend .school-selfservice__key;
  min-height: 64px; font-family: inherit; font-size: 1.1rem; font-weight: 600;
  padding: 0 1.5rem; background: transparent; color: var(--school-fg);
}
```

Replace `.school-books__row-heading` (School.scss:2263) with:

```scss
// The heading and its action are ONE unit. `space-between` on a 64rem panel
// put roughly 900px between "Reading now" and the button that acts on it.
.school-books__row-heading { display: flex; align-items: center; justify-content: flex-start; gap: 1rem; }
```

**Step 5: Run the test to verify it passes**

```bash
npx vitest run --config vitest.config.mjs frontend/src/modules/School/books/BookShelf.test.jsx
npm run check:scss
```

Expected: both PASS.

**Step 6: Commit**

```bash
git add frontend/src/modules/School/books/BookShelf.jsx frontend/src/modules/School/books/BookShelf.test.jsx frontend/src/modules/School/School.scss
git commit -m "fix(school): adding a book is the loud action, leaving is not"
```

---

## Task 8: An empty shelf offers a card, not a sentence

**The defect:** `BookShelf.jsx:91-92` has two mutually exclusive branches. A learner with no books ever gets the dashed `AddTile` card. A learner who has *finished* books but nothing in progress — the exact state in the screenshot — gets a bare `<p>Ready for your next book</p>` sitting in a row of cards, with no way forward inside the row. The two branches also make the row change shape between states.

**The fix:** one branch. The row always offers the add card when it is empty; only the label changes.

**Files:**
- Modify: `frontend/src/modules/School/books/BookShelf.jsx:89-93`
- Test: `frontend/src/modules/School/books/BookShelf.test.jsx`

**Step 1: Write the failing test**

Add inside `describe('the shelf', ...)`:

```javascript
    it('nothing in progress but books finished: the row still offers a card, not a sentence', () => {
      arm({ items: [DONE_AUG] });
      mount();
      const row = screen.getByTestId('book-shelf-grid');
      expect(within(row).getByRole('button', { name: 'Add a book' })).toBeInTheDocument();
      expect(within(row).queryByText('Ready for your next book')).toBeNull();
    });
```

Confirm `within` is already imported in this file (it is used at line 128); if not, add it to the `@testing-library/react` import.

**Step 2: Run it and watch it fail**

```bash
npx vitest run --config vitest.config.mjs frontend/src/modules/School/books/BookShelf.test.jsx
```

Expected: FAIL — the row renders the `Ready for your next book` paragraph and no button.

**Step 3: Collapse the two branches into one**

In `BookShelf.jsx`, replace lines 89-93 (the two `items.length === 0 && ...` lines) with:

```jsx
          {items.length === 0 && (
            <AddTile first={(shelf?.items ?? []).length === 0} disabled={awaitingShelf} onSelect={actions.startAdd} />
          )}
```

**Step 4: Run the test to verify it passes**

```bash
npx vitest run --config vitest.config.mjs frontend/src/modules/School/books/BookShelf.test.jsx
```

Expected: PASS. If the pre-existing test at line 139 (`empty: the + tile alone, captioned for the first book`) fails, read it — it should still pass, because `first` is still `true` when the learner has no items at all.

**Step 5: Remove the now-unused style**

`.school-books__empty` (School.scss:2000-2002) is still used by `History.jsx` for "Nothing finished yet", so **leave it**. Confirm:

```bash
grep -rn "school-books__empty" frontend/src
```

Expected: the SCSS definition plus `History.jsx`. If `BookShelf.jsx` still appears, Step 3 was not applied.

**Step 6: Commit**

```bash
git add frontend/src/modules/School/books/BookShelf.jsx frontend/src/modules/School/books/BookShelf.test.jsx
git commit -m "fix(school): an empty shelf hands a child a card, not a sentence"
```

---

## Task 9: The day's goal stops being a footnote

**The defect:** "0 of 1 check-in today" is the single number that says whether the child is done, and it renders in `--school-muted` at 1.15rem, floating unanchored under the header with no container.

**Files:**
- Modify: `frontend/src/modules/School/School.scss:1999`

**Step 1: Make it a chip in the foreground colour**

Replace `School.scss:1999`:

```scss
// The day's whole question, in one line. It read as a footnote in muted grey
// while being the only thing on this screen that says whether the child is done.
.school-books__obligation {
  flex: 0 0 auto; align-self: flex-start; margin: 0;
  padding: 0.35rem 0.9rem; border: 1px solid var(--school-border); border-radius: 999px;
  background: var(--school-surface-2); color: var(--school-fg);
  font-size: 1.15rem; font-weight: 700;
}
```

**Step 2: Verify**

```bash
npm run check:scss
npx vitest run --config vitest.config.mjs frontend/src/modules/School/books/BookShelf.test.jsx
```

Expected: both PASS — the obligation tests assert text, not styling.

**Step 3: Commit**

```bash
git add frontend/src/modules/School/School.scss
git commit -m "style(school): the day's reading goal reads like the goal"
```

---

## Task 10: Cards separate from the background, and the cover placeholder stops looking like an error

**Two defects.** (a) `--school-surface: #1f1f26` on `--school-bg: #16161b` is about a 1.05:1 luminance step, so a card's identity rests entirely on a 1px `#34343f` border that vanishes at kiosk distance — four cards read as one smear with hairlines. (b) The missing-cover placeholder is `.school-selfservice-card__poster-placeholder` (School.scss:2486-2498), a *launch card's* poster: a green radial accent gradient in Georgia serif with `1rem` padding and a 16px radius, sized for a large tile. At `5rem` wide the gradient hotspot is nonsense and the green tint reads as a warning — so the failure state is the most colourful thing on the shelf.

We do **not** change the `--school-*` tokens: they are used across the whole School app and this is a shelf problem. We lift the card onto `--school-surface-2`, which already has a real step from the background.

**Files:**
- Modify: `frontend/src/modules/School/School.scss:2037-2045` (`.school-books-tile`)
- Modify: `frontend/src/modules/School/School.scss:2051` (the placeholder override)

**Step 1: Lift the card off the background**

In `.school-books-tile` (School.scss:2037-2045), change `background: var(--school-surface);` to `background: var(--school-surface-2);` and `&:active { background: var(--school-surface-2); ... }` to `&:active { background: var(--school-surface); ... }` (the press state inverts, so a tap still reads).

Also update `&--still`'s active override in the same block from `background: var(--school-surface)` to `background: var(--school-surface-2)`, so a non-interactive tile does not flash.

**Step 2: Neutralise the borrowed placeholder**

Replace `School.scss:2051` with:

```scss
// The launch card's poster placeholder, stripped of the launch card. Its
// accent radial and Georgia serif were built for a large tile; at 5rem they
// read as a warning state on the two books whose covers failed to load.
.school-books-tile .school-selfservice-card__poster-placeholder {
  border-radius: 8px; padding: 0.35rem;
  background: var(--school-surface); font: 700 1.4rem/1 inherit;
  color: var(--school-border);
}
```

**Step 3: Verify**

```bash
npm run check:scss
npx vitest run --config vitest.config.mjs frontend/src/modules/School/books/
```

Expected: both PASS. `ShelfTile.test.jsx` asserts the placeholder *class* is present, which is unchanged.

**Step 4: Commit**

```bash
git add frontend/src/modules/School/School.scss
git commit -m "style(school): a book card is visibly a card, and a missing cover is not a warning"
```

---

## Task 11: One caption font

**The defect:** `.school-books-tile__caption` is set in the Kongtext pixel face (School.scss:2067) with the comment "the number a child reads is a code" — but the caption is words: "Just started", "read on 2 days", "Finished Sep 6". The row then overrode it back to `inherit`, so the same caption rendered in two different typefaces depending on whether you were looking at the shelf or at history. Task 1 deleted the override; this deletes the cause.

**Files:**
- Modify: `frontend/src/modules/School/School.scss:2067`

**Step 1: Drop the pixel font from the caption**

Replace `School.scss:2067`:

```scss
// Words, not a code. The Kongtext face here belonged to the ISBN pad, where a
// child copies digits; a caption reading "Finished Sep 6" is prose.
.school-books-tile__caption { font-size: 0.85rem; color: var(--school-muted); }
```

**Step 2: Confirm the row override is gone**

```bash
grep -n "school-books-tile__caption" frontend/src/modules/School/School.scss
```

Expected: exactly one hit (the definition above). A second hit inside `.school-books__row` means Task 1 Step 5 was applied incompletely.

**Step 3: Verify**

```bash
npm run check:scss
```

**Step 4: Commit**

```bash
git add frontend/src/modules/School/School.scss
git commit -m "style(school): one typeface for one caption"
```

---

## Task 12: Stop saying "Finished" five times

**The defect:** the section heading says "Recently finished" and then every card underneath says "Finished Sep 6". Four repetitions of a word the heading already established. In History the month heading does the same job. Set-aside items still need their word, because they sit mixed in with finished ones under a shared month heading.

**Files:**
- Modify: `frontend/src/modules/School/books/ShelfTile.jsx:56-60` (`outcomeFor`)
- Modify: `frontend/src/modules/School/books/ShelfTile.test.jsx:154, 165`
- Modify: `frontend/src/modules/School/books/BookShelf.test.jsx:369`
- Modify: `frontend/src/modules/School/books/shelfExperience.test.jsx:159`

**Step 1: Update the tests first**

In `ShelfTile.test.jsx`, change the two assertions that expect `'Finished Jul 14'` (lines 154 and 165) to expect `'Jul 14'`. **Leave line 159's `'Set aside Jun 2'` alone.**

In `BookShelf.test.jsx:369`, change `'Finished Jul 14'` to `'Jul 14'`.

In `shelfExperience.test.jsx:159`, change `'Finished Sep 2'` to `'Sep 2'`.

**Step 2: Run them and watch them fail**

```bash
npx vitest run --config vitest.config.mjs frontend/src/modules/School/books/
```

Expected: FAIL — four assertions, each `Unable to find an element with the text: Jul 14` (the DOM still says "Finished Jul 14").

**Step 3: Drop the word from the finished case only**

`ShelfTile.jsx`, replace `outcomeFor`:

```javascript
/**
 * A finished book's caption is its day alone: every place this renders — the
 * Recently finished row, a History month group — is already headed by the fact
 * that these are finished. A SET-ASIDE book keeps its word, because it sits
 * mixed in with finished ones under the same month heading and the day alone
 * would not distinguish the two.
 */
function outcomeFor(item) {
  const setAside = item.projection?.status === 'set-aside';
  const day = shortDay(setAside ? item.projection?.lastAt : lastFinish(item).day);
  if (setAside) return day ? `Set aside ${day}` : 'Set aside';
  return day ?? 'Finished';
}
```

Note this also fixes a latent bug in the original: it read `lastFinish(item).day` only when `projection.status === 'finished'`, but `ShelfTile` is also called with `finished={true}` from History for set-aside items, where the old ternary fell through to `projection.lastAt` correctly — the rewrite makes the two cases explicit instead of leaning on operator precedence.

**Step 4: Run the tests to verify they pass**

```bash
npx vitest run --config vitest.config.mjs frontend/src/modules/School/books/
```

Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/modules/School/books/ShelfTile.jsx frontend/src/modules/School/books/ShelfTile.test.jsx frontend/src/modules/School/books/BookShelf.test.jsx frontend/src/modules/School/books/shelfExperience.test.jsx
git commit -m "fix(school): a finished book's caption is its day, not the word above it repeated"
```

---

## Task 13: Ask for the avatar at the size it renders

**The defect:** `BookShelf.jsx:44` passes `size={96}`; `School.scss:2521` clamps `.piano-avatar` inside the chip to `3rem` (48px). The portrait is fetched and downscaled for nothing.

**Files:**
- Modify: `frontend/src/modules/School/books/BookShelf.jsx:44`
- Test: `frontend/src/modules/School/books/BookShelf.test.jsx`

**Step 1: Find how the existing avatar test inspects the prop**

```bash
grep -n "ProfileAvatar\|size" frontend/src/modules/School/books/BookShelf.test.jsx | head -20
```

The file already has `it('shows the learner portrait by the learner id ...')` at line 162. Read it and match how it reaches the avatar — if `ProfileAvatar` is mocked, assert on the mock's props; if it renders for real, assert on the rendered element's dimensions attribute.

**Step 2: Write the failing test**

Add inside `describe('the learner chip', ...)`, adapting the accessor you found in Step 1:

```javascript
    it('asks for the portrait at the size the chip actually draws it (3rem)', () => {
      // ...arm + mount as the sibling tests do...
      // assert the ProfileAvatar received size 48, not 96
    });
```

**Step 3: Run it and watch it fail**

```bash
npx vitest run --config vitest.config.mjs frontend/src/modules/School/books/BookShelf.test.jsx
```

Expected: FAIL — received 96.

**Step 4: Fix the call**

`BookShelf.jsx:44`:

```jsx
      <ProfileAvatar id={avatarId} name={name} size={48} />
```

**Step 5: Run it and watch it pass**

```bash
npx vitest run --config vitest.config.mjs frontend/src/modules/School/books/BookShelf.test.jsx
```

**Step 6: Commit**

```bash
git add frontend/src/modules/School/books/BookShelf.jsx frontend/src/modules/School/books/BookShelf.test.jsx
git commit -m "fix(school): fetch the shelf portrait at the size the chip draws"
```

---

## Task 14: A cover stops being announced twice

**The defect:** `BookCover.jsx:31` sets `alt={`Cover of ${title}`}` and `ShelfTile` renders the title as text immediately beside it, so a screen reader says every title twice. The sibling module `School/reading/ReadingSessionScreen.jsx` uses `alt=""` and carries an explicit comment about avoiding exactly this — two components in one feature disagreeing about the same decision.

`BookCover` is shared by `AddBook`, `UpdateBook`, `CompletedBook`, `ShelfTile` and `ReadingShelfPanel`. In the *confirmation* views the cover is the subject and its alt earns its place. Only the tile has the title adjacent. So this is a per-caller decision, not a global one.

**Files:**
- Modify: `frontend/src/modules/School/books/BookCover.jsx:9, 31, 42`
- Modify: `frontend/src/modules/School/books/ShelfTile.jsx:72`
- Test: `frontend/src/modules/School/books/ShelfTile.test.jsx`, `frontend/src/modules/School/books/BookShelf.test.jsx`

**Step 1: Write the failing test**

In `ShelfTile.test.jsx`, add inside `describe('the cover', ...)`:

```javascript
    it('the cover is decorative on a tile — the title beside it already names the book', () => {
      const { container } = render(<ShelfTile item={item()} onSelect={() => {}} />);
      const img = container.querySelector('img.school-books-tile__cover');
      expect(img).toHaveAttribute('alt', '');
      expect(img).toHaveAttribute('aria-hidden', 'true');
      expect(screen.getByText('Hatchet')).toBeInTheDocument();
    });
```

**Step 2: Run it and watch it fail**

```bash
npx vitest run --config vitest.config.mjs frontend/src/modules/School/books/ShelfTile.test.jsx
```

Expected: FAIL — alt is `"Cover of Hatchet"`.

**Step 3: Give BookCover a decorative mode**

`BookCover.jsx`, change the signature and the two render branches:

```jsx
/**
 * @param {boolean} [decorative] - the caller already names this book in text
 *   beside the cover (a shelf tile does). Announcing it here too makes a
 *   screen reader say every title twice. In the confirmation views the cover
 *   IS the subject and keeps its name.
 */
export default function BookCover({ book, className = '', loading = 'eager', decorative = false }) {
```

In the `<img>` branch:

```jsx
        alt={decorative ? '' : `Cover of ${title}`}
        aria-hidden={decorative ? 'true' : undefined}
```

In the placeholder branch:

```jsx
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative ? 'true' : undefined}
      aria-label={decorative ? undefined : `No cover available for ${title}`}
```

**Step 4: Pass it from the tile**

`ShelfTile.jsx`, in the `body` you wrote in Task 1:

```jsx
      <BookCover book={item} className="school-books-tile__cover" loading="lazy" decorative />
```

**Step 5: Run and fix the fallout**

```bash
npx vitest run --config vitest.config.mjs frontend/src/modules/School/books/
```

Expected: your new test PASSES, and the pre-existing tests at `ShelfTile.test.jsx:36` (`getByRole('img', { name: 'Cover of Hatchet' })`) and `:44` (`'No cover available for Hatchet'`) now FAIL. Those tests were pinning the defect. Rewrite them:

```javascript
    it('renders the cover image at the url the shelf gave', () => {
      const { container } = render(<ShelfTile item={item()} onSelect={() => {}} />);
      expect(container.querySelector('img.school-books-tile__cover')).toHaveAttribute('src', '/covers/hatchet.jpg');
    });

    it('uses the launch card placeholder when there is no cover, silently', () => {
      const { container } = render(<ShelfTile item={item({ coverUrl: null })} onSelect={() => {}} />);
      expect(container.querySelector(`.${PLACEHOLDER}`)).not.toBeNull();
      expect(container.querySelector('img')).toBeNull();
      expect(screen.queryByRole('img', { name: /Hatchet/ })).toBeNull();
    });
```

Also grep for other assertions that relied on the tile's cover having an accessible name:

```bash
grep -rn "Cover of\|No cover available" frontend/src/modules/School
```

Fix any in `BookShelf.test.jsx` / `shelfExperience.test.jsx` that reach a *tile* cover. **Do not** change assertions that reach `AddBook`, `UpdateBook`, `CompletedBook` or `ReadingShelfPanel` covers — those keep their names.

**Step 6: Verify the whole module**

```bash
npx vitest run --config vitest.config.mjs frontend/src/modules/School/
```

Expected: PASS.

**Step 7: Commit**

```bash
git add frontend/src/modules/School/books/BookCover.jsx frontend/src/modules/School/books/ShelfTile.jsx frontend/src/modules/School/books/ShelfTile.test.jsx frontend/src/modules/School/books/BookShelf.test.jsx
git commit -m "fix(school): a shelf cover is decorative — the title beside it already names the book"
```

---

## Task 15: One weight scale

**The defect:** every string on the screen is bold — title 800, section headings bold by default, tile titles 700, obligation 700, Done 700, add 700. Weight is unavailable as a hierarchy signal because it is spent everywhere, leaving size to do all the work alone.

Tasks 1, 6, 7 already dropped tile titles to 600, the history link to 600 and Done to 600. This finishes the scale: **800 = the screen's name; 700 = the primary action and the day's goal; 600 = everything else.**

**Files:**
- Modify: `frontend/src/modules/School/School.scss:2264` (row headings)

**Step 1: Set the section headings**

Replace `School.scss:2264`:

```scss
// Section labels, not headlines. They name a shelf; the books are the content.
.school-books__row-heading h3, .school-books__recent h3 {
  margin: 0.4rem 0; font-size: 0.95rem; font-weight: 600;
  letter-spacing: 0.04em; text-transform: uppercase; color: var(--school-muted);
}
```

**Step 2: Verify nothing pinned the heading text case**

```bash
grep -rn "Reading now\|Recently finished" frontend/src/modules/School
```

`text-transform` does not change the DOM text, so `getByText('Reading now')` still matches. Confirm no test asserts on computed style.

**Step 3: Verify**

```bash
npm run check:scss
npx vitest run --config vitest.config.mjs frontend/src/modules/School/books/
```

Expected: both PASS.

**Step 4: Commit**

```bash
git add frontend/src/modules/School/School.scss
git commit -m "style(school): weight means something again on the reading shelf"
```

---

## Task 16: Update the docs

**Files:**
- Modify: `docs/reference/school/reading-shelf.md` (the "Entering and browsing" section, ~line 38-44)

**Step 1: Correct the sentences this plan made false**

The doc currently says both collections "use compact horizontal rows, with Add a book above the active row" and does not mention history's scroll. Replace that paragraph with:

```markdown
Reading now contains reading/unread items; Recently finished contains up to
12 finished items ordered by effective finish date, then recording time when
available. Both collections are compact horizontal rows of the same card, and
Add a book sits beside the Reading now heading. A card sizes to its own text:
nothing fixes its height, so a two-line title is never cut. A finished card's
caption is its day alone; a set-aside card keeps the words. When Reading now
is empty the row offers the add card itself, whether or not the learner has
finished anything before.

See all history opens finished and set-aside books grouped by month in a
VERTICALLY SCROLLING list — the month list is the scroll container, the back
button and the shelf header stay put. Finished tiles in either place open
completed details.
```

**Step 2: Verify the file still reads cleanly**

```bash
sed -n '30,60p' docs/reference/school/reading-shelf.md
```

**Step 3: Commit**

```bash
git add docs/reference/school/reading-shelf.md
git commit -m "docs(school): record the reading shelf as rebuilt"
```

---

## Task 17: The gate, and eyes on it

**Step 1: Run the full colocated frontend sweep**

```bash
npm run test:isolated -- --only=frontend
```

Expected: PASS, with a test count at or above the number you recorded in Task 0 Step 3. A *lower* count means a file stopped being collected — investigate before continuing.

**Step 2: Run the SCSS build and the parse check**

```bash
npm run check:scss
npm run check:parse
```

Expected: both PASS.

**Step 3: Get a real screenshot**

jsdom has no layout engine, so **nothing above proves the pixels**. Per `feedback_screenshots_over_code_agents_for_ui_triage`, ask KC for a screenshot of the shelf in the same state as the original report — one learner, one check-in obligation, nothing in Reading now, four books in Recently finished (two of them without covers).

Check against the original defect list:

| # | Was | Should now be |
|---|-----|---------------|
| 1 | Titles sliced mid-glyph | Two clean clamped lines with an ellipsis, no cut |
| 2 | Two layout systems per element | — (structural) |
| 3 | Bright full-width scrollbar | A thin muted thumb |
| 4 | ~600px void, footer on the floor | Footer sits under the last row |
| 5 | Done outranks everything | Add is the accent; Done is quiet |
| 6 | Goal in muted grey | Goal in a foreground chip |
| 7 | Empty row shows a sentence | Empty row shows an add card |
| 10 | Green blob placeholder | Neutral placeholder, same box as a real cover |
| 12 | Ragged left edge | One left edge — covers and placeholders share a 2:3 box |
| 15 | Cards invisible against the ground | Cards visibly lift off the background |
| 16 | "Finished" four times | Dates alone |

**Step 4: Fix what the screenshot shows, then re-verify**

Any pixel defect the screenshot reveals gets its own commit. Do not close this plan on a green test run alone.

**Step 5: Push**

Only when KC has seen the screenshot and agreed.

```bash
git log --oneline origin/main..HEAD
git push origin HEAD
```

---

## Out of scope, deliberately

- **The right-edge peek fade** (defect 18). A CSS mask on a scroll container clips permanently even when there is nothing to scroll, and there is no clean CSS-only "only when scrollable" condition. The styled scrollbar from Task 5 is the affordance instead. Revisit only if the screenshot says the cut card still reads as a rendering fault.
- **Changing `--school-surface` / `--school-bg` themselves.** The contrast step between them is genuinely too small, but those tokens are used across the whole School app; Task 10 fixes the shelf by moving the card up one step rather than re-theming eleven other surfaces from inside a shelf remediation.
- **`frontend/src/modules/School/reading/`.** That directory is the living-room TV widget, which shares no markup with this screen. It came up only because its `RecentBook` already solved defect 19 the right way.
