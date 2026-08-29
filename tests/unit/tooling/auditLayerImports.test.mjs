import { describe, it, expect } from 'vitest';
import {
  scanViolations,
  scanAstViolations,
  scanContent,
  analyzePortGovernance,
  RULES,
  CONTENT_RULES,
  AST_SEMANTIC_RULES,
  APPLICATION_INFRASTRUCTURE_RULES,
} from '../../../scripts/audit-layer-imports.mjs';

describe('audit-layer-imports', () => {
  it('flags a domain file importing an adapter', () => {
    const v = scanViolations('backend/src/2_domains/x/Foo.mjs',
      "import { Bar } from '#adapters/thing/Bar.mjs';");
    expect(v.some(r => r.rule === 'domains-no-adapters')).toBe(true);
  });
  it('allows the composition root to import adapters', () => {
    const v = scanViolations('backend/src/5_composition/bootstrap.mjs',
      "import { Bar } from '#adapters/thing/Bar.mjs';");
    expect(v.length).toBe(0);
  });
  it('rejects adapter imports of application internals but permits ports', () => {
    const internal = scanAstViolations('backend/src/1_adapters/x/Foo.mjs',
      "import { Workflow } from '#apps/x/Workflow.mjs';");
    const port = scanAstViolations('backend/src/1_adapters/x/Foo.mjs',
      "import { IFoo } from '#apps/x/ports/IFoo.mjs';");
    expect(internal.some(r => r.rule === 'adapters-no-app-internals')).toBe(true);
    expect(port.some(r => r.rule === 'adapters-no-app-internals')).toBe(false);
  });
  it('rejects relative peer-adapter imports while permitting a family-local import', () => {
    const peer = scanAstViolations('backend/src/1_adapters/alpha/Foo.mjs',
      "import { Bar } from '../beta/Bar.mjs';");
    const local = scanAstViolations('backend/src/1_adapters/alpha/Foo.mjs',
      "import { Bar } from './Bar.mjs';");
    expect(peer.some(r => r.rule === 'adapters-no-cross-adapter')).toBe(true);
    expect(local.some(r => r.rule === 'adapters-no-cross-adapter')).toBe(false);
  });
  it('flags raw fs import in 3_applications', () => {
    const v = scanViolations('backend/src/3_applications/x/Svc.mjs',
      "import fs from 'node:fs';");
    expect(v.some(r => r.rule === 'apps-no-fs')).toBe(true);
  });
  it('finds multiline and literal dynamic imports in the AST report', () => {
    const multiline = scanAstViolations('backend/src/4_api/x/router.mjs',
      "import {\n  Service,\n} from '#apps/x/Service.mjs';");
    const dynamic = scanAstViolations('backend/src/4_api/x/router.mjs',
      "const { Service } = await import('#apps/x/Service.mjs');");
    expect(multiline.some(r => r.rule === 'api-no-apps')).toBe(true);
    expect(dynamic.some(r => r.rule === 'api-no-apps')).toBe(true);
  });
  it('finds re-exports and CommonJS requires through the AST scanner', () => {
    const reExport = scanAstViolations('backend/src/4_api/x/router.mjs',
      "export { Service } from '#apps/x/Service.mjs';");
    const required = scanAstViolations('backend/src/4_api/x/router.mjs',
      "const Service = require('#apps/x/Service.mjs');");
    expect(reExport.some(r => r.rule === 'api-no-apps')).toBe(true);
    expect(required.some(r => r.rule === 'api-no-apps')).toBe(true);
  });

  it('finds static template imports and module.require calls', () => {
    const dynamic = scanAstViolations('backend/src/4_api/x/router.mjs',
      "const Service = await import(`#apps/x/Service.mjs`); const fs = module.require(`node:fs`);");
    expect(dynamic.some(r => r.rule === 'api-no-apps')).toBe(true);
    expect(dynamic.some(r => r.rule === 'api-no-node-infrastructure')).toBe(true);
  });
  it('reports API Node infrastructure imports', () => {
    const v = scanAstViolations('backend/src/4_api/x/router.mjs',
      "import { readFile } from 'node:fs/promises';");
    expect(v.some(r => r.rule === 'api-no-node-infrastructure')).toBe(true);
  });
  it('reports API rendering and direct FileIO imports', () => {
    const v = scanAstViolations('backend/src/4_api/x/router.mjs', [
      "import { render } from '#rendering/pdf/render.mjs';",
      "import { readFile } from '#system/utils/FileIO.mjs';",
    ].join('\n'));
    expect(v.some(r => r.rule === 'api-no-rendering')).toBe(true);
    expect(v.some(r => r.rule === 'api-no-fileio')).toBe(true);
  });
  it('rejects persistence and process I/O in composition', () => {
    const fileIo = scanAstViolations('backend/src/5_composition/bootstrap.mjs',
      "import { writeBinary } from '#system/utils/FileIO.mjs';");
    const processIo = scanAstViolations('backend/src/5_composition/modules/x.mjs',
      "import { spawn } from 'node:child_process';");
    expect(fileIo.some(r => r.rule === 'composition-no-fileio')).toBe(true);
    expect(processIo.some(r => r.rule === 'composition-no-direct-runtime-io')).toBe(true);
    const legacyRoot = scanAstViolations('backend/src/app.mjs',
      "import { loadYaml } from './0_system/utils/FileIO.mjs';");
    expect(legacyRoot.some(r => r.rule === 'composition-no-fileio')).toBe(true);
  });
  it('rejects global fetch in both composition roots', () => {
    for (const source of ['backend/src/app.mjs', 'backend/src/5_composition/bootstrap.mjs']) {
      const v = scanAstViolations(source, "await fetch('https://example.test');");
      expect(v.some(r => r.rule === 'composition-no-global-fetch'), source).toBe(true);
    }
  });
  it('reports application Node infrastructure imports', () => {
    for (const specifier of ['node:path', 'node:crypto']) {
      const v = scanAstViolations('backend/src/3_applications/x/Svc.mjs',
        `const runtime = await import('${specifier}');`);
      expect(v.some(r => r.rule === 'apps-no-node-infrastructure'), specifier).toBe(true);
    }
  });
  it('does not exempt HealthArchiveScope from application infrastructure rules', () => {
    const v = scanAstViolations('backend/src/3_applications/health/archive/HealthArchiveScope.mjs',
      "import path from 'node:path'; export const within = (root, child) => path.resolve(child).startsWith(path.resolve(root));");
    expect(v.some(r => r.rule === 'apps-no-node-infrastructure')).toBe(true);
  });
  it('reports raw application timers, generic event buses, and config-service access', () => {
    const v = scanAstViolations('backend/src/3_applications/x/Svc.mjs', [
      'export function start({ eventBus, configService }) {',
      '  setTimeout(() => eventBus.broadcast(configService.get("topic")), 10);',
      '}',
    ].join('\n'));
    expect(v.some(r => r.rule === 'apps-no-global-timers')).toBe(true);
    expect(v.some(r => r.rule === 'apps-no-generic-eventbus')).toBe(true);
    expect(v.some(r => r.rule === 'apps-no-config-service-access')).toBe(true);
  });
  it('distinguishes ambient clocks from caller-supplied date parsing', () => {
    const ambient = scanAstViolations('backend/src/2_domains/x/Foo.mjs',
      'const a = new Date(); const b = Date.now();');
    const parsing = scanAstViolations('backend/src/2_domains/x/Foo.mjs',
      'const a = new Date(value);');
    expect(ambient.filter(r => r.rule === 'domains-no-ambient-clock')).toHaveLength(2);
    expect(parsing.some(r => r.rule === 'domains-no-ambient-clock')).toBe(false);
  });
  it('does not flag an injected Date binding as an ambient clock', () => {
    const v = scanAstViolations('backend/src/2_domains/x/Foo.mjs',
      'function make(Date) { return new Date(); }');
    expect(v.some(r => r.rule === 'domains-no-ambient-clock')).toBe(false);
  });
  it('reports domain entropy separately from ambient time', () => {
    const v = scanAstViolations('backend/src/2_domains/x/Foo.mjs',
      'const a = Math.random(); const b = randomUUID(); const c = randomBytes(4); const d = crypto.getRandomValues(buf);');
    expect(v.filter(r => r.rule === 'domains-nondeterminism')).toHaveLength(4);
    expect(v.some(r => r.rule === 'domains-no-ambient-clock')).toBe(false);
  });
  it('reports ambient Math.random passed as a domain default', () => {
    const v = scanAstViolations('backend/src/2_domains/x/Foo.mjs',
      'export function choose(rng = Math.random) { return rng(); }');
    expect(v.filter(r => r.rule === 'domains-nondeterminism')).toHaveLength(1);
  });
  it('reports only an unbound global fetch in applications', () => {
    const globalFetch = scanAstViolations('backend/src/3_applications/x/Svc.mjs',
      "await fetch('https://example.test');");
    const injectedFetch = scanAstViolations('backend/src/3_applications/x/Svc.mjs',
      "async function load(fetch) { await fetch('https://example.test'); }");
    expect(globalFetch.some(r => r.rule === 'apps-no-global-fetch')).toBe(true);
    expect(injectedFetch.some(r => r.rule === 'apps-no-global-fetch')).toBe(false);
  });
  it('reports an unbound global fetch in API', () => {
    const v = scanAstViolations('backend/src/4_api/x/router.mjs',
      "await fetch('https://example.test');");
    expect(v.some(r => r.rule === 'api-no-global-fetch')).toBe(true);
  });
  it('reports an unbound global fetch passed as a default callback', () => {
    const v = scanAstViolations('backend/src/4_api/x/router.mjs',
      'export async function load(fetchFn = fetch) { return fetchFn("https://example.test"); }');
    expect(v.some(r => r.rule === 'api-no-global-fetch')).toBe(true);
  });
  it('reports application-facing port declarations in domains', () => {
    const v = scanAstViolations('backend/src/2_domains/lifelog/extractors/ILifelogExtractor.mjs',
      'export class ILifelogExtractor {}');
    expect(v.some(r => r.rule === 'domains-no-application-ports')).toBe(true);
  });
  it('reports a port file owned by an adapter instead of an application', () => {
    const findings = analyzePortGovernance([
      { file: 'backend/src/1_adapters/x/ports/IFoo.mjs', content: 'export class IFoo {}' },
    ]);
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: 'ports-outside-applications' }),
    ]));
  });
  it('reports an application port referenced only by its barrel', () => {
    const findings = analyzePortGovernance([
      { file: 'backend/src/3_applications/x/ports/IFoo.mjs', content: 'export class IFoo {}' },
      { file: 'backend/src/3_applications/x/ports/index.mjs', content: "export { IFoo } from './IFoo.mjs';" },
    ]);
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: 'ports-zero-importers' }),
    ]));
  });
  it('does not report an application port with a live production importer as dead', () => {
    const findings = analyzePortGovernance([
      { file: 'backend/src/3_applications/x/ports/IFoo.mjs', content: 'export class IFoo {}' },
      { file: 'backend/src/3_applications/x/UseFoo.mjs', content: "import { IFoo } from './ports/IFoo.mjs'; export const use = (foo) => foo instanceof IFoo;" },
    ]);
    expect(findings.some((finding) => finding.rule === 'ports-zero-importers')).toBe(false);
  });
  it('follows a named port import through its barrel', () => {
    const findings = analyzePortGovernance([
      { file: 'backend/src/3_applications/x/ports/IFoo.mjs', content: 'export class IFoo {}' },
      { file: 'backend/src/3_applications/x/ports/IUnused.mjs', content: 'export class IUnused {}' },
      { file: 'backend/src/3_applications/x/ports/index.mjs', content: "export { IFoo } from './IFoo.mjs'; export { IUnused } from './IUnused.mjs';" },
      { file: 'backend/src/3_applications/x/UseFoo.mjs', content: "import { IFoo } from './ports/index.mjs'; export const use = (foo) => foo instanceof IFoo;" },
    ]);
    expect(findings.some((finding) => finding.file.endsWith('/IFoo.mjs'))).toBe(false);
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: 'ports-zero-importers', file: expect.stringMatching(/IUnused\.mjs$/) }),
    ]));
  });
  it('enforces D7 when an adapter directly imports an application port', () => {
    const findings = analyzePortGovernance([
      { file: 'backend/src/3_applications/x/ports/IFoo.mjs', content: 'export class IFoo {}' },
      { file: 'backend/src/1_adapters/x/FooAdapter.mjs', content: "import { IFoo } from '#apps/x/ports/IFoo.mjs'; export class FooAdapter {}" },
    ]);
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: 'adapters-port-not-extended' }),
    ]));
  });
  it('accepts an adapter that explicitly extends its imported port', () => {
    const findings = analyzePortGovernance([
      { file: 'backend/src/3_applications/x/ports/IFoo.mjs', content: 'export class IFoo {}' },
      { file: 'backend/src/1_adapters/x/FooAdapter.mjs', content: "import { IFoo } from '#apps/x/ports/IFoo.mjs'; export class FooAdapter extends IFoo {}" },
    ]);
    expect(findings.some((finding) => finding.rule === 'adapters-port-not-extended')).toBe(false);
  });
  it('checks each imported class-port binding instead of any superclass in the module', () => {
    const findings = analyzePortGovernance([
      { file: 'backend/src/3_applications/x/ports/Contracts.mjs', content: 'export class IFoo {} export class Helper {}' },
      { file: 'backend/src/1_adapters/x/FooAdapter.mjs', content: "import { IFoo, Helper } from '#apps/x/ports/Contracts.mjs'; export class FooAdapter extends Helper {}" },
    ]);
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: 'adapters-port-not-extended', spec: expect.stringContaining('#IFoo') }),
    ]));
    expect(findings.some((finding) => finding.spec?.endsWith('#Helper'))).toBe(false);
  });
  it('does not require extends for non-class exports in a port module', () => {
    const findings = analyzePortGovernance([
      { file: 'backend/src/3_applications/x/ports/IThing.mjs', content: 'export const CONTENT_TYPES = {}; export const IThing = { run() {} };' },
      { file: 'backend/src/1_adapters/x/ThingAdapter.mjs', content: "import { CONTENT_TYPES } from '#apps/x/ports/IThing.mjs'; export const value = CONTENT_TYPES;" },
    ]);
    expect(findings.some((finding) => finding.rule === 'adapters-port-not-extended')).toBe(false);
  });
  it('rejects an adapter-facing I* binding that is not an abstract class contract', () => {
    const findings = analyzePortGovernance([
      { file: 'backend/src/3_applications/x/ports/IThing.mjs', content: 'export const IThing = { run() {} };' },
      { file: 'backend/src/1_adapters/x/ThingAdapter.mjs', content: "import { IThing } from '#apps/x/ports/IThing.mjs'; export const value = IThing;" },
    ]);
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: 'adapters-port-contract-not-class' }),
    ]));
  });
  it('counts CLI consumers but excludes test-only fake consumers', () => {
    const withCli = analyzePortGovernance([
      { file: 'backend/src/3_applications/x/ports/IFoo.mjs', content: 'export class IFoo {}' },
      { file: 'cli/_bootstrap.mjs', content: "import { IFoo } from '#apps/x/ports/IFoo.mjs'; export const foo = IFoo;" },
    ]);
    expect(withCli.some((finding) => finding.rule === 'ports-zero-importers')).toBe(false);

    const testOnly = analyzePortGovernance([
      { file: 'backend/src/3_applications/x/ports/IFoo.mjs', content: 'export class IFoo {}' },
      { file: 'backend/src/3_applications/x/test/FakeFoo.mjs', content: "import { IFoo } from '../ports/IFoo.mjs'; export class FakeFoo extends IFoo {}" },
    ]);
    expect(testOnly.some((finding) => finding.rule === 'ports-zero-importers')).toBe(true);
  });
  it('allows 0_system to import the domain shared-kernel utils (D4)', () => {
    const v = scanViolations('backend/src/0_system/utils/time.mjs',
      "import { DEFAULT_TIMEZONE } from '#domains/core/utils/timezone.mjs';");
    expect(v.some(r => r.rule === 'system-no-upward')).toBe(false);
  });
  it('allows the D4 exception through a relative reference too', () => {
    const v = scanAstViolations('backend/src/0_system/utils/time.mjs',
      "import { DEFAULT_TIMEZONE } from '../../2_domains/core/utils/timezone.mjs';");
    expect(v.some(r => r.rule === 'system-no-upward')).toBe(false);
  });
  it('still flags 0_system importing a non-core domain', () => {
    const v = scanViolations('backend/src/0_system/x.mjs',
      "import { Foo } from '#domains/fitness/entities/Foo.mjs';");
    expect(v.some(r => r.rule === 'system-no-upward')).toBe(true);
  });
  it('exposes a rule table', () => {
    expect(RULES.length).toBeGreaterThan(5);
  });
  it('content rules are represented', () => {
    expect(CONTENT_RULES.map(r => r.rule)).toEqual(expect.arrayContaining(['api-handrolled-500', 'apps-success-false']));
  });
  it('AST semantic discovery rules are represented', () => {
    expect(AST_SEMANTIC_RULES.map(r => r.rule)).toEqual(expect.arrayContaining([
      'domains-no-ambient-clock',
      'apps-no-global-fetch',
      'domains-no-application-ports',
      'ports-zero-importers',
      'adapters-port-not-extended',
    ]));
  });
  it('groups all application infrastructure rules in one hard report', () => {
    expect(APPLICATION_INFRASTRUCTURE_RULES).toEqual(expect.arrayContaining([
      'apps-no-adapters',
      'apps-no-config-internals',
      'apps-no-node-infrastructure',
      'apps-no-global-fetch',
      'apps-no-global-timers',
      'apps-no-generic-eventbus',
      'apps-no-config-service-access',
      'no-storage-paths',
    ]));
  });
  it('keeps zeroed infrastructure and semantic rules hard instead of legitimizing debt', () => {
    expect(RULES.find(r => r.rule === 'apps-no-node-infrastructure')?.reportOnly).not.toBe(true);
    expect(RULES.find(r => r.rule === 'api-no-fileio')?.reportOnly).not.toBe(true);
    expect(RULES.find(r => r.rule === 'api-no-node-infrastructure')?.reportOnly).not.toBe(true);
    expect(RULES.find(r => r.rule === 'composition-no-fileio')?.reportOnly).not.toBe(true);
    expect(AST_SEMANTIC_RULES.find(r => r.rule === 'domains-no-ambient-clock')?.reportOnly).not.toBe(true);
    expect(AST_SEMANTIC_RULES.find(r => r.rule === 'apps-no-global-fetch')?.reportOnly).not.toBe(true);
    expect(AST_SEMANTIC_RULES.find(r => r.rule === 'apps-no-global-process')?.reportOnly).not.toBe(true);
    expect(AST_SEMANTIC_RULES.find(r => r.rule === 'api-no-global-process')?.reportOnly).not.toBe(true);
  });
  it('scanContent flags a hand-rolled 500 in a 4_api file', () => {
    const v = scanContent('backend/src/4_api/x/router.mjs',
      "  return res.status(500).json({ error: 'boom' });");
    expect(v.some(r => r.rule === 'api-handrolled-500')).toBe(true);
  });
  it('scanContent flags success:false in a 3_applications file', () => {
    const v = scanContent('backend/src/3_applications/x/Svc.mjs',
      "    return { success: false, error: err.message };");
    expect(v.some(r => r.rule === 'apps-success-false')).toBe(true);
  });
  it('scanContent flags success:false even when reordered after other keys', () => {
    const v = scanContent('backend/src/3_applications/x/Svc.mjs',
      "    return { error: err.message, success: false };");
    expect(v.some(r => r.rule === 'apps-success-false')).toBe(true);
  });
  it('scanContent does not flag content in the wrong layer', () => {
    const v = scanContent('backend/src/2_domains/x/Foo.mjs',
      "    return { success: false };");
    expect(v.length).toBe(0);
  });
  it('scanContent flags userDataService references outside 0_system/config', () => {
    const v = scanContent('backend/src/1_adapters/x/FooAdapter.mjs',
      "    const data = this.userDataService.readUserData(user, 'lifelog/fitness');");
    expect(v.some(r => r.rule === 'no-userdataservice')).toBe(true);
  });
  it('scanContent flags UserDataService imports (uppercase) too', () => {
    const v = scanContent('backend/src/3_applications/x/Svc.mjs',
      "import { userDataService } from '#system/config/UserDataService.mjs';");
    expect(v.some(r => r.rule === 'no-userdataservice')).toBe(true);
  });
  it('scanContent does not flag userDataService inside 0_system/config', () => {
    const v = scanContent('backend/src/0_system/config/UserDataService.mjs',
      "export const userDataService = new UserDataService();");
    expect(v.some(r => r.rule === 'no-userdataservice')).toBe(false);
  });
  it('allows composition to bind legacy user-data methods to narrow ports', () => {
    const v = scanContent('backend/src/5_composition/modules/x.mjs',
      "const load = (user) => userDataService.readUserData(user, 'current/todoist');");
    expect(v.some(r => r.rule === 'no-userdataservice')).toBe(false);
  });
  it('scanContent flags a toJSON() method definition in a 2_domains entity', () => {
    const v = scanContent('backend/src/2_domains/x/entities/Foo.mjs',
      "  toJSON() {");
    expect(v.some(r => r.rule === 'domains-tojson')).toBe(true);
  });
  it('scanContent does not flag a .toJSON() call site in 2_domains', () => {
    const v = scanContent('backend/src/2_domains/x/services/Svc.mjs',
      "    return items.map(i => i.toJSON());");
    expect(v.some(r => r.rule === 'domains-tojson')).toBe(false);
  });
  it('scanContent does not flag a toJSON() definition outside 2_domains', () => {
    const v = scanContent('backend/src/3_applications/x/Dto.mjs',
      "  toJSON() {");
    expect(v.some(r => r.rule === 'domains-tojson')).toBe(false);
  });

  describe('no-storage-paths — storage layout belongs to the adapter', () => {
    const flagged = (f, line) => scanContent(f, line).some((v) => v.rule === 'no-storage-paths');

    it('flags a household path literal in the application layer', () => {
      expect(flagged('backend/src/3_applications/hardware/x.mjs',
        "const DEFAULT_DIR = 'household/omr/log';")).toBe(true);
    });

    it('flags the segmented join form a path-literal grep would miss', () => {
      expect(flagged('backend/src/3_applications/x.mjs',
        "path.join(dataDir, 'household', 'fitness')")).toBe(true);
    });

    it('flags an API router naming a storage location', () => {
      expect(flagged('backend/src/4_api/v1/routers/x.mjs',
        "loadFile('household/weather/current')")).toBe(true);
    });

    it("does not flag 'household' used as a VALUE, not a path", () => {
      expect(flagged('backend/src/3_applications/school/y.mjs',
        "scopeType = 'household', scopeId = 'household',")).toBe(false);
    });

    it('allows the adapter layer, which owns storage addressing', () => {
      expect(flagged('backend/src/1_adapters/persistence/yaml/Z.mjs',
        "const REL = 'household/omr/log';")).toBe(false);
    });

    it('allows the composition root, whose job is wiring', () => {
      expect(flagged('backend/src/5_composition/modules/x.mjs',
        "path.join(dataDir, 'household', 'notifications')")).toBe(false);
      expect(flagged('backend/src/app.mjs',
        "path.join(dataDir, 'household', 'barcode')")).toBe(false);
    });

    it('allows the admin surface over household/config and household/auth', () => {
      // Those two are not domains and never move; editing them by name is a
      // different concern from domain data storage.
      expect(flagged('backend/src/3_applications/admin/AppsConfigService.mjs',
        "fitness: 'household/config/fitness.yml',")).toBe(false);
    });
  });
});
