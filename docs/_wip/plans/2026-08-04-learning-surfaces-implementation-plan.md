# Learning Surfaces v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/_wip/plans/2026-08-04-learning-surfaces-requirements.md` (rev 2). Read it before starting any task; section references (§) below point into it.

> **Revision 2 of this plan** — incorporates the adversarial plan review: declared
> `requiredCapabilities` enforcement moved into the projection (Task 10) since the
> bundle must stay byte-identical; Task 15 rewritten against the real
> `PrintService.listPrintables()` shape; §4.2 screen-config key specified
> (`surfaceProfile:`); asset validation moved into Task 12's body; TI-86 reason
> attribution corrected to the codec's `module <i>` format; tracked-return rule
> added to the calculator port; CLI exemplar corrected to
> `cli/schoolcalc-catalog.cli.test.mjs`; cross-task fixtures given explicit file
> paths; banks added to gate + manifest; Task 14 split; `customCapabilities`
> supplier wired; architecture-test path corrected.

**Goal:** One certification language across calculator, paper, and screen surfaces: surface profiles, per-family `certify(bundle, profile)` ports, a certification projection with manifest, the `school:certify` CLI, and offer-side consumers (screen app, Print Center) that only offer certified work.

**Architecture:** Pure domain modules (capability registry, demand derivation, verdict roll-up) feed three adapter-layer certification ports (TI-86 wrap, paper, screen) behind one contract; an application-layer registry + projection computes the matrix (including declared-lesson-requirement reasons) and writes a manifest; the CLI and API are thin shells over the projection. No published capability ID changes; the TI-86 codec's behavior is wrapped, never modified; the neutral bundle shape is never altered (artifact digests depend on it).

**Tech Stack:** Node ESM (`.mjs`), vitest (colocated `*.test.mjs`, run `npx vitest run <path>` from repo root — node_modules is present in this worktree), `#domains/...`/`#apps/...` import aliases (see package.json `imports`), js-yaml via existing YAML repository patterns.

## Global Constraints (from spec)

- **Never rename or alias a published capability ID** (§3.1 inventory). New IDs in v1: `return.session@1`, `return.scan@1`, `return.cable@1`, `return.qr@1` only (§3.2).
- **Never change the neutral bundle shape** produced by `BuildLearningLesson` — TI-86 artifact identities hash it (`sourceDigest`); adding/removing a field breaks §12.1 vocabulary safety.
- **Port signature:** `certify(bundle, profile)` → `{ modules: [{moduleId, verdict: 'render'|'incompatible', reasons, warnings}], lesson: {verdict: 'full'|'partial'|'none'}, resource? }` (§7.1). No `dispatch` anywhere in v1.
- **Ports are deterministic and do no I/O**; all inputs (bundle, resolved banks, profile) supplied by caller (§7.1). Never throw for "content doesn't fit" — throw only on malformed bundle/profile.
- **One certifier everywhere:** CLI/gate/runtime all call the same ports and projection (§2). No parallel lint logic.
- **TI-86 codec baseline for CLI certification is `TI86_SCHOOLCALC_CODEC_CAPABILITIES`**, never `TI86_SCHOOLCALC_CLIENT_CAPABILITIES` (§6.2). Verdicts against it carry `baseline: 'codec'`.
- **Existing behavior must not change:** golden TI-86 byte digests, bundle digests, `supports()`/`compile()` semantics, Print Center's `pdf` printables and curriculum-unit pipeline (§9), `schoolcalc:validate`.
- **Certified-`none`-everywhere is a warning, not an error** (§6.1). Schema/reference errors remain hard failures.
- **Subject-neutral:** no subject vocabulary in any new certification code (§2; the architecture test at `tests/isolated/application/school/schoolcalcArchitecture.test.mjs` extends).
- Commit after every task; end every commit message with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## File Structure

```
backend/src/2_domains/school/surfaces/
  capabilityRegistry.mjs        # Task 1 — known-ID inventory + return.* IDs
  profileValidation.mjs         # Task 2 — school.surface-profile/v1 validation
  demands.mjs                   # Task 3 — module/bank demand derivation
  verdicts.mjs                  # Task 4 — capability pass, tracked-return rule, roll-up
  index.mjs                     # Task 4 — barrel
backend/src/1_adapters/schoolcalc/ti86/
  Ti86SurfaceCertification.mjs  # Task 6 — calculator port (wraps codec)
backend/src/1_adapters/school/paper/
  PaperCertification.mjs        # Task 7 — paper port
backend/src/1_adapters/school/screen/
  ScreenCertification.mjs       # Task 8 — screen port
backend/src/1_adapters/school/catalog/
  YamlSurfaceProfileRepository.mjs  # Task 9 — loads catalog/surfaces/*.yml
backend/src/3_applications/school/surfaces/
  SurfaceRegistry.mjs           # Task 9 — profiles + family→port wiring
  GetSurfaceCertification.mjs   # Task 10 — the projection (matrix + digest cache + declared requirements)
  certificationManifest.mjs     # Task 11 — manifest read/write helpers
cli/school-certify.cli.mjs      # Task 12 — the certifier CLI (npm: school:certify)
backend/src/4_api/v1/routers/school.mjs           # Task 13 — modify: certification + profile-resolve endpoints
frontend/src/modules/School/catalog/certification.js  # Task 14 — pure gate helper
frontend/src/modules/School/SchoolApp.jsx             # Task 14 — modify: consult certification
backend/src/3_applications/school/PrintService.mjs    # Task 15 — modify: paper-certification gate on bank printables
tests/_lib/school/certificationContract.mjs       # Task 5 — shared port contract suite
```

Rollout order is strictly bottom-up; every task leaves the tree green (`npx vitest run backend/src/2_domains/school backend/src/1_adapters/schoolcalc backend/src/3_applications/school`).

---

### Task 1: Capability registry (domain)

**Files:**
- Create: `backend/src/2_domains/school/surfaces/capabilityRegistry.mjs`
- Test: `backend/src/2_domains/school/surfaces/capabilityRegistry.test.mjs`

**Interfaces:**
- Consumes: `parseCapabilityId` from `../catalog/capabilities.mjs`.
- Produces: `KNOWN_CAPABILITY_IDS: readonly string[]`, `RETURN_CAPABILITY_IDS: readonly string[]`, `isRegisteredCapability(id, {customCapabilities?: string[]}) => boolean`. Tasks 2, 4, 7, 8 rely on these exact names.

- [ ] **Step 1: Write the failing test**

```js
// backend/src/2_domains/school/surfaces/capabilityRegistry.test.mjs
import { describe, expect, it } from 'vitest';
import {
  KNOWN_CAPABILITY_IDS, RETURN_CAPABILITY_IDS, isRegisteredCapability,
} from './capabilityRegistry.mjs';

describe('capability registry', () => {
  it('contains every published ID from the spec §3.1 inventory, verbatim', () => {
    const published = [
      'reader@1', 'examples@1', 'problems@1', 'flashcards@1', 'quiz@1', 'learning-probe@1',
      'activity.matching@1', 'activity.sorting@1', 'activity.sequencing@1',
      'activity.timed-drill@1', 'activity.memory@1',
      'response.choice@1', 'response.text@1', 'response.matching@1',
      'response.region@1', 'response.asset-choice@1',
      'math@1', 'table-layout@1', 'image@1', 'scan-action@1',
      'calculator@1', 'graph@1', 'table@1', 'solver@1', 'matrix@1',
      'equation-editor@1', 'native-program@1',
      'cable-sync@1', 'qr-output@1', 'shell-core@1',
    ];
    for (const id of published) expect(KNOWN_CAPABILITY_IDS).toContain(id);
  });

  it('adds exactly the four v1 return.* IDs and nothing dispatch-shaped', () => {
    expect(RETURN_CAPABILITY_IDS).toEqual([
      'return.session@1', 'return.scan@1', 'return.cable@1', 'return.qr@1',
    ]);
    for (const id of RETURN_CAPABILITY_IDS) expect(KNOWN_CAPABILITY_IDS).toContain(id);
    expect(KNOWN_CAPABILITY_IDS.some((id) => id.startsWith('action.'))).toBe(false);
  });

  it('recognizes registered IDs, injected custom capabilities, and rejects the rest', () => {
    expect(isRegisteredCapability('reader@1')).toBe(true);
    expect(isRegisteredCapability('made-up@1')).toBe(false);
    expect(isRegisteredCapability('periodic-table@1', { customCapabilities: ['periodic-table@1'] })).toBe(true);
    expect(isRegisteredCapability('not-an-id')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/2_domains/school/surfaces/capabilityRegistry.test.mjs`
Expected: FAIL — cannot resolve `./capabilityRegistry.mjs`.

- [ ] **Step 3: Write the implementation**

```js
// backend/src/2_domains/school/surfaces/capabilityRegistry.mjs
import { parseCapabilityId } from '../catalog/capabilities.mjs';

/**
 * The reviewed inventory of capability IDs this backend recognizes (spec §3).
 * Published IDs are adopted verbatim from their deriving code and are never
 * renamed; return.* are the only IDs v1 introduces. action.* is reserved for
 * the v2 dispatch spec and must not appear here.
 */
export const RETURN_CAPABILITY_IDS = Object.freeze([
  'return.session@1', 'return.scan@1', 'return.cable@1', 'return.qr@1',
]);

export const KNOWN_CAPABILITY_IDS = Object.freeze([
  // Module presentation (capabilityForLearningModule)
  'reader@1', 'examples@1', 'problems@1', 'flashcards@1', 'quiz@1', 'learning-probe@1',
  'activity.matching@1', 'activity.sorting@1', 'activity.sequencing@1',
  'activity.timed-drill@1', 'activity.memory@1',
  // Item response capture (capabilityForQuestionItem)
  'response.choice@1', 'response.text@1', 'response.matching@1',
  'response.region@1', 'response.asset-choice@1',
  // Document blocks (capabilityForLearningDocumentBlock)
  'math@1', 'table-layout@1', 'image@1', 'scan-action@1',
  // Registered native tools (core LearningModuleRegistry)
  'calculator@1', 'graph@1', 'table@1', 'solver@1', 'matrix@1',
  'equation-editor@1', 'native-program@1',
  // Family/channel (TI-86 codec capability lists)
  'cable-sync@1', 'qr-output@1', 'shell-core@1',
  ...RETURN_CAPABILITY_IDS,
]);

const KNOWN = new Set(KNOWN_CAPABILITY_IDS);

export function isRegisteredCapability(id, { customCapabilities = [] } = {}) {
  if (!parseCapabilityId(id)) return false;
  return KNOWN.has(id) || customCapabilities.includes(id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run backend/src/2_domains/school/surfaces/capabilityRegistry.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/school/surfaces/
git commit -m "feat(school): capability registry — published inventory + return.* IDs

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Surface profile validation (domain)

**Files:**
- Create: `backend/src/2_domains/school/surfaces/profileValidation.mjs`
- Test: `backend/src/2_domains/school/surfaces/profileValidation.test.mjs`

**Interfaces:**
- Consumes: `validateCapabilityList` from `../catalog/capabilities.mjs`; `isRegisteredCapability` (Task 1).
- Produces: `validateSurfaceProfile(raw, {customCapabilities?}) => {errors: string[], profile?: object}` with frozen normalized profile `{schema, surfaceId, family, title, liveness, capabilities: string[], limits: object}`. `SURFACE_FAMILIES = ['schoolcalc','paper','screen']`. Tasks 6–10 rely on the normalized shape. The `customCapabilities` list is supplied by callers from the learning-module registry (Task 9 wires it).

- [ ] **Step 1: Write the failing test**

```js
// backend/src/2_domains/school/surfaces/profileValidation.test.mjs
import { describe, expect, it } from 'vitest';
import { validateSurfaceProfile, SURFACE_FAMILIES } from './profileValidation.mjs';

const good = {
  schema: 'school.surface-profile/v1',
  surfaceId: 'paper-letter-mono',
  family: 'paper',
  title: 'Laser worksheets',
  liveness: 'static',
  capabilities: ['reader@1', 'quiz@1', 'response.choice@1', 'return.scan@1'],
  limits: { omrChannels: 12, maxItemsPerSheet: 25, maxPagesPerDocument: 20 },
};

describe('validateSurfaceProfile', () => {
  it('accepts a well-formed profile and freezes the normalized record', () => {
    const { errors, profile } = validateSurfaceProfile(good);
    expect(errors).toEqual([]);
    expect(profile.surfaceId).toBe('paper-letter-mono');
    expect(Object.isFrozen(profile)).toBe(true);
    expect(profile.limits.omrChannels).toBe(12);
  });

  it('rejects wrong schema, bad surfaceId, unknown family, unknown liveness', () => {
    expect(validateSurfaceProfile({ ...good, schema: 'nope/v1' }).errors.join()).toMatch(/schema/);
    expect(validateSurfaceProfile({ ...good, surfaceId: 'Bad_Id' }).errors.join()).toMatch(/surfaceId/);
    expect(validateSurfaceProfile({ ...good, family: 'dispatch' }).errors.join())
      .toMatch(new RegExp(SURFACE_FAMILIES.join('\\|')));
    expect(validateSurfaceProfile({ ...good, liveness: 'live' }).errors.join()).toMatch(/liveness/);
  });

  it('rejects unregistered capability IDs unless injected as custom (spec §3.1/§3.2)', () => {
    const { errors } = validateSurfaceProfile({ ...good, capabilities: ['reader@1', 'hologram@1'] });
    expect(errors.join()).toMatch(/hologram@1/);
    const custom = validateSurfaceProfile(
      { ...good, capabilities: ['reader@1', 'periodic-table@1'] },
      { customCapabilities: ['periodic-table@1'] },
    );
    expect(custom.errors).toEqual([]);
  });

  it('requires a non-empty capability list and a mapping for limits', () => {
    expect(validateSurfaceProfile({ ...good, capabilities: [] }).errors.length).toBeGreaterThan(0);
    expect(validateSurfaceProfile({ ...good, limits: [] }).errors.join()).toMatch(/limits/);
    expect(validateSurfaceProfile({ ...good, limits: undefined }).errors).toEqual([]); // limits optional
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/2_domains/school/surfaces/profileValidation.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
// backend/src/2_domains/school/surfaces/profileValidation.mjs
import { validateCapabilityList } from '../catalog/capabilities.mjs';
import { isRegisteredCapability } from './capabilityRegistry.mjs';

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.trim().length > 0;

export const SURFACE_FAMILIES = Object.freeze(['schoolcalc', 'paper', 'screen']);
const LIVENESS = Object.freeze(['static', 'observed']);

/** Pure validation for school.surface-profile/v1 (spec §4.1). */
export function validateSurfaceProfile(raw, { customCapabilities = [] } = {}) {
  if (!isObject(raw)) return { errors: ['surface profile must be a mapping'] };
  const errors = [];
  if (raw.schema !== 'school.surface-profile/v1') errors.push('schema must be school.surface-profile/v1');
  if (!ID.test(raw.surfaceId || '')) errors.push('surfaceId must be a lowercase identifier');
  if (!SURFACE_FAMILIES.includes(raw.family)) errors.push(`family must be ${SURFACE_FAMILIES.join('|')}`);
  if (!isText(raw.title)) errors.push('title is required');
  if (!LIVENESS.includes(raw.liveness)) errors.push(`liveness must be ${LIVENESS.join('|')}`);

  const list = validateCapabilityList(raw.capabilities, { path: 'capabilities', required: true });
  errors.push(...list.errors);
  for (const id of list.capabilities) {
    if (!isRegisteredCapability(id, { customCapabilities })) {
      errors.push(`capabilities: '${id}' is not a registered capability`);
    }
  }
  if (raw.limits !== undefined && !isObject(raw.limits)) errors.push('limits must be a mapping');

  if (errors.length) return { errors };
  return {
    errors,
    profile: Object.freeze({
      schema: raw.schema, surfaceId: raw.surfaceId, family: raw.family,
      title: raw.title, liveness: raw.liveness,
      capabilities: Object.freeze([...list.capabilities]),
      limits: Object.freeze(structuredClone(raw.limits ?? {})),
    }),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run backend/src/2_domains/school/surfaces/profileValidation.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit** — `git add backend/src/2_domains/school/surfaces/ && git commit -m "feat(school): surface profile validation (school.surface-profile/v1)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 3: Demand derivation (domain)

**Files:**
- Create: `backend/src/2_domains/school/surfaces/demands.mjs`
- Test: `backend/src/2_domains/school/surfaces/demands.test.mjs`

**Interfaces:**
- Consumes (all existing): `capabilityForLearningModule`, `capabilityForQuestionItem` from `../catalog/moduleValidation.mjs`; `capabilityForLearningDocumentBlock` from `../catalog/learningDocumentValidation.mjs`.
- Produces: `TRACKED_MODULE_TYPES: Set<string>` (`quiz`,`problems`,`learning_probe`,`flashcards`,`activity`); `deriveModuleDemands({module, document?, bank?}) => {capabilities: string[], tracked: boolean}`; `deriveBankDemands(bank) => {capabilities: string[], tracked: true}`. Tasks 4, 6, 7, 8, 10 rely on these names.
- **Note on declared `requiredCapabilities` (spec §3.3 item 2):** they are enforced in the **projection** (Task 10), not here. `BuildLearningLesson` folds them into `bundle.capabilities` (line ~64) without preserving them as a distinct field, and the bundle shape cannot change (Global Constraints). The projection reads them from the authored catalog entry and applies `capabilityReasons` lesson-wide. This module stays per-module and pure.

Bundle shapes to know (from `BuildLearningLesson` output): a resolved module carries its own `bank` (`module.bank.items[]`) for bank-backed types and lecture_notes carry `document.blocks[]`. Image-bearing items: an item with an `asset` field, or an item whose choices carry `image`, additionally demands `image@1` (spec §3.3.4).

- [ ] **Step 1: Write the failing test**

```js
// backend/src/2_domains/school/surfaces/demands.test.mjs
import { describe, expect, it } from 'vitest';
import { TRACKED_MODULE_TYPES, deriveModuleDemands, deriveBankDemands } from './demands.mjs';

describe('demand derivation (spec §3.3)', () => {
  it('derives module + item demands for a tracked quiz', () => {
    const { capabilities, tracked } = deriveModuleDemands({
      module: { moduleId: 'check', type: 'quiz', bankId: 'b1' },
      bank: { items: [
        { id: 'q1', type: 'multiple_choice', prompt: 'p', choices: ['a', 'b'], answer: 'a' },
        { id: 'q2', type: 'short_answer', prompt: 'p', answer: 'x' },
      ] },
    });
    expect(capabilities).toContain('quiz@1');
    expect(capabilities).toContain('response.choice@1');
    expect(capabilities).toContain('response.text@1');
    expect(tracked).toBe(true);
  });

  it('derives block demands for lecture notes and marks them untracked', () => {
    const { capabilities, tracked } = deriveModuleDemands({
      module: { moduleId: 'notes', type: 'lecture_notes', documentId: 'd1' },
      document: { blocks: [
        { blockId: 'f', type: 'formula', text: 'x', latex: 'x' },
        { blockId: 't', type: 'table', columns: ['a'], rows: [['1']] },
        { blockId: 'img', type: 'asset', assetId: 'pic', alt: 'a picture' },
        { blockId: 'qr', type: 'scan_action', actionId: 'act', label: 'Go' },
      ] },
    });
    expect(capabilities).toEqual(expect.arrayContaining(['reader@1', 'math@1', 'table-layout@1', 'image@1', 'scan-action@1']));
    expect(tracked).toBe(false);
  });

  it('adds image@1 for image-bearing items and dedupes', () => {
    const { capabilities } = deriveBankDemands({ items: [
      { id: 'q1', type: 'region_click', prompt: 'p', asset: 'map', answer: 'here' },
      { id: 'q2', type: 'asset_choice', prompt: 'p', choices: [{ image: { assetId: 'x' } }], answer: 'x' },
    ] });
    expect(capabilities).toContain('response.region@1');
    expect(capabilities).toContain('response.asset-choice@1');
    expect(capabilities.filter((c) => c === 'image@1')).toHaveLength(1);
  });

  it('falls back to module.bank when no resolved bank is passed', () => {
    const { capabilities } = deriveModuleDemands({
      module: { moduleId: 'm', type: 'quiz', bank: { items: [
        { id: 'q1', type: 'multiple_choice', prompt: 'p', choices: ['a'], answer: 'a' },
      ] } },
    });
    expect(capabilities).toContain('response.choice@1');
  });

  it('tracks exactly the spec §3.3 tracked types', () => {
    expect([...TRACKED_MODULE_TYPES].sort()).toEqual(
      ['activity', 'flashcards', 'learning_probe', 'problems', 'quiz'],
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run backend/src/2_domains/school/surfaces/demands.test.mjs` → FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```js
// backend/src/2_domains/school/surfaces/demands.mjs
import { capabilityForLearningModule, capabilityForQuestionItem } from '../catalog/moduleValidation.mjs';
import { capabilityForLearningDocumentBlock } from '../catalog/learningDocumentValidation.mjs';

export const TRACKED_MODULE_TYPES = Object.freeze(
  new Set(['quiz', 'problems', 'learning_probe', 'flashcards', 'activity']),
);

const itemBearsImage = (item) => item?.asset !== undefined
  || (Array.isArray(item?.choices) && item.choices.some((c) => c && typeof c === 'object' && c.image !== undefined));

function itemDemands(items = []) {
  const out = [];
  for (const item of items) {
    const cap = capabilityForQuestionItem(item);
    if (cap) out.push(cap);
    if (itemBearsImage(item)) out.push('image@1');
  }
  return out;
}

/**
 * A module's demand set (spec §3.3): module capability + block capabilities +
 * item capabilities, deduplicated, plus its tracking class. Pure; the caller
 * supplies the resolved document and bank (ports do no I/O). Declared
 * lesson-level requiredCapabilities are applied by the certification
 * projection, not here (they are lesson-wide and absent from module shapes).
 */
export function deriveModuleDemands({ module, document = null, bank = null }) {
  const caps = [];
  const moduleCap = capabilityForLearningModule(module);
  if (moduleCap) caps.push(moduleCap);
  for (const block of (document ?? module?.document)?.blocks ?? []) {
    const cap = capabilityForLearningDocumentBlock(block);
    if (cap) caps.push(cap);
  }
  caps.push(...itemDemands((bank ?? module?.bank)?.items));
  return { capabilities: [...new Set(caps)], tracked: TRACKED_MODULE_TYPES.has(module?.type) };
}

/** A standalone bank's demand set (spec §7.3): items only, always tracked. */
export function deriveBankDemands(bank) {
  return { capabilities: [...new Set(itemDemands(bank?.items))], tracked: true };
}
```

- [ ] **Step 4: Run test to verify it passes** — same command, expected PASS.
- [ ] **Step 5: Commit** — `git add backend/src/2_domains/school/surfaces/ && git commit -m "feat(school): surface demand derivation from modules, blocks, and bank items" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 4: Verdicts, capability pass, roll-up (domain) + barrel

**Files:**
- Create: `backend/src/2_domains/school/surfaces/verdicts.mjs`, `backend/src/2_domains/school/surfaces/index.mjs`
- Test: `backend/src/2_domains/school/surfaces/verdicts.test.mjs`

**Interfaces:**
- Consumes: `missingCapabilities` from `../catalog/capabilities.mjs`.
- Produces (Tasks 5–10 rely on these):
  - `capabilityReasons(demands, profile) => string[]` — missing-capability reasons (`missing capability <id>`) plus, when `demands.tracked` and the profile offers no `return.*` ID, `tracked module requires a return channel; profile offers none`.
  - `moduleVerdict({moduleId, reasons, warnings?}) => {moduleId, verdict, reasons, warnings}` (`render` iff `reasons.length === 0`).
  - `rollUpLesson(moduleVerdicts, {fullOrNothing = false}) => 'full'|'partial'|'none'` — `fullOrNothing` demotes `partial` to `none` (SchoolCalc tightening, spec §7.2).
  - `index.mjs` barrel re-exporting Tasks 1–4 public names.

- [ ] **Step 1: Write the failing test**

```js
// backend/src/2_domains/school/surfaces/verdicts.test.mjs
import { describe, expect, it } from 'vitest';
import { capabilityReasons, moduleVerdict, rollUpLesson } from './verdicts.mjs';

const paper = { surfaceId: 'p', capabilities: ['quiz@1', 'response.choice@1', 'return.scan@1'] };

describe('verdicts (spec §7)', () => {
  it('reports each missing capability exactly once, by ID', () => {
    const reasons = capabilityReasons(
      { capabilities: ['quiz@1', 'response.text@1', 'image@1'], tracked: true }, paper,
    );
    expect(reasons).toEqual(['missing capability response.text@1', 'missing capability image@1']);
  });

  it('flags a tracked demand set on a surface with no return channel', () => {
    const reasons = capabilityReasons(
      { capabilities: ['quiz@1', 'response.choice@1'], tracked: true },
      { surfaceId: 's', capabilities: ['quiz@1', 'response.choice@1'] },
    );
    expect(reasons.join()).toMatch(/return channel/);
  });

  it('renders iff there are no reasons', () => {
    expect(moduleVerdict({ moduleId: 'm', reasons: [] }).verdict).toBe('render');
    expect(moduleVerdict({ moduleId: 'm', reasons: ['x'] }).verdict).toBe('incompatible');
  });

  it('rolls up full/partial/none, with fullOrNothing demoting partial', () => {
    const r = (v) => ({ moduleId: 'm', verdict: v, reasons: [], warnings: [] });
    expect(rollUpLesson([r('render'), r('render')])).toBe('full');
    expect(rollUpLesson([r('render'), r('incompatible')])).toBe('partial');
    expect(rollUpLesson([r('incompatible')])).toBe('none');
    expect(rollUpLesson([r('render'), r('incompatible')], { fullOrNothing: true })).toBe('none');
    expect(rollUpLesson([r('render')], { fullOrNothing: true })).toBe('full');
  });
});
```

- [ ] **Step 2: Run to verify FAIL**, then **Step 3: implement**:

```js
// backend/src/2_domains/school/surfaces/verdicts.mjs
import { missingCapabilities } from '../catalog/capabilities.mjs';

/** Shared first pass every family port runs (spec §7.1). Pure. */
export function capabilityReasons(demands, profile) {
  const reasons = missingCapabilities(demands.capabilities, profile.capabilities)
    .map((id) => `missing capability ${id}`);
  if (demands.tracked && !profile.capabilities.some((id) => id.startsWith('return.'))) {
    reasons.push('tracked module requires a return channel; profile offers none');
  }
  return reasons;
}

export function moduleVerdict({ moduleId, reasons = [], warnings = [] }) {
  return Object.freeze({
    moduleId,
    verdict: reasons.length === 0 ? 'render' : 'incompatible',
    reasons: Object.freeze([...reasons]),
    warnings: Object.freeze([...warnings]),
  });
}

/** Lesson roll-up (spec §7.2). fullOrNothing is the SchoolCalc tightening. */
export function rollUpLesson(moduleVerdicts, { fullOrNothing = false } = {}) {
  const total = moduleVerdicts.length;
  const rendering = moduleVerdicts.filter(({ verdict }) => verdict === 'render').length;
  if (rendering === total && total > 0) return 'full';
  if (rendering === 0) return 'none';
  return fullOrNothing ? 'none' : 'partial';
}
```

```js
// backend/src/2_domains/school/surfaces/index.mjs
export { KNOWN_CAPABILITY_IDS, RETURN_CAPABILITY_IDS, isRegisteredCapability } from './capabilityRegistry.mjs';
export { validateSurfaceProfile, SURFACE_FAMILIES } from './profileValidation.mjs';
export { TRACKED_MODULE_TYPES, deriveModuleDemands, deriveBankDemands } from './demands.mjs';
export { capabilityReasons, moduleVerdict, rollUpLesson } from './verdicts.mjs';
```

- [ ] **Step 4: Run to verify PASS**, then run the whole domain folder: `npx vitest run backend/src/2_domains/school/` — everything green.
- [ ] **Step 5: Commit** — `git commit -m "feat(school): verdicts, tracked-return rule, lesson roll-up + surfaces barrel" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 5: Shared certification-port contract suite

**Files:**
- Create: `tests/_lib/school/certificationContract.mjs`
- Test (proves the harness on a trivial fake): `tests/isolated/application/certificationContract.selftest.test.mjs`

**Interfaces:**
- Produces: `runCertificationPortContract({ name, makePort, profile, renderableBundle, incompatibleBundle })` — registers a vitest `describe` block asserting, for any port (spec §7.1): (1) verdict shape (modules array parallel to `bundle.lesson.modules`, each `{moduleId, verdict, reasons, warnings}`; lesson verdict ∈ full|partial|none); (2) determinism (two calls, deep-equal results); (3) never-throws on `incompatibleBundle` and returns ≥1 reason; (4) `renderableBundle` yields lesson `full` and zero reasons; (5) `verdict === 'incompatible'` ⇒ `reasons.length > 0`. Tasks 6–8 call this against their real ports.
- Consumes: nothing from production code (bundles/profiles are supplied by callers).

Note: `tests/isolated/**` specs run under vitest, not jest — invoke with `npx vitest run <path>`.

- [ ] **Step 1: Write the harness and a self-test with a minimal fake port**

```js
// tests/_lib/school/certificationContract.mjs
import { describe, expect, it } from 'vitest';

/**
 * Contract every surface-family certification port must satisfy (spec §7.1).
 * Ports are pure: certify(bundle, profile) with no I/O, no throw for
 * unsupported content, deterministic output.
 */
export function runCertificationPortContract({ name, makePort, profile, renderableBundle, incompatibleBundle }) {
  describe(`certification port contract: ${name}`, () => {
    it('returns one verdict per module, in module order, with the required shape', () => {
      const result = makePort().certify(renderableBundle, profile);
      expect(result.modules.map((m) => m.moduleId))
        .toEqual(renderableBundle.lesson.modules.map((m) => m.moduleId));
      for (const entry of result.modules) {
        expect(['render', 'incompatible']).toContain(entry.verdict);
        expect(Array.isArray(entry.reasons)).toBe(true);
        expect(Array.isArray(entry.warnings)).toBe(true);
      }
      expect(['full', 'partial', 'none']).toContain(result.lesson.verdict);
    });

    it('is deterministic', () => {
      const port = makePort();
      expect(port.certify(renderableBundle, profile)).toEqual(port.certify(renderableBundle, profile));
    });

    it('certifies the renderable bundle full with no reasons', () => {
      const result = makePort().certify(renderableBundle, profile);
      expect(result.lesson.verdict).toBe('full');
      expect(result.modules.flatMap((m) => m.reasons)).toEqual([]);
    });

    it('never throws for unsupported content; returns reasons instead', () => {
      const result = makePort().certify(incompatibleBundle, profile);
      expect(result.lesson.verdict).not.toBe('full');
      const incompatible = result.modules.filter((m) => m.verdict === 'incompatible');
      expect(incompatible.length).toBeGreaterThan(0);
      for (const entry of incompatible) expect(entry.reasons.length).toBeGreaterThan(0);
    });
  });
}
```

```js
// tests/isolated/application/certificationContract.selftest.test.mjs
import { runCertificationPortContract } from '../../_lib/school/certificationContract.mjs';
import { deriveModuleDemands, capabilityReasons, moduleVerdict, rollUpLesson }
  from '../../../backend/src/2_domains/school/surfaces/index.mjs';

const fakePort = () => ({
  certify(bundle, profile) {
    const modules = bundle.lesson.modules.map((module) => moduleVerdict({
      moduleId: module.moduleId,
      reasons: capabilityReasons(deriveModuleDemands({ module }), profile),
    }));
    return { modules, lesson: { verdict: rollUpLesson(modules) } };
  },
});

runCertificationPortContract({
  name: 'domain-primitives fake',
  makePort: fakePort,
  profile: { surfaceId: 'fake', capabilities: ['reader@1'] },
  renderableBundle: { lesson: { modules: [{ moduleId: 'notes', type: 'lecture_notes', documentId: 'd' }] } },
  incompatibleBundle: { lesson: { modules: [{ moduleId: 'g', type: 'tool', capability: 'graph@1', config: {} }] } },
});
```

- [ ] **Step 2: Run** `npx vitest run tests/isolated/application/certificationContract.selftest.test.mjs` — expect PASS (the fake satisfies the contract; if it fails, the harness or domain primitives are wrong — fix before proceeding).
- [ ] **Step 3: Commit** — `git commit -m "test(school): shared certification-port contract suite + self-test" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 6: Calculator certification port (wraps the TI-86 codec)

**Files:**
- Create: `backend/src/1_adapters/schoolcalc/ti86/Ti86SurfaceCertification.mjs`
- Test: `backend/src/1_adapters/schoolcalc/ti86/Ti86SurfaceCertification.test.mjs`
- Do NOT modify `Ti86SchoolCalcCodec.mjs` (golden digests must stay green).

**Interfaces:**
- Consumes: `Ti86SchoolCalcCodec` (existing: `supports(bundle, capabilityReport)`, `compile(bundle, capabilityReport)`, exported `TI86_SCHOOLCALC_CODEC_CAPABILITIES`, `TI86_SCHOOLCALC_LIMITS`); `deriveModuleDemands`, `moduleVerdict`, `rollUpLesson` from `#domains/school/surfaces/index.mjs`.
- Produces:
  - `class Ti86SurfaceCertification { constructor({codec}) ; certify(bundle, profile) }` — spec §7.1 calculator port. `profile.capabilities` is translated to the codec's capability-report shape `{platformId: 'ti86', capabilities: profile.capabilities.filter((id) => !id.startsWith('return.')), limits: {maxArtifactBytes: profile.limits?.maxArtifactBytes}}` (strip undefined limits; codec default applies).
  - `ti86CodecBaselineProfile() => profile` — a frozen `school.surface-profile/v1`-shaped record: `surfaceId: 'ti86-codec-baseline'`, `family: 'schoolcalc'`, `liveness: 'observed'`, capabilities = `TI86_SCHOOLCALC_CODEC_CAPABILITIES` **plus** `return.cable@1`, `return.qr@1` (the family's return channels, spec §3.2/§6.2). Tasks 9/12 use this for CLI certification with `baseline: 'codec'` labeling.
- Semantics (spec §6.2/§7.1):
  1. Run `codec.supports(bundle, report)`.
  2. **Tracked-return rule (spec §3.3 item 5 — the calculator port must implement it too):** for each module, if `deriveModuleDemands({module}).tracked` and the *profile* (pre-strip) offers no `return.*` capability, add reason `tracked module requires a return channel; profile offers none`.
  3. If supports() is compatible and no tracked-return reasons, attempt `codec.compile(bundle, report)` in try/catch — a compile throw (byte ceiling) becomes an `incompatible` reason (verbatim `error.message`), never an exception. On success, `resource = {estimatedBytes: compiled.byteLength, limitsApplied: {hardCeilingBytes: TI86_SCHOOLCALC_LIMITS.lessonMaxBytes, targetBytes: TI86_SCHOOLCALC_LIMITS.lessonTargetBytes}}`; compile `warnings` pass through onto every module's `warnings`.
  4. **Reason-to-module attribution:** codec reasons are formatted `` `module ${index} …` `` (see `ti86ProjectionReasons` — the string is `module 0 …`, NOT `modules[0]`). Match `/^module (\d+)\b/`; a matching reason attaches only to `bundle.lesson.modules[index]`; all non-matching reasons (schema, byte ceiling, capability misses) attach to every module.
  5. **Whole-lesson policy:** any reason anywhere ⇒ `rollUpLesson(..., {fullOrNothing: true})`.

- [ ] **Step 1: Write the failing test.** Copy the `const bundle` fixture **verbatim from `backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.test.mjs` (top of file, ~line 27)** as `renderableBundle`:

```js
// backend/src/1_adapters/schoolcalc/ti86/Ti86SurfaceCertification.test.mjs
import { describe, expect, it } from 'vitest';
import { Ti86SchoolCalcCodec } from './Ti86SchoolCalcCodec.mjs';
import { Ti86SurfaceCertification, ti86CodecBaselineProfile } from './Ti86SurfaceCertification.mjs';
import { runCertificationPortContract } from '../../../../../tests/_lib/school/certificationContract.mjs';

const renderableBundle = /* paste `bundle` from Ti86SchoolCalcCodec.test.mjs verbatim */;

const oversizedBundle = structuredClone(renderableBundle);
oversizedBundle.lesson.modules = [{
  moduleId: 'notes', type: 'lecture_notes',
  document: { blocks: Array.from({ length: 400 }, (_, i) => ({
    blockId: `p${i}`, type: 'prose', text: `Filler paragraph ${i} `.repeat(10),
  })) },
}];

const makePort = () => new Ti86SurfaceCertification({ codec: new Ti86SchoolCalcCodec() });

runCertificationPortContract({
  name: 'ti86',
  makePort,
  profile: ti86CodecBaselineProfile(),
  renderableBundle,
  incompatibleBundle: oversizedBundle,
});

describe('Ti86SurfaceCertification specifics', () => {
  it('surfaces the compile-time byte ceiling as a reason, not a throw (spec §6.2)', () => {
    const result = makePort().certify(oversizedBundle, ti86CodecBaselineProfile());
    expect(result.lesson.verdict).toBe('none'); // fullOrNothing
    expect(result.modules[0].reasons.join()).toMatch(/bytes/);
  });

  it('agrees with supports() reasons for capability misses', () => {
    const bundle = structuredClone(renderableBundle);
    bundle.capabilities = [...(bundle.capabilities ?? []), 'image@1'];
    const port = makePort();
    const supports = new Ti86SchoolCalcCodec().supports(bundle);
    const certified = port.certify(bundle, ti86CodecBaselineProfile());
    expect(supports.compatible).toBe(false);
    for (const reason of supports.reasons) {
      expect(certified.modules.flatMap((m) => m.reasons)).toContain(reason);
    }
  });

  it('attributes `module <i>` reasons only to that module', () => {
    // Two modules; make the SECOND one invalid for TI-86 projection (an asset
    // block, which the reader cannot project) so the codec emits a
    // `module 1 …` reason. The first module must stay clean of it.
    const bundle = structuredClone(renderableBundle);
    bundle.lesson.modules = [
      renderableBundle.lesson.modules[0],
      { moduleId: 'notes2', type: 'lecture_notes',
        document: { blocks: [{ blockId: 'a', type: 'asset', assetId: 'pic', alt: 'x' }] } },
    ];
    const result = makePort().certify(bundle, ti86CodecBaselineProfile());
    const moduleScoped = result.modules[1].reasons.filter((r) => /^module 1\b/.test(r));
    expect(moduleScoped.length).toBeGreaterThan(0);
    expect(result.modules[0].reasons.filter((r) => /^module 1\b/.test(r))).toEqual([]);
  });

  it('rejects tracked work when the profile offers no return channel', () => {
    const base = ti86CodecBaselineProfile();
    const noReturn = { ...base, capabilities: base.capabilities.filter((c) => !c.startsWith('return.')) };
    const result = makePort().certify(renderableBundle, noReturn);
    expect(result.lesson.verdict).toBe('none');
    expect(result.modules.flatMap((m) => m.reasons).join()).toMatch(/return channel/);
  });

  it('reports resource bytes for a compilable lesson', () => {
    const { resource } = makePort().certify(renderableBundle, ti86CodecBaselineProfile());
    expect(resource.estimatedBytes).toBeGreaterThan(0);
    expect(resource.limitsApplied.hardCeilingBytes).toBe(12288);
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `npx vitest run backend/src/1_adapters/schoolcalc/ti86/Ti86SurfaceCertification.test.mjs`.
- [ ] **Step 3: Implement** `Ti86SurfaceCertification.mjs` per the five-point semantics above (~90 lines).
- [ ] **Step 4: Run to verify PASS**, then run the *entire* existing codec suite untouched: `npx vitest run backend/src/1_adapters/schoolcalc/` — the golden byte digests must still pass (Global Constraint).
- [ ] **Step 5: Commit** — `git commit -m "feat(schoolcalc): TI-86 certification port wrapping supports()+compile byte ceiling" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 7: Paper certification port

**Files:**
- Create: `backend/src/1_adapters/school/paper/PaperCertification.mjs`
- Test: `backend/src/1_adapters/school/paper/PaperCertification.test.mjs`

**Interfaces:**
- Consumes: `deriveModuleDemands`, `deriveBankDemands`, `capabilityReasons`, `moduleVerdict`, `rollUpLesson` — import from `#domains/school/surfaces/index.mjs` (the `#domains` alias is defined in package.json `imports`; other adapters use it, e.g. the codec imports `#domains/core/errors/index.mjs`).
- Produces:
  - `class PaperCertification { certify(bundle, profile); certifyBank(bank, profile) }`. `certifyBank` returns `{verdict: 'render'|'incompatible', reasons, warnings}` for a standalone bank (spec §7.3).
  - Rules implemented (spec §6.3), on top of the shared `capabilityReasons` pass:
    - module types `tool`, `custom`, `activity`, `learning_probe` → reason `<type> modules do not render on paper`.
    - for choice items (`multiple_choice`/`asset_choice`): `choices.length > profile.limits.omrChannels` → reason naming the item id and the limit; any choice lacking printable text (a non-empty string, or an object with non-empty `label`) → reason naming the item id.
    - bank/module item count > `profile.limits.maxItemsPerSheet` → reason naming the limit.
    - lecture_notes documents estimated pages > `profile.limits.maxPagesPerDocument` → reason naming the limit (estimate: `Math.ceil(blocks.length / 12)` — 12 blocks/page is the v1 heuristic, stated in a comment; the paper renderer refines it later without changing this port's contract).
    - non-choice response demands are already covered by `capabilityReasons` (a paper profile omits `response.text@1` etc. — the test proves the item-level miss reads correctly).

- [ ] **Step 1: Write the failing test**

```js
// backend/src/1_adapters/school/paper/PaperCertification.test.mjs
import { describe, expect, it } from 'vitest';
import { PaperCertification } from './PaperCertification.mjs';
import { runCertificationPortContract } from '../../../../../tests/_lib/school/certificationContract.mjs';

export const paperProfile = {
  surfaceId: 'paper-letter-mono', family: 'paper', liveness: 'static',
  capabilities: [
    'reader@1', 'examples@1', 'quiz@1', 'problems@1', 'flashcards@1',
    'image@1', 'math@1', 'table-layout@1', 'scan-action@1',
    'response.choice@1', 'response.asset-choice@1', 'return.scan@1',
  ],
  limits: { omrChannels: 12, maxItemsPerSheet: 25, maxPagesPerDocument: 20 },
};

export const choiceBank = { id: 'b1', items: [
  { id: 'q1', type: 'multiple_choice', prompt: 'p', choices: ['a', 'b', 'c'], answer: 'a' },
] };
const textBank = { id: 'b2', items: [
  { id: 'q1', type: 'short_answer', prompt: 'p', answer: 'x' },
] };

export const renderableBundle = { lesson: { modules: [
  { moduleId: 'notes', type: 'lecture_notes', document: { blocks: [{ blockId: 'p', type: 'prose', text: 't' }] } },
  { moduleId: 'check', type: 'quiz', bank: choiceBank },
] } };
const incompatibleBundle = { lesson: { modules: [
  { moduleId: 'probe', type: 'learning_probe', bank: choiceBank },
] } };

runCertificationPortContract({
  name: 'paper', makePort: () => new PaperCertification(),
  profile: paperProfile, renderableBundle, incompatibleBundle,
});

describe('PaperCertification specifics (spec §6.3)', () => {
  const port = new PaperCertification();

  it('disqualifies a text-answer quiz with an item-level capability reason', () => {
    const result = port.certify({ lesson: { modules: [{ moduleId: 'q', type: 'quiz', bank: textBank }] } }, paperProfile);
    expect(result.modules[0].verdict).toBe('incompatible');
    expect(result.modules[0].reasons.join()).toMatch(/response\.text@1/);
  });

  it('disqualifies a choice item exceeding the OMR channel count, naming the item', () => {
    const wide = { id: 'b3', items: [{ id: 'q9', type: 'multiple_choice', prompt: 'p', choices: Array.from({ length: 13 }, (_, i) => `c${i}`), answer: 'c0' }] };
    const bank = port.certifyBank(wide, paperProfile);
    expect(bank.verdict).toBe('incompatible');
    expect(bank.reasons.join()).toMatch(/q9/);
    expect(bank.reasons.join()).toMatch(/12/);
  });

  it('certifies a conforming choice bank render', () => {
    expect(port.certifyBank(choiceBank, paperProfile).verdict).toBe('render');
  });

  it('rejects interactive module types with a stated reason', () => {
    const result = port.certify(incompatibleBundle, paperProfile);
    expect(result.modules[0].reasons.join()).toMatch(/do not render on paper/);
  });

  it('enforces sheet and page budgets', () => {
    const bigBank = { id: 'b4', items: Array.from({ length: 26 }, (_, i) => ({ id: `q${i}`, type: 'multiple_choice', prompt: 'p', choices: ['a', 'b'], answer: 'a' })) };
    expect(port.certifyBank(bigBank, paperProfile).reasons.join()).toMatch(/25/);
    const longDoc = { lesson: { modules: [{ moduleId: 'n', type: 'lecture_notes', document: { blocks: Array.from({ length: 12 * 21 }, (_, i) => ({ blockId: `b${i}`, type: 'prose', text: 't' })) } }] } };
    expect(port.certify(longDoc, paperProfile).modules[0].reasons.join()).toMatch(/20/);
  });
});
```

(The `export`ed fixtures — `paperProfile`, `choiceBank`, `renderableBundle` — are deliberately importable: Tasks 8 and 10 reuse them by importing from this test file.)

- [ ] **Step 2: Run to verify FAIL.**
- [ ] **Step 3: Implement** `PaperCertification.mjs` (~90 lines) per the rules block above; every rule adds a `reasons` string, then `moduleVerdict`/`rollUpLesson` assemble the result. `certifyBank` = shared capability pass over `deriveBankDemands(bank)` + channel/label/sheet checks.
- [ ] **Step 4: Run to verify PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(school): paper certification port (OMR capture, geometry, budgets)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 8: Screen certification port

**Files:**
- Create: `backend/src/1_adapters/school/screen/ScreenCertification.mjs`
- Test: `backend/src/1_adapters/school/screen/ScreenCertification.test.mjs`

**Interfaces:**
- Consumes: `deriveModuleDemands`, `deriveBankDemands`, `capabilityReasons`, `moduleVerdict`, `rollUpLesson` from `#domains/school/surfaces/index.mjs`.
- Produces: `class ScreenCertification { certify(bundle, profile); certifyBank(bank, profile) }`. Screen rules (spec §6.4) are *purely capability-driven* — no structural limits in v1. **Return rule is stricter than the generic class rule:** tracked modules require `return.session@1` specifically (reason: `tracked module requires return.session@1 on a screen`). Implement by calling `capabilityReasons` with `{...demands, tracked: false}` and then adding the screen-specific reason when `demands.tracked` and `!profile.capabilities.includes('return.session@1')`.

- [ ] **Step 1: Write the complete failing test**

```js
// backend/src/1_adapters/school/screen/ScreenCertification.test.mjs
import { describe, expect, it } from 'vitest';
import { ScreenCertification } from './ScreenCertification.mjs';
import { runCertificationPortContract } from '../../../../../tests/_lib/school/certificationContract.mjs';
// Fixtures are shared from the paper port's test file (created in Task 7):
import { renderableBundle } from '../paper/PaperCertification.test.mjs';

const screenProfile = {
  surfaceId: 'screen-office', family: 'screen', liveness: 'static',
  capabilities: [
    'reader@1', 'examples@1', 'problems@1', 'flashcards@1', 'quiz@1', 'learning-probe@1',
    'activity.matching@1', 'calculator@1', 'graph@1',
    'image@1', 'math@1', 'table-layout@1', 'scan-action@1',
    'response.choice@1', 'response.text@1', 'response.matching@1',
    'response.region@1', 'response.asset-choice@1',
    'return.session@1',
  ],
  limits: {},
};

const incompatibleBundle = { lesson: { modules: [
  // solver@1 is a registered tool capability this profile does not offer.
  { moduleId: 'solve', type: 'tool', capability: 'solver@1', config: {} },
] } };

runCertificationPortContract({
  name: 'screen', makePort: () => new ScreenCertification(),
  profile: screenProfile, renderableBundle, incompatibleBundle,
});

describe('ScreenCertification specifics (spec §6.4)', () => {
  const port = new ScreenCertification();

  it('demotes region_click items on a pointer-less profile', () => {
    const remoteOnly = { ...screenProfile, capabilities: screenProfile.capabilities.filter((c) => c !== 'response.region@1') };
    const bank = { id: 'b', items: [{ id: 'q1', type: 'region_click', prompt: 'p', asset: 'map', answer: 'x' }] };
    const result = port.certify({ lesson: { modules: [{ moduleId: 'm', type: 'quiz', bank }] } }, remoteOnly);
    expect(result.modules[0].reasons.join()).toMatch(/response\.region@1/);
  });

  it('requires return.session@1 for tracked modules', () => {
    const noReturn = { ...screenProfile, capabilities: screenProfile.capabilities.filter((c) => !c.startsWith('return.')) };
    const result = port.certify(renderableBundle, noReturn);
    expect(result.modules.find((m) => m.moduleId === 'check').reasons.join()).toMatch(/return\.session@1/);
    expect(result.modules.find((m) => m.moduleId === 'notes').verdict).toBe('render');
  });

  it('certifies a standalone bank against the profile', () => {
    const bank = { id: 'b', items: [{ id: 'q1', type: 'short_answer', prompt: 'p', answer: 'x' }] };
    expect(port.certifyBank(bank, screenProfile).verdict).toBe('render');
    const noText = { ...screenProfile, capabilities: screenProfile.capabilities.filter((c) => c !== 'response.text@1') };
    expect(port.certifyBank(bank, noText).verdict).toBe('incompatible');
  });
});
```

- [ ] **Step 2: Run to verify FAIL → Step 3: implement (~50 lines) → Step 4: PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(school): screen certification port (capability + session-return checks)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 9: Surface profile repository + registry (application)

**Files:**
- Create: `backend/src/1_adapters/school/catalog/YamlSurfaceProfileRepository.mjs`, `backend/src/3_applications/school/surfaces/SurfaceRegistry.mjs`
- Test: `backend/src/3_applications/school/surfaces/SurfaceRegistry.test.mjs`

**Interfaces:**
- Consumes: `validateSurfaceProfile` (Task 2); the three ports (Tasks 6–8); js-yaml + `node:fs` directory listing (mirror the directory-walk style of `backend/src/1_adapters/school/catalog/YamlLearningCatalogRepository.mjs` — read it for the error/listing conventions, but import domain code via `#domains/school/surfaces/index.mjs`).
- Produces:
  - `YamlSurfaceProfileRepository({directory, customCapabilities = []})` with `async listProfiles() => Array<{profile?, errors, file}>` — parses every `<directory>/*.yml` through `validateSurfaceProfile(raw, {customCapabilities})`; invalid files are returned with their errors, never silently skipped.
  - `class SurfaceRegistry { constructor({profiles, ports}) ; list() ; get(surfaceId) ; portFor(profile) ; codecBaselines() }` where `ports` = `{schoolcalc, paper, screen}` instances. `portFor` throws on an unknown family (malformed input, spec §7.1). `codecBaselines()` returns `[{profile: ti86CodecBaselineProfile(), baseline: 'codec'}]` (import from Task 6) so the CLI certifies calculators without a device (spec §6.2).
- **`customCapabilities` supplier (review finding 11):** the composition (`backend/src/5_composition/modules/schoolCatalog.mjs`) builds `moduleRegistry = createCoreLearningModuleRegistry()`; its `.list()` returns `[{capability, kind, …}]`. Callers construct the repository with `customCapabilities: moduleRegistry.list().map((d) => d.capability)` — harmless duplicates with the known inventory, and injected custom definitions validate correctly. State this in the repository's JSDoc; Tasks 12/13 wire it.
- Wiring note for the executor: the registry is *constructed* by callers (Task 10's projection, Task 12's CLI, Task 13's router) — there is no singleton. Static profiles load from `<contentRoot>/surfaces/` where `contentRoot` is the same school content root the catalog composition resolves (see `schoolCatalog.mjs` `contentRoot` and `resolveDirectoryList`).

- [ ] **Step 1: Write the failing test** — temp-dir fixture (use `fs.mkdtempSync(path.join(os.tmpdir(), 'surfaces-'))`) with two valid profiles (the paper + screen fixtures from Tasks 7–8, written as YAML) and one invalid file (`bad.yml` with `family: dispatch`); assert: `listProfiles()` returns 3 entries (2 with `profile`, 1 with `errors`); `SurfaceRegistry.list()` exposes only the valid 2; `get('paper-letter-mono')` works; `portFor({family:'paper'})` returns the paper port instance; unknown family throws; `codecBaselines()[0].profile.surfaceId === 'ti86-codec-baseline'` and `codecBaselines()[0].baseline === 'codec'`; a profile using an injected custom capability validates when `customCapabilities` is passed.
- [ ] **Step 2: FAIL → Step 3: implement → Step 4: PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(school): surface profile repository + registry with codec baselines" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 10: Certification projection (application)

**Files:**
- Create: `backend/src/3_applications/school/surfaces/GetSurfaceCertification.mjs`
- Test: `backend/src/3_applications/school/surfaces/GetSurfaceCertification.test.mjs`

**Interfaces:**
- Consumes: `BuildLearningLesson` (existing — `execute({catalogId, subjectId, courseId, unitId, lessonId})` returns the neutral bundle); `SurfaceRegistry` (Task 9); a catalogs repo (`getCatalog(catalogId)`) and `findCatalogLesson` from `#domains/school/catalog/index.mjs` for declared requirements; a banks source (`getBank(bankId)` — same reader `BuildLearningLesson`'s content repo exposes); `capabilityReasons` from `#domains/school/surfaces/index.mjs`; `node:crypto` `createHash('sha256')`.
- Produces: `class GetSurfaceCertification { constructor({buildLesson, catalogs, banks, registry}) ; async lesson(address) ; async bank(bankId) }` where both return matrix rows `[{address, surfaceId, baseline?, verdict, reasons, warnings, resource?, moduleVerdicts, contentDigest, profileDigest}]` — one row per registered profile + each codec baseline. `address` is the 5-segment string `catalogId/subjectId/courseId/unitId/lessonId`; bank rows use `address: 'bank:<bankId>'` and `moduleVerdicts: null`.
- **Declared `requiredCapabilities` (spec §3.3 item 2 — review finding 1):** after the port runs, the projection reads the *authored* lesson entry (`findCatalogLesson(await catalogs.getCatalog(catalogId), {subjectId, courseId, unitId, lessonId})` — same lookup `BuildLearningLesson` uses) and computes `capabilityReasons({capabilities: entry.lesson.requiredCapabilities ?? [], tracked: false}, profile)`. Any reasons are appended to **every** module verdict (a declared lesson requirement is lesson-wide) and the lesson verdict is recomputed with the family's roll-up. The bundle itself is never modified (Global Constraints — digests).
- Digests: implement a local `digest(value)` — sha256 hex over JSON.stringify with recursively sorted object keys (~10 lines). `canonicalJson` in the codec is exported, but importing an adapter from the application layer inverts the dependency direction — copy the sorted-key pattern instead, for layering.
- Caching: in-memory Map keyed `(contentDigest, profileDigest)`; the digests ride on each row for Task 11's manifest.

- [ ] **Step 1: Write the failing test** — fakes only (no filesystem): a `buildLesson` fake returning `renderableBundle` (import it from `backend/src/1_adapters/school/paper/PaperCertification.test.mjs`) for address `main/sci/wc/wm/evap`; a `catalogs` fake whose `getCatalog` returns a minimal authored catalog where that lesson entry exists (needed by `findCatalogLesson` — mirror the nesting: `{subjects:[{subjectId:'sci', courses:[{courseId:'wc', units:[{unitId:'wm', lessons:[{lessonId:'evap', title:'t', modules:[…], requiredCapabilities: […]}]}]}]}]}`); a `banks` fake; a registry with the real paper + screen ports and a stub schoolcalc port. Assert:
  - (a) `lesson()` returns one row per profile + one `baseline: 'codec'` row;
  - (b) paper row verdict `full`, screen row `full` (empty `requiredCapabilities`);
  - (c) with `requiredCapabilities: ['native-program@1']` in the authored entry, the paper row becomes `none`/`partial`-appropriate with `missing capability native-program@1` on **every** module verdict (finding 1 regression test);
  - (d) calling `lesson()` twice invokes `buildLesson.execute` once (cache hit — count with a wrapper); a changed bundle (new digest) re-certifies;
  - (e) `bank('b1')` produces rows via each port's `certifyBank` with `address: 'bank:b1'`, `moduleVerdicts: null`.
- [ ] **Step 2: FAIL → Step 3: implement (~120 lines) → Step 4: PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(school): surface certification projection — matrix, declared requirements, digest cache" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 11: Certification manifest (persistence)

**Files:**
- Create: `backend/src/3_applications/school/surfaces/certificationManifest.mjs`
- Test: `backend/src/3_applications/school/surfaces/certificationManifest.test.mjs`

**Interfaces:**
- Produces: `writeManifest({rows, path, fs?})` and `readManifest({path, fs?})`. Manifest is JSON: `{schema: 'school.certification-manifest/v1', entries: {"<contentDigest>:<profileDigest>": {address, surfaceId, baseline?, verdict, reasons, warnings, resource?}}}` — the entry shape mirrors Task 10's rows minus `moduleVerdicts`/digests (keys carry the digests). Bank rows (`address: 'bank:<id>'`) are ordinary entries. Written with recursively sorted keys and trailing newline so identical input ⇒ identical bytes (spec §8 determinism, acceptance §12.6). `readManifest` returns `{schema, entries: {}}` on missing file (spec §7.3: degrade to on-demand, never fail).
- Manifest location (used by Tasks 12/13): `<contentRoot>/certification-manifest.json` (generated, alongside `ti86-packs/` which is already generated-not-authored).

- [ ] **Step 1: Test:** round-trip via injected fs stub (plain object with `writeFileSync`/`readFileSync`/`existsSync`); byte-identical output across two writes of the same rows in different array order; a bank row and a `baseline: 'codec'` row survive the round-trip with those fields intact; missing-file read returns empty entries.
- [ ] **Step 2: FAIL → Step 3: implement (sorted-key serializer ~40 lines) → Step 4: PASS → Step 5: Commit** — `git commit -m "feat(school): deterministic certification manifest read/write" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 12: `school:certify` CLI

**Files:**
- Read first: `cli/schoolcalc-catalog.cli.mjs` (the corpus walk, `resolveSchoolCalcContentPaths` at ~line 74, and `ValidateSchoolCalcPublication` invocation) and `cli/schoolcalc-catalog.cli.test.mjs` (**the vitest exemplar** — tests exported functions against tmp dirs; do NOT copy `cli/backfill-media-durations.test.mjs`, which is `node:test`, not vitest).
- Create: `cli/school-certify.cli.mjs`
- Modify: `package.json` (add script `"school:certify": "node cli/school-certify.cli.mjs"`)
- Test: `cli/school-certify.cli.test.mjs`

**Interfaces:**
- Consumes: Tasks 9–11; the existing validation walk — reuse `ValidateSchoolCalcPublication` and the content-path resolution from `cli/schoolcalc-catalog.cli.mjs`. **Content root resolves from `--data-dir` flag / `$DAYLIGHT_BASE_PATH` env with the `content/school/catalog` default** (that is what `resolveSchoolCalcContentPaths` does — there is no config-service lookup here).
- Produces: `export async function runCertify(argv, deps) => {exitCode, report}` plus a thin bin entry that prints and `process.exit`s. `deps` carries injected constructors/paths for testability. Behavior per spec §8:
  - **Gate mode** (no `--surface`/`--address`/`--file`): validation pass first (schema + references, aggregated); on errors exit 1, nothing certified. Then certify **lessons AND every question bank** (walk `catalog/question-banks/*.yml` through `projection.bank()` — spec §7.3, review finding 9) against all static profiles + codec baselines; print table + warnings (including the certified-nowhere list); exit 0. `--write-manifest` additionally writes Task 11's manifest to `<contentRoot>/certification-manifest.json`.
  - **Asset-existence validation (spec §5.5.2 — this is part of THIS task's deliverable, review finding 4):** during the validation pass, resolve every document `asset` block `assetId` and every bank item `asset` reference to a real file under `<contentRoot>/assets/`; each missing file is a reference error (gate-mode exit 1), formatted like the existing dangling-reference errors.
  - **Query mode** (`--surface <id>` / `--address <addr>` / `--file <path>`): exit 0 whenever certification ran, whatever the verdicts ("`none` on TI-86" is an *answer*); exit 1 only for schema/reference errors in scope.
  - `--json`: emit the row array as JSON lines, sorted by (address, surfaceId), byte-stable.
- [ ] **Step 1: Write failing tests** (vitest, tmp-dir corpus fixtures modeled on `schoolcalc-catalog.cli.test.mjs`): (a) gate-mode exit 1 on a schema error; (b) gate-mode exit 1 on a dangling `assetId` (fixture document referencing `assets/missing.svg`); (c) gate-mode exit 0 with a certified-nowhere warning in `report.warnings`; (d) gate mode certifies banks — a `question-banks/b1.yml` fixture appears as `bank:b1` rows; (e) query-mode `--surface ti86-codec-baseline` exit 0 with verdict rows present; (f) `--json` output sorted and byte-identical across two runs; (g) `--write-manifest` writes the Task 11 file.
- [ ] **Step 2: FAIL → Step 3: implement → Step 4: PASS → Step 5: Commit** — `git commit -m "feat(school): school:certify CLI — modal gate/query exits, banks, asset validation, --json, --write-manifest" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 13: API — certification + screen-profile resolution

**Files:**
- Read first: `backend/src/4_api/v1/routers/school.mjs` (DI style: `createSchoolRouter({...services, logger})`, the `wrap()` error mapper), `backend/src/4_api/v1/routers/school.progress.test.mjs` (router test style), `backend/src/4_api/v1/routers/screens.mjs` (how screen configs are served — reuse its config access for resolution).
- Modify: `backend/src/4_api/v1/routers/school.mjs` (new DI params: `surfaceCertification = null`, `surfaceRegistry = null`, `getScreenConfig = null`), plus the composition site that builds the school router (find it: `grep -rn "createSchoolRouter(" backend/src/5_composition backend/src/4_api`).
- Test: `backend/src/4_api/v1/routers/school.certification.test.mjs`

**Interfaces (spec §4.2, §9):**
- `GET /api/v1/school/certification?address=<a>` / `?bank=<id>`, optional `&surface=<surfaceId>` — returns Task 10's rows (filtered when `surface` given); 400 malformed query, 404 unknown address/bank.
- `GET /api/v1/school/surfaces/profile?screen=<screenId>` — **screen-config key (review finding 3):** a screen's config YAML (`data/household/screens/<screenId>.yml`, served today by `screens.mjs`) gains one optional top-level key `surfaceProfile: <surfaceId>`. The handler resolves: `getScreenConfig(screenId)` → its `surfaceProfile` value → `surfaceRegistry.get(surfaceId)`. `?screen=browser` (or the param absent) skips screen config and resolves the fixed id `screen-browser` from the registry. Any miss along the chain (no config, no `surfaceProfile` key, unknown surfaceId) ⇒ **404 `{error: 'surface-profile-unresolved'}`** + `logger.warn` — never a synthesized default (fail closed).
- Document the new key with one sentence in `docs/reference/school/README.md` (screens section) as part of this task.
- [ ] **Steps:** failing router tests (screenId happy path via a `getScreenConfig` fake returning `{surfaceProfile: 'screen-office'}`; `browser` default; each fail-closed 404 variant; certification rows for a fixture lesson; 400/404 cases) → implement → pass → wire the composition site → commit `feat(school): certification + surface-profile resolution endpoints`.

---

### Task 14: Screen app consumes certification

**Files:**
- Create: `frontend/src/modules/School/catalog/certification.js`, `frontend/src/modules/School/catalog/certification.test.js`
- Modify: `frontend/src/modules/School/schoolApi.js`, `frontend/src/modules/School/SchoolApp.jsx`, `frontend/src/modules/School/catalog/LearningCatalogBrowser.jsx`
- **Existing tests that WILL need their schoolApi mocks extended (review finding 10):** `frontend/src/modules/School/SchoolApp.test.jsx`, `SchoolApp.launch.test.jsx`, `SchoolApp.geo.test.jsx` — add the two new schoolApi methods to their mocks with benign defaults (`surfaceProfile: async () => ({ok: false})`, `certification: async () => ({ok: true, data: []})`; an `ok:false` profile means launches stay gated only for catalog learning modules, and those suites drive banks/geo, not catalog modules — they must stay green).

**Step A (pure helper, TDD):**
- [ ] Failing test for `buildVerdictMap(rows)` (rows for ONE surface → `Map(moduleId -> {verdict, reasons})`) and `moduleLaunchAllowed(verdictMap, moduleId)` (`true` only for `verdict === 'render'`; unknown moduleId → `false`, fail closed; `null`/absent map → `false`).
- [ ] Implement; `npx vitest run frontend/src/modules/School/catalog/certification.test.js` PASS.

**Step B (api fetchers):**
- [ ] Add `schoolApi.surfaceProfile(screenId)` → `GET /api/v1/school/surfaces/profile?screen=<id>` and `schoolApi.certification({address, surface})` — copy the fetch/`{ok,data}` style of the existing methods in `schoolApi.js`.

**Step C (wiring):**
- [ ] `SchoolApp.jsx`: on ready, resolve the mount's screen id (reuse the existing `/screen(s)/<id>` parsing in `schoolUrlBase()`; plain app mounts use `'browser'`), fetch `surfaceProfile`; hold `{surfaceId}` in state. In `onLearningLaunch`/`startLearning`, before the existing type switch, check `moduleLaunchAllowed` against the certification rows fetched for the opened lesson (fetch in `LearningCatalogBrowser` alongside its existing lesson fetch, passed through the launch object); refusals route to the existing `learning_unsupported` panel (its copy already fits the stale-cache-guard role). Profile fetch failure ⇒ `schoolLog` warn + catalog learning launches disabled (fail closed, spec §4.2); everything else (banks, geo, typing, materials) untouched.
- [ ] `LearningCatalogBrowser.jsx`: render per-lesson `full`/`partial` badges from the certification rows (plain chip spans, existing styles).
- [ ] Update the three named test files' mocks; run `npx vitest run frontend/src/modules/School/` — whole folder green.
- [ ] Commit — `git commit -m "feat(school-ui): certification-gated launches + catalog badges" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 15: Print Center — paper-certification gate on bank printables

**Files:**
- Read first: `backend/src/3_applications/school/PrintService.mjs` (real shape: constructor `{config, datastore, printerAdapter, worksheetRenderer, bankReader, pdfReader, userService, logger, now}`; `#printableDefs()` builds the printable list from the `printing` config — types `bank` and `pdf`; `listPrintables()` at ~line 70 iterates them, resolving `bankReader.getBank(def.bankId)`), and the composition site that constructs it (`grep -rn "new PrintService(" backend/src`).
- Modify: `backend/src/3_applications/school/PrintService.mjs` + its composition site.
- Test: colocate with the existing PrintService tests (`grep -l "PrintService" backend/src/3_applications/school/*.test.mjs tests/ -r` — extend the existing suite file if one exists, else create `PrintService.certification.test.mjs` beside the service).

**Interfaces (spec §9 — scoped honestly per review finding 2):**
- PrintService constructor gains one optional dep: `paperCertifyBank = null` — an async function `(bank) => {verdict, reasons}` that the composition binds from Task 10's projection + the registry's paper profile (`(bank) => paperPort.certifyBank(bank, paperProfile)`). When `null` (composition without a paper profile, or feature not wired), behavior is **byte-for-byte unchanged** — the legacy path the spec exempts.
- In `listPrintables()`: for each `bank`-type def whose bank resolves, when `paperCertifyBank` is present and returns `verdict: 'incompatible'`, the def is **excluded** from the listing and logged once per listing call: `logger.warn('print.printable-excluded', {printableId, bankId, reasons})` (spec §11 observability). `pdf`-type defs and unresolvable banks are untouched. `IssueDocument`, quotas, and every other PrintService method are untouched.
- [ ] **Steps:** failing test (a config with two bank defs — one whose bank is all `multiple_choice`, one containing a `short_answer` item — plus a pdf def; with a real `PaperCertification` bound as `paperCertifyBank`, `listPrintables()` returns the conforming bank + the pdf, excludes the other, and the logger fake captured the exclusion with its reasons; with `paperCertifyBank: null` all three return) → implement → run the full school application suite `npx vitest run backend/src/3_applications/school/` (IssueDocument suites must stay green) → wire composition → commit `feat(school): paper-certified gate on bank printables`.

---

### Task 16: Acceptance sweep and evidence

**Files:**
- Create: `backend/src/3_applications/school/surfaces/acceptance.v1.test.mjs`
- Create: `docs/_wip/audits/2026-08-04-learning-surfaces-acceptance.md` (evidence record)

Covers spec §12 items not already proven task-by-task:

- [ ] **§12.1 vocabulary safety:** run `npx vitest run backend/src/1_adapters/schoolcalc/ backend/src/3_applications/school/` — all golden-digest and bundle tests green with the feature merged. Record the run in the evidence doc.
- [ ] **§12.2 calculator parity test:** in `acceptance.v1.test.mjs`, for the fixture bundle from `Ti86SchoolCalcCodec.test.mjs`, assert `Ti86SurfaceCertification.certify(...).lesson.verdict === 'full'` ⇔ (`supports().compatible` && `compile()` does not throw), and that an incompatible variant's reason set equals `supports()`'s reasons (∪ any compile throw message).
- [ ] **§12.3 offer soundness (matrix property):** two-lesson fixture corpus (one full-everywhere, one paper-incompatible); run the projection; assert `PrintService.listPrintables()` (with the gate bound) and the frontend `buildVerdictMap`+`moduleLaunchAllowed` helpers exclude exactly the non-render pairs. Application-layer assertion — the same use cases the routes call.
- [ ] **§12.4 paper capture soundness:** already proven in Task 7 tests; reference them in the evidence doc.
- [ ] **§12.5 corpus inventory (ops step, prod host):** run `npm run school:certify` against the real mounted corpus (read-only; content root via `$DAYLIGHT_BASE_PATH`); confirm zero schema errors; paste the certified-nowhere warning list into the evidence doc for review.
- [ ] **§12.6 determinism:** `npm run school:certify -- --json > /tmp/a.json` twice, `diff` — byte-identical; record in evidence doc.
- [ ] **§12.7 contract + architecture:** confirm Tasks 6–8 each invoke `runCertificationPortContract`. Extend the subject-vocabulary/layering architecture test at `tests/isolated/application/school/schoolcalcArchitecture.test.mjs` (it already scans all of `2_domains/school` — the surfaces dir is covered for free) to also scan `backend/src/1_adapters/school/paper/` and `backend/src/1_adapters/school/screen/`, following its existing directory-list pattern.
- [ ] **Final:** full sweep `npx vitest run backend/src/ frontend/src/modules/School/ tests/isolated/ cli/school-certify.cli.test.mjs` green; commit `test(school): learning-surfaces v1 acceptance evidence`; update the spec's status line to "v1 accepted — implementation merged" when the user signs off.

---

## Self-Review Notes (rev 2)

- **All 12 review findings addressed in-body:** requiredCapabilities → Task 10 (projection-layer, digest-safe) with regression test (c); Task 15 rewritten against the real `listPrintables()`/`#printableDefs()` shape with a null-safe optional dep; §4.2 key specified (`surfaceProfile:` in `data/household/screens/<id>.yml`) with loader injection in Task 13; asset validation is Task 12 step (b) with its own failing test; `module <i>` attribution corrected with a two-module attribution test; calculator tracked-return rule added (Task 6 semantics point 2 + test); CLI exemplar/content-root/final-sweep corrected (Task 12 Read-first, Task 16 final); cross-task fixtures are now exported from `PaperCertification.test.mjs` and imported by path; banks walk through the gate (Task 12) and manifest (Task 11, with `baseline?` preserved); Task 14 split into A/B/C naming the three mock-update files; `customCapabilities` supplied from `moduleRegistry.list()` (Task 9); architecture-test path corrected to `tests/isolated/application/school/schoolcalcArchitecture.test.mjs`.
- **Type consistency:** port result `{modules, lesson, resource?}`, row shape (Task 10) ⊇ manifest entry (Task 11) ⊇ `--json` rows (Task 12) = `buildVerdictMap` input (Task 14) — `baseline?` present in all four.
- **Known deliberate simplifications** (spec-conformant): paper page estimate is a stated heuristic (Task 7); screen runner availability is capability-presence (§6.4); in-memory projection cache + file manifest (digests self-invalidate).
