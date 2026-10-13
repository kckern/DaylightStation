import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DataManager } from './DataManager.js';

// Mock fetch
global.fetch = vi.fn();

describe('DataManager', () => {
  let manager;

  beforeEach(() => {
    manager = new DataManager();
    vi.clearAllMocks();
  });

  afterEach(() => {
    manager.destroy();
  });

  it('should fetch data from a source', async () => {
    const mockData = { temperature: 72, condition: 'sunny' };
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockData)
    });

    const data = await manager.fetch('/api/v1/home/weather');

    expect(fetch).toHaveBeenCalledWith('/api/v1/home/weather');
    expect(data).toEqual(mockData);
  });

  it('should cache fetched data', async () => {
    const mockData = { temperature: 72 };
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockData)
    });

    await manager.fetch('/api/v1/home/weather');
    const cached = manager.getCached('/api/v1/home/weather');

    expect(cached).toEqual(mockData);
  });

  it('should subscribe to a source with refresh interval', async () => {
    vi.useFakeTimers();
    const mockData = { count: 1 };
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData)
    });

    const callback = vi.fn();
    manager.subscribe('/api/v1/test', callback, { refreshInterval: 1000 });

    // Initial fetch
    await vi.advanceTimersByTimeAsync(0);
    expect(callback).toHaveBeenCalledTimes(1);

    // After refresh interval
    await vi.advanceTimersByTimeAsync(1000);
    expect(callback).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('should unsubscribe and stop refreshing', async () => {
    vi.useFakeTimers();
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: 'test' })
    });

    const callback = vi.fn();
    const unsubscribe = manager.subscribe('/api/v1/test', callback, { refreshInterval: 1000 });

    await vi.advanceTimersByTimeAsync(0);
    unsubscribe();
    await vi.advanceTimersByTimeAsync(2000);

    expect(callback).toHaveBeenCalledTimes(1); // Only initial fetch

    vi.useRealTimers();
  });
});
