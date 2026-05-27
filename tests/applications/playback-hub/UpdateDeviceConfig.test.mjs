import { describe, it, expect, beforeEach } from 'vitest';
import { UpdateDeviceConfig } from '../../../backend/src/3_applications/playback-hub/usecases/UpdateDeviceConfig.mjs';
import { FakeHubConfigRepository } from '../../../backend/src/3_applications/playback-hub/test/FakeHubConfigRepository.mjs';
import { HubConfig } from '../../../backend/src/2_domains/playback-hub/entities/HubConfig.mjs';
import { HubDevice } from '../../../backend/src/2_domains/playback-hub/entities/HubDevice.mjs';
import { SlotPosition } from '../../../backend/src/2_domains/playback-hub/value-objects/SlotPosition.mjs';
import { SlotColor } from '../../../backend/src/2_domains/playback-hub/value-objects/SlotColor.mjs';
import { SlotClass } from '../../../backend/src/2_domains/playback-hub/value-objects/SlotClass.mjs';
import { VolumeBounds } from '../../../backend/src/2_domains/playback-hub/value-objects/VolumeBounds.mjs';
import { EntityNotFoundError } from '../../../backend/src/2_domains/core/errors/EntityNotFoundError.mjs';
import { DomainInvariantError } from '../../../backend/src/2_domains/core/errors/DomainInvariantError.mjs';

const makeDevice = ({
  position = 1, color = 'red', mac = '41:42:3A:E5:43:07',
  cls = 'private', haEntityId = null, volumeBounds
} = {}) => new HubDevice({
  position: new SlotPosition(position),
  color: new SlotColor(color),
  mac,
  class: new SlotClass(cls),
  haEntityId,
  volumeBounds: volumeBounds || new VolumeBounds({})
});

describe('UpdateDeviceConfig', () => {
  let repo, useCase;
  beforeEach(() => {
    repo = new FakeHubConfigRepository();
    useCase = new UpdateDeviceConfig({ hubConfigRepository: repo });
  });

  it('patches the device and saves the new HubConfig', async () => {
    repo.setConfig(new HubConfig({
      devices: [makeDevice({ color: 'red' })]
    }));
    const updated = await useCase.execute({
      color: 'red',
      patch: { volumeBounds: new VolumeBounds({ default: 40, max: 50 }) }
    });
    expect(updated).toBeInstanceOf(HubDevice);
    expect(updated.volumeBounds.max).toBe(50);
    expect(repo.lastSaved).not.toBeNull();
    expect(repo.lastSaved.findDevice('red').volumeBounds.max).toBe(50);
  });

  it('domain invariant violation aborts the save (lastSaved unchanged)', async () => {
    repo.setConfig(new HubConfig({
      devices: [makeDevice({
        color: 'white',
        cls: 'public',
        haEntityId: 'switch.living_room'
      })]
    }));
    // Removing the ha_entity_id from a public device violates the invariant.
    await expect(useCase.execute({
      color: 'white',
      patch: { haEntityId: null }
    })).rejects.toThrow(DomainInvariantError);
    expect(repo.lastSaved).toBeNull(); // never saved
    expect(repo.saveCount).toBe(0);
  });

  it('unknown color → EntityNotFoundError', async () => {
    repo.setConfig(new HubConfig({
      devices: [makeDevice({ color: 'red' })]
    }));
    await expect(useCase.execute({
      color: 'orange',
      patch: { volumeBounds: new VolumeBounds({ default: 40, max: 50 }) }
    })).rejects.toThrow(EntityNotFoundError);
    expect(repo.saveCount).toBe(0);
  });

  it('throws when constructed without dependencies', () => {
    expect(() => new UpdateDeviceConfig({})).toThrow(/hubConfigRepository/);
  });
});
