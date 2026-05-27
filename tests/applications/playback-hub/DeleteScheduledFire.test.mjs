import { describe, it, expect, beforeEach } from 'vitest';
import { DeleteScheduledFire } from '../../../backend/src/3_applications/playback-hub/usecases/DeleteScheduledFire.mjs';
import { FakeHubConfigRepository } from '../../../backend/src/3_applications/playback-hub/test/FakeHubConfigRepository.mjs';
import { HubConfig } from '../../../backend/src/2_domains/playback-hub/entities/HubConfig.mjs';
import { HubDevice } from '../../../backend/src/2_domains/playback-hub/entities/HubDevice.mjs';
import { ScheduledFire } from '../../../backend/src/2_domains/playback-hub/entities/ScheduledFire.mjs';
import { SlotPosition } from '../../../backend/src/2_domains/playback-hub/value-objects/SlotPosition.mjs';
import { SlotColor } from '../../../backend/src/2_domains/playback-hub/value-objects/SlotColor.mjs';
import { SlotClass } from '../../../backend/src/2_domains/playback-hub/value-objects/SlotClass.mjs';
import { VolumeBounds } from '../../../backend/src/2_domains/playback-hub/value-objects/VolumeBounds.mjs';
import { DayPattern } from '../../../backend/src/2_domains/playback-hub/value-objects/DayPattern.mjs';
import { QueueRef } from '../../../backend/src/2_domains/playback-hub/value-objects/QueueRef.mjs';
import { EntityNotFoundError } from '../../../backend/src/2_domains/core/errors/EntityNotFoundError.mjs';

const makeDevice = (color = 'red') => new HubDevice({
  position: new SlotPosition(1),
  color: new SlotColor(color),
  mac: '41:42:3A:E5:43:07',
  class: new SlotClass('private'),
  volumeBounds: new VolumeBounds({})
});

const makeFire = (id, target = 'red') => new ScheduledFire({
  id, time: '07:00',
  days: new DayPattern('weekdays'),
  target,
  queue: QueueRef.parse('plex:1')
});

describe('DeleteScheduledFire', () => {
  let repo, useCase;
  beforeEach(() => {
    repo = new FakeHubConfigRepository();
    useCase = new DeleteScheduledFire({ hubConfigRepository: repo });
  });

  it('removes an existing fire and saves the new config', async () => {
    repo.setConfig(new HubConfig({
      devices: [makeDevice('red')],
      scheduledFires: [makeFire('to-delete'), makeFire('keep', 'red')]
    }));
    await useCase.execute({ id: 'to-delete' });
    expect(repo.lastSaved).not.toBeNull();
    expect(repo.lastSaved.scheduledFires.map(f => f.id)).toEqual(['keep']);
  });

  it('unknown id → EntityNotFoundError, no save', async () => {
    repo.setConfig(new HubConfig({
      devices: [makeDevice('red')],
      scheduledFires: [makeFire('alive')]
    }));
    await expect(useCase.execute({ id: 'never-existed' }))
      .rejects.toThrow(EntityNotFoundError);
    expect(repo.saveCount).toBe(0);
  });

  it('throws when constructed without dependencies', () => {
    expect(() => new DeleteScheduledFire({})).toThrow(/hubConfigRepository/);
  });
});
