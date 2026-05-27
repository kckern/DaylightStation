import { describe, it, expect, beforeEach } from 'vitest';
import { SaveScheduledFire } from '../../../backend/src/3_applications/playback-hub/usecases/SaveScheduledFire.mjs';
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

describe('SaveScheduledFire', () => {
  let repo, useCase;
  beforeEach(() => {
    repo = new FakeHubConfigRepository();
    useCase = new SaveScheduledFire({ hubConfigRepository: repo });
  });

  it('upserts a new fire (id not in config) and saves', async () => {
    repo.setConfig(new HubConfig({
      devices: [makeDevice({ color: 'red' })]
    }));
    const fire = await useCase.execute({
      fire: {
        id: 'morning-alarm',
        time: '07:00',
        days: 'weekdays',
        target: 'red',
        queue: 'plex:670208'
      }
    });
    expect(fire).toBeInstanceOf(ScheduledFire);
    expect(fire.id).toBe('morning-alarm');
    expect(repo.lastSaved).not.toBeNull();
    expect(repo.lastSaved.scheduledFires).toHaveLength(1);
    expect(repo.lastSaved.findScheduledFire('morning-alarm').time).toBe('07:00');
  });

  it('updates an existing fire (same id) and saves', async () => {
    const existing = new ScheduledFire({
      id: 'wake',
      time: '06:30',
      days: new DayPattern('all'),
      target: 'red',
      queue: QueueRef.parse('plex:111')
    });
    repo.setConfig(new HubConfig({
      devices: [makeDevice({ color: 'red' })],
      scheduledFires: [existing]
    }));
    const updated = await useCase.execute({
      fire: {
        id: 'wake',
        time: '06:45',
        days: 'all',
        target: 'red',
        queue: 'plex:999'
      }
    });
    expect(updated.time).toBe('06:45');
    expect(updated.queue.toString()).toBe('plex:999');
    expect(repo.lastSaved.scheduledFires).toHaveLength(1);
  });

  it('target color does not exist → EntityNotFoundError', async () => {
    repo.setConfig(new HubConfig({
      devices: [makeDevice({ color: 'red' })]
    }));
    await expect(useCase.execute({
      fire: {
        id: 'bad',
        time: '07:00',
        days: 'weekdays',
        target: 'orange',
        queue: 'plex:1'
      }
    })).rejects.toThrow(EntityNotFoundError);
    expect(repo.saveCount).toBe(0);
  });

  it('volumeOverride > target.max → DomainInvariantError', async () => {
    repo.setConfig(new HubConfig({
      devices: [makeDevice({
        color: 'red',
        volumeBounds: new VolumeBounds({ max: 60 })
      })]
    }));
    await expect(useCase.execute({
      fire: {
        id: 'too-loud',
        time: '07:00',
        days: 'weekdays',
        target: 'red',
        queue: 'plex:1',
        volumeOverride: 90
      }
    })).rejects.toThrow(DomainInvariantError);
    expect(repo.saveCount).toBe(0);
  });

  it('supports day arrays', async () => {
    repo.setConfig(new HubConfig({
      devices: [makeDevice({ color: 'red' })]
    }));
    const fire = await useCase.execute({
      fire: {
        id: 'mwf',
        time: '07:00',
        days: ['mon', 'wed', 'fri'],
        target: 'red',
        queue: 'plex:1'
      }
    });
    expect(fire.days.value).toEqual(['mon', 'wed', 'fri']);
  });

  it('throws when constructed without dependencies', () => {
    expect(() => new SaveScheduledFire({})).toThrow(/hubConfigRepository/);
  });
});
