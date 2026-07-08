# DDD Remediation — Session Handoff Index

**Date:** 2026-07-08
**Status:** COMPLETE and merged to local `main` (phases P0–P3, ~90 audit findings remediated across ~85 commits). **`main` is NOT pushed** — see Next Actions.

This is the one-page index for picking the work back up. Everything below is committed on `main`.

---

## Next actions (in order)

1. **Push `main`.** It is ~60 commits ahead of `origin/main`. Per the workspace sync protocol, first check the homeserver deploy tree for unpushed work (`ssh homeserver.local 'cd /opt/Code/DaylightStation && git log --oneline origin/main..HEAD'`), integrate if needed, then push. Nothing is deployed until this happens; prod is untouched.
2. **Deploy + prod smoke.** The remediation was verified against the local dev server (multiple live smokes, all 200s), never against prod. After deploy, spot-check: a fitness session list, an admin config read, piano course progress, one proxy image.
3. **Pick up the deferred tracks** (each has its own executable plan/doc — see the map below). Recommended priority: the test-runner bifurcation first (it already hid one real regression), then serialization phase 2.

## Where everything is

| Artifact | Path |
|---|---|
| The audit (all original findings) | `docs/_wip/audits/2026-07-06-ddd-layer-compliance-mega-audit.md` |
| The implementation plan + master exit-criteria table | `docs/_wip/plans/2026-07-06-ddd-compliance-remediation-plan.md` |
| Decision register D1–D9 (binding rulings) | `docs/reference/core/layers-of-abstraction/decision-register.md` |
| Serialization migration, phases 2–10 (executable) | `docs/_wip/plans/2026-07-08-serialization-ownership-migration.md` |
| Neutral content-ID rollout, phases 1–5 (executable) | `docs/_wip/plans/2026-07-08-neutral-content-id-design.md` |
| Test-runner bifurcation (~100 ungated vitest tests) | `docs/_wip/audits/2026-07-08-test-runner-bifurcation-ungated-vitest.md` |
| Live remaining-work counts (machine-readable) | `scripts/audit-baseline.json` via `npm run audit:layers` (`--list=<rule>` for file:line) |

## The gates (run these before/after any future backend change)

```bash
npm run audit:layers      # layer-import ratchet; exit 1 on any regression
npm run test:refactor     # ~106 invariant tests (vitest, single process)
npm run test:unit         # jest suite/; deterministic baseline 410 pass / 23 fail
                          # (the 23 are pre-existing; baseline in scripts/audit-baseline.unit.txt)
node --input-type=module -e "await import('./backend/src/5_composition/bootstrap.mjs'); await import('./backend/src/app.mjs'); console.log('IMPORT-OK')"
```

## Structural facts that changed (don't assume the old layout)

- Composition root: `backend/src/5_composition/bootstrap.mjs` + `5_composition/modules/*` (alias `#composition/*`). `0_system/bootstrap*` no longer exists; `0_system` has zero upward imports.
- Error responses (fitness/piano/admin/local/proxy routers): `{ error: "<string>", code }` via `errorHandlerMiddleware({shape:'string'})`; unexpected 500s return a generic message (real error server-logged). Status maps by `err.name`/`err.status` — the `#system` and `#domains` error hierarchies are different classes, so never use `instanceof` across them.
- SSOTs: zones = `2_domains/fitness/entities/Zone.mjs`; timezone = `DEFAULT_TIMEZONE` (`2_domains/core/utils/timezone.mjs`); `nowTs*` format against it, not configured system.timezone (D8); deepMerge null does NOT clear inherited values (D9).
- Admin/piano/fitness routers are thin; their logic lives in `3_applications/{admin,piano,fitness}` services/use-cases with characterization tests.

## Deferred-work counts at handoff (from the committed baseline)

`api-handrolled-500` 89 · `no-userdataservice` 93 · `domains-tojson` 72 · `apps-no-fs` 19 (relocated repositories awaiting adapter extraction) · `api-no-apps` 13 / `api-no-domains` 12 (ContentExpression cluster) · `apps-success-false` 49 · `adapters-no-cross-adapter` 4. Also open: app.mjs modularization, ~45 remaining timezone literals, frontend/backend zone-palette mismatch, `IFitnessSyncerGateway` rename (content-ID plan phase 5).

## Session-environment notes

- Three concurrent Claude sessions shared this checkout during the work (piano playback, pii-externalize, nfc-fix). Before any merge/checkout: `git worktree list` + `git status`; never touch another session's dirty tree; when `main` isn't checkout-able, merge via a scratch worktree or `git commit-tree` + `git update-ref`.
- `_deleteme/` accumulated scratch during the work — empty manually per repo convention.
- The macOS file-descriptor ceiling caused vitest worker flakes at one point — `--no-file-parallelism` gives stable counts.
