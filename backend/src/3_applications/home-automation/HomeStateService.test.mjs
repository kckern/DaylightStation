import { describe, expect, it, vi } from 'vitest';
import { HomeStateService } from './HomeStateService.mjs';

describe('HomeStateService', () => {
  it('preserves volume state shape and command order', async () => {
    let state = { volume: 50, muted: true };
    const repository = {
      loadVolumeState: vi.fn(() => state),
      saveVolumeState: vi.fn((next) => { state = next; }),
    };
    const setVolume = vi.fn(async (value) => ({ value }));
    const result = await new HomeStateService({ repository, remoteExecGateway: { setVolume } }).controlVolume('+');
    expect(setVolume.mock.calls.map(([value]) => value)).toEqual(['unmute', 62]);
    expect(repository.saveVolumeState).toHaveBeenCalledWith({ volume: 62, muted: false });
    expect(result).toEqual({
      result: { value: 62 },
      beforeState: { volume: 50, muted: true },
      afterState: { volume: 62, muted: false },
    });
  });

  it('maps keyboard bindings without exposing their storage key', () => {
    const service = new HomeStateService({ repository: {
      loadKeyboardBindings: () => [{ folder: 'Living Room', key: 'A', label: 'Play', function: 'play', params: { id: 1 }, secondary: false }],
    } });
    expect(service.getKeyboard('livingroom')).toEqual({
      kind: 'found', value: { A: { label: 'Play', function: 'play', params: { id: 1 }, secondary: false } },
    });
  });
});
