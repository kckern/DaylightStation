import { describe, it, expect } from 'vitest';
import { ConfigMediaScreenCatalog } from './ConfigMediaScreenCatalog.mjs';

const devices = {
  devices: {
    'livingroom-tv': { name: 'Living Room TV', location: 'Living Room', type: 'shield-tv', content_control: { provider: 'fully-kiosk' }, device_control: { provider: 'ha' } },
    'garage-tv': { name: 'Garage TV', location: 'Garage', type: 'linux-pc', fleet: {} },
    'kitchen-relay': { name: 'Kitchen Relay', type: 'kitchen-relay' },
    'speaker-red': { name: 'Red Headset', location: "Kids' Rooms", type: 'speaker' },
    doorbell: { name: 'Doorbell Camera', type: 'ip-camera' },
    piano: { name: 'Piano', type: 'midi-keyboard' },
    portal: { type: 'android-tablet', content_control: {} },
  },
};

describe('ConfigMediaScreenCatalog', () => {
  it('lists devices.yml media surfaces as fleet: screens with name, room and type', () => {
    const catalog = new ConfigMediaScreenCatalog({ configService: { getHouseholdDevices: () => devices } });
    expect(catalog.list()).toEqual([
      { id: 'fleet:livingroom-tv', screenId: 'livingroom-tv', name: 'Living Room TV', room: 'Living Room', type: 'shield-tv', wakeable: true },
      { id: 'fleet:garage-tv', screenId: 'garage-tv', name: 'Garage TV', room: 'Garage', type: 'linux-pc', wakeable: false },
      { id: 'fleet:speaker-red', screenId: 'speaker-red', name: 'Red Headset', room: "Kids' Rooms", type: 'speaker', wakeable: false },
      { id: 'fleet:portal', screenId: 'portal', name: 'portal', room: null, type: 'android-tablet', wakeable: false },
    ]);
  });
  it('an unreadable device config is an empty list', () => {
    expect(new ConfigMediaScreenCatalog({ configService: { getHouseholdDevices: () => null } }).list()).toEqual([]);
  });
});
