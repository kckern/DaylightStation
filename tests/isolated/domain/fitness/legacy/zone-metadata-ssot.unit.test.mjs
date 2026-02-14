import { buildZoneMetadata } from '#frontend/hooks/fitness/zoneMetadata.js';

describe('buildZoneMetadata', () => {
  const zoneConfig = [
    { id: 'cool', name: 'Cool', color: '#94a3b8', min: 0 },
    { id: 'active', name: 'Active', color: '#22c55e', min: 100 },
    { id: 'warm', name: 'Warm', color: '#eab308', min: 130 },
    { id: 'hot', name: 'Hot', color: '#f97316', min: 155 },
    { id: 'fire', name: 'Fire', color: '#ef4444', min: 175 }
  ];

  test('map contains all zones keyed by normalized ID', () => {
    const meta = buildZoneMetadata(zoneConfig);
    expect(Object.keys(meta.map)).toEqual(['cool', 'active', 'warm', 'hot', 'fire']);
    expect(meta.map.warm.name).toBe('Warm');
    expect(meta.map.warm.color).toBe('#eab308');
  });

  test('each zone has a rank matching sorted order by min', () => {
    const meta = buildZoneMetadata(zoneConfig);
    expect(meta.map.cool.rank).toBe(0);
    expect(meta.map.active.rank).toBe(1);
    expect(meta.map.warm.rank).toBe(2);
    expect(meta.map.hot.rank).toBe(3);
    expect(meta.map.fire.rank).toBe(4);
  });

  test('rankMap provides zoneId → rank for GovernanceEngine', () => {
    const meta = buildZoneMetadata(zoneConfig);
    expect(meta.rankMap.cool).toBe(0);
    expect(meta.rankMap.warm).toBe(2);
  });

  test('infoMap provides zoneId → {id, name, color} for GovernanceEngine', () => {
    const meta = buildZoneMetadata(zoneConfig);
    expect(meta.infoMap.warm).toEqual({ id: 'warm', name: 'Warm', color: '#eab308' });
  });

  test('handles empty config', () => {
    const meta = buildZoneMetadata([]);
    expect(Object.keys(meta.map)).toEqual([]);
    expect(Object.keys(meta.rankMap)).toEqual([]);
  });

  test('ranked array is sorted by min threshold', () => {
    const shuffled = [zoneConfig[3], zoneConfig[0], zoneConfig[4], zoneConfig[1], zoneConfig[2]];
    const meta = buildZoneMetadata(shuffled);
    expect(meta.ranked.map(z => z.id)).toEqual(['cool', 'active', 'warm', 'hot', 'fire']);
  });
});
