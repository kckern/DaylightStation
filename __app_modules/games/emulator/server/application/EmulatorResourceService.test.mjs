import { vi } from 'vitest';
import { EmulatorResourceService } from "./EmulatorResourceService.mjs";

function missing() {
  const error = new Error('not found');
  error.code = 'ENOENT';
  return error;
}

function harness({ saveMode = 'battery', saveOwner = null } = {}) {
  const assetRepository = {
    getEngineResource: vi.fn((assetId) => {
      if (assetId === 'localization/fr-FR.json') throw missing();
      return { id: assetId };
    }),
    getRomResource: vi.fn(() => ({ id: 'rom' })),
    getArtResource: vi.fn(() => ({ id: 'art' })),
    getSystemLogoResource: vi.fn(() => ({ id: 'logo' })),
  };
  const saveRepository = {
    getSaveResource: vi.fn(), storeSaveArtifact: vi.fn(), deleteSave: vi.fn(),
    getStateResource: vi.fn(), storeStateArtifact: vi.fn(), deleteState: vi.fn(),
    listUsers: vi.fn(() => ['user_5']),
  };
  const config = { games: [{ id: 'game', saveMode }] };
  const service = new EmulatorResourceService({
    assetRepository,
    saveRepository,
    loadConfig: () => config,
    resolveGameRules: (_config, gameId) => gameId === 'game' ? { saveMode, saveOwner } : null,
  });
  return { service, assetRepository, saveRepository, config };
}

describe('EmulatorResourceService', () => {
  test('resolves ROM and art through semantic references', () => {
    const { service, assetRepository } = harness();
    expect(service.getRomResource({ system: 'gb', gameId: 'game' })).toEqual({ id: 'rom' });
    expect(assetRepository.getRomResource).toHaveBeenCalledWith({ system: 'gb', gameId: 'game' });
    expect(service.getArtResource({ system: 'gb', gameId: 'game', kind: 'cover' })).toEqual({ id: 'art' });
    expect(assetRepository.getArtResource).toHaveBeenCalledWith({ system: 'gb', gameId: 'game', kind: 'cover' });
    expect(service.getSystemLogoResource({ system: 'gb' })).toEqual({ id: 'logo' });
    expect(assetRepository.getSystemLogoResource).toHaveBeenCalledWith({ system: 'gb' });
  });

  test('falls back missing browser locales to localization/en.json', () => {
    const { service, assetRepository } = harness();
    expect(service.getEngineResource('localization/fr-FR.json')).toEqual({ id: 'localization/en.json' });
    expect(assetRepository.getEngineResource).toHaveBeenNthCalledWith(2, 'localization/en.json');
  });

  test('refuses save and state writes from anyone but the save owner', () => {
    const { service, saveRepository } = harness({ saveOwner: 'user_5' });
    const key = { system: 'gbc', gameId: 'game', user: 'user_4' };
    expect(() => service.storeSaveArtifact(key, {})).toThrow(expect.objectContaining({ code: 'ESAVEOWNER' }));
    expect(() => service.deleteSave(key)).toThrow(expect.objectContaining({ code: 'ESAVEOWNER' }));
    expect(() => service.storeStateArtifact({ ...key, slot: 'resume' }, {})).toThrow(expect.objectContaining({ code: 'ESAVEOWNER' }));
    expect(() => service.deleteState({ ...key, slot: 'resume' })).toThrow(expect.objectContaining({ code: 'ESAVEOWNER' }));
    expect(saveRepository.storeSaveArtifact).not.toHaveBeenCalled();
    expect(saveRepository.deleteSave).not.toHaveBeenCalled();
  });

  test('lets the save owner write, case-insensitively', () => {
    const { service, saveRepository } = harness({ saveOwner: 'user_5' });
    service.storeSaveArtifact({ system: 'gbc', gameId: 'game', user: 'User_5' }, {});
    expect(saveRepository.storeSaveArtifact).toHaveBeenCalled();
  });

  test('a game without an owner accepts any user', () => {
    const { service, saveRepository } = harness();
    service.storeSaveArtifact({ system: 'gbc', gameId: 'game', user: 'user_4' }, {});
    expect(saveRepository.storeSaveArtifact).toHaveBeenCalled();
  });

  test('does not scan save storage for a none-save game', () => {
    const { service, saveRepository } = harness({ saveMode: 'none' });
    expect(service.listSaveUsers({ system: 'gb', gameId: 'game' })).toEqual([]);
    expect(saveRepository.listUsers).not.toHaveBeenCalled();
  });

  test('lists users for a save-enabled game', () => {
    const { service, saveRepository } = harness();
    expect(service.listSaveUsers({ system: 'gb', gameId: 'game' })).toEqual(['user_5']);
    expect(saveRepository.listUsers).toHaveBeenCalledWith('gb', 'game');
  });
});
