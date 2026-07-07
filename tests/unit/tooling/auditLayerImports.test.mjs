import { describe, it, expect } from 'vitest';
import { scanViolations, RULES, CONTENT_RULES } from '../../../scripts/audit-layer-imports.mjs';

describe('audit-layer-imports', () => {
  it('flags a domain file importing an adapter', () => {
    const v = scanViolations('backend/src/2_domains/x/Foo.mjs',
      "import { Bar } from '#adapters/thing/Bar.mjs';");
    expect(v.some(r => r.rule === 'domains-no-adapters')).toBe(true);
  });
  it('allows the composition root to import adapters', () => {
    const v = scanViolations('backend/src/0_system/bootstrap.mjs',
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
});
