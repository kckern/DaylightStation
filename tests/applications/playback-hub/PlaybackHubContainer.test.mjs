import { describe, it, expect, beforeEach } from 'vitest';
import { PlaybackHubContainer } from "../../../__app_modules/media/server/application/playback-hub/PlaybackHubContainer.mjs";
import { FakeHubGateway } from "../../../__app_modules/media/server/application/playback-hub/test/FakeHubGateway.mjs";
import { FakeHubConfigRepository } from "../../../__app_modules/media/server/application/playback-hub/test/FakeHubConfigRepository.mjs";
import { GetHubStatus } from "../../../__app_modules/media/server/application/playback-hub/usecases/GetHubStatus.mjs";
import { GetHubConfig } from "../../../__app_modules/media/server/application/playback-hub/usecases/GetHubConfig.mjs";
import { SendHubCommand } from "../../../__app_modules/media/server/application/playback-hub/usecases/SendHubCommand.mjs";
import { UpdateDeviceConfig } from "../../../__app_modules/media/server/application/playback-hub/usecases/UpdateDeviceConfig.mjs";
import { SaveScheduledFire } from "../../../__app_modules/media/server/application/playback-hub/usecases/SaveScheduledFire.mjs";
import { DeleteScheduledFire } from "../../../__app_modules/media/server/application/playback-hub/usecases/DeleteScheduledFire.mjs";
import { VerifyAudioFlowing } from "../../../__app_modules/media/server/application/playback-hub/usecases/VerifyAudioFlowing.mjs";
import { HubStatusBroadcaster } from "../../../__app_modules/media/server/application/playback-hub/runtime/HubStatusBroadcaster.mjs";
import { SlotStatus } from "../../../__app_modules/media/server/domain/playback-hub/value-objects/SlotStatus.mjs";
const statusFromFixture = value => new SlotStatus({ ...value, position: value.slot ?? value.position });

class StubEventPublisher {
  events = [];
  publish(ev) { this.events.push(ev); }
}

const makeStatus = () => statusFromFixture({
  slot: 1, color: 'red', bt_connected: true, paused: false, now_playing: null,
  volume: 50, playlist_pos: 0, playlist_count: 0, armed_source: null
});

describe('PlaybackHubContainer', () => {
  let gateway, configRepository, eventPublisher;
  let sleepFn;

  beforeEach(() => {
    gateway = new FakeHubGateway();
    configRepository = new FakeHubConfigRepository();
    eventPublisher = new StubEventPublisher();
    sleepFn = (ms) => new Promise(r => setImmediate(r));
  });

  it('constructs cleanly with all dependencies', () => {
    const container = new PlaybackHubContainer({
      gateway, configRepository, eventPublisher,
      broadcasterOptions: { sleepFn }
    });
    expect(container.getHubStatus).toBeInstanceOf(GetHubStatus);
    expect(container.getHubConfig).toBeInstanceOf(GetHubConfig);
    expect(container.sendHubCommand).toBeInstanceOf(SendHubCommand);
    expect(container.updateDeviceConfig).toBeInstanceOf(UpdateDeviceConfig);
    expect(container.saveScheduledFire).toBeInstanceOf(SaveScheduledFire);
    expect(container.deleteScheduledFire).toBeInstanceOf(DeleteScheduledFire);
    expect(container.broadcaster).toBeInstanceOf(HubStatusBroadcaster);
  });

  it('returns the same use-case instance on repeat access (memoization)', () => {
    const container = new PlaybackHubContainer({
      gateway, configRepository, eventPublisher,
      broadcasterOptions: { sleepFn }
    });
    expect(container.getHubStatus).toBe(container.getHubStatus);
    expect(container.broadcaster).toBe(container.broadcaster);
  });

  it('start() then stop() runs the broadcaster cleanly', async () => {
    gateway.setStatusFixture([makeStatus()]);
    const container = new PlaybackHubContainer({
      gateway, configRepository, eventPublisher,
      broadcasterOptions: { intervalMs: 3000, sleepFn }
    });
    await container.start();
    await new Promise(r => setTimeout(r, 20));
    await container.stop();
    expect(eventPublisher.events.length).toBeGreaterThanOrEqual(1);
    expect(container.broadcaster.getLastSnapshot()).not.toBeNull();
  });

  it('throws when constructed without required dependencies', () => {
    expect(() => new PlaybackHubContainer({})).toThrow(/gateway/);
    expect(() => new PlaybackHubContainer({ gateway })).toThrow(/configRepository/);
    expect(() => new PlaybackHubContainer({ gateway, configRepository }))
      .toThrow(/eventPublisher/);
  });
});

describe('PlaybackHubContainer.verifyAudioFlowing', () => {
  it('exposes a VerifyAudioFlowing use case wired to the gateway', () => {
    const container = new PlaybackHubContainer({
      gateway: new FakeHubGateway(),
      configRepository: new FakeHubConfigRepository(),
      eventPublisher: { publish: () => {} },
    });

    expect(container.verifyAudioFlowing).toBeInstanceOf(VerifyAudioFlowing);
    // Memoized — second access returns same instance.
    expect(container.verifyAudioFlowing).toBe(container.verifyAudioFlowing);
  });
});
