import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { HomeAssistantRoutineFileSource } from './HomeAssistantRoutineFileSource.mjs';

describe('HomeAssistantRoutineFileSource', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ha-includes-'));
    for (const d of ['rest_commands', 'scripts', 'automations']) mkdirSync(join(dir, d));
    writeFileSync(join(dir, 'rest_commands', 'devices.yaml'),
      'device_livingroom_tv:\n  url: http://daylight-station:3111/api/v1/device/livingroom-tv/{{ action }}\n  method: GET\n');
    writeFileSync(join(dir, 'rest_commands', 'secret.yaml'), 'other:\n  url: !secret other_url\n');
    writeFileSync(join(dir, 'scripts', 'livingroom_tv_sequence.yaml'),
      "alias: Living Room TV Sequence\nsequence:\n- service: rest_command.device_livingroom_tv\n  data:\n    action: \"load?{{ query | default('queue=music') }}\"\n");
    writeFileSync(join(dir, 'automations', 'kitchen_button_1.yaml'),
      "alias: 'Kitchen Button 1: Morning Program'\nid: kitchen_button_1\nactions:\n- action: script.livingroom_tv_sequence\n  data:\n    query: queue=morning-program\n");
    writeFileSync(join(dir, 'automations', 'listed.yaml'), '- alias: Two\n  id: two\n  actions: []\n');
    writeFileSync(join(dir, 'automations', 'broken.yaml'), 'alias: [unterminated\n');
    writeFileSync(join(dir, 'automations', 'notes.txt'), 'ignored');
    mkdirSync(join(dir, 'automations', 'kitchen'));
    writeFileSync(join(dir, 'automations', 'kitchen', 'nested.yaml'), 'alias: Nested\nid: nested\nactions: []\n');
    mkdirSync(join(dir, 'scripts', 'tv'));
    writeFileSync(join(dir, 'scripts', 'tv', 'deep_script.yaml'), 'alias: Deep\nsequence: []\n');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reads rest commands (merged), scripts (named by file) and automations (one per file or a list), tolerating HA tags', async () => {
    const logger = { warn: vi.fn(), debug: vi.fn() };
    const source = new HomeAssistantRoutineFileSource({ configDir: dir, logger });
    const config = await source.read();
    expect(Object.keys(config.restCommands).sort()).toEqual(['device_livingroom_tv', 'other']);
    expect(config.scripts.livingroom_tv_sequence.alias).toBe('Living Room TV Sequence');
    // include_dir_* recurse into subdirectories; scripts are named by file.
    expect(config.automations.map((a) => a.id).sort()).toEqual(['kitchen_button_1', 'nested', 'two']);
    expect(config.scripts.deep_script.alias).toBe('Deep');
    const [, logged] = logger.warn.mock.calls.find(([event]) => event === 'media.routines.ha_file_unreadable');
    expect(logged).toMatchObject({ file: expect.stringContaining('broken.yaml'), error: 'YAMLException', line: expect.any(Number) });
    // js-yaml's message quotes the offending config line; it is never logged.
    expect(JSON.stringify(logged)).not.toContain('unterminated');
  });

  it('reports unavailable when the directory is not there (e.g. inside the container)', async () => {
    const source = new HomeAssistantRoutineFileSource({ configDir: join(dir, 'nope') });
    expect(source.available()).toBe(false);
    expect(await source.read()).toBeNull();
    expect(new HomeAssistantRoutineFileSource({ configDir: null }).available()).toBe(false);
  });
});
