import { describe, expect, it, vi } from 'vitest';
import { HouseholdHomeStateRepository } from './HouseholdHomeStateRepository.mjs';

describe('HouseholdHomeStateRepository', () => {
  it('contains the concrete household layout behind semantic methods', () => {
    const load = vi.fn((key) => key);
    const save = vi.fn();
    const repository = new HouseholdHomeStateRepository({ load, save });
    expect(repository.loadVolumeState()).toBe('hardware/volLevel');
    expect(repository.loadKeyboardBindings()).toBe('triggers/bindings/keyboard');
    expect(repository.loadEvents()).toBe('calendar/events');
    repository.saveVolumeState({ volume: 30, muted: false });
    expect(save).toHaveBeenCalledWith('hardware/volLevel', { volume: 30, muted: false });
  });
});
