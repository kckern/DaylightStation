// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createLearnCoachClient, coachScopeKey } from './learnCoachClient.js';
import { PianoLearnCoachService } from '../../../../server/application/PianoLearnCoachService.mjs';
import { pianoCoachFixture } from '../../../../../../../tests/_lib/pianoCoachFixture.mjs';
import { createCoachPlan, projectCoach } from '../../../../../../../shared/music/learnCoach.mjs';

const scope = { profileId: 'learner4', scoreId: 'files:test.musicxml', scoreKey: 'files-test-musicxml', fingerprint: 'content-a' };
const storageOf = () => { const data = new Map();return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key) }; };
const deferred = () => { let resolve;const promise = new Promise((done) => { resolve = done; });return { promise, resolve }; };
function setup({ storage = storageOf(), intercept = async () => {} } = {}) {
  const f = pianoCoachFixture();const service = new PianoLearnCoachService(f);const calls = [];
  const request = async (path, options = {}) => {
    calls.push({ path, ...structuredClone(options) });
    await intercept(path, options);
    const url = new URL(path, 'http://test');const user = url.pathname.split('/users/')[1].split('/')[0];
    if (url.pathname.endsWith('/attempts')) {
      const current = f.attempts.get(options.body.attempt_id);
      if (!current) f.attempts.set(options.body.attempt_id, { ...structuredClone(options.body), user_id: user });
      return f.attempts.get(options.body.attempt_id);
    }
    return options.method === 'POST' ? service.record(user, scope.scoreKey, options.body)
      : service.get(user, scope.scoreKey, { scoreId: url.searchParams.get('scoreId'), fingerprint: url.searchParams.get('fingerprint') });
  };
  const client = createLearnCoachClient({ request, storage, now: () => new Date('2026-10-26T18:00:00Z'), dayKey: () => '2026-10-26' });
  const event = (id = 'attempt-one') => ({ id, type: 'outcome', profileId: scope.profileId, task: f.plan.tasks[0], result: f.outcome('unused').event.result });
  return { f, service, calls, request, client, storage, event };
}

describe('profile-scoped coaching outbox', () => {
  it('shows musical progress while an assessment is pending and acknowledges it only after both writes', async () => {
    const gate = deferred();const h = setup({ intercept: async (path) => { if (path.endsWith('/attempts')) await gate.promise; } });
    await h.client.load(scope, h.f.plan);
    const pending = h.client.enqueue(scope, h.event(), h.f.plan);
    expect(h.client.get(scope).state.evidence).toHaveLength(1);
    expect(h.client.get(scope).saveStatus).toBe('pending');
    gate.resolve();await pending;
    expect(h.client.get(scope)).toMatchObject({ saveStatus: 'saved', pendingCount: 0, revision: 1 });
    expect((await h.service.get('learner4', scope.scoreKey)).state.evidence).toHaveLength(1);
  });

  it('retries the same outcome after reload without duplicating an acknowledged assessment', async () => {
    let offline = true;const h = setup({ intercept: async (path, options) => { if (offline && path.endsWith('/coach') && options.method === 'POST') throw new Error('offline'); } });
    await h.client.load(scope, h.f.plan);
    await h.client.enqueue(scope, h.event(), h.f.plan);
    expect(h.client.get(scope)).toMatchObject({ saveStatus: 'error', pendingCount: 1 });
    h.client.dispose();offline = false;
    const next = createLearnCoachClient({ request: h.request, storage: h.storage });
    await next.load(scope, h.f.plan);
    expect(next.get(scope)).toMatchObject({ saveStatus: 'saved', pendingCount: 0, revision: 1 });
    expect(h.calls.filter((call) => call.path.endsWith('/attempts'))).toHaveLength(1);
    expect(h.calls.filter((call) => call.path.endsWith('/coach') && call.method === 'POST').map((call) => call.body.event.id)).toEqual(['attempt-one', 'attempt-one']);
    next.dispose();
  });

  it('does not downgrade acknowledged progress when an older load response arrives late', async () => {
    const gate = deferred();let first = true;const h = setup();
    const request = async (path, options) => {
      if (first && options.method !== 'POST') { first = false;await gate.promise;return { state: null, revision: 0, legacy: {} }; }
      return h.request(path, options);
    };
    const client = createLearnCoachClient({ request, storage: h.storage });
    const load = client.load(scope, h.f.plan);
    await client.enqueue(scope, h.event(), h.f.plan);
    gate.resolve();await load;
    expect(client.get(scope).revision).toBe(1);
    expect(client.get(scope).state.evidence).toHaveLength(1);
    client.dispose();
  });

  it('keeps an old profile write in its captured scope after another profile loads', async () => {
    const gate = deferred();const h = setup({ intercept: async (path) => { if (path.endsWith('/attempts')) await gate.promise; } });
    await h.client.load(scope, h.f.plan);const pending = h.client.enqueue(scope, h.event(), h.f.plan);
    const other = { ...scope, profileId: 'learner5' };await h.client.load(other, h.f.plan);
    gate.resolve();await pending;
    expect(h.client.get(other).state?.evidence ?? []).toHaveLength(0);
    expect(h.client.get(scope).state.evidence).toHaveLength(1);
    expect(h.f.attempts.get('attempt-one').user_id).toBe('learner4');
  });

  it('continues safely in memory when browser storage throws and reports an offline save honestly', async () => {
    const storage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    const h = setup({ storage, intercept: async () => { throw new Error('offline'); } });
    await h.client.load(scope, h.f.plan);await h.client.enqueue(scope, h.event(), h.f.plan);
    expect(h.client.get(scope)).toMatchObject({ saveStatus: 'error', pendingCount: 1 });
    expect(h.client.get(scope).storageError).toBeTruthy();
    expect(h.client.get(scope).state.evidence).toHaveLength(1);
  });

  it('keeps a bounded queue without discarding earlier unsaved work', async () => {
    const h = setup({ intercept: async () => { throw new Error('offline'); } });
    for (let i = 0; i < 128; i++)await h.client.enqueue(scope, { id: `select-${i}`, type: 'selection', profileId: scope.profileId, task: h.f.plan.tasks[0] }, h.f.plan);
    await expect(h.client.enqueue(scope, { id: 'select-overflow', type: 'selection', profileId: scope.profileId, task: h.f.plan.tasks[0] }, h.f.plan)).rejects.toThrow(/full/i);
    expect(h.client.get(scope).pendingCount).toBe(128);
  });

  it('gives guests session progress without sending or storing their outcomes', async () => {
    const h = setup();const guest = { ...scope, profileId: 'guest' };
    await h.client.load(guest, h.f.plan);
    await h.client.enqueue(guest, { ...h.event(), profileId: 'guest' }, h.f.plan);
    expect(h.client.get(guest)).toMatchObject({ saveStatus: 'guest', pendingCount: 0 });
    expect(h.client.get(guest).state.evidence).toHaveLength(1);
    expect(h.calls).toHaveLength(0);
    const next = createLearnCoachClient({ request: h.request, storage: h.storage });await next.load(guest, h.f.plan);
    expect(next.get(guest).state?.evidence ?? []).toHaveLength(0);
    next.dispose();
  });

  it('retains configured criteria across the serialized plan and acknowledged server projection', async () => {
    const h = setup();const plan = createCoachPlan({ ...h.f.plan, criteria: { cleanliness: 0.6 } });
    const task = plan.tasks[0];
    for (const id of ['custom-one', 'custom-two']) {
      const event = h.event(id);event.task = task;event.result.criteria.cleanliness = 0.7;
      await h.client.enqueue(scope, event, plan);
    }
    expect(Object.keys(h.client.get(scope).state.achievements)).toHaveLength(1);
    expect(projectCoach({ plan, state: h.client.get(scope).state, dayKey: '2026-10-26' }).segments[0].skills[0].ready).toBe(true);
  });

  it('can retain offline work when old browser storage contains an unexpected JSON shape', async () => {
    const storage = storageOf();storage.setItem('piano.learn.coach.outbox.v1', '[]');
    const h = setup({ storage, intercept: async () => { throw new Error('offline'); } });
    await h.client.enqueue(scope, h.event(), h.f.plan);h.client.dispose();
    const next = createLearnCoachClient({ request: h.request, storage });
    await next.load(scope, h.f.plan);
    expect(next.get(scope).pendingCount).toBe(1);
    next.dispose();
  });
  it.each([{}, [{}], [{body:{event:{id:'broken',type:'selection',task:{}}}}]])('quarantines unreadable nested work while allowing new work: %j',async(items)=>{
    const storage=storageOf();storage.setItem('piano.learn.coach.outbox.v1',JSON.stringify({[coachScopeKey(scope)]:{scope,items}}));
    const h=setup({storage});await expect(h.client.load(scope,h.f.plan)).resolves.toMatchObject({loaded:true});
    expect(h.client.get(scope).recoveryError).toMatch(/earlier practice/i);
    await h.client.enqueue(scope,h.event(),h.f.plan);expect(h.f.attempts.has('attempt-one')).toBe(true);
    const saved=JSON.parse(storage.getItem('piano.learn.coach.outbox.v1'));expect(saved[coachScopeKey(scope)].quarantined.length).toBeGreaterThan(0);
  });
  it('replays valid queued work against its captured plan after segment configuration changes',async()=>{
    const h=setup({intercept:async()=>{throw new Error('offline')}});await h.client.enqueue(scope,h.event(),h.f.plan);h.client.dispose();
    const changed=createCoachPlan({...h.f.plan,segments:[{id:'new',inMeasure:0,outMeasure:1,playableParts:['rh','lh']}]});
    const next=createLearnCoachClient({request:async()=>{throw new Error('offline')},storage:h.storage});
    await expect(next.load(scope,changed)).resolves.toMatchObject({loaded:true,pendingCount:1});expect(next.get(scope).state.evidence).toHaveLength(1);next.dispose();
  });

  it('preserves authored tempo stages through the saved recipe and server acknowledgements',async()=>{
    const h=setup();const plan=createCoachPlan({...h.f.plan,authoredLadder:true,segments:[{...h.f.plan.segments[0],ladder:[{id:'ramp',label:'Ramp',effectiveParts:['rh','lh'],mode:'cued',sets:2,reps:1,tempoPercent:60,tempoPercents:[60,100],completes:'passage'}]}]});
    const take=async(id,task)=>{const event=h.event(id);event.task=task;await h.client.enqueue(scope,event,plan)};
    await h.client.load(scope,plan);const first=projectCoach({plan}).recommended;await take('ramp-one',first);await take('ramp-slow-again',first);
    let p=projectCoach({plan,state:h.client.get(scope).state});expect(p.segments[0].complete).toBe(false);expect(p.recommended.tempoPercent).toBe(100);
    await take('ramp-full',p.recommended);p=projectCoach({plan,state:h.client.get(scope).state});expect(p.segments[0]).toMatchObject({complete:true,mastered:true});
  });

});
