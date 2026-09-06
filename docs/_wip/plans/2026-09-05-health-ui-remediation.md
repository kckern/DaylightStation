# Health UI audit remediation

Approved: implement all 16 findings from the September 5 UI audit.
Explicit user decisions: only explicit confirmation ends review early; desktop
uses two meal columns; preview and repair artwork on audited entries only,
preserving nutrition, review state, and manual artwork pins.

## Completion checklist

- [x] 1 Confirmation: visible pending/success/error, deduplication, versions.
- [x] 2 Explicit-only confirmation, field-scoped protection, atomic group scope.
- [x] 3 Unknown vs zero nutrients, partial coverage, target-independent macro intake.
- [x] 4 Canonical portion presentation and editing (mass/volume/servings).
- [x] 5 Responsive Progress stats and accessible Coach Send.
- [x] 6 One contextual left rail, compact week/history, mobile disclosure.
- [x] 7 Two populated meal columns, empty meal add strip, chronological order.
- [x] 8 Inline status/macros/add controls, numeric alignment, single capture bar.
- [x] 9 Compact exceptional uncounted-capture disclosure.
- [x] 10 Last-child tree termination, persistent groups, single artwork slot.
- [x] 11 Shared day draft preview; drag/direct entry/keyboard; one commit on release;
      cancel/failure/conflict handling; scale groups atomically; preserve polling.
- [ ] 12 Manifest/catalog artwork quality and exact-ID previewed live icon repair.
- [x] 13 Canonical weight delta, as-of date and historic-view labelling.
- [x] 14 Compact goal summary before responsive Progress charts; edit in sheet.
- [x] 15 Cleanup run summary/history terminology and preserved audit/undo.
- [x] 16 Exercise titles, Medical empty action, labels, units, friendly errors.
- [x] Canonical docs, regression tests and repository gates.
- [x] Six-viewport screenshot verification (plus shared-shell regression checks).
- [ ] Deploy gates, production verification, no live nutrition demo writes.

## Required acceptance

At 1366×768, first food y≤300 and lunch/dinner identifiable without scrolling;
at 390×844, first food y≤350 with history collapsed. Preserve 44px targets.
Chia 14→28g previews 140 kcal, meal 941, day 1609, remaining 526 in the incident
fixture. No writes during motion/cancel, one versioned command on release. All
totals use shared quantity/counting contracts; groups remain non-additive.
Preserve 72h deadlines and manual fields; only Confirm ratifies nutrition.
Telegram keeps original message IDs, with no stabilization/reminder spam.

Implementation order: shared command/quantity correctness → compact surfaces and
preview control → secondary screens/artwork → tests/screenshots/docs → gated
deployment and selective artwork repair. Use isolated worktree, preserve unrelated
workspace files. No broad data migrations or relaxed reviewer safeguards.
