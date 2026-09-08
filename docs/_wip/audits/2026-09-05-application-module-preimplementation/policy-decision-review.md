# Policy decisions and required repairs

Status: decisions recorded and still design-blocked. The
[machine review](policy-decision-review.json) verifies that each policy conflict
has a decision ID, accountable review role, future implementation card, and
explicit D10 disposition.

| Conflict | Decision | Future gate |
|---|---|---|
| Missing `books` rank, equal-rank allowance, stale hierarchy table | `DEC-POLICY-RANKS` | `IMP-BASE.02`, `IMP-POLICY.01`, `IMP-POLICY.02` |
| Data registry mixed with executable household helpers | `DEC-CONTRACT-SYMBOL-SPLIT` | `IMP-BASE.04` |
| New owner/facade paths evade current path-only gates | `DEC-POLICY-RANKS` | `IMP-BASE.02` |
| Product/runtime SCCs risk being promoted to generic platform code | `DEC-CYCLES` | `IMP-SHARED.04` |

No record grants a D10 direct-filesystem exception. `IMP-BASE.02` must extend
both layer and direct-fs enforcement to canonical owner/layer metadata before
any relocated implementation is accepted. The authoritative references,
checker, and protected application source remain unchanged in this phase.
