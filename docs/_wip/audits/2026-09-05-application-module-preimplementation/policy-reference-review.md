# Layer-policy reference and checker reconciliation

Status: cross-check complete; the authoritative references and current checker
are intentionally unchanged. The machine-readable [review](policy-reference-review.json)
pins every D1–D10 decision, relevant guideline location, checker behavior, and
the three observed domain-edge findings.

## Confirmed policy versus current enforcement

All D1–D10 remain binding. In particular, containers do not import concrete
adapters (D1), applications receive renderers through ports (D2), ports live in
applications (D3), FileIO remains prohibited in applications (D5), adapters
implement actual ports (D7), and direct filesystem imports have no exemption
outside system (D10). Public package names and a relocation do not weaken any
of those constraints.

The one documented D4 exception is narrow: system code may consume pure
`core/utils`, not arbitrary domain code. Household config naming is similarly
narrow: the frozen registry is a declarative cross-layer contract; its lookup
and enumeration helpers are executable system behavior and remain private after
the required symbol split.

## Disagreements that block enforcement adoption

The domain guide says all domain folders have a level and imports go only to a
lower level. The current checker has 43 ranked folders plus unranked `books`:
an unknown source/target returns no finding. It also rejects only an import to a
numerically higher rank, so it allows equal-rank imports. Current source has
three such edges: Piano → School once and Trigger → Barcode twice.

The live guide's displayed hierarchy table is stale relative to the checker and
physical tree: it omits current directories including `books`, `automotive`,
`camera`, `economy`, `exercise`, `measures`, `midi`, and `shutdown`. This review
does not silently choose between them. `DEC-POLICY-RANKS` proposes Level 2 for
`books`, strict-downward imports, unknown-rank failure, and an extremely narrow
same-rank declarative-contract rule; it remains blocked on explicit maintainer
approval and `IMP-BASE.02` / `IMP-POLICY.01` / `IMP-POLICY.02`.

The existing architecture fixture independently demonstrates the two checker
gaps and the required future red controls. It is evidence for the policy card,
not an adopted replacement checker.
