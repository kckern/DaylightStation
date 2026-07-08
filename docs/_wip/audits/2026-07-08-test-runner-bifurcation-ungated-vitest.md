# Test-Runner Bifurcation: ~100 Ungated Vitest Tests

**Date:** 2026-07-08
**Found by:** the P1 adversarial review of the DDD remediation (see `docs/_wip/plans/2026-07-06-ddd-compliance-remediation-plan.md`)
**Status:** open — highest-priority follow-up from the remediation; already hid one real regression

## The problem

The repo runs two test systems, and only one is gated:

- **Gated:** `npm run test:unit` → `tests/unit/harness.mjs` → jest, collecting **only `tests/unit/suite/**`** (119 suites; deterministic baseline 410 pass / 23 fail recorded in `scripts/audit-baseline.unit.txt`).
- **Ungated:** ~100+ vitest-style test files (`import { describe } from 'vitest'`) living OUTSIDE `suite/` — `tests/unit/{art,cli,livestream,adapters,applications,domains/health,coaching,api,rendering,config,...}` plus `tests/isolated/**`. No npm script or CI gate runs them as a whole. Mixing them into jest fails with the `Cannot redefine property: Symbol($$jest-matchers-object)` interop error, so they can't just be moved into `suite/`.

Partial mitigation from the remediation: `npm run test:refactor` gates ~106 hand-picked invariant tests (vitest, single process). Everything else remains dark.

## Proof it bites

P1.4 (typed domain errors) changed `PeriodResolver`'s not-found throw; the assertion in the **ungated** `tests/isolated/domain/health/services/PeriodResolver.test.mjs` broke silently and shipped through every gate. Caught only because P2.1 happened to run the health vitest folder by hand (fixed in commit `test(health): fix PeriodResolver assertion for P1.4 typed-error message`).

Also note: jest's ignore list needed `.claude/worktrees/` added (commit `3f8266d06`) because a sibling Claude-session worktree doubled the collected suite count — same class of gate-integrity problem.

## Options (pick one, do it deliberately)

1. **Single-runner unification (best, most work):** move the jest `suite/` tests to vitest (precedent: the 2026-04-26 `fix/test-suite-greening` branch codemodded 281 files `@jest/globals`→vitest) and make `npm run test:unit` a vitest run over all of `tests/unit` + `tests/isolated`. Kills the interop error class entirely.
2. **Second gate (cheap):** add `test:unit:vitest` = `vitest run tests/unit tests/isolated --exclude tests/unit/suite` with its own pass/fail baseline file, wired next to GATE-UNIT wherever gates run. Accepts two runners but closes the blind spot.
3. **Do nothing** — accept that ~100 test files are documentation, not protection. (Not recommended; see the P1.4 escape above.)

## Verification for whoever picks this up

```bash
# the ungated population
grep -rl "from 'vitest'" tests/unit tests/isolated --include='*.test.mjs' | grep -v '/suite/' | wc -l
# the current partial gate
npm run test:refactor
# known-flaky note: parallel vitest can hit ENFILE/worker-fork flakes on this machine — use --no-file-parallelism for stable counts
```
