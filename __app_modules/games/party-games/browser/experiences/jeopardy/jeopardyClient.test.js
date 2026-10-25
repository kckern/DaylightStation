import { it, expect, vi, beforeEach } from 'vitest';
import { DaylightAPI } from '@/lib/api.mjs';
import { jeopardyRuleModule as rules } from '../../../../../../__capabilities/gaming/portable/rulesets/jeopardy/index.mjs';
import { sendJeopardyCommand } from './jeopardyClient.js';
vi.mock('@/lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
const definition = { rounds: [{ mode: 'hosted', categories: [{ clues: [{ value: 100, clue: 'Question', answer: 'Answer' }] }] }] };
const conflict = () => Object.assign(new Error('Revision conflict'), { status: 409, body: { error: 'revision_conflict' } });
function server(phase = 'board') {
  let state = rules.createInitialState(definition, { seats: [{ id: 'red' }] });
  state = { ...state, phase, active: phase === 'clue' ? { cat: 0, row: 0, clue: definition.rounds[0].categories[0].clues[0] } : null, buzzerSetup: { epoch: 'tv', seenAt: 1000, teams: { red: { slot: 'gamepad:0:Pad', generation: 0, connected: true, tested: true } } } };
  let revision = 0;
  return {
    snapshot: () => ({ header: { revision }, state }),
    phoneCommit() { revision++; },
    post(envelope) {
      if (envelope.expected_revision !== revision) throw conflict();
      const result = rules.handleCommand(state, envelope.command, definition, { actorId: 'host', logicalTime: 1000 });
      if (result.error) throw new Error(result.error.code);
      state = result.state; revision++; return this.snapshot();
    },
  };
}
it('retries a disconnect revision conflict caused by a phone command against fresh authority state', async () => {
  const authority = server(); let posts = 0;
  DaylightAPI.mockImplementation(async (_, envelope, method) => {
    if (method !== 'POST') return authority.snapshot();
    if (++posts === 1) authority.phoneCommit();
    return authority.post(envelope);
  });
  const result = await sendJeopardyCommand('race:disconnect', { type: 'BUZZER_REPORT', kind: 'disconnect', epoch: 'tv', teamId: 'red', generation: 0, slot: 'gamepad:0:Pad' });
  expect(result.state.buzzerSetup.teams.red).toMatchObject({ connected: false, tested: false, generation: 1 });
  expect(posts).toBe(2);
});
it('serializes heartbeat and winning BUZZ in one local session lane', async () => {
  const authority = server('clue'); let release;
  const pause = new Promise(resolve => { release = resolve; });
  const committed = [];
  DaylightAPI.mockImplementation(async (_, envelope, method) => {
    if (method !== 'POST') return authority.snapshot();
    if (envelope.command.type === 'jeopardy.buzzer.presence') await pause;
    const result = authority.post(envelope); committed.push(envelope.command.type); return result;
  });
  const heartbeat = sendJeopardyCommand('race:buzz', { type: 'BUZZER_PRESENCE', epoch: 'tv' });
  await Promise.resolve(); await Promise.resolve();
  const buzz = sendJeopardyCommand('race:buzz', { type: 'BUZZ', teamId: 'red' });
  await Promise.resolve(); await Promise.resolve();
  release();
  await Promise.all([heartbeat, buzz]);
  expect(authority.snapshot().state).toMatchObject({ phase: 'judging', answeringTeamId: 'red' });
  expect(committed).toEqual(['jeopardy.buzzer.presence', 'jeopardy.buzz']);
});
