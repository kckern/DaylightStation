// tests/live/agent/paged-media-toc-agent.test.mjs
/**
 * Paged Media TOC Agent — Live Tests
 *
 * Tests agent registration and the background run endpoint.
 * Does NOT test full vision extraction (too slow for CI).
 * Use cli/paged-media-toc-backfill.cli.mjs for actual backfill execution.
 */

import { agentAPI } from './_agent-test-helper.mjs';

const AGENT_ID = 'paged-media-toc';

describe('Paged Media TOC Agent', () => {
  beforeAll(async () => {
    const { res, data } = await agentAPI('/');
    if (!res.ok) throw new Error(`Agent API not responding: ${res.status}`);
    const agent = data.agents?.find(a => a.id === AGENT_ID);
    if (!agent) {
      const available = data.agents?.map(a => a.id).join(', ') || 'none';
      throw new Error(`Agent ${AGENT_ID} not registered. Available: ${available}`);
    }
  });

  test('GET /agents — lists paged-media-toc agent', async () => {
    const { res, data } = await agentAPI('/');
    expect(res.status).toBe(200);
    const agent = data.agents.find(a => a.id === AGENT_ID);
    expect(agent).toBeDefined();
    expect(agent.id).toBe(AGENT_ID);
    expect(agent.description).toMatch(/paged.media/i);
  });

  test('GET /agents/paged-media-toc/assignments — returns assignments array', async () => {
    const { res, data } = await agentAPI(`/${AGENT_ID}/assignments`);
    expect(res.status).toBe(200);
    expect(data).toHaveProperty('agentId', AGENT_ID);
    expect(data).toHaveProperty('assignments');
    expect(Array.isArray(data.assignments)).toBe(true);
  });

  test('POST /agents/paged-media-toc/run-background — accepts background run', async () => {
    const { res, data } = await agentAPI(`/${AGENT_ID}/run-background`, {
      method: 'POST',
      body: { input: 'Scan for books that need TOC extraction and process them.' },
      timeout: 10000,
    });
    expect(res.status).toBe(202);
    expect(data).toHaveProperty('agentId', AGENT_ID);
    expect(data).toHaveProperty('taskId');
    expect(data).toHaveProperty('status', 'accepted');
  }, 15000);
});
