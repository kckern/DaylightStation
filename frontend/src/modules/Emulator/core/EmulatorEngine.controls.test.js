import { describe, it, expect, vi } from 'vitest';
import { createEmulatorEngine } from './EmulatorEngine.js';

describe('EmulatorEngine forwards controls', () => {
  it('passes controls to the loader', async () => {
    const load = vi.fn().mockResolvedValue({ wramBase: 1 });
    const engine = createEmulatorEngine({ load, win: {} });
    await engine.boot({ mount: {}, romUrl: 'r', pathtodata: '/p/', core: 'gb', controls: { 0: { 3: { value: 'enter' } } } });
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ controls: { 0: { 3: { value: 'enter' } } } }));
  });
});
