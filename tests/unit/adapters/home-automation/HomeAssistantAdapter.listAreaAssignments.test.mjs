import { describe, it, expect, vi } from 'vitest';
import { HomeAssistantAdapter } from "../../../../__capabilities/home-control/server/adapters/homeassistant/HomeAssistantAdapter.mjs";

const quietLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function adapterWith(post) {
  return new HomeAssistantAdapter(
    { baseUrl: 'http://ha', token: 'tok' },
    { httpClient: { get: vi.fn(), post }, logger: quietLogger }
  );
}

describe('HomeAssistantAdapter.listAreaAssignments', () => {
  it('renders the area template once and maps areas and assignments', async () => {
    const post = vi.fn().mockResolvedValue({
      data: '{"areas": {"office": "Office", "living_room": "Living Room"}, "assignments": {"light.desk": "office"}}',
    });
    const result = await adapterWith(post).listAreaAssignments();

    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toBe('http://ha/api/template');
    expect(post.mock.calls[0][1].template).toContain('area_id(s.entity_id)');
    expect(result.areas).toEqual([
      { id: 'office', name: 'Office' },
      { id: 'living_room', name: 'Living Room' },
    ]);
    expect(result.assignments).toEqual({ 'light.desk': 'office' });
  });

  it('accepts a body the HTTP client already parsed', async () => {
    const post = vi.fn().mockResolvedValue({ data: { areas: { garage: 'Garage' }, assignments: {} } });
    const result = await adapterWith(post).listAreaAssignments();
    expect(result.areas).toEqual([{ id: 'garage', name: 'Garage' }]);
  });

  it('returns empty room data instead of throwing when HA refuses the template', async () => {
    const post = vi.fn().mockRejectedValue(new Error('401'));
    const result = await adapterWith(post).listAreaAssignments();
    expect(result).toEqual({ areas: [], assignments: {} });
    expect(quietLogger.warn).toHaveBeenCalledWith('ha.listAreaAssignments.error', { error: '401' });
  });
});
