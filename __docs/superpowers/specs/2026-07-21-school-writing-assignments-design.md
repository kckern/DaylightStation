# School Portal — Writing Assignments

**Status:** Design spec, 2026-07-21.
**Parent requirements:** `2026-07-21-portal-homeschool-requirements.md`
**Depends on:** slice 1 (identity + quiz engine), shipped.
**Related:** `2026-07-21-school-courses-design.md` (the learning log, §9, shares the submission-record pattern)

---

## 1. Goal

A child writes an assignment on the Portal with a Bluetooth keyboard, in a
comfortable distraction-free editor, and submits it against their record.

Explicit non-goals, from the request: no typesetting, no page layout, and **no
spell check** — the text is post-processed later (LLM or spell checker), so the
writing surface stays out of the child's way. "Open and free for the user."

---

## 2. Editor choice

**TipTap** (headless, ProseMirror-based, MIT core). Chosen for light rich text:
bold, italic, headings, lists. Headless means we build a minimal toolbar rather
than inheriting a vendor's.

Rejected: **TinyMCE** — bundles its own UI, skins and plugin system, licensing
tightened toward commercial/GPL, and is vast overkill without typesetting.
**Lexical** — equivalent capability, less mature ecosystem. **Plain textarea** —
would have avoided the risk below, but cannot do formatting.

Only free/MIT TipTap extensions. Several official extensions (collaboration and
some "Pro" ones) are paid; none are needed here and none may be introduced
without raising it.

`spellcheck="false"` on the editable element. No spelling or grammar extension.

---

## 3. THE RISK, AND THE SPIKE THAT MUST COME FIRST

TipTap is `contenteditable`-based. This runs on a **Facebook Portal, Android 9
(API 28), Chrome 131 WebView** — a platform with a long history of
`contenteditable` IME and caret defects: the caret jumping to position zero
mid-word, composition events misfiring, backspace deleting the wrong character.
A plain `<textarea>` avoids this entirely by using the native text-input path;
TipTap does not.

**Task 1 of implementation is a throwaway spike on the real panel.** Not a
local browser, not a headless Chromium — the Portal itself, with the Bluetooth
keyboard actually paired. It must confirm, in a bare TipTap instance:

1. Sustained typing of several paragraphs with no caret jumps.
2. Backspace and mid-document editing land where expected.
3. Enter creates paragraphs cleanly; no runaway nesting.
4. Bold/italic via keyboard shortcut and via toolbar both work.
5. Selection by keyboard (shift+arrows) and by touch both behave.
6. No input lag that a child would notice while typing at speed.
7. Bundle/runtime cost is acceptable — the build already warns on chunk size.

**If the spike fails, we fall back to a styled textarea and drop rich
formatting**, rather than shipping an editor that eats a child's essay. That is
a real, acceptable outcome, and discovering it in Task 1 costs a day rather
than a rebuild. Do not begin §5 or §6 until the spike passes.

---

## 4. Assignments as content

An assignment is a data file, hand-authorable like a question bank:

`data/content/assignments/{assignmentId}.yml`

```yaml
id: watercolour-reflection
title: What makes a good landscape?
audience: assigned            # generic | assigned, same fail-closed rule as banks
prompt: |
  Look at the three paintings from the lesson. Write a paragraph about which
  one you would want on your wall, and why.
lecture: plex:685101          # optional — the lecture this belongs to
min_words: 60                 # optional, advisory only (see §6)
```

Validation mirrors `questionBankValidation.mjs`: `id`/`title`/`prompt`
required; `audience` defaults to `assigned` (fail closed); `min_words`, if
present, a positive integer.

---

## 5. Storage — drafts are mutable, submissions are not

This is the one place writing genuinely differs from quizzes and the learning
log, and it must not be forced into the same shape.

Quiz attempts and log entries are **events**: they happen once and are
append-only. A draft is **mutable by nature** — the child returns to it and
keeps editing. So:

**Draft** — one mutable file per child per assignment, overwritten on autosave:

`data/users/{userId}/apps/school/writing/{assignmentId}.draft.yml`

```yaml
assignmentId: watercolour-reflection
updatedAt: '2026-07-21T16:22:04.881Z'
wordCount: 74
html: '<p>I would want the second one…</p>'
```

**Submission** — append-only, joining the same attributable record as quiz
attempts and log entries, so R6.5 reassignment moves a whole sitting together:

`data/users/{userId}/apps/school/writing/submissions/{YYYY-MM-DD}.yml`

```yaml
- id: sub_a91f3c
  at: '2026-07-21T16:40:12.002Z'
  assignmentId: watercolour-reflection
  lecture: plex:685101
  wordCount: 74
  html: '<p>I would want the second one…</p>'
  attributedTo: kckern
```

Submitting **snapshots** the draft; it does not delete it. A child may revise
and submit again, producing a second submission. Nothing is ever destroyed by
resubmitting — the history is the record.

Guests do not write. Same rule as attempts and log entries: no identity, no
attribution, so the surface is absent rather than failing on submit.

---

## 6. Losing work is the failure that matters

Everything below exists because a child losing an essay is the worst outcome
this feature can produce, and far more likely than any grading subtlety.

- **Autosave on a debounce (~2s idle) and on blur.** Never only on submit.
- **Draft saved locally first**, then to the server. A backend hiccup — this
  host redeploys routinely — must not lose keystrokes. On failure the editor
  keeps the local copy and shows an unsaved indicator, exactly as the quiz
  runner surfaces an unrecorded answer rather than failing silently.
- **The 10-minute identity lapse must not discard a draft.** Slice 1 lapses
  identity on idle; a child staring at a prompt, thinking, is idle. Typing
  counts as interaction and resets the timer (`useIdleGap` already treats
  keydown as activity), but if a lapse does occur mid-assignment the draft is
  flushed to storage before identity clears, and restored when they re-claim.
  Losing an essay to an idle timer would be indefensible.
- **`min_words` is advisory only.** It shows progress; it never blocks submit.
  A hard minimum on a kiosk with no adult nearby is a trap of the same family
  as the sequential dead-end, and this feature does not need one.

---

## 7. Keyboard

A Bluetooth keyboard is the intended input. Two practical consequences:

- **The on-screen keyboard would eat half an 800px-tall panel.** With a
  hardware keyboard paired, Android suppresses it. The layout must still be
  usable if it appears (soft-keyboard visible), rather than assuming it never
  will.
- Standard shortcuts work through TipTap: ⌘/Ctrl+B, +I, +Z. No custom
  chord bindings — nothing to learn.
- The Portal's physical volume keys are already claimed by `portalKeys`
  (`portal.yml`); they are not text input and are unaffected.

---

## 8. File structure

### Backend

| Path | Layer | Responsibility |
|---|---|---|
| `2_domains/school/assignmentValidation.mjs` | domain | Pure validation, mirroring `questionBankValidation.mjs` |
| `3_applications/school/WritingService.mjs` | application | List/get assignments, load+save draft, submit |
| `1_adapters/persistence/yaml/YamlSchoolDatastore.mjs` | adapter | **Modified**: draft read/write, submission append |
| `4_api/v1/routers/school.mjs` | api | **Modified**: routes below |

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/assignments?audience=` | List |
| `GET` | `/assignments/:id` | One |
| `GET` | `/users/:userId/writing/:assignmentId` | Load draft |
| `PUT` | `/users/:userId/writing/:assignmentId` | Save draft (autosave) |
| `POST` | `/users/:userId/writing/:assignmentId/submit` | Snapshot to submissions |

### Frontend — `frontend/src/modules/School/writing/`

| Path | Responsibility |
|---|---|
| `AssignmentBrowser.jsx` | List assignments, filtered by audience |
| `WritingEditor.jsx` | TipTap instance, minimal toolbar, word count, save state |
| `useWritingDraft.js` | Debounced autosave, local-first persistence, restore |

`SchoolApp.jsx` gains Writing alongside Courses and Banks.

---

## 9. Out of scope

- Grading, scoring, or rubric evaluation of submitted writing.
- The LLM/spell-check post-processing pass — this spec only guarantees clean
  stored text for it to consume later.
- Parent review and sign-off of submissions (sub-project 5).
- Collaboration, comments, revision diffing, or version history beyond the
  submission list.
- Any paid TipTap extension.
