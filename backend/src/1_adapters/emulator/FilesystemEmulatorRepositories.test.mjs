// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach } from 'vitest';
import {
  CORE_LOAD_CALL,
  FilesystemEmulatorAssetRepository,
  makeLoaderReentrant,
} from './FilesystemEmulatorAssetRepository.mjs';
import { FilesystemEmulatorSaveRepository } from './FilesystemEmulatorSaveRepository.mjs';
import { FilesystemEmulatorConfigRepository } from './FilesystemEmulatorConfigRepository.mjs';
import { IEmulatorAssetRepository } from '#apps/emulator/ports/IEmulatorAssetRepository.mjs';
import { IEmulatorSaveRepository } from '#apps/emulator/ports/IEmulatorSaveRepository.mjs';
import { IEmulatorConfigRepository } from '#apps/emulator/ports/IEmulatorConfigRepository.mjs';
import { loadEmulatorConfig } from '#apps/emulator/loadEmulatorConfig.mjs';

async function read(resource, range) {
  const chunks = [];
  for await (const chunk of resource.open(range)) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

describe('filesystem emulator repositories', () => {
  let root;
  let emulationDir;
  let engineDir;
  let config;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-emulator-'));
    emulationDir = path.join(root, 'emulation');
    engineDir = path.join(emulationDir, '_engine');
    fs.mkdirSync(path.join(emulationDir, 'gb', 'roms'), { recursive: true });
    fs.mkdirSync(engineDir, { recursive: true });
    fs.writeFileSync(path.join(emulationDir, 'gb', 'roms', 'Example Quest.gb'), 'ROMBYTES');
    fs.writeFileSync(path.join(emulationDir, 'gb', 'cover.png'), 'PNGDATA');
    fs.writeFileSync(path.join(emulationDir, 'gb', 'bezel.png'), 'BEZEL');
    fs.writeFileSync(path.join(engineDir, 'loader.js'), `${CORE_LOAD_CALL}\nNEXT`);
    config = {
      games: [{
        system: 'gb', id: 'example-quest', title: 'Example Quest',
        rom: 'roms/Example Quest.gb', boxart: 'cover.png', bezel: 'bezel.png',
      }],
    };
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  test('asset adapter implements its port and returns path-free range resources', async () => {
    const repository = new FilesystemEmulatorAssetRepository({ emulationDir, engineDir, loadCatalog: () => config });
    expect(repository).toBeInstanceOf(IEmulatorAssetRepository);

    const rom = repository.getRomResource({ system: 'gb', gameId: 'example-quest' });
    expect(Object.keys(rom).sort()).toEqual(['mimeType', 'open', 'size']);
    expect(rom).not.toHaveProperty('path');
    expect(rom.size).toBe(8);
    expect((await read(rom, { start: 1, end: 3 })).toString()).toBe('OMB');

    const art = repository.getArtResource({ system: 'gb', gameId: 'example-quest', kind: 'cover' });
    expect(art.mimeType).toBe('image/png');
    expect((await read(art)).toString()).toBe('PNGDATA');
  });

  test('asset adapter maps unknown games to ENOENT and contains manifest paths', () => {
    const repository = new FilesystemEmulatorAssetRepository({ emulationDir, engineDir, loadCatalog: () => config });
    expect(() => repository.getRomResource({ system: 'gb', gameId: 'missing' })).toThrow(
      expect.objectContaining({ code: 'ENOENT' }),
    );
    const malicious = new FilesystemEmulatorAssetRepository({
      emulationDir, engineDir,
      loadCatalog: () => ({ games: [{ system: 'gb', id: 'escape', rom: '../../../secret.gb' }] }),
    });
    expect(() => malicious.getRomResource({ system: 'gb', gameId: 'escape' })).toThrow(
      expect.objectContaining({ code: 'ENOENT' }),
    );
  });

  test('engine resources stay contained and loader.js is patched re-entrantly', async () => {
    const repository = new FilesystemEmulatorAssetRepository({ emulationDir, engineDir, loadCatalog: () => config });
    const loader = repository.getEngineResource('loader.js');
    const source = (await read(loader)).toString();
    expect(source).toContain('typeof window.EmulatorJS === "undefined"');
    expect(makeLoaderReentrant(source)).toBe(source);
    expect(() => repository.getEngineResource('../secret')).toThrow(
      expect.objectContaining({ code: 'ENOENT' }),
    );
  });

  test('save adapter atomically round-trips, deletes idempotently, and keeps paths opaque', async () => {
    const repository = new FilesystemEmulatorSaveRepository({ emulationDir });
    expect(repository).toBeInstanceOf(IEmulatorSaveRepository);
    const key = { system: 'gb', gameId: 'example-quest', user: 'user_5' };

    await repository.storeSaveArtifact(key, { async *chunks() { yield Buffer.from([1, 2, 3, 4]); } });
    const saved = repository.getSaveResource(key);
    expect(saved).not.toHaveProperty('path');
    expect(await read(saved)).toEqual(Buffer.from([1, 2, 3, 4]));
    await repository.deleteSave(key);
    await repository.deleteSave(key);
    expect(() => repository.getSaveResource(key)).toThrow(
      expect.objectContaining({ code: 'ENOENT' }),
    );
  });

  test('state storage and save-user discovery preserve the existing layout behavior', async () => {
    const repository = new FilesystemEmulatorSaveRepository({ emulationDir });
    await repository.storeSaveArtifact(
      { system: 'gb', gameId: 'example-quest', user: 'user_5' },
      { async *chunks() { yield Buffer.from('battery'); } },
    );
    await repository.storeStateArtifact(
      { system: 'gb', gameId: 'example-quest', slot: 'auto', user: 'user_4' },
      { async *chunks() { yield Buffer.from('state'); } },
    );
    await repository.storeStateArtifact(
      { system: 'gb', gameId: 'example-quest', slot: '1', user: 'user_5' },
      { async *chunks() { yield Buffer.from('state'); } },
    );

    expect(repository.listUsers('gb', 'example-quest')).toEqual(['user_4', 'user_5']);
    expect((await read(repository.getStateResource({
      system: 'gb', gameId: 'example-quest', slot: 'auto', user: 'user_4',
    }))).toString()).toBe('state');
    expect(() => repository.listUsers('..', 'example-quest')).toThrow('unsafe path segment');
  });

  test('config adapter implements its port and supplies loadEmulatorConfig', () => {
    fs.writeFileSync(path.join(emulationDir, 'gb', 'manifest.yml'), [
      'system: gb',
      'label: Game Boy',
      'core:',
      '  ejs_core: gb',
      'games:',
      '  - id: example-quest',
      '    title: Example Quest',
      '    rom: roms/Example Quest.gb',
    ].join('\n'));
    fs.writeFileSync(path.join(emulationDir, 'input.yml'), 'keyboard:\n  up: ArrowUp\n');
    fs.writeFileSync(path.join(emulationDir, 'settings.yml'), 'autosaveSeconds: 20\n');
    const repository = new FilesystemEmulatorConfigRepository({ emulationDir });
    expect(repository).toBeInstanceOf(IEmulatorConfigRepository);

    const loaded = loadEmulatorConfig({ configRepository: repository });
    expect(loaded.systems.gb.label).toBe('Game Boy');
    expect(loaded.games[0].id).toBe('example-quest');
    expect(loaded.input.keyboard.up).toBe('ArrowUp');
    expect(loaded.settings.autosaveSeconds).toBe(20);
  });

  test('optional malformed config is null while a missing emulator root yields no manifests', () => {
    fs.writeFileSync(path.join(emulationDir, 'input.yml'), 'not: [valid');
    const repository = new FilesystemEmulatorConfigRepository({ emulationDir });
    expect(repository.readInputConfig()).toBeNull();
    const absent = new FilesystemEmulatorConfigRepository({ emulationDir: path.join(root, 'absent') });
    expect(absent.readManifests()).toEqual([]);
  });
});
