# Round 2: recovered reviewer response

Reviewer: `architecture_review_r2`. Recorded: `2026-09-05T22:06:47.915Z`.
Source event: reviewer session line 200. Paths normalized as described in the evidence index.

---

Round 2: **two high-severity plan defects remain**. The revised plan substantially closes Round 1; these are concrete implementation-design contradictions, not complaints that future work packages are unexecuted.

### R2-01 — High: One workspace scope cannot preserve the dependencies of a full-stack owner

Locations: migration plan §7.2, §9, especially lines 661–674 and 699–719.

The plan promises one owner package, source consolidation, and preservation of the resolved dependency version used by every importer. Fitness demonstrates why those promises need another packaging mechanism:

| Existing importer | Proven `moment-timezone` version |
|---|---:|
| `frontend/src/hooks/fitness/SessionSerializerV3.js:1` | 0.5.47 |
| `backend/src/1_rendering/fitness/FitnessReceiptRenderer.mjs:12` | 0.6.0 |
| `cli/lib/fitness/stravaCrud.mjs:12` | 0.5.46 |

I verified these with `createRequire` resolution and the three checked-in lockfiles. Moving all three under a single package scope cannot retain three meanings of the same bare import merely by keeping three versions somewhere in the lockfile.

There is a second, related risk: these packages extend and export their underlying `moment` singleton. The three current installations resolve **separate** `moment@2.30.1` instances. Default workspace hoisting could unify that transitive dependency even while preserving three `moment-timezone` versions. Loading one timezone package can then replace another importer’s `moment.tz` implementation/data.

Recommended correction:

- Specify owner-local private runtime-facet packages where dependency scopes conflict, while retaining one contributor directory/public owner identity.
- The proposed `server/`, `web/`, and `cli/` facet workspaces are viable in principle. Public owner exports may target descendant facet source files; the source file’s nearest package scope controls its imports.
- Explicitly specify facet workspace discovery, manifest copying, install closure, `type`/`imports`, and dependency declarations.
- Preserve required **instance separation**, not only versions. Define the tested installation strategy for conflicting transitive singletons; do not promise that nested workspace manifests alone solve hoisting.

Objective acceptance:

1. A fixture mirrors these three existing versions and a shared-version mutable transitive dependency.
2. Real Node and browser resolution reach each intended facet/version without test aliases.
3. Importing the server and CLI variants in both orders preserves their independent behavior.
4. React/context identity remains unified within the browser graph; native-module identity follows its explicitly reviewed requirement.
5. Clean Linux image installation reproduces the same results.

This is not simply “WP-03 has not run”: the current layout already encounters a proven representational conflict. The plan should contain the strategy before delegating implementation to WP-03.

### R2-02 — High: Provider discovery has unresolved system and adapter-layer violations

Locations: migration plan §8.2–8.3, §10.1–10.2, particularly lines 581, 630–633, 733–738, and provider-discovery row 751.

Concrete source chain:

- `backend/src/0_system/modules/FileModuleManifestDiscovery.mjs:19` performs `import(modulePath)`.
- `backend/src/5_composition/integrations/AdapterRegistry.mjs:24` delegates manifest imports to that system service.
- `backend/src/1_adapters/ai/openai/manifest.mjs:8` contains a lazy import of the concrete OpenAI adapter.

The plan correctly requires computed imports to resolve to finite target sets and preserves system isolation. Applying that rule exposes a system → provider manifest dependency. Moreover, classifying the executable manifest as an adapter because of its present directory creates a peer-adapter import.

“Supply relocated discovery roots/entries” is insufficient to resolve this seam.

Recommended correction:

- Keep filesystem enumeration in system.
- Perform module loading and concrete provider selection in composition.
- Classify executable provider manifests/factory registrations as **composition**, with concrete destination paths.
- Preserve discovery ordering, duplicate-provider resolution, laziness, defaults, config precedence, failure logging and existing missing-provider behavior.
- Narrow §10.1’s sentence “An integration is an adapter role.” Provider translation is an adapter role; installed widget registration, executable provider manifests, and cross-owner binding are composition.

Objective acceptance:

1. Negative fixture rejects a computed system import of an owner composition/adapter target.
2. Negative fixture rejects a manifest mislabeled as adapter when it imports another adapter implementation.
3. The corrected discovery chain passes without exempting dynamic imports.
4. Fake-backed discovery tests preserve ordered provider registration, lazy construction, duplicate/default selection, and error behavior.
5. The design names the exact source split before WP-04 relocates discovery infrastructure.

### Round 1 closure assessment

- **R1-01/02:** Addressed at plan level: binding rulings, context ranks, export provenance, port-only inversion and unknown-path failures are explicit.
- **R1-03:** Addressed for plan scope. I verified all tracked directory names appear in the inventory: 74 application, 43 domain, 35 frontend-module and 19 extension folders. Per-file decisions are correctly identified as blocking implementation deliverables.
- **R1-04:** Addressed: game experiences now have explicit subownership and environment → experience → platform direction.
- **R1-05:** Addressed through the concrete integration register.
- **R1-06:** Addressed through measurable safe contributor scenarios and clean-checkout trials.
- **R1-07:** Improved substantially, but its package-resolution portion remains incomplete until R2-01 is incorporated.

The generic screen-host classification now checks out: generic hosting and installed product selection are explicitly separated, with independent positive and negative boundary proofs. I found no additional blocking naming or product-classification defect in this round.

No files edited; no controller started.
