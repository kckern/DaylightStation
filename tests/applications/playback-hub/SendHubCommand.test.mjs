import { describe, it, expect, beforeEach } from 'vitest';
import { SendHubCommand } from '../../../backend/src/3_applications/playback-hub/usecases/SendHubCommand.mjs';
import { FakeHubGateway } from '../../../backend/src/3_applications/playback-hub/test/FakeHubGateway.mjs';
import { FakeHubConfigRepository } from '../../../backend/src/3_applications/playback-hub/test/FakeHubConfigRepository.mjs';
import { HubConfig } from '../../../backend/src/2_domains/playback-hub/entities/HubConfig.mjs';
import { HubDevice } from '../../../backend/src/2_domains/playback-hub/entities/HubDevice.mjs';
import { SlotPosition } from '../../../backend/src/2_domains/playback-hub/value-objects/SlotPosition.mjs';
import { SlotColor } from '../../../backend/src/2_domains/playback-hub/value-objects/SlotColor.mjs';
import { SlotClass } from '../../../backend/src/2_domains/playback-hub/value-objects/SlotClass.mjs';
import { VolumeBounds } from '../../../backend/src/2_domains/playback-hub/value-objects/VolumeBounds.mjs';
import { CommandResult } from '../../../backend/src/2_domains/playback-hub/value-objects/CommandResult.mjs';
import { ValidationError } from '../../../backend/src/2_domains/core/errors/ValidationError.mjs';
import { EntityNotFoundError } from '../../../backend/src/2_domains/core/errors/EntityNotFoundError.mjs';
import { InfrastructureError } from '../../../backend/src/0_system/utils/errors/InfrastructureError.mjs';

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

const makeConfig = (devices) => new HubConfig({ devices });

describe('SendHubCommand', () => {
  let gateway, repo, useCase;

  beforeEach(() => {
    gateway = new FakeHubGateway();
    repo = new FakeHubConfigRepository();
    useCase = new SendHubCommand({
      headsetHubGateway: gateway,
      hubConfigRepository: repo
    });
  });

  it('single-target play with valid content → CommandResult.applied contains that color', async () => {
    repo.setConfig(makeConfig([
      makeDevice({ color: 'red' }),
      makeDevice({ position: 2, color: 'blue', mac: '41:42:3A:E5:43:08' })
    ]));
    gateway.setNextCommandResult(new CommandResult({ applied: ['red'], skipped: [] }));
    const result = await useCase.execute({
      action: 'play', target: 'red', contentId: '670208'
    });
    expect(result.applied).toContain('red');
    expect(gateway.lastCall.targets.map(d => d.color.value)).toEqual(['red']);
  });

  it('"all" target expands to every device color', async () => {
    repo.setConfig(makeConfig([
      makeDevice({ color: 'red' }),
      makeDevice({ position: 2, color: 'blue', mac: '41:42:3A:E5:43:08' }),
      makeDevice({
        position: 3, color: 'white', mac: '41:42:3A:E5:43:09',
        cls: 'public', haEntityId: 'switch.living_room'
      })
    ]));
    gateway.enqueueCommandResult(new CommandResult({ applied: ['red'], skipped: [] }));
    gateway.enqueueCommandResult(new CommandResult({ applied: ['blue'], skipped: [] }));
    gateway.enqueueCommandResult(new CommandResult({ applied: ['white'], skipped: [] }));
    const result = await useCase.execute({ action: 'stop', target: 'all' });
    expect([...result.applied].sort()).toEqual(['blue', 'red', 'white']);
    expect(gateway.calls.length).toBe(3);
  });

  it('"all-private" target → only private devices', async () => {
    repo.setConfig(makeConfig([
      makeDevice({ color: 'red', cls: 'private' }),
      makeDevice({ position: 2, color: 'blue', mac: '41:42:3A:E5:43:08', cls: 'private' }),
      makeDevice({
        position: 3, color: 'white', mac: '41:42:3A:E5:43:09',
        cls: 'public', haEntityId: 'switch.living_room'
      })
    ]));
    gateway.enqueueCommandResult(new CommandResult({ applied: ['red'], skipped: [] }));
    gateway.enqueueCommandResult(new CommandResult({ applied: ['blue'], skipped: [] }));
    const result = await useCase.execute({ action: 'stop', target: 'all-private' });
    expect([...result.applied].sort()).toEqual(['blue', 'red']);
    expect(gateway.calls.length).toBe(2);
  });

  it('"all-public" target → only public devices', async () => {
    repo.setConfig(makeConfig([
      makeDevice({ color: 'red', cls: 'private' }),
      makeDevice({
        position: 2, color: 'white', mac: '41:42:3A:E5:43:09',
        cls: 'public', haEntityId: 'switch.living_room'
      }),
      makeDevice({
        position: 3, color: 'green', mac: '41:42:3A:E5:43:10',
        cls: 'public', haEntityId: 'switch.kitchen'
      })
    ]));
    gateway.enqueueCommandResult(new CommandResult({ applied: ['white'], skipped: [] }));
    gateway.enqueueCommandResult(new CommandResult({ applied: ['green'], skipped: [] }));
    const result = await useCase.execute({ action: 'stop', target: 'all-public' });
    expect([...result.applied].sort()).toEqual(['green', 'white']);
    expect(gateway.calls.length).toBe(2);
  });

  it('comma-list target "red,blue" → both expanded', async () => {
    repo.setConfig(makeConfig([
      makeDevice({ color: 'red' }),
      makeDevice({ position: 2, color: 'blue', mac: '41:42:3A:E5:43:08' }),
      makeDevice({ position: 3, color: 'yellow', mac: '41:42:3A:E5:43:09' })
    ]));
    gateway.enqueueCommandResult(new CommandResult({ applied: ['red'], skipped: [] }));
    gateway.enqueueCommandResult(new CommandResult({ applied: ['blue'], skipped: [] }));
    const result = await useCase.execute({ action: 'stop', target: 'red,blue' });
    expect([...result.applied].sort()).toEqual(['blue', 'red']);
    expect(gateway.calls.length).toBe(2);
  });

  it('clamps volume above target max before sending', async () => {
    repo.setConfig(makeConfig([
      makeDevice({
        color: 'red',
        volumeBounds: new VolumeBounds({ max: 70 })
      })
    ]));
    gateway.setNextCommandResult(new CommandResult({ applied: ['red'], skipped: [] }));
    await useCase.execute({
      action: 'play', target: 'red', contentId: '670208', volume: 95
    });
    expect(gateway.lastCall.playCommand.volume).toBe(70);
  });

  it('does NOT clamp volume within bounds', async () => {
    repo.setConfig(makeConfig([
      makeDevice({
        color: 'red',
        volumeBounds: new VolumeBounds({ max: 70 })
      })
    ]));
    gateway.setNextCommandResult(new CommandResult({ applied: ['red'], skipped: [] }));
    await useCase.execute({
      action: 'play', target: 'red', contentId: '670208', volume: 50
    });
    expect(gateway.lastCall.playCommand.volume).toBe(50);
  });

  it('gateway 409 contention → propagated as skipped reason (no throw)', async () => {
    repo.setConfig(makeConfig([makeDevice({ color: 'red' })]));
    gateway.setNextCommandResult(new CommandResult({
      applied: [], skipped: [{ color: 'red', reason: 'contention' }]
    }));
    const result = await useCase.execute({
      action: 'play', target: 'red', contentId: '670208'
    });
    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual([{ color: 'red', reason: 'contention' }]);
  });

  it('unknown target color → EntityNotFoundError (not skipped silently)', async () => {
    repo.setConfig(makeConfig([makeDevice({ color: 'red' })]));
    await expect(useCase.execute({
      action: 'play', target: 'orange', contentId: '670208'
    })).rejects.toThrow(EntityNotFoundError);
  });

  it('unknown color in comma-list → EntityNotFoundError', async () => {
    repo.setConfig(makeConfig([makeDevice({ color: 'red' })]));
    await expect(useCase.execute({
      action: 'play', target: 'red,orange', contentId: '670208'
    })).rejects.toThrow(EntityNotFoundError);
  });

  it('gateway InfrastructureError → recorded as skipped[{reason:unreachable}]', async () => {
    repo.setConfig(makeConfig([
      makeDevice({ color: 'red' }),
      makeDevice({ position: 2, color: 'blue', mac: '41:42:3A:E5:43:08' })
    ]));
    // First call (red) throws unreachable, second (blue) succeeds.
    gateway.setCommandError(new InfrastructureError('hub unreachable'));
    gateway.enqueueCommandResult(new CommandResult({ applied: ['blue'], skipped: [] }));
    const result = await useCase.execute({ action: 'stop', target: 'red,blue' });
    expect(result.applied).toEqual(['blue']);
    expect(result.skipped).toEqual([{ color: 'red', reason: 'unreachable' }]);
  });

  it('action "play" without contentId → ValidationError (from PlayCommand)', async () => {
    repo.setConfig(makeConfig([makeDevice({ color: 'red' })]));
    await expect(useCase.execute({ action: 'play', target: 'red' }))
      .rejects.toThrow(ValidationError);
  });

  it('throws when constructed without dependencies', () => {
    expect(() => new SendHubCommand({})).toThrow(/headsetHubGateway/);
    expect(() => new SendHubCommand({ headsetHubGateway: gateway }))
      .toThrow(/hubConfigRepository/);
  });
});
