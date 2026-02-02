import { describe, it, expect, beforeEach } from 'vitest';
import { WidgetRegistry } from './registry.js';

// Mock widget components
const MockClock = () => 'clock';
const MockWeather = () => 'weather';

describe('WidgetRegistry', () => {
  let registry;

  beforeEach(() => {
    registry = new WidgetRegistry();
  });

  it('should register a widget', () => {
    registry.register('clock', MockClock);

    expect(registry.has('clock')).toBe(true);
  });

  it('should retrieve a registered widget', () => {
    registry.register('clock', MockClock);

    const widget = registry.get('clock');

    expect(widget).toBe(MockClock);
  });

  it('should return null for unregistered widget', () => {
    expect(registry.get('nonexistent')).toBe(null);
  });

  it('should register widget with metadata', () => {
    registry.register('weather', MockWeather, {
      defaultSource: '/api/v1/home/weather',
      refreshInterval: 60000,
      actions: ['select', 'refresh']
    });

    const meta = registry.getMetadata('weather');

    expect(meta.defaultSource).toBe('/api/v1/home/weather');
    expect(meta.refreshInterval).toBe(60000);
    expect(meta.actions).toContain('refresh');
  });

  it('should list all registered widgets', () => {
    registry.register('clock', MockClock);
    registry.register('weather', MockWeather);

    const widgets = registry.list();

    expect(widgets).toContain('clock');
    expect(widgets).toContain('weather');
    expect(widgets.length).toBe(2);
  });
});
