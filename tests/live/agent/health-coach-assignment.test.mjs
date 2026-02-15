// tests/live/agent/health-coach-assignment.test.mjs
/**
 * Health Coach Assignment Pipeline Test
 *
 * Triggers the daily-dashboard assignment and verifies the full pipeline:
 * 1. Assignment completes successfully
 * 2. Dashboard file is written with correct structure
 * 3. Working memory is updated
 * 4. Cleanup: delete generated dashboard
 *
 * Requires: health-coach agent registered, health services configured, LLM API key.
 * Fails fast if prerequisites are missing.
 */

import { agentAPI, dashboardAPI, householdAPI, today } from './_agent-test-helper.mjs';

const AGENT_ID = 'health-coach';
const ASSIGNMENT_ID = 'daily-dashboard';
const DATE = today();

describe('Health Coach Assignment Pipeline', () => {
  let userId;

  beforeAll(async () => {
    // Verify health-coach is registered
    const { res, data } = await agentAPI('/');
    if (!res.ok) {
      throw new Error(`Agent API not responding: ${res.status}`);
    }

    const agent = data.agents?.find(a => a.id === AGENT_ID);
    if (!agent) {
      throw new Error(
        `Agent '${AGENT_ID}' is not registered. ` +
        'Health services are likely not configured. ' +
        `Available agents: ${data.agents?.map(a => a.id).join(', ') || 'none'}`
      );
    }

    // Get a real userId from household
    const { data: hhData } = await householdAPI();
    const members = hhData?.members || [];
    if (members.length === 0) {
      throw new Error('No household members found — cannot determine userId for test');
    }
    userId = members[0].username || members[0].id;
  });

  test('triggers daily-dashboard assignment and gets success', async () => {
    const { res, data } = await agentAPI(
      `/${AGENT_ID}/assignments/${ASSIGNMENT_ID}/run`,
      {
        method: 'POST',
        body: { userId },
        timeout: 120000,
      }
    );

    expect(res.status).toBe(200);
    expect(data).toHaveProperty('agentId', AGENT_ID);
    expect(data).toHaveProperty('assignmentId', ASSIGNMENT_ID);
    expect(data).toHaveProperty('status', 'complete');
    expect(data).toHaveProperty('result');
  }, 120000);

  test('dashboard was written with expected structure', async () => {
    const { res, data } = await dashboardAPI(`/${userId}/${DATE}`);

    expect(res.status).toBe(200);
    expect(data).toHaveProperty('dashboard');

    const db = data.dashboard;

    // Top-level structure
    expect(db).toHaveProperty('curated');
    expect(db).toHaveProperty('coach');

    // Curated content: up_next with primary
    expect(db.curated).toHaveProperty('up_next');
    expect(db.curated.up_next).toHaveProperty('primary');
    expect(db.curated.up_next.primary).toHaveProperty('content_id');
    expect(db.curated.up_next.primary).toHaveProperty('title');

    // Coach content: briefing is a non-empty string
    expect(db.coach).toHaveProperty('briefing');
    expect(typeof db.coach.briefing).toBe('string');
    expect(db.coach.briefing.length).toBeGreaterThan(0);
  });

  test('working memory was updated', async () => {
    const { res, data } = await agentAPI(`/${AGENT_ID}/memory/${userId}`);

    expect(res.status).toBe(200);
    expect(data).toHaveProperty('entries');
    expect(typeof data.entries).toBe('object');

    const keys = Object.keys(data.entries);
    expect(keys.length).toBeGreaterThan(0);
  });

  test('cleanup: delete generated dashboard', async () => {
    const { res, data } = await dashboardAPI(`/${userId}/${DATE}`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    expect(data).toHaveProperty('deleted', true);
  });
});
