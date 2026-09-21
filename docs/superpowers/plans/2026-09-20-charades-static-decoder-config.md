# Charades Static Decoder Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the FHE Charades text decoder completely static through configuration while retaining every animated decoder capability.

**Architecture:** Extend the existing `decoder:` contract with `color_animation`, defaulting to `true`. The decoder engine skips recoloring ticks and installs no timer when `reveal: static`, `motion: false`, and `color_animation: false`; the FHE preset opts into that combination.

**Tech Stack:** React, Vitest, Playwright, YAML-backed Gaming definitions, shared Activity Party validation.

**Spec:** `docs/superpowers/specs/2026-09-20-charades-real-play-history-and-static-decoder-design.md`

## Global Constraints

- Preserve progressive, marquee, movement, and color-animation code.
- `color_animation` defaults to `true`; other presets retain current behavior.
- Today's `charades:fhe` text is always fully revealed, position-fixed, and color-fixed.
- Image decoder behavior is unchanged.
- Static mode must not install a needless interval when every animated dimension is disabled.

## Review Focus

- Omitted `color_animation` preserves the existing animated default (Task 1 test).
- Snake-case YAML and camel-case component input normalize identically (Task 1 test).
- Invalid non-boolean configuration fails definition validation (Task 1 test).
- Changing from animated to fully static configuration cleans up the old timer (Task 1 rerender test).
- Reduced-motion remains still and fully revealed regardless of authored mode (Task 1 regression test).

---

### Task 1: Add an independently configurable color clock

**Files:**
- Modify: `frontend/src/modules/Gaming/platform/ui/segmentedSecretReveal.js:9-50`
- Modify: `frontend/src/modules/Gaming/platform/ui/segmentedSecretReveal.test.js`
- Modify: `frontend/src/modules/Gaming/platform/ui/SegmentedSecretText.jsx:63-177`
- Modify: `frontend/src/modules/Gaming/platform/ui/SegmentedSecretText.test.jsx:90-330`
- Modify: `shared/gaming/rulesets/activity-party/index.mjs:38-60`
- Modify: `shared/gaming/rulesets/activity-party/activityParty.test.mjs`

**Interfaces:**
- Consumes: `decoder.color_animation` or `decoder.colorAnimation` boolean.
- Produces: normalized `settings.colorAnimation: boolean`, default `true`.

- [ ] **Step 1: Add failing normalization and validation tests**

```js
expect(decoderSettings({ color_animation: false }).colorAnimation).toBe(false);
expect(decoderSettings({ colorAnimation: false }).colorAnimation).toBe(false);
expect(decoderSettings({}).colorAnimation).toBe(true);
expect(validateActivityPartyDefinition({ ...definition, decoder: { color_animation: 'no' } }).errors)
  .toContain('decoder.color_animation must be boolean');
```

- [ ] **Step 2: Add a failing fully-static component test**

```js
it('does not reveal, move, recolor, flicker, or schedule ticks when fully static', () => {
  vi.useFakeTimers();
  const timer = vi.spyOn(globalThis, 'setInterval');
  const { container } = render(<SegmentedSecretText text="CAT" decoder={{
    reveal: 'static', motion: false, color_animation: false,
  }} />);
  const card = screen.getByRole('img', { name: 'Secret clue: CAT' });
  const before = [...container.querySelectorAll('polygon')].map(colorOf);
  expect(picture(container, 'CAT')).toBe('CAT');
  expect(card.style.transform).toBe('');
  vi.advanceTimersByTime(60_000);
  expect([...container.querySelectorAll('polygon')].map(colorOf)).toEqual(before);
  expect(card).toHaveAttribute('data-reveal-step', '0');
  expect(timer).not.toHaveBeenCalled();
});
```

Add a rerender test from default marquee to the fully static block and assert
the previous interval is cleared and no later DOM changes occur.

- [ ] **Step 3: Run focused tests and verify the new expectations fail**

Run: `npx vitest run frontend/src/modules/Gaming/platform/ui/segmentedSecretReveal.test.js frontend/src/modules/Gaming/platform/ui/SegmentedSecretText.test.jsx shared/gaming/rulesets/activity-party/activityParty.test.mjs`

Expected: FAIL because `color_animation` is unknown and static mode still recolors.

- [ ] **Step 4: Normalize and validate the new key**

Add `colorAnimation: true` to `DECODER_DEFAULTS`, normalize snake/camel input
with the existing `pick` helper, and validate authored
`decoder.color_animation` as boolean in the Activity Party definition.

- [ ] **Step 5: Separate frame changes from color changes in the engine**

Change `paint(frame)` to `paint(frame, { recolor })`. Always update signal/mask
classes when the reveal frame changes. Only call `nextColorIndex` and update
`--segment-color` when `recolor` is true or a segment changed family and needs a
valid initial index. Define:

```js
const fullyStatic = settings.reveal === 'static'
  && !settings.motion
  && !settings.colorAnimation;
```

Call `show()` once for `fullyStatic` and do not call `setInterval`. Animated
modes continue using the single existing clock. Include `colorAnimation` and
`running: Boolean(timer)` in structured debug fields.

- [ ] **Step 6: Run focused tests, including existing animation regressions**

Run: `npx vitest run frontend/src/modules/Gaming/platform/ui/segmentedSecretReveal.test.js frontend/src/modules/Gaming/platform/ui/SegmentedSecretText.test.jsx shared/gaming/rulesets/activity-party/activityParty.test.mjs`

Expected: PASS; existing marquee/progressive/motion/color tests still prove the preserved features work.

- [ ] **Step 7: Commit the configuration capability**

```bash
git add frontend/src/modules/Gaming/platform/ui/segmentedSecretReveal.js frontend/src/modules/Gaming/platform/ui/segmentedSecretReveal.test.js frontend/src/modules/Gaming/platform/ui/SegmentedSecretText.jsx frontend/src/modules/Gaming/platform/ui/SegmentedSecretText.test.jsx shared/gaming/rulesets/activity-party/index.mjs shared/gaming/rulesets/activity-party/activityParty.test.mjs
git commit -m "feat(gaming): allow decoder color animation to be disabled"
```

### Task 2: Configure and certify static FHE text

**Files:**
- Runtime config: `{DAYLIGHT_BASE_PATH}/data/household/gaming/games/charades:fhe/rules.yml`
- Modify: `tests/live/flow/gaming/fhe-charades.runtime.test.mjs:135-205`
- Modify: `docs/reference/gaming/party-games.md:30-88`

**Interfaces:**
- Consumes: the `decoder` definition projected by Activity Party.
- Produces: `{ reveal: 'static', motion: false, color_animation: false }` for `charades:fhe`.

- [ ] **Step 1: Change the FHE preset only**

```yaml
decoder:
  reveal: static
  motion: false
  color_animation: false
```

Remove timing and marquee keys from this preset because they have no effect in
the fully static configuration. Do not change `DECODER_DEFAULTS` or other games.

- [ ] **Step 2: Add live-flow assertions for authored configuration and stable DOM**

Assert the returned definition contains exactly the three keys above. On the
first text turn, capture `data-reveal-step`, `data-motion-index`, inline
transform, signal/mask classes, and every segment color; wait at least 500 ms;
assert the second capture is identical. Retain the existing physical decoder
and concealment assertions.

- [ ] **Step 3: Run definition and component tests**

Run: `npx vitest run shared/gaming/rulesets/activity-party/activityParty.test.mjs frontend/src/modules/Gaming/platform/ui/SegmentedSecretText.test.jsx frontend/src/modules/Gaming/experiences/charades/Charades.test.jsx`

Expected: PASS.

- [ ] **Step 4: Update the decoder reference contract**

Add `color_animation` to the configuration table, change the absolute statement
“The clue is never shown steadily” to describe animated defaults, and document
the fully static three-key combination. State explicitly that image decoder
animation is unaffected.

- [ ] **Step 5: Run the live test against the single existing backend stack**

Per `CLAUDE.local.md`, do not start another backend process. Run:

`npx playwright test tests/live/flow/gaming/fhe-charades.runtime.test.mjs`

Expected: PASS; every text clue remains unchanged during its ready phase.

- [ ] **Step 6: Commit configuration, certification, and docs**

The runtime YAML is outside Git and is applied operationally; commit the test
and reference changes:

```bash
git add tests/live/flow/gaming/fhe-charades.runtime.test.mjs docs/reference/gaming/party-games.md
git commit -m "config(gaming): hold FHE decoder text static"
```

