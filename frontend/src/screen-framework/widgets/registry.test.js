import { describe, it, expect, beforeEach } from 'vitest';
import { WidgetRegistry } from './registry.js';

const MockClock = () => 'clock';
const MockWeather = () => 'weather';

describe('WidgetRegistry', () => {
  let registry;

  beforeEach(() => {
    registry = new WidgetRegistry();
  });

  it('should register and retrieve a widget', () => {
    registry.register('clock', MockClock);
    expect(registry.has('clock')).toBe(true);
    expect(registry.get('clock')).toBe(MockClock);
  });

  it('should return null for unregistered widget', () => {
    expect(registry.get('nonexistent')).toBe(null);
  });

  it('should list all registered widget names', () => {
    registry.register('clock', MockClock);
    registry.register('weather', MockWeather);
    const names = registry.list();
    expect(names).toContain('clock');
    expect(names).toContain('weather');
    expect(names.length).toBe(2);
  });

  it('should clear all registrations', () => {
    registry.register('clock', MockClock);
    registry.clear();
    expect(registry.has('clock')).toBe(false);
    expect(registry.list().length).toBe(0);
  });
});
