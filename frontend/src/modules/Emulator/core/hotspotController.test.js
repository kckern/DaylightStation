import { describe, it, expect, vi } from 'vitest';
import { createHotspotController } from './hotspotController.js';

function makeDeps(overrides = {}) {
  return {
    mixer: { setBusVolume: vi.fn(), muteBus: vi.fn() },
    engine: { pause: vi.fn(), resume: vi.fn() },
    onExit: vi.fn(),
    runActions: vi.fn(),
    saveState: vi.fn(),
    onChange: vi.fn(),
    ...overrides,
  };
}

describe('createHotspotController', () => {
  it('exposes the initial state (full volume, unmuted, not paused)', () => {
    const c = createHotspotController(makeDeps());
    expect(c.getState()).toEqual({ volume: 1, muted: false, paused: false });
  });

  it('volume action steps the game bus down and wraps back to full', () => {
    const deps = makeDeps();
    const c = createHotspotController(deps);

    c.activate({ id: 'speaker', action: 'volume' });
    expect(c.getState().volume).toBe(0.75);
    expect(deps.mixer.setBusVolume).toHaveBeenLastCalledWith('game', 0.75);

    c.activate({ action: 'volume' }); // 0.5
    c.activate({ action: 'volume' }); // 0.25
    c.activate({ action: 'volume' }); // 0
    expect(c.getState().volume).toBe(0);
    c.activate({ action: 'volume' }); // wraps -> 1
    expect(c.getState().volume).toBe(1);
    expect(deps.mixer.setBusVolume).toHaveBeenLastCalledWith('game', 1);
    expect(deps.onChange).toHaveBeenCalled();
  });

  it('mute action toggles the game bus mute', () => {
    const deps = makeDeps();
    const c = createHotspotController(deps);

    c.activate({ id: 'dot_matrix_text', action: 'mute' });
    expect(c.getState().muted).toBe(true);
    expect(deps.mixer.muteBus).toHaveBeenLastCalledWith('game', true);

    c.activate({ action: 'mute' });
    expect(c.getState().muted).toBe(false);
    expect(deps.mixer.muteBus).toHaveBeenLastCalledWith('game', false);
  });

  it('pause action toggles engine pause/resume', () => {
    const deps = makeDeps();
    const c = createHotspotController(deps);

    c.activate({ id: 'start', action: 'pause' });
    expect(c.getState().paused).toBe(true);
    expect(deps.engine.pause).toHaveBeenCalledTimes(1);
    expect(deps.engine.resume).not.toHaveBeenCalled();

    c.activate({ action: 'pause' });
    expect(c.getState().paused).toBe(false);
    expect(deps.engine.resume).toHaveBeenCalledTimes(1);
  });

  it('exit action calls onExit', () => {
    const deps = makeDeps();
    createHotspotController(deps).activate({ id: 'logo', action: 'exit' });
    expect(deps.onExit).toHaveBeenCalledTimes(1);
  });

  it('save_state action calls the injected saveState', () => {
    const deps = makeDeps();
    createHotspotController(deps).activate({ id: 'a_button', action: 'save_state' });
    expect(deps.saveState).toHaveBeenCalledTimes(1);
  });

  it('a do: block is dispatched through runActions with the hotspot context', () => {
    const deps = makeDeps();
    const c = createHotspotController(deps);
    const hotspot = { id: 'battery_led', do: { toast: 'Credit', chime: '/x.mp3' } };

    c.activate(hotspot);

    expect(deps.runActions).toHaveBeenCalledTimes(1);
    const [doMap, ctx] = deps.runActions.mock.calls[0];
    expect(doMap).toEqual({ toast: 'Credit', chime: '/x.mp3' });
    expect(ctx).toMatchObject({ hotspot: 'battery_led' });
  });

  it('does nothing (and never throws) for a hotspot with no action or do', () => {
    const deps = makeDeps();
    const c = createHotspotController(deps);
    expect(() => c.activate({ id: 'dpad' })).not.toThrow();
    expect(deps.runActions).not.toHaveBeenCalled();
    expect(deps.mixer.setBusVolume).not.toHaveBeenCalled();
  });

  it('tolerates an unknown action verb and missing collaborators', () => {
    const c = createHotspotController({ mixer: {}, engine: {} });
    expect(() => c.activate({ action: 'frobnicate' })).not.toThrow();
    expect(() => c.activate({ action: 'save_state' })).not.toThrow();
    expect(() => c.activate({ action: 'exit' })).not.toThrow();
  });

  it('the reset verb fires onReset (start-over / power switch)', () => {
    const onReset = vi.fn();
    const c = createHotspotController(makeDeps({ onReset }));
    c.activate({ id: 'reset', action: 'reset' });
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
