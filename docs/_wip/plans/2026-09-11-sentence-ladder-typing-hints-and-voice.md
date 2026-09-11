# Sentence Ladder — typing, hints, and voice answers

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the Sentence Ladder's two typing rungs usable for a real learner on the
Portal panel: fix the Hangul composer, rebuild the drill surface as an aligned
model-over-answer pair, scale help from beginner to advanced without a new mode per
tier, and let a learner answer interpretation by speaking instead of typing.

**Architecture:** Everything hinges on one seam that does not exist yet. `TypedRung`
sees only the input's merged `value`, so it cannot tell settled text from the syllable
still being composed — which is the cause of the reveal bug, and the thing that makes a
per-glyph gate, per-glyph colouring and glyph-paced audio all impossible. Task 2 opens
that seam; everything after it is ordinary UI work on top. The backend changes are
small: one new gloss sidecar, and lifting a transcription service out of `fitness/`.

**Tech Stack:** React 18 + vitest/@testing-library (frontend), Express + vitest +
supertest (backend), SCSS, the in-page Hangul IME at `frontend/src/modules/School/ime/`.

---

## Before you start

**Read these first.** They are short and this plan assumes them:

- `frontend/src/modules/School/ime/hangul.js` — the 두벌식 automaton. The whole plan
  rests on its `committed` / `pending` split.
- `docs/reference/school/sentence-ladder.md` §2–3 — rungs, the two chains, and the
  **no-grading rule**: *"accuracy is recorded, never gating"*. Several tasks here add
  gates and hints; none of them may change what earns credit.
- `frontend/src/modules/School/Programs/SentenceLadder/SentenceLadderProgram.jsx` — the
  shell that owns the day and re-fetches after every save.

**Two house rules that will bite you:**

1. **NEVER start a second backend.** `node backend/index.js` is a live household
   controller — a second instance makes real Home Assistant calls and fights the running
   one for device authority, on any port. See `CLAUDE.local.md`. Run vitest, not a server.
2. **Do not use raw `console.*`.** Frontend logging goes through
   `frontend/src/lib/logging/Logger.js`; this program has its own facade at
   `Programs/SentenceLadder/languageLog.js`. Use it.

**Test command used throughout:**

```bash
npx vitest run <path> --reporter=dot
```

**Commit trailer** on every commit in this plan:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U3nFY9r2G6bGeiJ4iyV7AJ
```

---

## Phase 0 — the live bug

### Task 1: Shift must not destroy the syllable in flight

**Why:** Typing 예 on the Portal produces ㅇㅖ. Verified from the device's own keystroke
log: `D, SHIFT_LEFT, P` failed twice, `SHIFT_LEFT, D, P` (shift held from before the
first jamo) worked. `LAYOUT` has no `ShiftLeft` entry, so `jamoFor` returns null and
`handleKey` calls `this.end()` — the standalone Shift **keydown** ends the composition
session mid-syllable. Affects every syllable needing Shift after an initial: ㅖ (예, 계),
ㅒ (얘), and ㄲ/ㅆ as batchim (있, 갔, 났).

**Files:**
- Modify: `frontend/src/modules/School/ime/fieldComposer.js` (`handleKey`, ~line 94)
- Test: `frontend/src/modules/School/ime/fieldComposer.test.js`

**Step 1: Write the failing test**

Add to `fieldComposer.test.js`. Follow the existing file's helper for making a field and
feeding keys; if it drives `Hangul` directly, drive `FieldComposer.handleKey` here
instead — the bug is in the composer, not the automaton, and a test on `Hangul` alone
will pass while the app stays broken.

```js
describe('modifier keys do not end a syllable in flight', () => {
  // 예 = ㅇ + ㅖ, and ㅖ is Shift+P in 두벌식. Pressing Shift fires its OWN keydown
  // between the two jamo; before this fix that keydown ended the session and the
  // field got ㅇㅖ — two bare jamo instead of one syllable.
  it.each([
    ['예', [['KeyD', false], ['ShiftLeft', true], ['KeyP', true]]],
    ['얘', [['KeyD', false], ['ShiftLeft', true], ['KeyO', true]]],
    ['있', [['KeyD', false], ['KeyL', false], ['ShiftLeft', true], ['KeyT', true]]],
  ])('composes %s with Shift pressed mid-syllable', (expected, keys) => {
    const el = field();
    for (const [code, shiftKey] of keys) press(el, { code, shiftKey });
    expect(el.value).toBe(expected);
  });
});
```

**Step 2: Run it and watch it fail**

```bash
npx vitest run frontend/src/modules/School/ime/fieldComposer.test.js --reporter=dot
```

Expected: 3 failures, `expected '예' to be 'ㅇㅖ'` (or similar).

**Step 3: Implement**

In `handleKey`, **above** the ctrl/alt/meta line:

```js
  handleKey(event, el) {
    // A modifier's own keydown is not a key the learner "typed" — it is the
    // first half of one. Shift is REQUIRED for ㅖ, ㅒ and the tensed consonants,
    // so treating its keydown as a non-jamo and ending the session made every
    // syllable that needs it impossible to compose (예 came out as ㅇㅖ).
    // Return false so the browser handles it, but do NOT end(): Shift moves no
    // caret, so the session is still anchored to reality across it.
    if (MODIFIER_KEYS.has(event.key)) return false;
    if (event.ctrlKey || event.altKey || event.metaKey) { this.end(); return false; }
```

and near the top of the file:

```js
/** Keys that are held, not typed. Their keydown must pass through untouched. */
const MODIFIER_KEYS = new Set(['Shift', 'CapsLock', 'AltGraph']);
```

**Step 4: Run and verify green**

```bash
npx vitest run frontend/src/modules/School/ime/ --reporter=dot
```

Expected: all pass, including the pre-existing composer and hangul suites.

**Step 5: Commit**

```bash
git add frontend/src/modules/School/ime/fieldComposer.js \
        frontend/src/modules/School/ime/fieldComposer.test.js
git commit -m "fix(school): pressing Shift no longer destroys the syllable in flight"
```

---

## Phase 1 — the seam everything else needs

### Task 2: Expose committed vs pending text to the React layer

**Why:** `TypedRung` computes its reveal by matching the input's `value` against the
target. `value` merges settled text with the syllable still being composed, and in 두벌식
a consonant is genuinely ambiguous until the next vowel lands. Typing 오늘: after ㄴ the
value is **온**, which does not match 오, so the match count drops to zero, the prompt
collapses, and 늘 — the glyph being typed — disappears. The automaton already knows the
difference; nothing surfaces it.

**Files:**
- Modify: `frontend/src/modules/School/ime/fieldComposer.js` (add a method)
- Modify: `frontend/src/modules/School/ime/HangulTypingProvider.jsx` (expose it on context)
- Test: `frontend/src/modules/School/ime/fieldComposer.test.js`

**Step 1: Write the failing test**

```js
describe('compositionState', () => {
  it('splits what is settled from the syllable still in flight', () => {
    const el = field();
    const c = composer();
    press(c, el, { code: 'KeyD' });                      // ㅇ
    press(c, el, { code: 'KeyH' });                      // ㅗ  -> 오
    expect(c.compositionState(el)).toEqual({ committed: '', pending: '오' });

    press(c, el, { code: 'KeyS' });                      // ㄴ  -> 온 (ambiguous)
    expect(c.compositionState(el)).toEqual({ committed: '', pending: '온' });

    press(c, el, { code: 'KeyM' });                      // ㅡ  -> 오 + 느
    expect(c.compositionState(el)).toEqual({ committed: '오', pending: '느' });
  });

  // Latin typing, or any field the composer is not driving, is all settled.
  it('reports a field with no live session as fully committed', () => {
    const el = field('hello');
    expect(composer().compositionState(el)).toEqual({ committed: 'hello', pending: '' });
  });
});
```

**Step 2: Run it and watch it fail** — `c.compositionState is not a function`.

**Step 3: Implement**

In `FieldComposer`:

```js
  /**
   * What of this field's value will never change again, and what is still being
   * built. `committed + pending === el.value` always.
   *
   * The caller needs this because 두벌식 makes the merged value ambiguous
   * mid-syllable: after ㅇㅗㄴ the field reads 온, which is a real word, and only
   * the next vowel decides whether that ㄴ belonged to 오 or starts 늘. Anything
   * that compares the field against a target — a reveal, a gate, per-glyph
   * colour — has to compare against `committed` or it will flinch on every
   * syllable boundary.
   */
  compositionState(el) {
    if (!this.#continuous(el)) return { committed: el?.value ?? '', pending: '' };
    return {
      committed: el.value.slice(0, this.#anchor) + this.#hangul.committed,
      pending: this.#hangul.pending,
    };
  }
```

In `HangulTypingProvider.jsx`, add `compositionState` to the context value, reading
through the existing `composer` ref:

```js
  // A ref read, deliberately not state: callers ask during their own onChange,
  // which the composer's writeField already triggered, so the answer is current
  // and no extra render is needed to deliver it.
  const compositionState = useCallback((el) => composer.current.compositionState(el), []);
```

**Step 4: Run and verify green.**

**Step 5: Commit**

```bash
git add frontend/src/modules/School/ime/
git commit -m "feat(school): the IME can say what is settled and what is still in flight"
```

---

## Phase 2 — the drill surface

The current screen stacks seven things down a 300px column in the middle of a 1280px
panel: a banner, a 90px play disc, the glyph, a label, the input, a hint line, Submit.
The right half is empty and nothing on screen says who is working.

Replace it with **two rows, column-aligned per syllable** — the model above, the
learner's answer directly beneath it:

```
┌─rail───┐ ┌────────────────────────────────────────────────┐
│  (◉)   │ │         저녁    혼자    살아요     ░░░          │  ← model
│ Learner│ │         ────    ────    ──────                 │
│ 🔊 ●●●●●│ │         저녁    혼_                            │  ← answer
│ ⌨ ●●●●○│ │                  ▁                             │
│ 🎙 ●●●●●│ │                                                │
│ 文 ○○○○○│ │   ▸ Tab plays                      [ Submit ] │
└────────┘ └────────────────────────────────────────────────┘
```

Type scale matches by construction rather than by keeping two numbers in sync, the caret
has a column to sit under, and per-glyph colour has somewhere to land.

**Audio is not a column.** It is a small control on the baseline with its shortcut
written on it — not a 90px disc owning the vertical centre.

### Task 3: A glyph-strip component

**Files:**
- Create: `frontend/src/modules/School/Programs/SentenceLadder/rungs/GlyphStrip.jsx`
- Create: `frontend/src/modules/School/Programs/SentenceLadder/rungs/glyphStrip.js`
- Create: `frontend/src/modules/School/Programs/SentenceLadder/rungs/glyphStrip.test.js`
- Create: `frontend/src/modules/School/Programs/SentenceLadder/rungs/GlyphStrip.test.jsx`

Pure function first, component second. `glyphStrip.js` decides state per column; the
component only draws.

**Step 1: Write the failing test for the pure function**

```js
import { columnsFor } from './glyphStrip.js';

// `committed` is the settled prefix from FieldComposer.compositionState — never
// the raw field value. See Task 2 for why.
const cols = (target, committed, pending, opts) =>
  columnsFor({ target, committed, pending, ...opts }).map((c) => `${c.want}:${c.state}`);

describe('columnsFor', () => {
  it('marks settled columns right or wrong, and the next one current', () => {
    expect(cols('오늘', '오', '느')).toEqual(['오:done', '늘:current']);
    expect(cols('오늘', '우', '')).toEqual(['오:wrong', '늘:current']);
  });

  // THE PORTAL BUG. Mid-syllable the field reads 온; the strip must not flinch.
  it('does not regress while a syllable is ambiguous', () => {
    expect(cols('오늘', '', '오')).toEqual(['오:current', '늘:next']);
    expect(cols('오늘', '', '온')).toEqual(['오:current', '늘:next']);
  });

  it('shows exactly one glyph beyond the current one, ghosted', () => {
    expect(cols('가나다라', '', '')).toEqual(['가:current', '나:next', '다:hidden', '라:hidden']);
  });

  // Listen mode starts blind; a peek turns every column visible at once.
  it('hides the model entirely when asked, and shows all of it on a peek', () => {
    expect(cols('오늘', '', '', { reveal: 'none' })).toEqual(['오:blind', '늘:blind']);
    expect(cols('오늘', '', '', { reveal: 'all' })).toEqual(['오:current', '늘:next']);
  });
});
```

**Step 2: Run it and watch it fail.**

**Step 3: Implement `glyphStrip.js`**

```js
/**
 * One column per target syllable: what belongs there, what the learner put
 * there, and how it should be drawn.
 *
 * The index of the live column is `Array.from(committed).length` and NOTHING
 * else. Deriving it from the field's value instead is what made the prompt
 * collapse on the first keystroke of every new syllable (see Task 2).
 *
 * There is deliberately no "wrong" state for `pending`: a half-built syllable
 * is not yet incorrect, it is unfinished. Callers that must judge a keystroke
 * as it lands use `isViablePrefix` (Task 7), not this.
 *
 * @param {{target: string, committed: string, pending: string,
 *          reveal?: 'model'|'all'|'none'}} args
 *   reveal — 'model' (default) shows current + one ghosted next; 'all' is a
 *   peek; 'none' is blind listen mode.
 * @returns {Array<{want: string, got: string|null, state: string}>}
 */
export function columnsFor({ target, committed, pending = '', reveal = 'model' }) {
  const want = Array.from(target);
  const got = Array.from(committed);
  const at = got.length;
  return want.map((glyph, i) => {
    if (i < at) return { want: glyph, got: got[i], state: got[i] === glyph ? 'done' : 'wrong' };
    if (reveal === 'none') return { want: glyph, got: null, state: 'blind' };
    if (i === at) return { want: glyph, got: pending || null, state: 'current' };
    if (reveal === 'all') return { want: glyph, got: null, state: 'next' };
    return { want: glyph, got: null, state: i === at + 1 ? 'next' : 'hidden' };
  });
}
```

Note the `reveal: 'all'` branch draws every column beyond the current one as `next`
(ghosted), which is what a peek should look like.

**Step 4: Run and verify green. Commit.**

```bash
git add frontend/src/modules/School/Programs/SentenceLadder/rungs/glyphStrip*
git commit -m "feat(school): a glyph strip that survives an ambiguous syllable"
```

**Step 5: The component**

`GlyphStrip.jsx` renders a CSS grid, one column per entry, two rows: `want` on top and
`got` beneath, plus a caret element on the current column.

```jsx
export default function GlyphStrip({ columns, caret = true }) {
  return (
    <div className="lang-strip" role="presentation">
      {columns.map((col, i) => (
        <div key={i} className={`lang-strip__col is-${col.state}`}>
          <span className="lang-strip__want" aria-hidden={col.state === 'blind'}>
            {col.state === 'blind' ? '' : col.want}
          </span>
          <span className="lang-strip__got">{col.got ?? ''}</span>
          {caret && col.state === 'current' && <span className="lang-strip__caret" aria-hidden="true" />}
        </div>
      ))}
    </div>
  );
}
```

Accessibility: the strip is decorative duplication of the input's own value, so it is
`role="presentation"`. The input keeps its label and remains the accessible control.

**Step 6: Component test** — assert a `current` column renders a caret, a `blind` column
renders no text, a `wrong` column carries `is-wrong`. Commit.

### Task 4: Rebuild TypedRung around the strip

**Files:**
- Modify: `frontend/src/modules/School/Programs/SentenceLadder/rungs/TypedRung.jsx`
- Modify: `frontend/src/modules/School/Programs/SentenceLadder/SentenceLadder.scss`
- Test: extend `SentenceLadderProgram.test.jsx`

**Step 1: Tests first** — the three behaviours that must not regress:

```js
it('keeps the glyph being typed on screen through an ambiguous syllable', …);
it('plays once on arrival and never loops', …);
it('does not treat Space as a play key', …);
```

**Step 2: Implement.** The changes, in order:

- Delete `visibleTargetText`. Replace with `columnsFor(...)` fed from
  `compositionState(inputRef.current)`, read inside `onChange`, held in state.
- `playSequence(clips, { loop: true })` → `{ loop: false }`.
- Remove the `if (!played) play()` in `onChange`. Play once from the mount effect
  instead — the sentence announces itself on arrival, the learner does not trigger it by
  starting to type.
- Remove the Space branch in `onKeyDown` entirely. **A Korean sentence needs spaces**
  (오늘 온 사람), and a play key that works only while the field is empty is a trap a
  child cannot see.
- Keep the Tab branch; it now plays once.
- The `<input>` gets `className="lang-rung__input is-offscreen"` — visually hidden, still
  a real focused input. **Do not use `display:none` or `visibility:hidden`**: the IME
  reads `selectionStart` every keystroke (`FieldComposer.#continuous`) and both of those
  break selection APIs. Use position/opacity/clip.
- Hint text moves onto the play control: `Tab plays`.

**Step 3: SCSS.** `.lang-strip` is `display:grid; grid-auto-flow:column; gap:0.6em;`
with `font-size: $target` — the one declaration that makes both rows the same size.
Delete the hardcoded `font-size: 1.6rem` on `&__input`. States:

```scss
.lang-strip {
  font-size: $target; display: grid; grid-auto-flow: column;
  justify-content: center; gap: 0.55em; word-break: keep-all;

  &__col { display: grid; grid-template-rows: 1fr auto 1fr; justify-items: center; position: relative; }
  &__want { font-weight: 800; }
  &__got  { font-weight: 800; color: var(--school-fg); }

  .is-next  &__want, .is-next.lang-strip__col &__want { opacity: 0.32; }
  .is-hidden &__want { visibility: hidden; }
  .is-blind  &__want { visibility: hidden; }
  .is-wrong  &__got  { color: var(--school-danger); }
  .is-done   &__got  { color: var(--school-accent); }

  // The caret is the only motion on this screen; keep it cheap and respect
  // a learner who has asked the OS for less of it.
  &__caret {
    position: absolute; bottom: 0; width: 0.7em; height: 3px;
    background: var(--school-accent); animation: lang-blink 1.05s steps(1) infinite;
    @media (prefers-reduced-motion: reduce) { animation: none; }
  }
}
@keyframes lang-blink { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } }
```

**Step 4: Run the whole ladder suite.**

```bash
npx vitest run frontend/src/modules/School/Programs/SentenceLadder/ --reporter=dot
```

**Step 5: Commit.**

### Task 5: Rail identity and rung icons

The four icons are already ingested (`svg/rung-{repetition,dictation,recording,interpretation}.svg`,
`currentColor` + `1em`, documented in `icons/MANIFEST.md`, covered by `Icon.test.jsx`).
`MANIFEST.md` records that they are **not yet one visual family** — two filled, two
outline. Swapping the two filled ones is a drop-in file replacement; do not spend time
on it inside this plan.

**Files:**
- Modify: `SentenceLadderProgram.jsx` (the `lang-ladder` nav, ~line 540)
- Modify: `SentenceLadder.scss`

**Step 1: Test** — the rail shows the learner's name and an icon per rung:

```js
it('says whose session this is, and marks each rung with its own icon', async () => {
  // …render with userId="test-learner"… (never a real child's name: this repo
  // is public and a pre-commit hook rejects household names in fixtures)
  expect(await screen.findByText('Test Learner')).toBeTruthy();
  for (const rung of ['repetition', 'dictation', 'recording', 'interpretation']) {
    expect(container.querySelector(`.lang-ladder__step [data-icon="rung-${rung}"]`)).not.toBeNull();
  }
});
```

**Step 2: Implement.** Import `ProfileAvatar` from `lib/identity/ProfileAvatar.jsx`
(same component the School rail already uses: `<ProfileAvatar id={u.id} name={u.name} />`)
and `Icon` from `School/home/icons/Icon.jsx`. Put the avatar above the ladder, and an
`<Icon name={`rung-${rung}`} />` in each step beside its label. The blocked-rung branch
gets one too — a rung this device cannot climb should still be recognisable.

**Step 3: "Leave for now" becomes a real button** with the set's `back` mark:

```jsx
<button type="button" className="lang-btn lang-btn--quiet" data-testid="selfservice-section-exit" onClick={onExit}>
  <Icon name="back" className="lang-btn__glyph" />
  <span>Leave for now</span>
</button>
```

**Step 4: Run, commit.**

### Task 6: Glyph-paced audio

**Why:** Today `play()` loops until submit, and starts on the first keystroke. A learner
typing slowly gets hammered. Replace the loop with a clip that fires once per syllable
*landed*, so the audio is paced by their progress and doubles as confirmation.

**Files:**
- Modify: `TypedRung.jsx`
- Test: `SentenceLadderProgram.test.jsx`

**Step 1: Test**

```js
it('replays once each time a syllable is committed correctly, in copy mode', …);
it('does not replay on progress in listen mode', …);  // it would leak "you were right"
```

**Step 2: Implement.** Track the previous committed length in a ref; when it grows *and*
the newly settled glyph equals the target glyph *and* `isCopying`, call `play()`.

**Do not do this in listen mode.** The target is hidden there on purpose; replaying the
clip whenever the learner is correct tells them they are correct, which is the exercise.

**Step 3: Run, commit.**

---

## Phase 3 — copy mode is tracing, not typing

### Task 7: Jamo-level gate and target-aware auto-lock

**Why, and read this carefully — it is the subtlest task in the plan.**

Two separate ideas that reinforce each other:

**Auto-lock.** In copy mode we know the target. The instant `pending` equals the target
syllable, `flush()` it. 오 locks the moment ㅗ lands, so a following ㄴ has no syllable to
attach to and starts 늘 directly. **The 온 transient never happens** — the ambiguity that
caused the original bug is not papered over, it ceases to exist.

**The gate.** A keystroke that makes `pending` stop being a viable prefix of the target
syllable simply does not land. That is what tracing means: the stroke does not count
until it is formed. Type ㅁ where 오 is wanted and it is refused on the *first jamo*,
not after the whole block.

**Copy mode only, both of them.** In listen mode the target is also known, but
auto-flushing there would stop a learner ever typing a batchim the automaton "knows"
isn't wanted — a child who misheard 오늘 as 온... would be silently corrected into the
right answer and the record would say they heard it correctly. That is measurement
corruption. Listen mode keeps the plain automaton.

**This does not change grading.** The ladder does not grade and `accuracy` stays
*recorded, never gating*. This is an input constraint, like a worksheet with a shape to
trace. Add a line to `docs/reference/school/sentence-ladder.md` saying so, or the next
reader will think the no-grading rule quietly died.

**Files:**
- Create: `frontend/src/modules/School/ime/syllable.js` + `.test.js`
- Modify: `frontend/src/modules/School/ime/hangul.js` (expose `decompose`, `flush` is already public)
- Modify: `frontend/src/modules/School/ime/fieldComposer.js` (accept a target oracle)
- Modify: `TypedRung.jsx`

**Step 1: Write the failing test for the prefix oracle**

```js
import { isViablePrefix } from './syllable.js';

describe('isViablePrefix', () => {
  it('accepts the jamo that build the target, in order', () => {
    expect(isViablePrefix({ cho: 'ㅇ', jung: null, jong: null }, '오')).toBe(true);
    expect(isViablePrefix({ cho: 'ㅇ', jung: 'ㅗ', jong: null }, '오')).toBe(true);
  });
  it('rejects a wrong initial on the very first jamo', () => {
    expect(isViablePrefix({ cho: 'ㅁ', jung: null, jong: null }, '오')).toBe(false);
  });
  it('rejects a batchim the target does not have', () => {
    expect(isViablePrefix({ cho: 'ㅇ', jung: 'ㅗ', jong: 'ㄴ' }, '오')).toBe(false);
  });
  it('accepts a batchim the target does have', () => {
    expect(isViablePrefix({ cho: 'ㅇ', jung: 'ㅗ', jong: 'ㄴ' }, '온')).toBe(true);
  });
  // A bare jamo target (ㄱ on its own) and a non-Hangul target are both "anything goes":
  // the gate must never refuse a key it cannot reason about.
  it('permits anything against a target it cannot decompose', () => {
    expect(isViablePrefix({ cho: 'ㅁ', jung: null, jong: null }, 'a')).toBe(true);
  });
});
```

**Step 2: Run it and watch it fail.**

**Step 3: Implement `syllable.js`** — decompose the precomposed target with the inverse
of the arithmetic already in `hangul.js`'s `pending` getter (`0xac00`, `× 21`, `× 28`,
and the `CHO`/`JUNG`/`JONG` tables), then compare field by field, treating `null` in the
candidate as "not yet reached".

**Step 4: Wire the gate.** `FieldComposer.handleKey` gains an optional oracle, supplied
by the field via a data attribute or by the provider via context — prefer context, since
a target syllable is not a string you want in the DOM:

```js
// Offered BEFORE the automaton mutates, so a refused key changes nothing at all.
// Returning true (consumed) without applying is what makes the key "not land":
// the learner sees nothing move, and `onRefused` gives the UI something to show
// so a refused key does not feel like a dead keyboard.
```

**Step 5: Auto-lock.** After `this.#hangul.jamo(jamo)`, if an oracle is present and
`this.#hangul.pending === oracle.currentTarget()`, call `this.#hangul.flush()` before
`#apply`.

**Step 6: Visible rejection.** `TypedRung` shakes the current column and flashes it
`is-refused` for ~180ms. **A silent refusal reads as a broken keyboard** — this is not
optional polish.

**Step 7: Run the full ime + ladder suites. Commit.**

---

## Phase 4 — the peek

### Task 8: Press to peek, type to hide

**Why:** Copy mode is a beginner's scaffold. An intermediate should be *listening* and
typing what they hear, not reading and transcribing — but pure blind dictation with no
help is too harsh. The peek shows the whole sentence with the learner's position marked;
**the next keystroke takes it away**. You can look, hold a chunk in your head, and type
it from memory. You cannot read and type at the same time, which is the whole point.

This collapses the tiers rather than adding one. The only difference between them is how
long the model row stays up:

| tier | model row | `dictationMode` |
|---|---|---|
| beginner | always | `copy` |
| intermediate | on request, until the next keystroke | `listen` |
| advanced | never (simply does not peek) | `listen` |

**No third mode, and no new enum value.** What separates intermediate from advanced is
how often they peek — which we record anyway. One fewer knob nobody remembers to change
as a kid improves.

**Honesty about the limit:** self-hiding alone does not prevent glyph-by-glyph copying. A
child can peek, type one glyph, peek, type one glyph, and rebuild copy mode a keystroke
at a time. What discourages that is showing the **whole** sentence each time, so taking
one glyph from it is obviously uneconomic — plus the peek count in the record. **Do not
add a hard cap**; a cap that fires mid-sentence strands a stuck child, which is the
failure this whole design keeps avoiding.

**Key choice — F1, and NOT Escape.** `data/household/screens/portal.yml` binds
`actions.escape` to `reload` when idle, so a stuck child pressing Escape would reload the
kiosk out from under themselves. Tab is play, Space is typing, arrows are the caret and
deliberately end a composition session. F1 already reads as "help" and is unclaimed.
Pair it with a visible button — the Portal is a touch panel.

**Files:**
- Modify: `TypedRung.jsx`
- Test: `SentenceLadderProgram.test.jsx`

**Steps:** test → implement → run → commit, as above. The state is one boolean; F1 and
the button set it, `onChange` clears it. Log through
`languageLog.rung('peek', { rung, seq, at })` so the count is in the evidence log.

---

## Phase 5 — interpretation needs help

### Task 9: Separate a hint from a reveal

**The distinction that makes this task necessary:** on interpretation the task is *"type
what it means in English"*, so **the English text IS the answer**. Showing it is not a
hint, and playing the English audio is not a hint either — it hands over the whole
response and leaves only transcription. Both are a **skip**.

So build two affordances, named honestly:

- **Hint** — partial. One word's meaning (Task 10). Leaves the sentence to build.
- **Reveal** — the answer, as EN text or EN audio. Ends the exercise for that sentence
  and is recorded *as a reveal*, not as an attempt the learner got right.

Without this split the record will say a child interpreted 4,143 sentences when they
pressed a button 4,143 times.

Both EN text and EN audio already exist — every corpus entry carries `text.EN`, and the
repetition rung already plays the EN clip via `audioUrl(seq, 'EN')`. **No new data.**

**Files:** `TypedRung.jsx`, `languageLog.js`, `LanguageStudyService.mjs` (record the
reveal on the attempt), `docs/reference/school/sentence-ladder.md`.

### Task 10: Word glosses — a data problem, not a UI problem

**Why it is hard:** the corpus is 4,143 entries of exactly
`{seq, text: {EN, KR}, origin}` — sentence pairs and nothing else. There is no word
breakdown to hang a definition on. And Korean is agglutinative: 날씨가 is 날씨 + the
subject particle 가; 좋아요 is 좋다 conjugated. **The surface form is almost never the
dictionary headword**, so matching a tapped word against a dictionary fails on most
words in most sentences.

**Approach: generate a per-sentence gloss once, cache it forever.** The model does the
segmentation and lemmatisation — which is the part that is actually hard — and afterwards
it is static data served offline. Generate **lazily**, for sentences a learner actually
reaches: the daily limit is 5, so it is a handful a day, and tomorrow's queue is already
known and can be pre-warmed. A morphological analyser (mecab-ko and a sourced KO-EN
dictionary) is the alternative; it is a new runtime dependency and a hosting problem, and
it is not obviously more correct on conversational Glossika sentences.

**Files:**
- Create: `backend/src/2_domains/school/language/sentenceGloss.mjs` (+ test) — the shape
  and its validation. A gloss is `{seq, words: [{surface, lemma, gloss, role}]}`, where
  `surface` must be findable in the sentence: **validate that `words.map(w => w.surface)`
  joins back to the KR text**, or a tap will highlight the wrong span.
- Create: `backend/src/1_adapters/school/GlossGenerator.mjs` (+ test with a stub adapter)
- Create: `backend/src/3_applications/school/usecases/GetSentenceGloss.mjs` (+ test)
- Modify: `backend/src/4_api/v1/routers/schoolLifecycle.mjs` — `GET /sentence-ladder/gloss/:corpusId/:seq`
- Storage: a sidecar beside the corpus, `data/content/school/language/gloss/<corpusId>/<seq>.yml`.
  **Not** inside `glossika-korean.yml` — it is already 700KB and read on every day load.

**Test the failure paths, not just the happy one:** gateway unavailable → the endpoint
returns 503 and the UI hides the hint rather than showing an empty popover; a gloss whose
surfaces do not reconstruct the sentence → rejected and regenerated, never served.

### Task 11: Word lookup is a selection, not a navigation

**Why arrow keys are wrong here** — this is the reasoning, not a preference:

- Inside the field, arrows are the text caret, and in Korean they are *destructive*:
  `FieldComposer.#continuous` checks caret position every keystroke, so an arrow
  deliberately ends the composition session.
- Task 8 has already spent a key on "reveal the next glyph".
- Above all: **the learner's eyes are on the model row and their hands are on the answer
  row.** An arrow key moves something at the caret — that is what the gesture means
  everywhere else. Making the same keys walk a highlight through a different row, in a
  different script, that they are reading rather than editing, means steering by feel
  while looking somewhere else.

And the deeper mismatch: **a hint is an action, a lookup is a selection.** "Give me the
next glyph" takes no argument, so a key fits it perfectly. "What does *this* word mean"
must name one of five or six words first, and selections need a pointer or an addressing
scheme — they do not fall out of a directional key.

Note also that the two-row aligned layout **does not carry over to interpretation**: the
top row is Korean and the bottom is English, with different word counts and lengths.
There is no shared column for a cursor to live in. Interpretation shows the Korean as a
tappable sentence, not as a strip aligned to anything.

**So: direct addressing.**
- **Touch** a word — they are on a touch panel and pointing at what you are looking at is
  the entire gesture.
- **Keyboard**: hold a modifier and the words number themselves 1–5; press the digit.
  No cursor, no navigation, and it costs no key that typing needs.

**Files:** `TypedRung.jsx` (or a new `WordLookup.jsx`), `SentenceLadder.scss`,
`languageLog.js`. Log every lookup with the word — `recorded, never gating`.

---

## Phase 6 — answering interpretation out loud

Typing a translation is sometimes the wrong test. A learner who understands the sentence
perfectly may be defeated by an English keyboard, and then the record measures typing
rather than comprehension. Let them **say** the answer, transcribe it, and feed the
transcript into the same flow as a typed one.

### Task 12: Lift the transcription service out of fitness

**What is actually fitness-specific** in
`backend/src/1_adapters/fitness/VoiceMemoTranscriptionService.mjs` is exactly two
prompts: `buildTranscriptionContext(context)` (the Whisper bias) and
`CLEANUP_SYSTEM_PROMPT`. Everything else — buffer/base64 handling, extension resolution
from MIME, the Whisper call, the cleanup pass, the duration estimate, and the
lengths-never-contents logging — is generic.

So the generalisation is: move the service to `1_adapters/ai/`, inject a **profile**
carrying those two prompts, and leave fitness as one profile among others.

**⚠ THE PART THAT MATTERS MOST — cleanup is not neutral.**

The fitness profile's entire job is to *repair* the transcript: *"Fix obvious
mistranscriptions (eg thumbbells -> dumbbells)"*. That is right for a workout memo and
**catastrophic for a language assessment**. If the cleanup pass tidies a learner's wrong
translation into a right one, the evidence log records comprehension that did not happen
and the rung measures nothing at all.

The language profile must therefore:
- **not** repair, rephrase, correct grammar, or "fix" word choice;
- do at most what a transcript honestly needs — drop filler, collapse a stutter;
- and when in doubt, return the words as heard.

**⚠ Second trap — never put the expected answer in the Whisper prompt.** A Whisper
`prompt` biases recognition. Feeding it `text.EN` would make it hear the right answer
whatever the learner actually said. The language profile's Whisper prompt may name the
*language* and the general register; it may not name the sentence.

**Files:**
- Create: `backend/src/1_adapters/ai/VoiceTranscriptionService.mjs` — the service, now
  taking `{ openaiAdapter, profile, logger }`.
- Create: `backend/src/1_adapters/ai/transcriptionProfiles/fitness.mjs` — moves
  `CLEANUP_SYSTEM_PROMPT`, delegates to the existing `buildTranscriptionContext`.
- Create: `backend/src/1_adapters/ai/transcriptionProfiles/language.mjs` — the verbatim
  profile described above.
- Create: `backend/src/1_adapters/ai/VoiceTranscriptionService.test.mjs`
- Modify: `backend/src/1_adapters/fitness/VoiceMemoTranscriptionService.mjs` → a thin
  factory binding the fitness profile, so **nothing in fitness changes behaviour**. Keep
  the export in `1_adapters/fitness/index.mjs`.
- Modify: `backend/src/5_composition/bootstrap.mjs:940` — build per profile.

**Step 1: Characterisation test FIRST, before moving anything.** Capture what the fitness
path does today against a stubbed `openaiAdapter`: the prompt it sends, the filename
extension per MIME type, and the exact shape it returns. Then the refactor is provably
behaviour-preserving rather than hopefully so.

**Step 2: A test that names each trap**

```js
it('the language profile never asks the model to correct what it heard', () => {
  const p = languageProfile.cleanupPrompt.toLowerCase();
  for (const banned of ['fix', 'correct', 'mistranscription']) expect(p).not.toContain(banned);
});

it('the language profile does not leak the expected answer into the whisper prompt', () => {
  const prompt = languageProfile.whisperPrompt({ expected: 'The weather is nice today.' });
  expect(prompt).not.toContain('weather');
});
```

**Step 3: Move, wire, run, commit.**

```bash
npx vitest run backend/src/1_adapters/ai/ tests/isolated/adapter --reporter=dot
git commit -m "refactor(ai): voice transcription is a service with a profile, not a fitness detail"
```

### Task 13: Interpretation accepts a spoken answer

**The capture path already exists and works.** `RecordingRung.jsx` records a blob and
`languageApi.recording(userId, corpusId, seq, blob, capabilities, studyGrant)` posts it —
verified in production, with `capture.stop` events carrying real byte counts and
`heard: true`. Reuse that machinery; do not write a second recorder.

**Keep the domain clean:** `entry.response` stays
`{ role: 'source', modality: 'text', language: 'EN' }`. The answer is still text — voice
is an *input method*, not a different kind of response. The transcript becomes `given`,
and the attempt carries `method: 'typed' | 'spoken'` so a reader can tell them apart.

**Do not auto-submit a transcript.** Put it in the field for the learner to read and edit
first. Otherwise a transcription error silently becomes their mistake, and they never
find out why they were marked down.

**Files:** `TypedRung.jsx` (a mic control beside Submit), a new
`POST /sentence-ladder/transcribe` guarded by the same `studyGrant` as every other write
on this rung, and `LanguageStudyService.mjs` to carry `method` onto the record.

### Task 14: A spoken answer changes what the rung needs

**This is the payoff, and it is a real domain change.** Interpretation currently declares
it needs `textInput:EN`. Answerable by voice, it needs **`textInput:EN` OR `microphone`**
— and a panel with a microphone and no keyboard could do interpretation after all.

**Files:**
- Modify: `backend/src/2_domains/school/language/` — wherever `resolveRole` maps a rung to
  its requirement; a requirement becomes a set of alternatives, satisfied by any one.
- Modify: `LanguageStudyService.mjs` — `#decorate` and the missing-credit computation.
- Modify: `SentenceLadderProgram.jsx` `needNote()` — a rung short of *alternatives* must
  say something true ("Needs an English keyboard or a microphone"), never list them as
  though all were required.
- Modify: `docs/reference/school/sentence-ladder.md` §2 — the Needs table and the
  two-chains section.

**Test the interaction with the capability fix shipped 2026-09-11:** a device with a
microphone and no keyboard must now be offered interpretation instead of being told to
go elsewhere.

---

## Documentation

Not a final sweep — update as each phase lands:

- `docs/reference/school/sentence-ladder.md` — the Needs table (Task 14), a note beside
  the copy-mode gate that credit is still ungraded (Task 7), the tier table (Task 8), the
  hint/reveal distinction (Task 9), the gloss sidecar and endpoint (Task 10).
- `frontend/src/modules/School/home/icons/MANIFEST.md` — already updated for the four
  rung icons; revise if the two filled ones are swapped for outlines.

## Order and risk

Phases 0–2 are independently shippable in that order: Task 1 is a live bug, and Phase 2
is the surface every later task decorates. Phase 3 depends on Task 2's seam. Phases 5 and
6 are independent of each other and of Phase 4.

**The two places to be most careful**, both the same class of error:

1. **Task 7's auto-lock applied in listen mode** would silently correct a learner's
   mishearing into the right answer.
2. **Task 12's cleanup prompt** would turn a wrong spoken translation into a right one.

Either produces a system that looks like it is working perfectly while measuring nothing,
and neither is caught by a green suite unless someone writes the test that names the
danger. The tests above do. Keep them.

## A note on test fixtures

This repo is public and a pre-commit hook rejects household names in any staged, unstaged
**or untracked** file. Use `test-learner` / `Test Learner` throughout — never a real
child's name, not even in a comment or an ASCII sketch. The hook caught this plan twice
while it was being written.
