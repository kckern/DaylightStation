# Round 3: recovered reviewer response

Reviewer: `architecture_review_r1`. Recorded: `2026-09-05T22:14:46.056Z`.
Source event: reviewer session line 220. Paths normalized as described in the evidence index.

---

Round 3 complete against the revised 1,259-line plan, source inventory, review record, and relevant source. Two findings remain; no repository edits or live tests performed.

### R3-01 — High: Shared naming/wire contracts have no consistent classification under the exhaustive matrix

Locations: main §7.2, §8.1–8.3, §9, §10.2; `system-layer-guidelines.md:265–270`.

The plan correctly says portable code retains its semantic layer, but its matrix does not account for explicitly sanctioned naming contracts. It states that system's only exception is D4, while the system reference expressly places the household-config registry in `shared/contracts/householdConfig.mjs`.

Concrete evidence:

- `configLoader.mjs:14` and `ConfigService.mjs:16` import that registry.
- The registry contains product config names plus two pure lookup functions.
- It is not a domain model, application port, or composition factory.
- Labeling the whole `shared/contracts` tree uniformly would be unsafe: `media/envelopes.mjs:26–27` reads the clock, while `nutrition/foodItemRecord.mjs:1–10` performs transport/persistence serialization.
- Likewise, `shared/gaming/kernel/coordinator.mjs` orchestrates injected stores and clocks; “kernel” cannot imply domain purity.

Consequence: the proposed classifier must either reject legitimate existing reference-backed dependencies or invent an overly permissive contracts classification.

Correction: distinguish executable layers from explicitly approved declarative-contract artifacts. Specify owner, consumer allowlist, permitted operations/import closure, and reference basis per contract. Preserve the canonical registry and lookup semantics; do not impose a literal-only restriction that silently changes its API. Explicitly classify wire builders, validators, serializers, and gaming orchestration rather than granting the whole directory an exception.

Objective verification:

- The actual household-config registry and its authorized consumers pass.
- A contract re-exporting an application workflow, adapter, domain class, or port does not acquire new import privileges.
- A clock-reading builder cannot pass as pure domain/declarative data.
- The registry remains a single source, with unchanged unknown-key and read/write mapping behavior.
- Reference updates and the policy fixtures agree.

This remains a blocking architectural omission until the plan supplies that distinction.

### R3-02 — Medium: Experience subowners are promised boundaries but are not covered by private-import enforcement

Locations: main §7.1, §8.3, §9; source inventory §4.

The plan promises each game experience a public entry and boundary classification. However, private-import rules operate across owner IDs, while subowners appear mainly in metadata and cycle checks. Since all experiences share the `game-experiences` owner, an experience can import a sibling's private implementation without violating the stated owner rule or creating a cycle.

Source evidence: current Gaming separates experience directories and already has an explicitly composition-owned presenter registry at `frontend/src/modules/Gaming/experiences/presenterRegistry.js:1–7`.

Correction: enforce public/private visibility across declared subowner boundaries as well as owner boundaries. Give each experience explicit public entries; classify the presenter registry as composition. Shared experience utilities need their own declared common boundary, not privileged access to every sibling.

Objective verification:

- A synthetic same-owner, cross-subowner private import fails.
- Importing a sibling's deliberate public export passes when layer rules permit it.
- Composition may register public presenters.
- The generic gaming platform still cannot import any concrete experience/environment.
- These checks resolve aliases and re-exports, not only relative path strings.

The revised sibling-package architecture, dependency-identity policy, port inversion rules, and provider-discovery split address the earlier findings. I found no additional package-layout blocker; WP-03 correctly treats real dependency parity as an implementation gate rather than a proven result.
