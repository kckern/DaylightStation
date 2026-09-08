# Round 1: recovered reviewer response

Reviewer: `architecture_review_r1`. Recorded: `2026-09-05T21:57:12.121Z`.
Source event: reviewer session line 118. Paths normalized as described in the evidence index.

---

Round 1 reviewed the current 375-line migration draft, relevant roadmap/runtime sections, every file under `docs/reference/core/layers-of-abstraction`, the adapter guidelines, and representative source. No files edited.

The three-category ownership model is sound, and the draft correctly distinguishes proposed work from implementation. It is not yet sufficiently precise to serve as the full migration specification.

### 1. High: “Preserve the existing rules” is insufficient when the rules and checker disagree

Locations: migration §1.3, §3, §4; `ddd-reference.md:40`, `domain-layer-guidelines.md:328`, `scripts/audit-layer-imports.mjs:25`, `:386`.

The source hierarchy checker:

- Allows different domains at the same level (`:413` tests only `>`).
- Silently accepts unknown source and destination domains (`:388`, `:412`).
- Does not assign existing `backend/src/2_domains/books/` a level.

I verified two synthetic cases without editing files: `piano → gaming` and `books → health` both return no findings. Meanwhile, the domain guidelines require lower-level dependencies, and their domain table differs from the more complete table in `ddd-reference.md`.

“Shared capability” must not automatically become “lower-level domain.” Gaming can be a shared owner while its domain remains level 2.

Recommended correction: add a normative owner-local layer mapping, authoritative precedence rules, and an explicit reconciliation task for missing domains and same-level imports. Preserve D1–D10; do not lower restrictions to match today's scanner.

Acceptance: unknown domains fail classification; public visibility and relocation do not change domain rank; same-level/upward fixtures have documented expected verdicts; both source layouts receive identical decisions.

### 2. High: Public entry points lack sufficient layer provenance

Locations: migration §1.2–1.3; `ddd-reference.md:40–52`; decision register D1–D3 and D7.

The draft describes `web`, `server`, and portable entries, but those runtime labels cannot enforce server-layer restrictions. A public server barrel containing a domain value, an application port, a container, and an adapter would make an apparently legal public import capable of loading forbidden layers.

There is also a necessary distinction between importing an application's implementation and importing its application-owned port. A shared adapter may legitimately implement such a port: `TemporaryImagePrintGateway.mjs:4–7` extends Gratitude's port. An owner-only dependency prohibition would either reject dependency inversion or encourage moving ports into `shared/` or domain code, contrary to D3.

Recommended correction: specify layer/contract-role provenance for exports and resolve re-export chains to their implementations. Distinguish concrete consumer imports from permitted port-contract dependencies. API factories still receive operations through injection; public application contracts do not grant API import permission. Renderers must not acquire an application-port import exception.

Acceptance: negative fixtures reject API→public-container, application→public-renderer, and domain→public-workflow imports, including re-exports. A gateway extending an existing application port passes; a renderer importing that port fails.

### 3. High: The destination remains a direction rather than an executable filesystem design

Locations: migration §1.3 and §6.1/6.4.

`modules/<product>` and `capabilities/<name>` are provisional, with owner-local server distinctions described but not concretely laid out. The plan does not settle where public entries, integration bridges, colocated tests, documentation, assets, satellite sources, or retained shared-kernel code belong.

“Complete the agreed ownership map” is also not bounded by a current source-area inventory. The examples do not cover the existing application portfolio, platform roots, scripts, CLI entrypoints, or extensions.

Recommended correction: give a normative destination tree and naming rules, plus a source-area classification appendix with deliberate retained roots. Separate stable owner IDs from existing public route/content/config identifiers; filesystem normalization must not rename `office_off`, `app:*`, widget IDs, or persisted namespaces.

Acceptance: an implementer can place a new API handler, repository port, renderer, game experience, standalone widget, and native bridge without choosing a new convention. Every current production source area has a destination or explicitly retained owner. File-level unresolved ownership blocks cutover rather than becoming a permanent catch-all.

### 4. Medium: Gaming classification omits its existing middle abstraction

Locations: migration §1.1; `docs/reference/gaming/README.md:13–24`.

Gaming already documents:

```text
environment → experience → platform
```

Experiences are reusable production presenters, while Party Games supplies environment policy and hardware bindings. The migration table describes kernel, rulesets, browser platform, and Party Games but does not classify `frontend/src/modules/Gaming/experiences`.

This omission can fold game-specific experiences into the generic platform or unnecessarily force every experience into a complete new application.

Recommended correction: map the existing hierarchy to ownership and artifact roles explicitly. An experience may remain a separately identified library/artifact within an owner; reusability does not erase its game-specific semantics.

Acceptance: the migrated architecture test still rejects experience→environment imports and platform→experience imports, including aliases. At least one experience runs with injected fake environment capabilities.

### 5. Medium: Cross-application integration ownership is described abstractly but not assigned

Locations: migration §1.2, §6.1; `GratitudeFeedAdapter.mjs:28–52`; `HomeBotContainer.mjs:15–64`; `appRegistry.js:83–90`.

Concrete integrations remain without a proposed destination and binding owner:

- Feed directly reads Gratitude's stored record format.
- HomeBot receives a broad Gratitude service.
- Generic household parameter resolution calls `/api/v1/gratitude/bootstrap`.
- Screen built-ins select product presentations.

The runtime draft proposes behavioral redesign for some of these, but it is explicitly deferred. The immediate plan needs its own behavior-preserving treatment.

Recommended correction: add an integration register identifying consumer, provider, current behavior, destination bridge, public contract, composition binding, and compatibility test. Decide which imports are replaced now and which externally visible URLs intentionally remain.

Acceptance: moving Gratitude does not leave another owner reading its private datastore format; the existing bootstrap URL and selection semantics remain unchanged. Every bridge has a concrete owner, and composition only wires it—it does not absorb selection or policy logic.

### 6. Medium: Contributor isolation has no measurable delivery contract

Locations: migration introduction, §1, §6.

The purpose is contributor focus, but the plan's completion gates mostly establish production compatibility. A clean source layout can still require private household data and the whole live backend to develop a Piano widget.

This is especially dangerous here: `ScreenRenderer.jsx:41–46` executes installed-widget and device-key setup at import time; the broader backend is a household controller, not a passive development fixture.

Recommended correction: specify the minimum owner README, fake-backed development entry, synthetic data, dependency documentation, focused test command, and escalation path for adding APIs/adapters. These are development tooling, not new production runtime functionality.

Acceptance: an experienced contributor following only the owner README can render a representative view and execute a domain/API workflow without household secrets, real hardware, or starting the production controller. The docs clearly state the supported dependency closure rather than promising complete application removal.

### 7. Medium: Release gates are named, but their execution and adjudication are not specified

Locations: migration §3.1, §4, §5, §6.5.

The targeted diagnostic evidence is accurately reported as 95 passing and 2 failing tests. However, “required complete suites” has no runner/command matrix, and no documented decision distinguishes tolerable inherited test failures from blocking structural failures. A future implementer could treat the existing baseline as permission to ignore a new filesystem violation or lost test.

The package-resolution experiment likewise has criteria but no defined decision artifact or stopping condition if the preferred alias scheme fails.

Recommended correction: name each existing gate command, its coverage, planned extension, required evidence artifact, and release status. Define the resolver experiment's candidate/default, decision output, and rejection criteria. D10 remains zero-tolerance; inherited failures cannot be hidden by changing discovery.

Acceptance: the release checklist links exact before/after inventories and commands; missing tests fail; controlled red proofs fail for the intended reason; clean Node/image resolution is demonstrated independently of test aliases; unresolved architecture or contract failures prevent cutover.

The main strengths worth preserving are the no-new-runtime scope, application-owned public exports, generic screen-host/composition split, deliberate refusal of a `deprecated/` migration tree, and single-controller rollback discipline.
