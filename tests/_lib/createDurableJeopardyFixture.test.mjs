import fs from 'node:fs';
import { it, expect } from 'vitest';
import { createDurableJeopardyFixture } from './createDurableJeopardyFixture.mjs';

it('uses temporary real persistence, pinned definitions and exact duplicate replay after restart', async () => {
  const fixture = await createDurableJeopardyFixture();
  try {
    const viewer = { role: 'host' };
    const created = await fixture.application.createSession({ definitionId: 'jeopardy:test', seats: [{ id: 'blue' }, { id: 'gold' }], viewer });
    const envelope = { command_id: 'cmd:start', actor_id: 'host', expected_revision: 0, logical_time: 1, command: { type: 'BUZZER_SETUP', epoch: 'fixture' } };
    const accepted = await fixture.application.dispatch(created.header.session_id, envelope, viewer);
    const restarted = fixture.restart();
    const duplicate = await restarted.application.dispatch(created.header.session_id, envelope, viewer);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.header.revision).toBe(accepted.header.revision);
    expect((await restarted.application.resumeSession(created.header.session_id, viewer)).state).toEqual(accepted.state);
    expect(fs.readdirSync(fixture.root)).toContain('snapshots');
  } finally { fixture.dispose(); }
  expect(fs.existsSync(fixture.root)).toBe(false);
});
