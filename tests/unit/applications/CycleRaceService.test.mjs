import fs from 'fs';
import os from 'os';
import path from 'path';
import { YamlCycleRaceDatastore } from '#adapters/persistence/yaml/YamlCycleRaceDatastore.mjs';
import { CycleRaceService } from '#apps/fitness/services/CycleRaceService.mjs';

let tmp, svc;
const rec = (id, over = {}) => ({
  version: 1,
  race: { id, date: `${id.slice(0,4)}-${id.slice(4,6)}-${id.slice(6,8)}`, win_condition: 'distance', goal_m: 3000, course_id: null, ...over },
  // A real ride — the service refuses to persist a zero-distance race.
  participants: { user_3: { final_distance_m: 3000, final_time_s: 300 } }
});

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cgsvc-'));
  const datastore = new YamlCycleRaceDatastore({ configService: { getHouseholdPath: (rel) => path.join(tmp, rel) } });
  svc = new CycleRaceService({ datastore });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('CycleRaceService', () => {
  it('saves and gets a race', async () => {
    await svc.save(rec('20260602143012'), 'default');
    expect((await svc.get('20260602143012', 'default')).race.id).toBe('20260602143012');
  });
  it('refuses to save a zero-distance race', async () => {
    const dead = { version: 1, race: { id: '20260602143012', date: '2026-06-02', win_condition: 'distance', goal_m: 3000 }, participants: { user_3: { final_distance_m: 0 } } };
    expect(await svc.save(dead, 'default')).toBeNull();
    expect(await svc.get('20260602143012', 'default')).toBeNull();
  });
  it('lists races by date', async () => {
    await svc.save(rec('20260602143012'), 'default');
    expect(await svc.listByDate('2026-06-02', 'default')).toHaveLength(1);
  });
  it('finds ghost candidates by course id', async () => {
    await svc.save(rec('20260602143012', { course_id: 'alps_3k' }), 'default');
    await svc.save(rec('20260602150000', { course_id: 'coastal' }), 'default');
    const cands = await svc.findGhostCandidates({ courseId: 'alps_3k', householdId: 'default' });
    expect(cands).toHaveLength(1);
    expect(cands[0].race.course_id).toBe('alps_3k');
  });
  it('finds ghost candidates by win condition + goal for custom races', async () => {
    await svc.save(rec('20260602143012', { course_id: null, goal_m: 3000 }), 'default');
    await svc.save(rec('20260602150000', { course_id: null, goal_m: 5000 }), 'default');
    const cands = await svc.findGhostCandidates({ winCondition: 'distance', goalM: 3000, householdId: 'default' });
    expect(cands).toHaveLength(1);
  });
});
