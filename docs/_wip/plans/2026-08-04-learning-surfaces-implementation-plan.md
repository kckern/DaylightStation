# Learning Surfaces v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/_wip/plans/2026-08-04-learning-surfaces-requirements.md` (rev 2). Read it before starting any task; section references (§) below point into it.

**Goal:** One certification language across calculator, paper, and screen surfaces: surface profiles, per-family `certify(bundle, profile)` ports, a certification projection with manifest, the `school:certify` CLI, and offer-side consumers (screen app, Print Center) that only offer certified work.

**Architecture:** Pure domain modules (capability registry, demand derivation, verdict roll-up) feed three adapter-layer certification ports (TI-86 wrap, paper, screen) behind one contract; an application-layer registry + projection computes the matrix and writes a manifest; the CLI and API are thin shells over the projection. No published capability ID changes; the TI-86 codec's behavior is wrapped, never modified.

**Tech Stack:** Node ESM (`.mjs`), vitest (colocated `*.test.mjs`, run `npx vitest run <path>` from repo root — node_modules is present in this worktree), existing `#domains/...` import aliases, js-yaml via existing YAML repository patterns.

## Global Constraints (from spec)

- **Never rename or alias a published capability ID** (§3.1 inventory). New IDs in v1: `return.session@1`, `return.scan@1`, `return.cable@1`, `return.qr@1` only (§3.2).
- **Port signature:** `certify(bundle, profile)` → `{ modules: [{moduleId, verdict: 'render'|'incompatible', reasons, warnings}], lesson: {verdict: 'full'|'partial'|'none'}, resource? }` (§7.1). No `dispatch` anywhere in v1.
- **Ports are deterministic and do no I/O**; all inputs (bundle, resolved banks, profile) supplied by caller (§7.1). Never throw for "content doesn't fit" — throw only on malformed bundle/profile.
- **One certifier everywhere:** CLI/gate/runtime all call the same ports (§2). No parallel lint logic.
- **TI-86 codec baseline for CLI certification is `TI86_SCHOOLCALC_CODEC_CAPABILITIES`**, never `TI86_SCHOOLCALC_CLIENT_CAPABILITIES` (§6.2). Verdicts against it carry `baseline: 'codec'`.
- **Existing behavior must not change:** golden TI-86 byte digests, bundle digests, `supports()`/`compile()` semantics, Print Center's legacy curriculum-unit pipeline (§9), `schoolcalc:validate`.
- **Certified-`none`-everywhere is a warning, not an error** (§6.1). Schema/reference errors remain hard failures.
- **Subject-neutral:** no subject vocabulary in any new certification code (§2; existing architecture tests extend).
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
  GetSurfaceCertification.mjs   # Task 10 — the projection (matrix + digest cache)
  certificationManifest.mjs     # Task 11 — manifest read/write helpers
cli/school-certify.cli.mjs      # Task 12 — the certifier CLI (npm: school:certify)
backend/src/4_api/v1/routers/school.mjs           # Task 13 — modify: certification + profile-resolve endpoints
frontend/src/modules/School/catalog/certification.js  # Task 14 — pure gate helper
frontend/src/modules/School/SchoolApp.jsx             # Task 14 — modify: consult certification
tests/_lib/school/certificationContract.mjs       # Task 5 — shared port contract suite
```

Rollout order is strictly bottom-up; every task leaves the tree green (`npx vitest run backend/src/2_domains/school backend/src/1_adapters/schoolcalc backend/src/3_applications/school`).

---

### Task 1: Capability registry (domain)

**Files:**
- Create: `backend/src/2_domains/school/surfaces/capabilityRegistry.mjs`
- Test: `backend/src/2_domains/school/surfaces/capabilityRegistry.test.mjs`

**Interfaces:**
- Consumes: `parseCapabilityId` from `#domains/school/catalog/index.mjs` (re-exported from `catalog/capabilities.mjs`).
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
- Produces: `validateSurfaceProfile(raw, {customCapabilities?}) => {errors: string[], profile?: object}` with frozen normalized profile `{schema, surfaceId, family, title, liveness, capabilities: string[], limits: object}`. `SURFACE_FAMILIES = ['schoolcalc','paper','screen']`. Tasks 6–10 rely on the normalized shape.

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

  it('rejects unregistered capability IDs (fail closed, spec §3.2)', () => {
    const { errors } = validateSurfaceProfile({ ...good, capabilities: ['reader@1', 'hologram@1'] });
    expect(errors.join()).toMatch(/hologram@1/);
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
- Produces: `TRACKED_MODULE_TYPES: Set<string>` (`quiz`,`problems`,`learning_probe`,`flashcards`,`activity`); `deriveModuleDemands({module, document?, bank?}) => {capabilities: string[], tracked: boolean}`; `deriveBankDemands(bank) => {capabilities: string[], tracked: true}`. Tasks 4, 7, 8, 10 rely on these names.

Bundle shapes to know (from `BuildLearningLesson` output): a resolved module carries its own `bank` (`module.bank.items[]`) for bank-backed types and lecture_notes carry `document.blocks[]`. Image-bearing items: an item with an `asset` field, or an `asset_choice` item whose choices carry `image`, additionally demands `image@1` (spec §3.3.4).

- [ ] **Step 1: Write the failing test**

```js
// backend/src/2_domains/school/surfaces/demands.test.mjs
import { describe, expect, it } from 'vitest';
import { TRACKED_MODULE_TYPES, deriveModuleDemands, deriveBankDemands } from './demands.mjs';

describe('demand derivation (spec §3.3)', () => {
  it('derives module + item + return demands for a tracked quiz', () => {
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
 * supplies the resolved document and bank (ports do no I/O).
 */
export function deriveModuleDemands({ module, document = null, bank = null }) {
  const caps = [];
  const moduleCap = capabilityForLearningModule(module);
  if (moduleCap) caps.push(moduleCap);
  for (const block of document?.blocks ?? []) {
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
- Consumes: `missingCapabilities` from `../catalog/capabilities.mjs`; `RETURN_CAPABILITY_IDS` (Task 1).
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

Note: `tests/isolated/**` specs run under vitest, not jest (`reference_isolated_specs_need_vitest` — invoke with `npx vitest run <path>`).

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
- Consumes: `Ti86SchoolCalcCodec` (existing: `supports(bundle, capabilityReport)`, `compile(bundle, capabilityReport)`, exported `TI86_SCHOOLCALC_CODEC_CAPABILITIES`, `TI86_SCHOOLCALC_LIMITS`); `moduleVerdict`, `rollUpLesson` (Task 4).
- Produces:
  - `class Ti86SurfaceCertification { constructor({codec}) ; certify(bundle, profile) }` — spec §7.1 calculator port. `profile.capabilities` is translated to the codec's capability-report shape `{platformId: 'ti86', capabilities, limits: {maxArtifactBytes}}` (profile limits key `maxArtifactBytes` optional, codec default applies).
  - `ti86CodecBaselineProfile() => profile` — a frozen `school.surface-profile/v1`-shaped record: `surfaceId: 'ti86-codec-baseline'`, `family: 'schoolcalc'`, `liveness: 'observed'`, capabilities = `TI86_SCHOOLCALC_CODEC_CAPABILITIES` **plus** `return.cable@1`, `return.qr@1` (the family's return channels, spec §3.2/§6.2). Task 9/12 use this for CLI certification with `baseline: 'codec'` labeling.
- Semantics (spec §6.2/§7.1): run `codec.supports()`; if compatible, additionally attempt `codec.compile()` in a try/catch to enforce the byte ceiling — a compile throw becomes an `incompatible` reason (verbatim message), never an exception. On success, `resource = {estimatedBytes: compiled.byteLength, limitsApplied: {hardCeilingBytes, targetBytes}}` and compile warnings pass through as lesson-level warnings. **Whole-lesson policy:** verdicts are per-module in shape, but any lesson-level failure marks *every* module `incompatible`, attaching each reason to every module whose `modules[<index>]`/moduleId appears in it, and the remaining reasons to all modules; `rollUpLesson(..., {fullOrNothing: true})`.

- [ ] **Step 1: Write the failing test** (uses the same bundle fixture shape as `Ti86SchoolCalcCodec.test.mjs` — copy its `bundle` const as the renderable fixture; build the oversized fixture by inflating prose):

```js
// backend/src/1_adapters/schoolcalc/ti86/Ti86SurfaceCertification.test.mjs
import { describe, expect, it } from 'vitest';
import { Ti86SchoolCalcCodec } from './Ti86SchoolCalcCodec.mjs';
import { Ti86SurfaceCertification, ti86CodecBaselineProfile } from './Ti86SurfaceCertification.mjs';
import { runCertificationPortContract } from '../../../../../tests/_lib/school/certificationContract.mjs';

// Copy the minimal valid bundle from Ti86SchoolCalcCodec.test.mjs verbatim here
// (schema school.learning-lesson/v1, address, capabilities, one quiz module) as:
const renderableBundle = /* …paste from Ti86SchoolCalcCodec.test.mjs `bundle`… */;

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

  it('reports resource bytes for a compilable lesson', () => {
    const { resource } = makePort().certify(renderableBundle, ti86CodecBaselineProfile());
    expect(resource.estimatedBytes).toBeGreaterThan(0);
    expect(resource.limitsApplied.hardCeilingBytes).toBe(12288);
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `npx vitest run backend/src/1_adapters/schoolcalc/ti86/Ti86SurfaceCertification.test.mjs`.
- [ ] **Step 3: Implement** `Ti86SurfaceCertification.mjs` per the semantics above (~80 lines). Profile→report translation: `{platformId: 'ti86', capabilities: profile.capabilities.filter((id) => !id.startsWith('return.')), limits: {maxArtifactBytes: profile.limits?.maxArtifactBytes}}` (strip undefined limits). Reason-to-module attribution: a reason containing `modules[<i>]` attaches to `bundle.lesson.modules[i]`; all other reasons attach to every module.
- [ ] **Step 4: Run to verify PASS**, then run the *entire* existing codec suite untouched: `npx vitest run backend/src/1_adapters/schoolcalc/` — the golden byte digests must still pass (Global Constraint).
- [ ] **Step 5: Commit** — `git commit -m "feat(schoolcalc): TI-86 certification port wrapping supports()+compile byte ceiling" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 7: Paper certification port

**Files:**
- Create: `backend/src/1_adapters/school/paper/PaperCertification.mjs`
- Test: `backend/src/1_adapters/school/paper/PaperCertification.test.mjs`

**Interfaces:**
- Consumes: `deriveModuleDemands`, `deriveBankDemands`, `capabilityReasons`, `moduleVerdict`, `rollUpLesson` from `#domains/school/surfaces/index.mjs` (or the relative path — match how other `1_adapters/school` files import domain code; check `backend/src/1_adapters/school/catalog/YamlLearningCatalogRepository.mjs` imports first and copy the style).
- Produces:
  - `class PaperCertification { certify(bundle, profile); certifyBank(bank, profile) }`. `certifyBank` returns `{verdict, reasons, warnings}` for a standalone bank (spec §7.3).
  - Rules implemented (spec §6.3), on top of the shared `capabilityReasons` pass:
    - module types `tool`, `custom`, `activity`, `learning_probe` → reason `<type> modules do not render on paper`.
    - for choice items: `choices.length > profile.limits.omrChannels` → reason naming the item id; any choice lacking a printable text `label`/string → reason.
    - bank/module item count > `profile.limits.maxItemsPerSheet` → reason.
    - lecture_notes documents estimated pages > `profile.limits.maxPagesPerDocument` → reason (estimate: `Math.ceil(blocks.length / 12)` — 12 blocks/page is the v1 heuristic; state it in a comment; the paper renderer refines it later without changing this port's contract).
    - non-choice response demands are already covered by `capabilityReasons` (a paper profile omits `response.text@1` etc. — the test proves the item-level miss reads correctly).

- [ ] **Step 1: Write the failing test**

```js
// backend/src/1_adapters/school/paper/PaperCertification.test.mjs
import { describe, expect, it } from 'vitest';
import { PaperCertification } from './PaperCertification.mjs';
import { runCertificationPortContract } from '../../../../../tests/_lib/school/certificationContract.mjs';

const paperProfile = {
  surfaceId: 'paper-letter-mono', family: 'paper', liveness: 'static',
  capabilities: [
    'reader@1', 'examples@1', 'quiz@1', 'problems@1', 'flashcards@1',
    'image@1', 'math@1', 'table-layout@1', 'scan-action@1',
    'response.choice@1', 'response.asset-choice@1', 'return.scan@1',
  ],
  limits: { omrChannels: 12, maxItemsPerSheet: 25, maxPagesPerDocument: 20 },
};

const choiceBank = { id: 'b1', items: [
  { id: 'q1', type: 'multiple_choice', prompt: 'p', choices: ['a', 'b', 'c'], answer: 'a' },
] };
const textBank = { id: 'b2', items: [
  { id: 'q1', type: 'short_answer', prompt: 'p', answer: 'x' },
] };

const renderableBundle = { lesson: { modules: [
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

- [ ] **Step 2: Run to verify FAIL.**
- [ ] **Step 3: Implement** `PaperCertification.mjs` (~90 lines) per the rules block above; every rule adds a `reasons` string, then `moduleVerdict`/`rollUpLesson` assemble the result. `certifyBank` = shared capability pass over `deriveBankDemands(bank)` + channel/label/sheet checks, returning `{verdict: reasons.length ? 'incompatible' : 'render', reasons, warnings: []}`.
- [ ] **Step 4: Run to verify PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(school): paper certification port (OMR capture, geometry, budgets)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 8: Screen certification port

**Files:**
- Create: `backend/src/1_adapters/school/screen/ScreenCertification.mjs`
- Test: `backend/src/1_adapters/school/screen/ScreenCertification.test.mjs`

**Interfaces:**
- Consumes: same domain primitives as Task 7.
- Produces: `class ScreenCertification { certify(bundle, profile); certifyBank(bank, profile) }`. Screen rules (spec §6.4) are *purely capability-driven* — no structural limits in v1: module capability present, block capabilities present, item `response.*` present, tracked ⇒ `return.session@1` specifically (reason `tracked module requires return.session@1 on a screen` when absent — stricter than the generic class rule, per §6.4).

- [ ] **Step 1: Write the failing test** — contract run with a full-capability screen profile (`reader@1, examples@1, problems@1, flashcards@1, quiz@1, learning-probe@1, activity.matching@1, calculator@1, graph@1, image@1, math@1, table-layout@1, scan-action@1, response.choice@1, response.text@1, response.matching@1, response.region@1, response.asset-choice@1, return.session@1`) certifying the Task 7 `renderableBundle` full; plus specifics:

```js
it('demotes region_click items on a pointer-less profile', () => {
  const remoteOnly = { ...screenProfile, capabilities: screenProfile.capabilities.filter((c) => c !== 'response.region@1') };
  const bank = { id: 'b', items: [{ id: 'q1', type: 'region_click', prompt: 'p', asset: 'map', answer: 'x' }] };
  const result = new ScreenCertification().certify({ lesson: { modules: [{ moduleId: 'm', type: 'quiz', bank }] } }, remoteOnly);
  expect(result.modules[0].reasons.join()).toMatch(/response\.region@1/);
});

it('requires return.session@1 for tracked modules', () => {
  const noReturn = { ...screenProfile, capabilities: screenProfile.capabilities.filter((c) => !c.startsWith('return.')) };
  const result = new ScreenCertification().certify(renderableBundle, noReturn);
  expect(result.modules.find((m) => m.moduleId === 'check').reasons.join()).toMatch(/return\.session@1/);
});
```

- [ ] **Step 2: FAIL → Step 3: implement** (~50 lines: `capabilityReasons` minus its generic return clause, replaced by the screen-specific `return.session@1` check — implement by computing demands with `tracked: false`, then adding the screen return reason when the module is tracked and `return.session@1` absent) **→ Step 4: PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(school): screen certification port (capability + session-return checks)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 9: Surface profile repository + registry (application)

**Files:**
- Create: `backend/src/1_adapters/school/catalog/YamlSurfaceProfileRepository.mjs`, `backend/src/3_applications/school/surfaces/SurfaceRegistry.mjs`
- Test: `backend/src/3_applications/school/surfaces/SurfaceRegistry.test.mjs`

**Interfaces:**
- Consumes: `validateSurfaceProfile` (Task 2); the three ports (Tasks 6–8); js-yaml + fs patterns copied from `YamlLearningCatalogRepository.mjs` (read that file first and mirror its directory-listing/error style; it takes a root directory and lists `*.yml`).
- Produces:
  - `YamlSurfaceProfileRepository({directory})` with `async listProfiles() => Array<{profile, errors, file}>` — parses every `catalog/surfaces/*.yml` through `validateSurfaceProfile`; invalid files are returned with their errors, never silently skipped.
  - `class SurfaceRegistry { constructor({profiles, ports}) ; list() ; get(surfaceId) ; portFor(profile) }` where `ports` = `{schoolcalc, paper, screen}` instances. `portFor` throws on an unknown family (malformed input, spec §7.1). Registry also exposes `codecBaselines()` returning `[{profile: ti86CodecBaselineProfile(), baseline: 'codec'}]` (imported from Task 6) so the CLI certifies calculators without a device (spec §6.2).
- Wiring note for the executor: the registry is *constructed* by callers (Task 10's projection, Task 12's CLI, Task 13's router) — there is no singleton. Static profiles load from `<contentMount>/catalog/surfaces/`; find the content mount the way `cli/schoolcalc-catalog.cli.mjs` locates the catalog directory (read it; it resolves the school content root from config) and reuse that resolution.

- [ ] **Step 1: Write the failing test** — temp-dir fixture with two valid profiles (paper + screen) and one invalid file (`bad.yml` with `family: dispatch`); assert `listProfiles()` returns 3 entries (2 with `profile`, 1 with `errors`), `SurfaceRegistry.list()` exposes only the valid 2, `get('paper-letter-mono')` works, `portFor({family:'paper'})` returns the paper port instance, unknown family throws, and `codecBaselines()[0].profile.surfaceId === 'ti86-codec-baseline'`.
- [ ] **Step 2: FAIL → Step 3: implement → Step 4: PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(school): surface profile repository + registry with codec baselines" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 10: Certification projection (application)

**Files:**
- Create: `backend/src/3_applications/school/surfaces/GetSurfaceCertification.mjs`
- Test: `backend/src/3_applications/school/surfaces/GetSurfaceCertification.test.mjs`

**Interfaces:**
- Consumes: `BuildLearningLesson` (existing — `execute({catalogId, subjectId, courseId, unitId, lessonId})` returns the neutral bundle); `SurfaceRegistry` (Task 9); bank repository (`YamlLearningContentRepository` — read it; it exposes bank fetch by id; mirror how `BuildLearningLesson` gets banks); `sha256Hex`/canonical JSON — implement a tiny local `digest(value)` using `node:crypto` `createHash('sha256')` over `JSON.stringify` with sorted keys (copy the `canonicalJson` helper pattern from `Ti86SchoolCalcCodec.mjs` rather than importing it — it is codec-internal).
- Produces: `class GetSurfaceCertification { constructor({buildLesson, banks, registry}) ; async lesson(address) ; async bank(bankId) }` where both return matrix rows `[{address, surfaceId, baseline?, verdict, reasons, warnings, resource?, moduleVerdicts}]` — one row per registered profile + codec baseline. Rows are cached in-memory on `(contentDigest, profileDigest)`; the digests are included on each row (`contentDigest`, `profileDigest`) for Task 11's manifest.
- `address` is the string form `catalogId/subjectId/courseId/unitId/lessonId` (same 5-segment form the delivery request validation uses, spec §5.2 of the schoolcalc spec).

- [ ] **Step 1: Write the failing test** — fakes only (no filesystem): a `buildLesson` fake returning the Task 7 renderable bundle for address `main/sci/wc/wm/evap`, a `banks` fake, a registry with the real paper + screen ports (real Tasks 7–8 code) and a stub schoolcalc port. Assert: (a) `lesson()` returns one row per profile + one `baseline: 'codec'` row; (b) paper row verdict `full`, screen row `full`; (c) calling `lesson()` twice invokes `buildLesson.execute` once per address (cache hit — count with a wrapper); (d) editing the fake bundle (new digest) re-certifies; (e) `bank('b1')` produces rows via `certifyBank` with `verdict: 'render'|'incompatible'` mapped into the same row shape (lesson-less: `moduleVerdicts: null`).
- [ ] **Step 2: FAIL → Step 3: implement (~100 lines) → Step 4: PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(school): surface certification projection with digest cache" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 11: Certification manifest (persistence)

**Files:**
- Create: `backend/src/3_applications/school/surfaces/certificationManifest.mjs`
- Test: `backend/src/3_applications/school/surfaces/certificationManifest.test.mjs`

**Interfaces:**
- Produces: `writeManifest({rows, path, fs?})` and `readManifest({path, fs?})`. Manifest is JSON: `{schema: 'school.certification-manifest/v1', entries: {"<contentDigest>:<profileDigest>": {address, surfaceId, verdict, reasons, warnings, resource}}}`, written with sorted keys and trailing newline so identical input ⇒ identical bytes (spec §8 determinism, acceptance §12.6). `readManifest` returns `{}`-entries on missing file (spec §7.3: degrade to on-demand, never fail).
- Manifest location: `<contentMount>/catalog/certification-manifest.json` (generated, alongside `ti86-packs/` which is already generated-not-authored).

- [ ] **Step 1: Test:** round-trip via `memfs`-style injected fs stub (plain object with `writeFileSync`/`readFileSync`/`existsSync`); byte-identical output across two writes of the same rows in different array order; missing-file read returns empty entries.
- [ ] **Step 2: FAIL → Step 3: implement (sorted-key serializer ~40 lines) → Step 4: PASS → Step 5: Commit** — `git commit -m "feat(school): deterministic certification manifest read/write" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 12: `school:certify` CLI

**Files:**
- Create: `cli/school-certify.cli.mjs`
- Modify: `package.json` (add script `"school:certify": "node cli/school-certify.cli.mjs"`)
- Test: `cli/school-certify.test.mjs` (unit-test the exported `runCertify(argv, deps)` function with fakes — do NOT spawn a child process; follow the pattern of existing `cli/*.test.mjs` files, e.g. `backfill-media-durations.test.mjs`)

**Interfaces:**
- Consumes: everything from Tasks 9–11; the existing validation walk — read `cli/schoolcalc-catalog.cli.mjs` first and reuse its corpus-walk + `ValidateSchoolCalcPublication` invocation for the validation pass (One-certifier principle: do not reimplement validation).
- Produces: `runCertify(argv, deps) => Promise<{exitCode, report}>` and a bin entry that prints and `process.exit`s. Flags and exit semantics exactly per spec §8:
  - no flags = gate mode: validation pass; on schema/ref errors exit 1; else certify corpus × (static profiles + codec baselines), print table + warnings (including certified-nowhere list), exit 0. `--write-manifest` additionally writes Task 11's manifest.
  - `--surface <id>` / `--address <addr>` / `--file <path>` = query mode: exit 0 whenever certification ran (verdicts are answers); exit 1 only on schema/ref errors in scope.
  - `--json`: emit the row array as JSON lines, stable order (sort by address, then surfaceId).
- [ ] **Step 1: Write failing tests** for: gate-mode exit 1 on a validation error (fake validator returning errors); gate-mode exit 0 with a certified-nowhere warning present in `report.warnings`; query-mode `--surface ti86-codec-baseline` exit 0 with `verdict: 'none'` rows; `--json` output sorted and byte-stable across two runs.
- [ ] **Step 2: FAIL → Step 3: implement → Step 4: PASS → Step 5: Commit** — `git commit -m "feat(school): school:certify CLI — modal gate/query exits, --json, --write-manifest" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 13: API — certification + screen-profile resolution

**Files:**
- Modify: `backend/src/4_api/v1/routers/school.mjs` (read it first; follow its handler/DI style — handlers get services from the school composition, see `backend/src/4_api/v1/handlers/` and `schoolLifecycle.mjs` wiring)
- Test: `backend/src/4_api/v1/routers/school.certification.test.mjs` (follow the existing router test style in `school.progress.test.mjs`)

**Interfaces:**
- Produces two endpoints:
  - `GET /api/v1/school/certification?address=<a>` and `?bank=<id>`, optional `&surface=<surfaceId>` — returns the projection rows (Task 10), 400 on malformed query, 404 on unknown address/bank.
  - `GET /api/v1/school/surfaces/profile?screen=<screenId|browser>` — resolves a mount to its profile per spec §4.2: a screenId resolves through screen config; `browser` (or absent screen param) resolves the authored `screen-browser` profile; **missing profile ⇒ 404 with `{error: 'surface-profile-unresolved'}`** and a warn log — never a synthesized default (fail closed).
- [ ] **Steps:** failing router tests (resolution happy path, browser default, 404 fail-closed, certification rows for a fixture lesson) → implement → pass → commit `feat(school): certification + surface-profile resolution endpoints`.

---

### Task 14: Screen app consumes certification

**Files:**
- Create: `frontend/src/modules/School/catalog/certification.js`
- Modify: `frontend/src/modules/School/schoolApi.js` (add `surfaceProfile(screenId)` + `certification(params)` fetchers, same style as existing methods), `frontend/src/modules/School/SchoolApp.jsx`, `frontend/src/modules/School/catalog/LearningCatalogBrowser.jsx`
- Test: `frontend/src/modules/School/catalog/certification.test.js` (vitest, pure — no DOM needed)

**Interfaces:**
- Produces (pure helper, fully testable):

```js
// certification.js
/** Map projection rows for ONE surface into a moduleId -> verdict lookup. */
export function buildVerdictMap(rows) { /* rows -> Map(moduleId -> {verdict, reasons}) */ }
/** Launch gate: true only for verdict 'render'; unknown moduleId -> false (fail closed). */
export function moduleLaunchAllowed(verdictMap, moduleId) { /* … */ }
```

- `SchoolApp.jsx` changes are minimal and behavior-preserving where certification is unavailable: on mount, fetch the mount's surface profile (screen id from the `/screen/<id>` path, else `browser`) and the certification rows for opened lessons; `startLearning` checks `moduleLaunchAllowed` *before* the existing type switch and routes refusals to the existing `learning_unsupported` panel (which thereby becomes the §2 "stale cache guard" — its copy already fits). If the profile endpoint 404s, log via `schoolLog` and offer no learning catalog launches (spec §4.2 fail-closed) while leaving the rest of the app (materials, typing, etc.) untouched.
- `LearningCatalogBrowser.jsx`: render per-lesson badges from the rows already fetched (`full`/`partial` per surfaceId — a simple chip row; no new design system work).
- [ ] **Steps:** failing tests for `buildVerdictMap`/`moduleLaunchAllowed` (render allowed; incompatible blocked; unknown blocked) → implement helper → wire SchoolApp + browser (manual check: `npm run dev` and open `/school`) → run `npx vitest run frontend/src/modules/School/` → commit `feat(school-ui): certification-gated launches + catalog badges`.

---

### Task 15: Print Center offers only paper-certified banks

**Files:**
- Read first: `frontend/src/modules/School/print/PrintCenter.jsx`, `backend/src/3_applications/school/PrintService.mjs`, and the router path PrintCenter's fetches hit (trace the fetch URL in PrintCenter.jsx to its handler).
- Modify: the application use case that lists printable catalog banks (in `PrintService.mjs` or the handler it delegates to), threading `GetSurfaceCertification.bank()` through it.
- Test: colocated test beside the modified use case.

**Interfaces:**
- Consumes: `GetSurfaceCertification` (Task 10); the paper profile id comes from configuration (the registry's single `family: 'paper'` profile; if multiple, the listing filters against each and a bank is offered if any paper profile renders it).
- Produces: the catalog-bank listing the Print Center consumes excludes banks whose paper verdict is `incompatible`, and each excluded bank is logged (`schoolLog`-equivalent backend logger) with its reasons (spec §11 observability). **The legacy curriculum-unit printing path is untouched** (spec §9) — verify by leaving every `IssueDocument` test green.
- [ ] **Steps:** failing test (listing with one conforming + one text-item bank returns only the former; excluded bank logged with reason) → implement → run the full print/OMR suites (`npx vitest run backend/src/3_applications/school/`) → commit `feat(school): Print Center catalog offerings gated by paper certification`.

---

### Task 16: Acceptance sweep and evidence

**Files:**
- Create: `backend/src/3_applications/school/surfaces/acceptance.v1.test.mjs`
- Create: `docs/_wip/audits/2026-08-04-learning-surfaces-acceptance.md` (evidence record)

Covers spec §12 items not already proven task-by-task:

- [ ] **§12.1 vocabulary safety:** run `npx vitest run backend/src/1_adapters/schoolcalc/ backend/src/3_applications/school/` — all golden-digest and bundle tests green with the feature merged. Record the run in the evidence doc.
- [ ] **§12.2 calculator parity test:** in `acceptance.v1.test.mjs`, for each fixture bundle used in `Ti86SchoolCalcCodec.test.mjs`, assert `Ti86SurfaceCertification.certify(...).lesson.verdict === 'full'` ⇔ (`supports().compatible && compile()` does not throw), and that reasons sets match.
- [ ] **§12.3 offer soundness:** matrix-property test: build a two-lesson fixture corpus (one full-everywhere, one paper-incompatible), run the projection, then assert the Print Center listing (Task 15) and the frontend verdict map (Task 14 helper) exclude exactly the non-render pairs. (API/UI listing equivalence is asserted at the application layer — the same use cases the routes call.)
- [ ] **§12.4 paper capture soundness:** already proven in Task 7 tests; reference them in the evidence doc.
- [ ] **§12.5 corpus inventory (ops step, prod host):** run `npm run school:certify` against the real mounted corpus; confirm zero schema errors; paste the certified-nowhere warning list into the evidence doc for review. (Content lives on the data mount — run on the server, read-only; no docker exec needed for reads.)
- [ ] **§12.6 determinism:** run `npm run school:certify -- --json > /tmp/a.json` twice, `diff` — byte-identical; record in evidence doc.
- [ ] **§12.7 contract suite:** confirm Tasks 6–8 each invoke `runCertificationPortContract`; extend the architecture test that bans subject vocabulary (find it: `grep -rn "subject" backend/tests --include='*architecture*'` or the schoolcalc architecture test referenced in the delivery matrix as `schoolcalcArchitecture.test.mjs`) to include `backend/src/2_domains/school/surfaces/` and the two new adapter directories.
- [ ] **Final:** full suite `npx vitest run backend/src/ frontend/src/modules/School/ tests/isolated/` green; commit `test(school): learning-surfaces v1 acceptance evidence`; update the spec's status line to "v1 accepted — implementation merged" when the user signs off.

---

## Self-Review Notes

- **Spec coverage check:** §3 → Tasks 1–4; §4 → Tasks 2, 9, 13; §5.5 → Task 9 (profiles) — *asset existence validation (§5.5.2) has no dedicated task*: it belongs in the validation pass the CLI reuses; **added to Task 12 scope**: while wiring the validation pass, extend the corpus walk to stat every `asset` block `assetId` and bank item `asset` under `catalog/assets/`, reporting missing files as reference errors (exit 1 in gate mode). §6 → Tasks 6–8; §7 → Tasks 6–11; §8 → Task 12; §9 → Tasks 13–15; §12 → Task 16. §10/§11 are satisfied structurally (layering + logging noted inline in Tasks 9, 13, 15).
- **Type consistency:** the port result shape `{modules, lesson, resource?}` and helper names (`capabilityReasons`, `moduleVerdict`, `rollUpLesson`, `deriveModuleDemands`, `deriveBankDemands`, `certifyBank`, `ti86CodecBaselineProfile`) are used identically in Tasks 4–12.
- **Known deliberate simplifications** (all spec-conformant): paper page estimate is a stated heuristic (Task 7); screen runner availability is capability-presence (§6.4 defines it that way); in-memory projection cache + file manifest (no invalidation daemon — digests self-invalidate).
