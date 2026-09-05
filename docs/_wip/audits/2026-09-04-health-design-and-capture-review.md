# Health design and capture review

The screen uses the shared palette, but its information hierarchy and interaction
patterns do not consistently follow the Health pack's direction: “the daily log
is the screen.” This review covers the supplied desktop screenshots and the
production capture flow observed on September 4.

## Design feedback

- **Make logging the primary task.** The large week selector, empty meal sections,
  and sidebar charts push the actual food far down the screen. Their space and
  emphasis should reflect their importance to logging today's food.
- **Choose a coherent action hierarchy.** The global capsule and every meal repeat
  voice/photo/barcode controls, while “Add food” is faint text and “Save as meal”
  is prominently blue. Primary capture, meal targeting, and secondary actions
  should have visibly different priority. The global capsule's target is not
  evident from its icons.
- **Show data relationships.** A dish summary cannot look identical to an
  ingredient. Use one consistent expandable group pattern, indent the members,
  and label the parent total as a summary. A zero-calorie dish is misleading.
- **Use readable labels and stable columns.** Bare arithmetic and “P 15 · C 30 ·
  F 15” require interpretation; units and meaning should be visible. Very wide
  rows separate names from their quantities. Faint secondary text includes
  useful data and actions. Actual contrast compliance needs measurement; the
  screenshot alone does not establish a WCAG violation.
- **Make charts interpretable.** The intake/burn chart lacks visible series
  labels, units, and a useful axis. Small bars with different color conventions
  across three charts are not self-explanatory.
- **Treat art as data.** Ranch represented by ketchup/mustard and cream sauce
  represented by whipped cream are inaccurate matches. A neutral placeholder
  is preferable to a confidently wrong image. Reserve one fixed icon slot for
  loading, loaded, missing, and failed states.
- **Use shared components deliberately.** Weight's number/trend/sparkline is a
  hand-built version of the documented StatCard use case. The theme tokens and
  DateStepper are used, but the Health stylesheet also defines its own 1100px
  breakpoint despite the central breakpoint contract. Token use alone does not
  establish design-system compliance. The design system does not prohibit all
  local spacing or radii, so those should be critiqued as visual inconsistency,
  not invented formal violations.

## Corroborated capture findings

- The voice taco entry completed at 16:04 local time. Its transcript names the
  tortilla, fish, greens, jalapeno, ranch, and cream sauce, with no weights.
  Its six ingredient calories sum to 310.
- Production served every row as `kind: item`, `parentId: null`. The original
  stored capture also lacks the group fields. `YamlFoodLogDatastore`'s
  `dehydrateFoodItem` omits lifecycle/group metadata, even though the parser
  creates it and the UI already supports group rollups and collapse.
- White Fish is stored with `icon: default`. Icon selection happens during the
  parse; there is no later semantic matching job to replace this fallback.
  The transcript does not establish a weight intended for white sauce.
- A barcode scan at 12:51 succeeded and created a Salted Caramel Protein Shake
  capture. It remained pending, and the pending API returned it, but Today
  filtered out its messaging-service source. That filter is removed in this
  change; confirmation is available in Health.
- The pending shake contains 455 calories and 97.5g protein for 325ml. These
  values warrant a separate product-data/serving-basis audit before accepting
  them as accurate. The imported product was not verified against its label.

## Implementation and production repair boundary

This worktree now repairs serialization, distinguishes expanded dish summaries
from ingredients, reserves artwork slots through loading/decoding/failure, and
provides a version-checked pending editor. Capture targeting is explicit, secondary
meal actions are in a menu, and desktop trends use the shared large breakpoint.

UPC imports prefer explicit serving values, scale explicit per-100 values once,
preserve unknowns in lookup metadata, and require review of ambiguous nutrition.
The historical shake remains unverified and pending; no replacement nutrition
or inferred transfer of fish weight to sauce was applied.

The September 4 local synced-data dry run for capture `iB8tjeMBD0` proposed
exactly seven row updates, with 310 calories unchanged. The manifest is
`/tmp/health-fish-taco-repair-20260904.json`. Regenerate it against current
production data before applying; it pins file hashes, IDs, labels and nutrients.
The repair CLI requires stopped writers, an explicit `--offline` flag, and a
new verified backup directory. It does not perform historical heuristic grouping.
No production writes or deployment were performed.

## Verification

- Scoped Health, nutrition, capture, persistence, scanner and shared-card tests.
- Fixture-owned HTTP checks cover pending versions, server-owned user identity,
  required operation IDs and stale-review conflicts.
- Desktop (1440px) and mobile (390px) browser journeys cover grouping, persisted
  collapse, in-app review/portion confirmation, no horizontal overflow, and exact
  row bounds before/after image decoding. They run against the built frontend
  with mocked APIs, never a second household backend.
- Production frontend build, parse gate, architecture audit and UI-token audit.

Legacy barcode captures without serving-basis metadata require a product-label
acknowledgement before confirmation. This includes the historical shake; the
guard does not change its estimated values or accept it automatically.
