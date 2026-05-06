// tests/isolated/agents/concierge/concierge-transcript-path.test.mjs
//
// Verifies that the filePathStrategy used by OpenAIChatCompletionsTranslator
// produces the same {mediaDir}/concierge/{YYYY-MM-DD}/{satId}/... layout
// that the old ConciergeTranscript used.
import { describe, it, expect } from 'vitest';
import { AgentTranscript } from '../../../../backend/src/3_applications/agents/framework/AgentTranscript.mjs';

/**
 * Replicate the exact filePathStrategy from OpenAIChatCompletionsTranslator
 * so this test exercises the same closure logic without importing the HTTP layer.
 */
function makeConciergeTranscript(satellite, mediaDir) {
  const satId = satellite?.id ?? 'unknown';
  return new AgentTranscript({
    agentId: 'concierge',
    userId: 'household',
    mediaDir,
    logger: { warn: () => {} },
    input: { text: 'hello', context: {} },
    fs: {
      mkdir: async () => {},
      writeFile: async () => {},
    },
    filePathStrategy: (t) => {
      const day = new Date(t.startedAt).toISOString().slice(0, 10);
      const ts = new Date(t.startedAt).toISOString().replace(/[:.]/g, '-');
      return `${t.mediaDir}/concierge/${day}/${satId}/${ts}-${t.turnId}.json`;
    },
  });
}

describe('concierge transcript path strategy', () => {
  it('produces {mediaDir}/concierge/{day}/{satId}/...json', async () => {
    const writes = [];
    const satellite = { id: 'kitchen', area: 'kitchen', allowedSkills: ['memory'] };
    const t = new AgentTranscript({
      agentId: 'concierge',
      userId: 'household',
      mediaDir: '/test/media',
      logger: { warn: () => {} },
      input: { text: 'hello', context: {} },
      fs: {
        mkdir: async () => {},
        writeFile: async (path) => { writes.push(path); },
      },
      filePathStrategy: (tr) => {
        const satId = satellite?.id ?? 'unknown';
        const day = new Date(tr.startedAt).toISOString().slice(0, 10);
        const ts = new Date(tr.startedAt).toISOString().replace(/[:.]/g, '-');
        return `${tr.mediaDir}/concierge/${day}/${satId}/${ts}-${tr.turnId}.json`;
      },
    });

    t.setStatus('ok');
    await t.flush();

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatch(/^\/test\/media\/concierge\/\d{4}-\d{2}-\d{2}\/kitchen\/.+\.json$/);
  });

  it('uses "unknown" satId when satellite has no id', async () => {
    const writes = [];
    const satellite = {};
    const t = new AgentTranscript({
      agentId: 'concierge',
      userId: 'household',
      mediaDir: '/test/media',
      logger: { warn: () => {} },
      input: { text: 'hello', context: {} },
      fs: {
        mkdir: async () => {},
        writeFile: async (path) => { writes.push(path); },
      },
      filePathStrategy: (tr) => {
        const satId = satellite?.id ?? 'unknown';
        const day = new Date(tr.startedAt).toISOString().slice(0, 10);
        const ts = new Date(tr.startedAt).toISOString().replace(/[:.]/g, '-');
        return `${tr.mediaDir}/concierge/${day}/${satId}/${ts}-${tr.turnId}.json`;
      },
    });

    t.setStatus('ok');
    await t.flush();

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatch(/\/concierge\/\d{4}-\d{2}-\d{2}\/unknown\//);
  });

  it('is idempotent — second flush() is a no-op', async () => {
    const writes = [];
    const satellite = { id: 'livingroom' };
    const t = makeConciergeTranscript(satellite, '/test/media');
    // Override the injected fs after construction is not possible; use fresh instance
    const t2 = new AgentTranscript({
      agentId: 'concierge',
      userId: 'household',
      mediaDir: '/test/media',
      logger: { warn: () => {} },
      input: { text: 'q', context: {} },
      fs: {
        mkdir: async () => {},
        writeFile: async (p) => { writes.push(p); },
      },
      filePathStrategy: (tr) => {
        const satId = satellite?.id ?? 'unknown';
        const day = new Date(tr.startedAt).toISOString().slice(0, 10);
        const ts = new Date(tr.startedAt).toISOString().replace(/[:.]/g, '-');
        return `${tr.mediaDir}/concierge/${day}/${satId}/${ts}-${tr.turnId}.json`;
      },
    });
    t2.setStatus('ok');
    await t2.flush();
    await t2.flush(); // second call must be no-op
    expect(writes).toHaveLength(1);
  });

  it('setSatelliteSnapshot and setRequestBody populate transcript fields', () => {
    const satellite = { id: 'office', area: 'office', allowedSkills: ['media'] };
    const t = makeConciergeTranscript(satellite, '/test/media');
    t.setSatelliteSnapshot({ id: satellite.id, area: satellite.area, allowedSkills: satellite.allowedSkills });
    t.setRequestBody({ model: 'daylight-house', stream: false, conversation_id: null, messages: [] });
    const json = t.toJSON();
    expect(json.satellite).toEqual({ id: 'office', area: 'office', allowedSkills: ['media'] });
    expect(json.requestBody).toMatchObject({ model: 'daylight-house', stream: false });
  });
});
