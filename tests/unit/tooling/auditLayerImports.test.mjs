import { describe, it, expect } from 'vitest';
import { scanViolations, scanContent, RULES, CONTENT_RULES } from '../../../scripts/audit-layer-imports.mjs';

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
  it('flags raw fs import in 3_applications', () => {
    const v = scanViolations('backend/src/3_applications/x/Svc.mjs',
      "import fs from 'node:fs';");
    expect(v.some(r => r.rule === 'apps-no-fs')).toBe(true);
  });
  it('allows 0_system to import the domain shared-kernel utils (D4)', () => {
    const v = scanViolations('backend/src/0_system/utils/time.mjs',
      "import { DEFAULT_TIMEZONE } from '#domains/core/utils/timezone.mjs';");
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
