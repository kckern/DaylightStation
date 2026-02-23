import { describe, it, expect } from '@jest/globals';
import { IDeviceLauncher, isDeviceLauncher } from '#apps/devices/ports/IDeviceLauncher.mjs';

describe('IDeviceLauncher', () => {
  it('throws on direct method calls', async () => {
    const port = new IDeviceLauncher();
    await expect(port.launch('dev1', { target: 'x', params: {} }))
      .rejects.toThrow('IDeviceLauncher.launch must be implemented');
    await expect(port.canLaunch('dev1'))
      .rejects.toThrow('IDeviceLauncher.canLaunch must be implemented');
  });

  describe('isDeviceLauncher', () => {
    it('returns true for valid implementation', () => {
      const impl = { launch: async () => {}, canLaunch: async () => {} };
      expect(isDeviceLauncher(impl)).toBe(true);
    });

    it('returns false for incomplete implementation', () => {
      expect(isDeviceLauncher({})).toBe(false);
      expect(isDeviceLauncher({ launch: async () => {} })).toBe(false);
      expect(isDeviceLauncher(null)).toBe(false);
    });
  });
});
