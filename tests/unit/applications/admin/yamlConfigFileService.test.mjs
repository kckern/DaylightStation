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
import { YamlConfigFileService } from '#apps/admin/YamlConfigFileService.mjs';

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
  it('lists the editable config files', () => {
    const { files, count } = service.listFiles();
    const paths = files.map(f => f.path);
    expect(paths).toContain('system/config/system.yml');
    expect(paths).toContain('household/config/household.yml');
    expect(count).toBe(files.length);
    // Allowed files are not masked
    const sys = files.find(f => f.path === 'system/config/system.yml');
    expect(sys.masked).toBe(false);
  });

  it('reads an allowed file returning { raw, parsed }', () => {
    const result = service.readFile('system/config/system.yml');
    expect(result.raw).toContain('port: 3111');
    expect(result.parsed).toEqual({ port: 3111, host: 'localhost' });
    expect(result.path).toBe('system/config/system.yml');
  });

  it('writes an allowed file and round-trips the content', () => {
    const res = service.writeFile('household/config/household.yml', { raw: 'name: Updated\nusers:\n  - bob\n' });
    expect(res.ok).toBe(true);
    const readback = service.readFile('household/config/household.yml');
    expect(readback.parsed).toEqual({ name: 'Updated', users: ['bob'] });
  });

  it('writes from a parsed object (dump) and round-trips', () => {
    service.writeFile('household/config/household.yml', { parsed: { name: 'FromObject', count: 2 } });
    const readback = service.readFile('household/config/household.yml');
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
