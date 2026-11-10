import { describe, it, expect } from 'vitest';
import { CycleRaceApiService } from "./CycleRaceApiService.mjs";

describe('CycleRaceApiService.rivalPool', () => {
  it('asks the race service for the pool of one race type and length', async () => {
    const calls = [];
    const api = new CycleRaceApiService({
      races: { getRivalPool: async (q) => { calls.push(q); return [{ raceId: '20260101100000' }]; } },
      config: null
    });
    const pool = await api.rivalPool({ householdId: 'household', winCondition: 'distance', goalM: '3000', timeCapS: null });
    expect(pool).toEqual([{ raceId: '20260101100000' }]);
    expect(calls).toEqual([{ winCondition: 'distance', goalM: '3000', timeCapS: null, householdId: 'household' }]);
  });
});
