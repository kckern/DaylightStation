# Nutrition numeric editing verification

## Scope

Voice meal interpretation must satisfy the AI gateway message-array contract.
Individual foods and grouped dishes expose portion, calories, density, protein,
carbs and fat through the same drag/click/keyboard control. Shared arithmetic
drives previews and atomic, versioned saves.

## Evidence

- `MealInstructionService.gateway.test.mjs` reproduces the string-message failure
  through the real OpenAI adapter and checks the outgoing provider body after the
  fix. Whisper and Mastra were not changed.
- `foodNumericEdit.test.mjs` checks serving versus composition relationships,
  group allocation, known-zero macros, unknowns, negative results and rounding.
- `HealthOperations.portion.test.mjs` persists each group field and compares it
  with the preview patches. It checks stale members, changed membership,
  composition provenance, mixed-command rejection and recovery after response
  loss without a second nutrient adjustment.
- `portionPreview.test.jsx` checks draft isolation from polling, cancellation,
  semantic command submission, version catch-up and explicit conflict recovery.
- `NumericRow.test.jsx` checks all six controls and keyboard preview/save.
- `health-numeric.runtime.test.mjs` checks actual mouse drags on all six fields
  for foods and groups, exact entry, Escape, failed-save retries with the same
  operation ID, mobile touch cancellation and horizontal overflow.

Browser verification uses isolated HTTP fixtures, never household food writes.
Persistence verification uses a temporary real YAML store. The production
frontend bundle is tested via the configured local preview server.

## Existing verification failures

The older `health-portion.runtime.test.mjs` contains layout assumptions predating
the compact row layout. Its name-button parent locator selects only the identity
cell, its first-row position limit no longer matches the mobile chrome, and it
requires 44px desktop heights where the existing compact controls are 28px.
The pointer locator, 390px layout and 768px desktop-height failures were reproduced
against the unchanged deployed build at `f5b2a1d7cc0d8c682c0a3b3741dcfa0efd7414ad`.
These assertions were not weakened to make this change pass. New browser tests
exercise the requested numeric behaviors directly.

The Vite source server also intermittently failed loading `src/main.jsx` during
browser startup. Browser verification was moved to the built production bundle;
all new numeric journeys passed there.
