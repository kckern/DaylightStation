# Media App Redesign

**Is this live?** Accepted. Implementation not started. The next step is P0 · Step 0.
**What has changed in the codebase?** **No application code yet.** Only documents: the audit, the model, the review, the requirements and the handoff. The reference docs had factual drift corrected, and the redesign has not changed them otherwise.
**Authorised by:** the owner, 2026-09-14. Requirements and phasing accepted; evolve in place; commit and deploy through the gate.

## What it is

A redesign of `/media` around separation of concerns in the UX: one aim, one verb set, one search, one set of controls for any screen, and one voice for outcomes. It evolves the current app in place, phase by phase (P0 → P1 → P2), and folds in the defects the baseline audit found.

## Where everything is

| Artifact | Path |
|---|---|
| Baseline audit (as built, jobs → components) | [`../audits/2026-09-14-media-app-jobs-to-be-done-baseline.md`](../audits/2026-09-14-media-app-jobs-to-be-done-baseline.md) |
| Ideal jobs taxonomy, personas, stories, owner decisions | [`../plans/2026-09-14-media-app-ideal-jtbd-taxonomy.md`](../plans/2026-09-14-media-app-ideal-jtbd-taxonomy.md) |
| Adversarial review and owner triage | [`../audits/2026-09-14-media-app-jtbd-taxonomy-review.md`](../audits/2026-09-14-media-app-jtbd-taxonomy-review.md) |
| **Requirements (the contract)** | [`../plans/2026-09-14-media-app-redesign-requirements.md`](../plans/2026-09-14-media-app-redesign-requirements.md) |
| **Implementation handoff** | [`../plans/2026-09-14-media-app-redesign-handoff.md`](../plans/2026-09-14-media-app-redesign-handoff.md) |
| Current reference docs | [`../../reference/media/`](../../reference/media/) |

## Progress

Update a row when its step lands: date, commit, tests, deploy, and notes (including baseline and budget results).

| Phase · Step | Scope | State | Commit | Notes |
|---|---|---|---|---|
| P0 · 0 | Setup, baseline test results | Not started | — | |
| P0 · 1 | Defects D1–D4 | Not started | — | |
| P0 · 2 | One aim | Not started | — | |
| P0 · 3 | One verb set and tap rule, including screen-player queue ops | Not started | — | |
| P0 · 4 | One search | Not started | — | |
| P0 · 5 | One handle, one set of controls | Not started | — | |
| P0 · 6 | House view, devices using the app, origin attribution, minimum naming | Not started | — | |
| P0 · 7 | One voice for outcomes | Not started | — | |
| P0 · 8 | Keep your place, orientation | Not started | — | |
| P0 · 9 | Comfortable use, device-size parity | Not started | — | |
| P0 · 10 | Close-out: tap budgets, walkthroughs, deletions, reference docs | Not started | — | |
| P1 | See handoff §6 | Not started | — | |
| P2 | See handoff §7 | Not started | — | |

## Next action

Start P0 · Step 0 per the handoff. What authorises it: the owner's acceptance on 2026-09-14.
