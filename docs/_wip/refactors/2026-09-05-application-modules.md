# Application modules — owner-first product modules in a layered modular monolith

**Status:** Prepared, not implemented. Five adversarial review rounds complete;
the pre-implementation checklist is under way. **No source has been relocated.**

**Started:** 2026-09-05 · **Planning baseline:** `2144f762a`
**Working name:** *owner-first product modules in a layered modular monolith*

---

## What this refactor is

Today the backend is organised by DDD *layer* — `0_system`, `1_adapters`,
`2_domains`, `3_applications`, `4_api`, `5_composition` — so a single product
(Gratitude, say) is spread across six directories, and a contributor working on
it touches all of them without any of it being visibly theirs.

The refactor gives each product a **semi-enclosed workspace** it owns, while
keeping the existing layer boundaries intact. The migration plan is explicit
about the ceiling: this is *not* a plugin runtime, a new deployment model, or a
new application feature. Behaviour is meant to be unchanged; the change is
ownership and filesystem organisation.

## What has actually happened

Read this before reading anything else, because the volume of documentation
below overstates the amount of change:

| | |
|---|---|
| Source relocated | **None** |
| Runtime behaviour changed | **None** |
| Design | Complete and reviewed through five adversarial rounds |
| Pre-implementation checklist | Started, in its own worktree — now folded to main |
| Gratitude rehearsal | Designed, **not executed** |

The two worktree branches that carried this work (`preimplementation/application-modules`
and `audit/application-module-review-evidence`) were folded together and landed
on main as `74b7926a2` on 2026-09-07.

## Where everything lives

### Roadmap (the parent)

- [Full-Stack Application Modules](../../roadmap/2026-08-31-full-stack-application-modules.md)

### Plans

| Document | Lines | What it is |
|---|---|---|
| [Migration plan](../plans/2026-09-05-application-module-migration-plan.md) | 1398 | **The specification.** Structural, behaviour-preserving migration design. Supersedes the runtime draft wherever that implies new behaviour. |
| [Pre-implementation plan](../plans/2026-09-05-application-module-preimplementation-plan.md) | 608 | **The current checklist.** Inventory, boundary design, isolated tests, rehearsal backlog. Read before executing WP-01–05. |
| [Source inventory](../plans/2026-09-05-application-module-source-inventory.md) | 325 | The starting map of what lives where. |
| [Adversarial reviews](../plans/2026-09-05-application-module-adversarial-reviews.md) | 210 | The five-round review record. |
| [Runtime design](../plans/2026-09-05-application-module-runtime-design.md) | 643 | **Deferred.** Enablement, provider resolution, lifecycle machinery — future candidates, explicitly *not* cutover prerequisites. |

### Evidence

- [Pre-implementation packet](../audits/2026-09-05-application-module-preimplementation/README.md)
  — 42 boundary and review documents: per-subsystem boundaries (feed, homebot,
  household, http, logging, rendering, storage, utility), plus the reviews that
  interrogate them (dependency cycles, import bindings, provider lifecycle,
  public entry points, wire contracts, resolver/build projection).
- [Review-evidence packet](../audits/2026-09-06-application-module-review-evidence/README.md)
  — the provenance record for the five review rounds: dispatch snapshots, patch
  history, reviewer responses, and a reproducible package-resolution experiment.

### Tooling

`../../../tests/preimplementation/application-modules/` — 82 tools that
generate the audit ledgers, plus fixtures and the package-resolution experiment.

## A note on the generated ledgers

The pre-implementation packet originally carried **323 generated JSON ledgers —
3.19M lines, 121MB** — beside its 42 markdown findings. They were dropped on
2026-09-07 and are now gitignored (`docs/_wip/audits/**/*.json`).

Two reasons, and the second is the one that bites:

1. They are machine output from the committed tooling above, so they are
   regenerable and do not belong in history.
2. Millions of lines of generated **numbers** collide with the numeric device-id
   patterns in the push guard. A `"bytes":` field in `source-ledger.json`
   happened to equal a real ANT+ sensor id, and because the guard scans every
   unpushed ref, that one collision blocked an unrelated commit on `main`. Each
   such collision costs a full investigation to clear.

Regenerate them locally when you need them. Do not commit them back.

## Next action, and what authorises it

The pre-implementation plan's stopping point is deliberate: produce an
evidence-backed implementation plan **through the Gratitude rehearsal, without
changing the application or its delivery machinery.**

Executing the migration — existing-code repairs, package adoption, extraction,
and the rehearsal itself — is **separately authorised work that has not been
authorised.** Anyone picking this up should read the pre-implementation plan's
scope boundary first and confirm the mandate before moving a single file.
