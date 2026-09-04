# Health audit remediation

Source: [top-to-bottom audit](../audits/2026-09-04-health-top-to-bottom-audit.md).

## Governing decisions

- Reduce taps: predict → act → undo, or predict → tweak → confirm for real ambiguity.
- Retain direct text, voice, photo, and barcode access. Do not bury frequent actions.
- Grams are the food portion display standard; unknown is preferable to invented mass.
- Support corrections across the full history, including archived entries.
- Repair historical data only from evidence, with backups, dry-run reports, and rehearsal.
- Center the desktop entry editor; use an accessible bottom sheet on mobile.
- Retain compact readable typography, reduce wasted space, and preserve navigation context.
- Default calendar weeks to Monday–Sunday and label historical analytics against current goals.

## Implementation sequence

1. Protect test ownership and establish truthful quantity/nutrient contracts, durable commands, archive edits, and summary consistency (F01–F06, F09, F12–F13).
2. Scope capture operations, prevent duplicate submission, coordinate keyed resources, and complete initial setup/error recovery (F06–F08, F10–F11, F18).
3. Implement the correction dialog, compact direct controls, predictable calendar navigation, and shared accessible presentation (F14–F18).
4. Complete template/catalog workflows, icon identity, analytics, and coach continuity; remove semantic duplication (F17, F19–F21).
5. Rehearse evidence-backed migration, run boundary/browser regressions, deploy through activity gates, and record per-finding closure evidence.

## Verification requirements

Use isolated storage for mutation tests. Cover every creation transport, edit/delete then capture replay, empty-day summaries, date moves, archived groups, concurrent/idempotent commands, and crash recovery. Verify actual HTTP envelopes. Browser checks must cover scoped progress, one-tap logging, retained retries, exact grams, focus management, favorites, goal setup, mixed medical units, and date/scroll preservation.

No production data repair or deployment is considered complete merely because unit tests pass. Record verification and remaining work in the audit as implementation progresses.

## Implementation checkpoint

Phases 1–4 are implemented. Phase 5 has passed built-app browser journeys and
an actual copied-history rehearsal: 4,653 entries converted, 562 masses retained
as unknown, zero follow-up changes. Deployment and production conversion are
tracked in the audit. See the [repair runbook](../../runbooks/health-ledger-repair.md)
for writer isolation, backup verification and recovery.

Intentional limits: older creation clients without operation IDs are compatible
but not retry-idempotent; the YAML journal assumes one writer process; coach
visible-history persistence is bounded to this browser session; uncertain
historical catalog evidence is not automatically rewritten or merged.
