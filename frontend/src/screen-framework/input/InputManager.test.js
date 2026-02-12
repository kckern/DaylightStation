// frontend/src/screen-framework/input/InputManager.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActionBus } from './ActionBus.js';
import { createInputManager } from './InputManager.js';

vi.mock('./adapters/KeyboardAdapter.js', () => ({
  KeyboardAdapter: vi.fn().mockImplementation(function () {
    this.attach = vi.fn();
    this.destroy = vi.fn();
  }),
}));

vi.mock('./adapters/NumpadAdapter.js', () => ({
  NumpadAdapter: vi.fn().mockImplementation(function () {
    this.attach = vi.fn().mockResolvedValue(undefined);
    this.destroy = vi.fn();
  }),
}));

vi.mock('./adapters/RemoteAdapter.js', () => ({
  RemoteAdapter: vi.fn().mockImplementation(function () {
    this.attach = vi.fn().mockResolvedValue(undefined);
    this.destroy = vi.fn();
  }),
}));

import { KeyboardAdapter } from './adapters/KeyboardAdapter.js';
import { NumpadAdapter } from './adapters/NumpadAdapter.js';
import { RemoteAdapter } from './adapters/RemoteAdapter.js';

describe('InputManager', () => {
  let bus;

  beforeEach(() => {
    bus = new ActionBus();
    vi.clearAllMocks();
  });

  it('should create NumpadAdapter for type numpad', () => {
    const manager = createInputManager(bus, { type: 'numpad', keyboard_id: 'officekeypad' });
    expect(NumpadAdapter).toHaveBeenCalledWith(bus, { keyboardId: 'officekeypad' });
    manager.destroy();
  });

  it('should create RemoteAdapter for type remote', () => {
    const manager = createInputManager(bus, { type: 'remote', keyboard_id: 'tvremote' });
    expect(RemoteAdapter).toHaveBeenCalledWith(bus, { keyboardId: 'tvremote' });
    manager.destroy();
  });

  it('should create KeyboardAdapter for type keyboard', () => {
    const manager = createInputManager(bus, { type: 'keyboard' });
    expect(KeyboardAdapter).toHaveBeenCalledWith(bus);
    manager.destroy();
  });

  it('should default to KeyboardAdapter for unknown type', () => {
    const manager = createInputManager(bus, { type: 'unknown' });
    expect(KeyboardAdapter).toHaveBeenCalledWith(bus);
    manager.destroy();
  });

  it('should return no-op handle for null config', () => {
    const manager = createInputManager(bus, null);
    expect(NumpadAdapter).not.toHaveBeenCalled();
    expect(RemoteAdapter).not.toHaveBeenCalled();
    expect(KeyboardAdapter).not.toHaveBeenCalled();
    manager.destroy(); // should not throw
  });

  it('should call attach on the created adapter', () => {
    const manager = createInputManager(bus, { type: 'numpad', keyboard_id: 'test' });
    expect(manager.adapter.attach).toHaveBeenCalled();
    manager.destroy();
  });

  it('should call destroy on adapter when manager.destroy is called', () => {
    const manager = createInputManager(bus, { type: 'numpad', keyboard_id: 'test' });
    const adapterDestroy = manager.adapter.destroy;
    manager.destroy();
    expect(adapterDestroy).toHaveBeenCalled();
  });
});
