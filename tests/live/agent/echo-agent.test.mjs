// tests/live/agent/echo-agent.test.mjs
/**
 * Echo Agent API Contract Tests
 *
 * Validates the full agent API surface against the echo agent,
 * which is always registered and requires no external dependencies.
 */

import { agentAPI } from './_agent-test-helper.mjs';

const TEST_USER = '_test-agent';

describe('Echo Agent API', () => {

  test('GET /agents — lists agents including echo', async () => {
    const { res, data } = await agentAPI('/');
    expect(res.status).toBe(200);
    expect(data).toHaveProperty('agents');
    expect(Array.isArray(data.agents)).toBe(true);

    const echo = data.agents.find(a => a.id === 'echo');
    expect(echo).toBeDefined();
    expect(echo.id).toBe('echo');
  });

  test('GET /agents/echo/assignments — returns assignments array', async () => {
    const { res, data } = await agentAPI('/echo/assignments');
    expect(res.status).toBe(200);
    expect(data).toHaveProperty('agentId', 'echo');
    expect(data).toHaveProperty('assignments');
    expect(Array.isArray(data.assignments)).toBe(true);
  });

  test('POST /agents/echo/run — runs agent and returns output', async () => {
    const { res, data } = await agentAPI('/echo/run', {
      method: 'POST',
      body: { input: 'hello from test' },
      timeout: 30000,
    });
    expect(res.status).toBe(200);
    expect(data).toHaveProperty('agentId', 'echo');
    expect(data).toHaveProperty('output');
    expect(typeof data.output).toBe('string');
    expect(data).toHaveProperty('toolCalls');
    expect(Array.isArray(data.toolCalls)).toBe(true);
  }, 30000);

  test('GET /agents/echo/memory/:userId — reads memory entries', async () => {
    const { res, data } = await agentAPI(`/echo/memory/${TEST_USER}`);
    expect(res.status).toBe(200);
    expect(data).toHaveProperty('agentId', 'echo');
    expect(data).toHaveProperty('userId', TEST_USER);
    expect(data).toHaveProperty('entries');
    expect(typeof data.entries).toBe('object');
  });

  test('DELETE /agents/echo/memory/:userId — clears all memory', async () => {
    const { res, data } = await agentAPI(`/echo/memory/${TEST_USER}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    expect(data).toHaveProperty('cleared', true);
  });

  test('GET /agents/nonexistent/assignments — returns 404', async () => {
    const { res, data } = await agentAPI('/nonexistent/assignments');
    expect(res.status).toBe(404);
    expect(data).toHaveProperty('error');
    expect(data.error).toMatch(/not found/i);
  });
});
