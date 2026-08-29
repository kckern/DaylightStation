// tests/isolated/agents/concierge/concierge-transcript-path.test.mjs
//
// Verifies that concierge callers can persist transcript records through the
// application output port without coupling the collector to filesystem APIs.
import { describe, it, expect } from 'vitest';
import { AgentTranscript as BaseAgentTranscript } from '../../../../backend/src/3_applications/agents/framework/AgentTranscript.mjs';

class AgentTranscript extends BaseAgentTranscript {
  constructor(deps) { super({ turnId: 'test-turn', ...deps }); }
}

/**
 * Construct a collector with the output port used by concierge callers.
 */
function makeConciergeTranscript(satellite, writes) {
  return new AgentTranscript({
    agentId: 'concierge',
    userId: 'household',
    logger: { warn: () => {} },
    input: { text: 'hello', context: {} },
    transcriptStore: { save: async (entry) => writes.push(entry) },
  });
}

describe('concierge transcript output port', () => {
  it('passes the complete record to its store', async () => {
    const writes = [];
    const satellite = { id: 'kitchen', area: 'kitchen', allowedSkills: ['memory'] };
    const t = makeConciergeTranscript(satellite, writes);

    t.setStatus('ok');
    await t.flush();

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ agentId: 'concierge', userId: 'household' });
    expect(writes[0].transcript).toEqual(t.toJSON());
  });

  it('does not require a satellite to persist a transcript', async () => {
    const writes = [];
    const satellite = {};
    const t = makeConciergeTranscript(satellite, writes);

    t.setStatus('ok');
    await t.flush();

    expect(writes).toHaveLength(1);
    expect(writes[0].agentId).toBe('concierge');
  });

  it('is idempotent — second flush() is a no-op', async () => {
    const writes = [];
    const satellite = { id: 'livingroom' };
    const t = makeConciergeTranscript(satellite, writes);
    const t2 = t;
    t2.setStatus('ok');
    await t2.flush();
    await t2.flush(); // second call must be no-op
    expect(writes).toHaveLength(1);
  });

  it('setSatelliteSnapshot and setRequestBody populate transcript fields', () => {
    const satellite = { id: 'office', area: 'office', allowedSkills: ['media'] };
    const t = makeConciergeTranscript(satellite, []);
    t.setSatelliteSnapshot({ id: satellite.id, area: satellite.area, allowedSkills: satellite.allowedSkills });
    t.setRequestBody({ model: 'daylight-house', stream: false, conversation_id: null, messages: [] });
    const json = t.toJSON();
    expect(json.satellite).toEqual({ id: 'office', area: 'office', allowedSkills: ['media'] });
    expect(json.requestBody).toMatchObject({ model: 'daylight-house', stream: false });
  });
});
