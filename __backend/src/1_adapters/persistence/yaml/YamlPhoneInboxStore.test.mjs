import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { YamlPhoneInboxStore } from './YamlPhoneInboxStore.mjs';

// The inbox file must never read as empty when it is merely unreadable or damaged.
describe('YamlPhoneInboxStore', () => {
  let root; let store; let file;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-store-'));
    store = new YamlPhoneInboxStore({ resolvePath: (rel) => path.join(root, `${rel}.yml`) });
    file = path.join(root, 'history/devices/phone/inbox.yml');
  });

  it('no file yet is null', () => {
    expect(store.load('phone')).toBeNull();
  });

  it('saves atomically and reads back', async () => {
    await store.save('phone', { installs: [{ installId: 'install-aaaa-1111' }] });
    expect(store.load('phone').installs[0].installId).toBe('install-aaaa-1111');
    expect(fs.readdirSync(path.dirname(file)).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('a damaged or empty file throws (never read as empty) and can be kept aside', async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'installs: [unclosed');
    expect(() => store.load('phone')).toThrow();
    store.quarantine('phone');
    const bad = fs.readdirSync(path.join(path.dirname(file), '_bad'));
    expect(bad).toHaveLength(1);
    expect(fs.readFileSync(path.join(path.dirname(file), '_bad', bad[0]), 'utf8')).toBe('installs: [unclosed');
    fs.writeFileSync(file, '');
    expect(() => store.load('phone')).toThrow(expect.objectContaining({ damaged: true }));
  });

  it('refuses a device id that is not a safe path segment', () => {
    expect(() => store.load('../etc')).toThrow(TypeError);
  });
});
