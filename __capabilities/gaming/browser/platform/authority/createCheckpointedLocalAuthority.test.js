import { describe, expect, it, beforeEach } from 'vitest';
import { createCheckpointedLocalAuthority } from './createCheckpointedLocalAuthority.js';
import { connectFourDefinition, connectFourRuleModule } from '../../../portable/rulesets/connect-four/index.mjs';

const NS = 'gaming:test-c4';
const make = () => createCheckpointedLocalAuthority({ ruleset: connectFourRuleModule, definition: connectFourDefinition, namespace: NS });
const create = (authority) => authority.create({ ruleset: { id: 'connect-four', version: 1 }, definitionId: 'connect-four-standard', participants: [{ id: 'p' }], viewer: { participant_id: 'p' } });

beforeEach(() => localStorage.clear());

describe('createCheckpointedLocalAuthority reclaim', () => {
  it('drops unindexed sessions on creation and keeps every indexed one', async () => {
    // All three come from ONE authority, so no sweep runs between them; the
    // sweep under test is the one the fresh authority below runs.
    const first = make();
    const dead = await create(first);
    const learnerA = await create(first);
    const learnerB = await create(first);
    localStorage.setItem(`${NS}:active:learner-a`, learnerA.header.session_id);
    localStorage.setItem(`${NS}:active:learner-b`, learnerB.header.session_id);
    localStorage.setItem('unrelated', 'x');
    expect(localStorage.getItem(`${NS}:snapshot:${dead.header.session_id}`)).not.toBe(null);

    const authority = make();
    expect(localStorage.getItem(`${NS}:snapshot:${dead.header.session_id}`)).toBe(null);
    expect(localStorage.getItem(`${NS}:journal:${dead.header.session_id}`)).toBe(null);
    await expect(authority.resume(learnerA.header.session_id, { participant_id: 'p' })).resolves.toBeTruthy();
    await expect(authority.resume(learnerB.header.session_id, { participant_id: 'p' })).resolves.toBeTruthy();
    expect(localStorage.getItem('unrelated')).toBe('x');
  });
});
