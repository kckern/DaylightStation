import { describe, it, expect, beforeEach } from 'vitest';
import { GetHubConfig } from '../../../backend/src/3_applications/playback-hub/usecases/GetHubConfig.mjs';
import { FakeHubConfigRepository } from '../../../backend/src/3_applications/playback-hub/test/FakeHubConfigRepository.mjs';
import { HubConfig } from '../../../backend/src/2_domains/playback-hub/entities/HubConfig.mjs';
import { HubDevice } from '../../../backend/src/2_domains/playback-hub/entities/HubDevice.mjs';
import { SlotPosition } from '../../../backend/src/2_domains/playback-hub/value-objects/SlotPosition.mjs';
import { SlotColor } from '../../../backend/src/2_domains/playback-hub/value-objects/SlotColor.mjs';
import { SlotClass } from '../../../backend/src/2_domains/playback-hub/value-objects/SlotClass.mjs';
import { VolumeBounds } from '../../../backend/src/2_domains/playback-hub/value-objects/VolumeBounds.mjs';
import { EntityNotFoundError } from '../../../backend/src/2_domains/core/errors/EntityNotFoundError.mjs';

const makeConfig = () => new HubConfig({
  devices: [
    new HubDevice({
      position: new SlotPosition(1),
      color: new SlotColor('red'),
      mac: '41:42:3A:E5:43:07',
      class: new SlotClass('private'),
      volumeBounds: new VolumeBounds({})
    })
  ]
});

describe('GetHubConfig', () => {
  let repo;
  beforeEach(() => {
    repo = new FakeHubConfigRepository();
  });

  it('returns the HubConfig from the repository', async () => {
    const config = makeConfig();
    repo.setConfig(config);
    const useCase = new GetHubConfig({ hubConfigRepository: repo });
    const result = await useCase.execute();
    expect(result).toBe(config);
  });

  it('propagates EntityNotFoundError when repo has no config', async () => {
    const useCase = new GetHubConfig({ hubConfigRepository: repo });
    await expect(useCase.execute()).rejects.toThrow(EntityNotFoundError);
  });

  it('throws when constructed without a repository', () => {
    expect(() => new GetHubConfig({})).toThrow(/hubConfigRepository/);
  });
});
