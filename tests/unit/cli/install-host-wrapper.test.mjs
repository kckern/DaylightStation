// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

describe('host wrapper install', () => {
  const root = path.resolve(import.meta.dirname, '../../..');

  it('install script exists and starts with shebang', async () => {
    const text = await fs.readFile(path.join(root, 'cli/scripts/install-host-wrapper.sh'), 'utf8');
    expect(text.startsWith('#!/bin/sh')).toBe(true);
    expect(text).toMatch(/sudo/);
    expect(text).toMatch(/\/usr\/local\/bin\/dscli/);
  });

  it('install script requires root', async () => {
    const text = await fs.readFile(path.join(root, 'cli/scripts/install-host-wrapper.sh'), 'utf8');
    expect(text).toMatch(/id -u.*-ne 0/);
  });

  it('template references docker exec daylight-station', async () => {
    const text = await fs.readFile(path.join(root, 'cli/scripts/host-wrapper-template.sh'), 'utf8');
    expect(text.startsWith('#!/bin/sh')).toBe(true);
    expect(text).toMatch(/docker exec.*daylight-station/);
    expect(text).toMatch(/cli\/dscli\.mjs/);
  });

  it('both scripts are executable', async () => {
    const installStat = await fs.stat(path.join(root, 'cli/scripts/install-host-wrapper.sh'));
    const templateStat = await fs.stat(path.join(root, 'cli/scripts/host-wrapper-template.sh'));
    // Mode bits: 0o111 means at least one executable bit is set
    expect(installStat.mode & 0o111).not.toBe(0);
    expect(templateStat.mode & 0o111).not.toBe(0);
  });
});
