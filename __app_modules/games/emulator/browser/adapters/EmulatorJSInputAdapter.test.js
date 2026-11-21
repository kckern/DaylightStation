import { describe, expect, it, vi } from 'vitest';
import { EmulatorJSInputAdapter } from './EmulatorJSInputAdapter.js';
import { IEmulatorInput, isEmulatorInput, RETROPAD_BUTTONS } from '../ports/IEmulatorInput.js';
import { SEMANTIC_INDEX } from '../input/buildEjsControls.js';

const fakeEngine = (started = true) => ({ isStarted: () => started, pressInput: vi.fn(() => started) });

describe('IEmulatorInput', () => {
  it('port methods must be implemented', () => {
    const port = new IEmulatorInput();
    expect(() => port.press('a')).toThrow(/must be implemented/);
    expect(() => port.releaseAll()).toThrow(/must be implemented/);
    expect(isEmulatorInput({})).toBe(false);
  });
  it('every RetroPad button has an EmulatorJS control index', () => {
    for (const b of RETROPAD_BUTTONS) expect(SEMANTIC_INDEX[b]).toBeTypeOf('number');
  });
});

describe('EmulatorJSInputAdapter', () => {
  it('is an IEmulatorInput', () => {
    const a = new EmulatorJSInputAdapter({ getEngine: () => null });
    expect(a).toBeInstanceOf(IEmulatorInput);
    expect(isEmulatorInput(a)).toBe(true);
  });

  it('presses and releases through the engine by EmulatorJS control index', () => {
    const engine = fakeEngine();
    const a = new EmulatorJSInputAdapter({ getEngine: () => engine });
    expect(a.isReady()).toBe(true);
    expect(a.press('a')).toBe(true);
    expect(a.press('up')).toBe(true);
    expect(a.release('a')).toBe(true);
    expect(engine.pressInput.mock.calls).toEqual([[SEMANTIC_INDEX.a, 1, 0], [SEMANTIC_INDEX.up, 1, 0], [SEMANTIC_INDEX.a, 0, 0]]);
    expect(a.releaseAll()).toBe(1);
    expect(engine.pressInput.mock.calls.at(-1)).toEqual([SEMANTIC_INDEX.up, 0, 0]);
    expect(a.releaseAll()).toBe(0);
  });

  it('refuses unknown buttons and an engine that has not started', () => {
    const engine = fakeEngine(false);
    const a = new EmulatorJSInputAdapter({ getEngine: () => engine });
    expect(a.isReady()).toBe(false);
    expect(a.press('turbo')).toBe(false);
    expect(a.press('a')).toBe(false);
    expect(a.releaseAll()).toBe(0);
  });
});
