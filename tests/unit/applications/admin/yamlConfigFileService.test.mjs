/**
 * Security tests for YamlConfigFileService.
 *
 * These lock the SECURITY-SENSITIVE behavior that the admin config router used
 * to inline (path-traversal guard, allow-list, auth-dir masking) as the logic
 * moves into the application service. Derived directly from the router's prior
 * behavior — any loosening of these guards must fail here.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { YamlConfigFileService, ALLOWED_FILES } from '#apps/admin/YamlConfigFileService.mjs';
import { HOUSEHOLD_APP_CONFIGS } from '#shared/contracts/householdConfig.mjs';

let tmpRoot;      // parent of the data root (used to plant an outside file)
let dataRoot;     // the service's data root
let service;
const outsideSecret = 'topsecret: OUTSIDE_VALUE\n';
const authSecret = 'token: PLEX_SECRET_TOKEN\n';

function write(rel, content) {
  const abs = path.join(dataRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yaml-cfg-svc-'));
  dataRoot = path.join(tmpRoot, 'data');
  fs.mkdirSync(dataRoot, { recursive: true });

  // Allowed dirs
  write('system/config/system.yml', 'port: 3111\nhost: localhost\n');
  write('system/config/scratch.yml', 'name: TestHome\nusers:\n  - alice\n');
  // Phase E: household/config/ is no longer an allowed dir. Still planted so
  // the inverted assertions below can prove it is DENIED, not merely absent.
  write('household/config/household.yml', 'name: TestHome\nusers:\n  - alice\n');
  // Masked (auth) dirs
  write('system/auth/secret.yml', 'apiKey: SYS_SECRET\n');
  write('household/auth/plex.yml', authSecret);
  // Within data root but NOT in an allowed dir
  write('other/notallowed.yml', 'nope: true\n');

  // A YAML file OUTSIDE the data root (traversal target)
  fs.writeFileSync(path.join(tmpRoot, 'outside-secret.yml'), outsideSecret, 'utf8');

  const configService = { getDataDir: () => dataRoot };
  service = new YamlConfigFileService({ configService, logger: { info() {}, warn() {}, error() {} } });
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('YamlConfigFileService — path traversal', () => {
  it('rejects a "../" traversal to a YAML file outside the data root and never returns its content', () => {
    let caught;
    try {
      service.readFile('../outside-secret.yml');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    // Must NOT leak the outside file content in any form.
    expect(caught?.raw).toBeUndefined();
    expect(JSON.stringify(caught || {})).not.toContain('OUTSIDE_VALUE');
  });

  it('rejects a deep traversal to a non-YAML system file (e.g. /etc/passwd)', () => {
    expect(() => service.readFile('../../../../etc/passwd')).toThrow();
  });

  it('rejects a "../" traversal on WRITE (does not create/modify outside the data root)', () => {
    const before = fs.readFileSync(path.join(tmpRoot, 'outside-secret.yml'), 'utf8');
    expect(() => service.writeFile('../outside-secret.yml', { raw: 'hacked: true\n' })).toThrow();
    const after = fs.readFileSync(path.join(tmpRoot, 'outside-secret.yml'), 'utf8');
    expect(after).toBe(before);
  });
});

describe('YamlConfigFileService — allow-list', () => {
  it('blocks reading a YAML file inside the data root but outside the allowed dirs', () => {
    expect(() => service.readFile('other/notallowed.yml')).toThrow();
  });

  it('blocks writing a YAML file outside the allowed dirs', () => {
    expect(() => service.writeFile('other/notallowed.yml', { raw: 'nope: false\n' })).toThrow();
    expect(fs.readFileSync(path.join(dataRoot, 'other/notallowed.yml'), 'utf8')).toBe('nope: true\n');
  });
});

describe('YamlConfigFileService — auth dir masking', () => {
  it('lists masked auth files with masked:true but they are still surfaced in the listing', () => {
    const { files } = service.listFiles();
    const plex = files.find(f => f.path === 'household/auth/plex.yml');
    const sysSecret = files.find(f => f.path === 'system/auth/secret.yml');
    expect(plex).toBeDefined();
    expect(plex.masked).toBe(true);
    expect(sysSecret).toBeDefined();
    expect(sysSecret.masked).toBe(true);
  });

  it('blocks READING a masked auth file and never returns the secret', () => {
    let caught;
    try {
      service.readFile('household/auth/plex.yml');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(JSON.stringify(caught || {})).not.toContain('PLEX_SECRET_TOKEN');
    expect(caught?.raw).toBeUndefined();
  });

  it('blocks WRITING a masked auth file (leaves it unchanged)', () => {
    expect(() => service.writeFile('household/auth/plex.yml', { raw: 'token: HIJACKED\n' })).toThrow();
    expect(fs.readFileSync(path.join(dataRoot, 'household/auth/plex.yml'), 'utf8')).toBe(authSecret);
  });
});

describe('YamlConfigFileService — happy path', () => {
  // INVERTED in Phase E: this used to assert household/config/household.yml
  // appears in the listing. household/config/ was dropped from ALLOWED_DIRS
  // with the directory itself, so the file must now be absent from the listing
  // — and, per the case below, refused on read and write.
  it('lists the editable config files and no longer lists household/config/', () => {
    const { files, count } = service.listFiles();
    const paths = files.map(f => f.path);
    expect(paths).toContain('system/config/system.yml');
    expect(paths).not.toContain('household/config/household.yml');
    expect(paths.filter(p => p.startsWith('household/config/'))).toEqual([]);
    expect(count).toBe(files.length);
    // Allowed files are not masked
    const sys = files.find(f => f.path === 'system/config/system.yml');
    expect(sys.masked).toBe(false);
  });

  // INVERTED in Phase E (the read/write round-trips below used to target
  // household/config/household.yml and prove it EDITABLE).
  it('DENIES reading and writing anything under the retired household/config/', () => {
    expect(() => service.readFile('household/config/household.yml')).toThrow();
    expect(() => service.writeFile('household/config/household.yml', { raw: 'name: Hacked\n' })).toThrow();
    // The planted file must be untouched by the refused write.
    expect(fs.readFileSync(path.join(dataRoot, 'household/config/household.yml'), 'utf8'))
      .toBe('name: TestHome\nusers:\n  - alice\n');
  });

  it('reads an allowed file returning { raw, parsed }', () => {
    const result = service.readFile('system/config/system.yml');
    expect(result.raw).toContain('port: 3111');
    expect(result.parsed).toEqual({ port: 3111, host: 'localhost' });
    expect(result.path).toBe('system/config/system.yml');
  });

  // Retargeted in Phase E from household/config/household.yml (no longer an
  // allowed dir) to a file in system/config/ — the round-trip is what these
  // two cases are about, not the specific path.
  it('writes an allowed file and round-trips the content', () => {
    const res = service.writeFile('system/config/scratch.yml', { raw: 'name: Updated\nusers:\n  - bob\n' });
    expect(res.ok).toBe(true);
    const readback = service.readFile('system/config/scratch.yml');
    expect(readback.parsed).toEqual({ name: 'Updated', users: ['bob'] });
  });

  it('writes from a parsed object (dump) and round-trips', () => {
    service.writeFile('system/config/scratch.yml', { parsed: { name: 'FromObject', count: 2 } });
    const readback = service.readFile('system/config/scratch.yml');
    expect(readback.parsed).toEqual({ name: 'FromObject', count: 2 });
  });

  it('rejects a non-YAML file path', () => {
    expect(() => service.readFile('system/config/system.json')).toThrow();
  });

  it('rejects invalid YAML on write', () => {
    expect(() => service.writeFile('system/config/system.yml', { raw: 'foo: [unclosed\n' })).toThrow();
  });

  it('returns not-found for a missing allowed file', () => {
    expect(() => service.readFile('system/config/does-not-exist.yml')).toThrow();
  });
});

// task-13 review, Important 4: the colocated ALLOWED_FILES list first
// shipped with only 3 of the 11 files colocation actually created, silently
// 403ing the other 8 (school, media, livestream, newsreporter,
// notifications, agents, content-prefixes) even though they were reachable
// through this same admin surface before the move. These tests pin BOTH
// directions so a future edit can't silently narrow OR widen the grant:
// every colocated config file must be reachable, and — the whole reason
// this is a file allowlist and not a directory one — a sibling file in the
// same domain folder (e.g. fitness/log/'s session telemetry) must still be
// denied.
describe('YamlConfigFileService — colocated file allowlist (task-13)', () => {
  const colocated = [
    'household/fitness/config.yml',
    'household/gratitude/config.yml',
    'household/harvest/config.yml',
    'household/school/school.yml',
    'household/media/config.yml',
    'household/livestream/config.yml',
    'household/newsreporter/config.yml',
    'household/notifications/config.yml',
    'household/agents/config.yml',
    'household/media/content-prefixes.yml',
  ];

  beforeEach(() => {
    for (const rel of colocated) write(rel, 'marker: colocated\n');
    // A sibling file in the SAME domain folder as an allowed file, but not
    // itself allowed — proves the grant is file-scoped, not directory-scoped.
    write('household/fitness/log/2026-08-16/session-abc123.yml', 'heartRate: 140\n');
  });

  it.each(colocated)('allows reading %s', (rel) => {
    const result = service.readFile(rel);
    expect(result.parsed).toEqual({ marker: 'colocated' });
  });

  it.each(colocated)('allows writing %s', (rel) => {
    const res = service.writeFile(rel, { parsed: { marker: 'updated' } });
    expect(res.ok).toBe(true);
    expect(service.readFile(rel).parsed).toEqual({ marker: 'updated' });
  });

  it('DENIES reading a sibling telemetry file inside the same domain folder as an allowed file', () => {
    expect(() => service.readFile('household/fitness/log/2026-08-16/session-abc123.yml')).toThrow();
  });

  it('DENIES writing a sibling telemetry file inside the same domain folder as an allowed file', () => {
    expect(() => service.writeFile('household/fitness/log/2026-08-16/session-abc123.yml', { raw: 'heartRate: 999\n' }))
      .toThrow();
    expect(fs.readFileSync(path.join(dataRoot, 'household/fitness/log/2026-08-16/session-abc123.yml'), 'utf8'))
      .toBe('heartRate: 140\n');
  });

  it('lists every colocated file with masked:false', () => {
    const { files } = service.listFiles();
    for (const rel of colocated) {
      const entry = files.find(f => f.path === rel);
      expect(entry, `expected ${rel} in listFiles()`).toBeDefined();
      expect(entry.masked).toBe(false);
    }
    // The telemetry sibling must NOT appear in the listing at all.
    expect(files.find(f => f.path === 'household/fitness/log/2026-08-16/session-abc123.yml')).toBeUndefined();
  });
});

// Task 17b: the registry stores paths WITHOUT an extension because every
// runtime reader resolves .yml OR .yaml via resolveYamlPath. ALLOWED_FILES used
// to append a hardcoded '.yml', so an app whose file happened to land as .yaml
// booted fine and then 403'd here — a silent, signal-free failure, the exact
// class task-13's review found when 8 of 11 colocated files were unreachable.
describe('YamlConfigFileService — .yaml registry entries are allowlisted (task-17b)', () => {
  // Drive off the real registry rather than a literal so a renamed entry cannot
  // leave this passing against a path that no longer exists.
  const sampleRel = HOUSEHOLD_APP_CONFIGS.fitness;   // 'fitness/config'

  it('allowlists BOTH extensions for every registry entry', () => {
    for (const rel of Object.values(HOUSEHOLD_APP_CONFIGS)) {
      expect(ALLOWED_FILES).toContain(`household/${rel}.yml`);
      expect(ALLOWED_FILES).toContain(`household/${rel}.yaml`);
    }
  });

  it('reads and writes a registry entry that landed on disk as .yaml', () => {
    const rel = `household/${sampleRel}.yaml`;
    write(rel, 'marker: yaml-extension\n');

    expect(service.readFile(rel).parsed).toEqual({ marker: 'yaml-extension' });
    expect(service.writeFile(rel, { parsed: { marker: 'updated' } }).ok).toBe(true);
    expect(service.readFile(rel).parsed).toEqual({ marker: 'updated' });
  });

  it('lists a .yaml-suffixed config with masked:false', () => {
    const rel = `household/${sampleRel}.yaml`;
    write(rel, 'marker: yaml-extension\n');
    const entry = service.listFiles().files.find(f => f.path === rel);
    expect(entry, `expected ${rel} in listFiles()`).toBeDefined();
    expect(entry.masked).toBe(false);
  });

  // Widening to a second extension must not have widened the grant beyond the
  // registry: masking still wins, and a non-registry .yaml is still refused.
  it('does not widen the grant to arbitrary .yaml files', () => {
    write('household/fitness/log/2026-08-16/session-abc123.yaml', 'heartRate: 140\n');
    expect(() => service.readFile('household/fitness/log/2026-08-16/session-abc123.yaml')).toThrow();
    expect(() => service.readFile('household/auth/plex.yaml')).toThrow();
    expect(ALLOWED_FILES.some(p => p.startsWith('household/auth/'))).toBe(false);
  });
});

// I3 (final-review fix wave, 2026-08-16): task-13's review deferred
// re-adding household/integrations.yml here, reasoning it "has a dedicated
// admin surface elsewhere" — false, IntegrationsQueryService has zero write
// methods, so leaving it off ALLOWED_FILES made it editable only by
// shelling into the container. This restores it.
describe('YamlConfigFileService — integrations.yml allowlist (I3)', () => {
  beforeEach(() => {
    write('household/integrations.yml', 'plex:\n  enabled: true\n');
  });

  it('is listed with masked:false', () => {
    const { files } = service.listFiles();
    const entry = files.find(f => f.path === 'household/integrations.yml');
    expect(entry).toBeDefined();
    expect(entry.masked).toBe(false);
  });

  it('is readable and writable through the generic admin YAML browser', () => {
    const result = service.readFile('household/integrations.yml');
    expect(result.parsed).toEqual({ plex: { enabled: true } });

    const res = service.writeFile('household/integrations.yml', { parsed: { plex: { enabled: false } } });
    expect(res.ok).toBe(true);
    expect(service.readFile('household/integrations.yml').parsed).toEqual({ plex: { enabled: false } });
  });
});
