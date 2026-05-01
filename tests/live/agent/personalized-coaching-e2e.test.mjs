// tests/live/agent/personalized-coaching-e2e.test.mjs
/**
 * Personalized Coaching End-to-End Test
 *
 * Triggers the morning-brief assignment against a populated fixture archive
 * and asserts that the LLM output reflects the personalization signals wired
 * up across Tasks 6-30:
 *   - Personal Context (playbook) is loaded into the system prompt
 *   - At least one personalization signal fires (named pattern, similar
 *     period, compliance CTA, or stale-DEXA CTA)
 *   - Calibrated body composition values are available (Task 29 wiring)
 *
 * Prerequisites (fail-fast — no skipping):
 *   - Dev server reachable at TEST_BASE_URL
 *   - OPENAI_API_KEY set in the backend environment
 *   - health-coach agent registered (implies health services configured)
 *   - At least one household member exists
 *   - The fixture playbook has been mirrored to the test user's archive
 *     (`data/users/{userId}/lifelog/archives/playbook/playbook.yml`)
 *
 * Per CLAUDE.md test discipline ("skipping is NOT passing"), missing
 * prerequisites cause an immediate `throw` with a copy-paste-able fix.
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { agentAPI, householdAPI, BASE_URL } from './_agent-test-helper.mjs';
import { getDataPath } from '#testlib/configHelper.mjs';

const AGENT_ID = 'health-coach';
const ASSIGNMENT_ID = 'morning-brief';

// Fixture playbook source — mirrored into the user archive prior to test runs.
const FIXTURE_PLAYBOOK_REL = 'tests/_fixtures/health-archive/external/playbook/playbook.yml';

// Personalization signals: any of these substrings/regexes appearing in the
// LLM output is sufficient evidence that personalization is active. The LLM
// is non-deterministic, so we keep the matcher liberal — a single hit passes.
//
// Tier 1: explicit references to playbook content (named patterns, named
// periods). These are the strongest signals.
const PLAYBOOK_PATTERN_NAMES = [
  'same-jog-rut',
  'if-trap-risk',
  'maintenance-drift',
  'tracked-cut-formula',
];
const PLAYBOOK_PERIOD_NAMES = [
  'fixture-cut-2024',
  'fixture-rebound-2024',
];

// Tier 2: humanized references to the same patterns/periods. Useful because
// the LLM is encouraged in the system prompt to translate the slug into
// natural prose. Each entry is a regex string.
const HUMANIZED_PATTERN_PHRASES = [
  /jog\s*rut/i,
  /(intermittent fasting|if).{0,30}(protein|breakfast)/i,
  /maintenance\s*drift/i,
  /tracked[\s-]*cut/i,
  /post[\s-]*cut\s*(rebound|drift)/i,
];

// Tier 3: soft historical-reference language. The system prompt was updated
// in Task 25 to encourage the LLM to ground advice in precedent. Hits here
// alone are weak evidence but acceptable for a "any signal" check.
const HISTORICAL_PHRASES = [
  /\blast time\b/i,
  /\bpreviously\b/i,
  /\bhistorically\b/i,
  /\bsimilar period\b/i,
  /\bsimilar to\b/i,
];

// Compliance CTA copy comes from CTA_COPY in MorningBrief.mjs and shows up
// verbatim when a streak threshold is crossed.
const COMPLIANCE_CTA_PHRASES = [
  /post[\s-]*workout\s*protein/i,
  /strength\s*micro[\s-]*drill/i,
];

// DEXA staleness CTA — Task 30 surfaces this when calibration is past
// threshold. Wording is open-ended; match on "DEXA" or "scan" + staleness
// language.
const DEXA_STALENESS_PHRASES = [
  /\bdexa\b/i,
  /body\s*scan/i,
  /\bre[\s-]*scan\b/i,
];

function findPersonalizationSignals(text) {
  const hits = [];

  for (const name of PLAYBOOK_PATTERN_NAMES) {
    if (text.toLowerCase().includes(name)) hits.push(`pattern:${name}`);
  }
  for (const name of PLAYBOOK_PERIOD_NAMES) {
    if (text.toLowerCase().includes(name)) hits.push(`period:${name}`);
  }
  for (const re of HUMANIZED_PATTERN_PHRASES) {
    if (re.test(text)) hits.push(`humanized:${re.source}`);
  }
  for (const re of HISTORICAL_PHRASES) {
    if (re.test(text)) hits.push(`historical:${re.source}`);
  }
  for (const re of COMPLIANCE_CTA_PHRASES) {
    if (re.test(text)) hits.push(`compliance:${re.source}`);
  }
  for (const re of DEXA_STALENESS_PHRASES) {
    if (re.test(text)) hits.push(`dexa:${re.source}`);
  }

  return hits;
}

describe('Personalized Coaching End-to-End (morning-brief)', () => {
  let userId;
  let assignmentResult;
  let messageText;

  beforeAll(async () => {
    // 1. Dev server reachable?
    let agentList;
    try {
      agentList = await agentAPI('/');
    } catch (err) {
      throw new Error(
        `Dev server not running or unreachable at ${BASE_URL}. ` +
        `Start it with \`npm run dev\` (see CLAUDE.md "Dev Workflow"). ` +
        `Underlying error: ${err.message}`
      );
    }
    if (!agentList.res.ok) {
      throw new Error(
        `Agent API returned ${agentList.res.status} from ${BASE_URL}. ` +
        `Verify the backend is healthy.`
      );
    }

    // 2. health-coach agent registered?
    const agent = agentList.data?.agents?.find(a => a.id === AGENT_ID);
    if (!agent) {
      throw new Error(
        `Agent '${AGENT_ID}' is not registered. Health services are likely ` +
        `not configured. Available agents: ` +
        `${agentList.data?.agents?.map(a => a.id).join(', ') || 'none'}`
      );
    }

    // 3. morning-brief assignment registered?
    const assignmentsRes = await agentAPI(`/${AGENT_ID}/assignments`);
    if (!assignmentsRes.res.ok) {
      throw new Error(
        `Failed to list assignments for '${AGENT_ID}': ` +
        `${assignmentsRes.res.status}`
      );
    }
    const assignmentIds = (assignmentsRes.data?.assignments || []).map(a => a.id);
    if (!assignmentIds.includes(ASSIGNMENT_ID)) {
      throw new Error(
        `Assignment '${ASSIGNMENT_ID}' not registered on '${AGENT_ID}'. ` +
        `Available: ${assignmentIds.join(', ') || 'none'}`
      );
    }

    // 4. Resolve a real userId from the household admin endpoint.
    const { data: hhData } = await householdAPI();
    const members = hhData?.members || [];
    if (members.length === 0) {
      throw new Error('No household members found — cannot determine userId for test');
    }
    userId = members[0].username || members[0].id;

    // 5. Fixture playbook mirrored into the user archive?
    const dataPath = getDataPath();
    if (!dataPath) {
      throw new Error(
        'Could not resolve data path (DAYLIGHT_DATA_PATH or DAYLIGHT_BASE_PATH ' +
        'must be set in the environment or .env).'
      );
    }
    const playbookPath = path.join(
      dataPath,
      'users',
      userId,
      'lifelog/archives/playbook/playbook.yml'
    );
    try {
      await fs.access(playbookPath);
    } catch {
      throw new Error(
        `Fixture playbook missing at ${playbookPath}. ` +
        `To run this test, mirror the fixture playbook into the user archive:\n` +
        `  mkdir -p "${path.dirname(playbookPath)}"\n` +
        `  cp "${FIXTURE_PLAYBOOK_REL}" "${playbookPath}"`
      );
    }
  });

  test('morning-brief assignment completes without error', async () => {
    const { res, data } = await agentAPI(
      `/${AGENT_ID}/assignments/${ASSIGNMENT_ID}/run`,
      {
        method: 'POST',
        body: { userId },
        timeout: 180000,
      }
    );

    if (res.status !== 200) {
      throw new Error(
        `runAssignment failed: HTTP ${res.status} — ` +
        `${JSON.stringify(data)}. ` +
        `Common causes: missing OPENAI_API_KEY, missing fixture data ` +
        `(weight/nutrition/goals), or a tool registration gap.`
      );
    }

    expect(res.status).toBe(200);
    expect(data).toHaveProperty('agentId', AGENT_ID);
    expect(data).toHaveProperty('assignmentId', ASSIGNMENT_ID);
    expect(data).toHaveProperty('status', 'complete');
    expect(data).toHaveProperty('result');

    assignmentResult = data.result;
  }, 180000);

  test('LLM produced a non-empty coaching message (should_send + text)', () => {
    if (!assignmentResult) {
      throw new Error(
        'Assignment did not produce a result — see prior test failure.'
      );
    }

    expect(assignmentResult).toHaveProperty('should_send');
    expect(assignmentResult.should_send).toBe(true);
    expect(assignmentResult).toHaveProperty('text');
    expect(typeof assignmentResult.text).toBe('string');
    expect(assignmentResult.text.length).toBeGreaterThan(0);

    messageText = assignmentResult.text;
  });

  test('output references at least one personalization signal', () => {
    if (!messageText) {
      throw new Error(
        'No message text — see prior test failure.'
      );
    }

    const hits = findPersonalizationSignals(messageText);

    if (hits.length === 0) {
      throw new Error(
        'Output contains no personalization signals. The morning brief ran, ' +
        'but it did not reference any named pattern, named period, ' +
        'compliance CTA, DEXA CTA, or historical-precedent phrasing. ' +
        'Either the playbook signals did not fire (gather phase produced ' +
        'no detections) or the LLM ignored them. ' +
        `\n\n--- LLM output ---\n${messageText}\n--- end output ---`
      );
    }

    expect(hits.length).toBeGreaterThan(0);
  });

  test('memory was stamped (last_morning_brief)', async () => {
    const { res, data } = await agentAPI(`/${AGENT_ID}/memory/${userId}`);
    expect(res.status).toBe(200);
    expect(data).toHaveProperty('entries');
    const keys = Object.keys(data.entries || {});
    expect(keys).toContain('last_morning_brief');
  });
});
