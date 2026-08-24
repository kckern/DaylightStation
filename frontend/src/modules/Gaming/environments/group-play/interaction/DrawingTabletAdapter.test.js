import { describe, expect, it, vi } from 'vitest';
import { DrawingTabletAdapter } from './DrawingTabletAdapter.js';

function element() {
  const listeners = new Map();
  return {
    listeners, setPointerCapture: vi.fn(), releasePointerCapture: vi.fn(),
    width: 1280, height: 720,
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 1280, height: 720 }),
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: (name) => listeners.delete(name),
  };
}

describe('DrawingTabletAdapter', () => {
  it('captures an active stylus and ignores hover moves', () => {
    const target = element(); const intents = []; const adapter = new DrawingTabletAdapter({ element: target, onIntent: (intent) => intents.push(intent), pointerEvents: true }); adapter.connect();
    const event = (extra = {}) => ({ clientX: 30, clientY: 50, pressure: .75, buttons: 1, button: 0, pointerType: 'pen', pointerId: 7, timeStamp: 1, preventDefault: vi.fn(), ...extra });
    target.listeners.get('pointermove')(event());
    target.listeners.get('pointerdown')(event()); target.listeners.get('pointermove')(event({ clientX: 31 })); target.listeners.get('pointerup')(event({ buttons: 0 }));
    expect(intents.map((intent) => intent.phase)).toEqual(['press', 'change', 'release']);
    expect(intents[0]).toMatchObject({ source: 'stylus', value: { x: 20, y: 30, pressure: .75 } });
    expect(target.setPointerCapture).toHaveBeenCalledWith(7); expect(target.releasePointerCapture).toHaveBeenCalledWith(7);
  });

  it('provides mouse fallback when Pointer Events are unavailable', () => {
    const target = element(); const intents = []; new DrawingTabletAdapter({ element: target, onIntent: (intent) => intents.push(intent), pointerEvents: false }).connect();
    const event = { clientX: 11, clientY: 22, buttons: 1, button: 0, timeStamp: 2, preventDefault: vi.fn() };
    target.listeners.get('mousedown')(event); target.listeners.get('mousemove')(event); target.listeners.get('mouseup')({ ...event, buttons: 0 });
    expect(intents.map((intent) => intent.phase)).toEqual(['press', 'change', 'release']); expect(intents[0].source).toBe('mouse');
  });

  it('preserves stylus eraser metadata', () => {
    const target = element(); const intents = []; new DrawingTabletAdapter({ element: target, onIntent: (intent) => intents.push(intent), pointerEvents: true }).connect();
    const event = { clientX: 15, clientY: 25, pressure: .4, buttons: 32, button: 5, pointerType: 'pen', pointerId: 9, timeStamp: 3, preventDefault: vi.fn() };
    target.listeners.get('pointerdown')(event);
    expect(intents[0]).toMatchObject({ source: 'stylus', device_type: 'pen', value: { eraser: true, pressure: .4 } });
  });

  it('provides touch fallback with stable pointer identity', () => {
    const target = element(); const intents = []; new DrawingTabletAdapter({ element: target, onIntent: (intent) => intents.push(intent), pointerEvents: false }).connect();
    const event = { changedTouches: [{ identifier: 4, clientX: 20, clientY: 30, force: .6 }], timeStamp: 4, preventDefault: vi.fn() };
    target.listeners.get('touchstart')(event); target.listeners.get('touchmove')(event); target.listeners.get('touchend')(event);
    expect(intents.map((intent) => intent.phase)).toEqual(['press', 'change', 'release']);
    expect(intents[0]).toMatchObject({ source: 'touch', controller_id: 'pointer:6', value: { pressure: .6 } });
  });

  it('maps responsive CSS coordinates into the canvas backing store and clamps captured moves', () => {
    const target = element(); target.getBoundingClientRect = () => ({ left: 10, top: 20, width: 640, height: 360 });
    const intents = []; new DrawingTabletAdapter({ element: target, onIntent: (intent) => intents.push(intent), pointerEvents: true }).connect();
    const event = { clientX: 330, clientY: 200, pressure: .5, buttons: 1, button: 0, pointerType: 'pen', pointerId: 5, timeStamp: 5, preventDefault: vi.fn() };
    target.listeners.get('pointerdown')(event);
    target.listeners.get('pointermove')({ ...event, clientX: 900, clientY: -20 });
    expect(intents[0].value).toMatchObject({ x: 640, y: 360 });
    expect(intents[1].value).toMatchObject({ x: 1280, y: 0 });
  });
});
