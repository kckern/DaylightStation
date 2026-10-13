import { describe, expect, it } from 'vitest';
import { ConfigDeviceBlueprintFactory } from './ConfigDeviceBlueprintFactory.mjs';
import { ScreenAddressResolver } from '#adapters/devices/ScreenAddressResolver.mjs';

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const screens = [{ id: 'living-room', route: '/screen/living-room' }, { id: 'office', route: '/screen/office' }];

const build = (deviceId, source, resolver = new ScreenAddressResolver({ screens })) =>
  new ConfigDeviceBlueprintFactory({ screenAddressResolver: resolver, logger: silent })
    .createBlueprint(deviceId, source)
    .then((blueprint) => blueprint.descriptor.screenPath);

describe('ConfigDeviceBlueprintFactory screen path', () => {
  const content = { content_control: { provider: 'websocket', topic: 'x' } };

  it('keeps a declared screen_path', async () => {
    expect(await build('office-tv', { ...content, screen_path: '/screen/portal' })).toBe('/screen/portal');
  });

  it('fuzzy-matches a content device with no screen_path', async () => {
    expect(await build('office-tv', content)).toBe('/screen/office');
  });

  it('falls back to the default screen when nothing matches', async () => {
    expect(await build('yellow-room-tablet', { ...content, location: 'Yellow Room' })).toBe('/screen/living-room');
  });

  it('leaves devices that load no content alone', async () => {
    expect(await build('office-speaker', {})).toBeUndefined();
  });
});
