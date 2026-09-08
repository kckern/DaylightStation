# Narrow contract-consumption rule

Status: one selected declarative household-config contract, not a generic
shared-code permission. The [machine review](contract-consumption-review.json)
records each exported symbol, every direct importer, allowed operation, and
closure.

`@daylight/contracts/household-config` may expose only the frozen
`HOUSEHOLD_APP_CONFIGS` name-to-relative-path registry. Its ten current direct
consumers use data projection/lookup to derive loader, allowlist, Admin, test,
or migration paths. The registry does no I/O and conveys no permission to read
or write those paths.

`appConfigRelPath` and `allAppNames` are executable helpers. ConfigService is
the only production lookup caller; the existing namespace test reaches both.
They must move together to the specified private system-config helper while
preserving one frozen map binding, null lookup behavior, and fresh enumeration.
They must not remain public merely because they are colocated with declarative
data.

This rule explicitly excludes clocked builders, serializers/normalizers,
application ports/adapters, gaming rules/orchestration/presenters, and all
cross-owner private imports. Each requires its own owner/layer/port/composition
decision. `IMP-BASE.04` contains the future extraction, red controls, and
rollback; nothing has been extracted in this preparation worktree.
