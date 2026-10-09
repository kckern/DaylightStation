/** Exact HTTP serialization over memory; run only with the confined preparation runner. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schoolHttpFixture, stamp } from '../drivers/school-http.mjs';
const check = (name, fn) => test('CASE-SCHOOL-HTTP-' + name, { timeout: 5000 }, fn);
check('ROSTER-BANK-FILTER', async () => {
  const f = schoolHttpFixture();
  const roster = await f.request('GET', '/roster');
  assert.equal(roster.status, 200); assert.deepEqual(roster.json(), [{ id: 'kid1', name: 'KID1' }]);
  const banks = await f.request('GET', '/banks?audience=generic');
  assert.equal(banks.status, 200); assert.deepEqual(banks.json(), [{ id: 'animals' }]);
  assert.equal(f.calls.banks.length, 1); assert.equal(f.calls.banks[0].audience, 'generic');
  assert.deepEqual(f.writes, []);
});
check('SESSION-ERROR-TYPES', async () => {
  const f = schoolHttpFixture();
  for (const [body, status] of [[{ bankId: 'assigned-bank', mode: 'quiz' }, 403], [{ userId: 'kid1', bankId: 'nope', mode: 'quiz' }, 404]]) {
    const response = await f.request('POST', '/sessions', { body }); assert.equal(response.status, status); assert.ok(response.json().error);
  }
  const body = { userId: 'kid1', bankId: 'caps', mode: 'quiz' };
  const ok = await f.request('POST', '/sessions', { body });
  assert.equal(ok.status, 200); assert.deepEqual(ok.json(), { sessionId: 'ses_1' });
  assert.equal(f.calls.sessions.length, 3); assert.equal(f.calls.sessions[2].userId, 'kid1'); assert.equal(f.calls.sessions[2].bankId, 'caps');
  assert.deepEqual(f.writes, []);
});
check('ANSWER-STATUS-AND-PAYLOAD', async () => {
  const f = schoolHttpFixture();
  for (const [id, body, status] of [['ses_gone', { itemId: 'q1', given: 'x' }, 410], ['ses_1', { itemId: 'q1', selfGrade: 'correct' }, 400], ['ses_boom', { itemId: 'q1', given: 'x' }, 500]]) {
    const response = await f.request('POST', '/sessions/' + id + '/answer', { body }); assert.equal(response.status, status); assert.ok(response.json().error);
  }
  const ok = await f.request('POST', '/sessions/ses_1/answer', { body: { itemId: 'q1', given: 'x' } });
  assert.equal(ok.status, 200); assert.deepEqual(ok.json(), { correct: true, expected: 'x', attemptId: 'att_1' });
  assert.equal(f.calls.answers.length, 4); assert.equal(f.calls.answers[3].sessionId, 'ses_1'); assert.equal(f.calls.answers[3].given, 'x');
  assert.deepEqual(f.writes, []);
});
check('PROGRESS-QUERY-FORWARDING', async () => {
  const f = schoolHttpFixture();
  const response = await f.request('GET', '/users/kid1/material-progress?subject=science');
  assert.equal(response.status, 200); assert.deepEqual(response.json(), [{ materialId: 'plex:v1', unitsDone: 1, unitTotal: 2, percent: 50 }]);
  assert.equal(f.calls.progress.length, 1); assert.equal(f.calls.progress[0].userId, 'kid1'); assert.equal(f.calls.progress[0].subject, 'science');
  assert.deepEqual(f.writes, []);
});
check('AGENDA-GET-PREVIEWS-POST-ISSUES', async () => {
  const f = schoolHttpFixture();
  const preview = await f.request('GET', '/lifecycle/learners/kid1/agenda?studyDay=2026-07-27');
  assert.equal(preview.status, 200); assert.equal(preview.headers['content-type'], 'image/png'); assert.equal(preview.body, 'png:preview-kid1');
  assert.deepEqual(f.calls.previews, [{ learnerId: 'kid1', learnerName: 'KID1', studyDay: '2026-07-27' }]); assert.deepEqual(f.calls.builds, []); assert.deepEqual(f.writes, []);
  const issue = await f.request('POST', '/lifecycle/learners/kid1/agenda', { body: {} });
  assert.equal(issue.status, 200); assert.equal(issue.body, 'png:agenda-kid1'); assert.equal(issue.headers['content-disposition'], 'inline; filename="agenda-kid1.png"');
  assert.deepEqual(f.calls.builds, [{ learnerId: 'kid1', learnerName: 'KID1' }]); assert.equal(f.calls.previews.length, 1);
});
check('ASSIGNMENT-CHILD-REFUSAL-NO-WRITE', async () => {
  const f = schoolHttpFixture();
  const response = await f.request('PUT', '/lifecycle/assignments/kid1', { body: { courses: ['math-fractions'], units: [], assignedBy: 'kid1' } });
  assert.equal(response.status, 403); assert.ok(response.json().error); assert.deepEqual(f.writes, []); assert.equal(f.rows.size, 0);
});
check('ASSIGNMENT-ADULT-EXACT-WRITE', async () => {
  const f = schoolHttpFixture();
  const response = await f.request('PUT', '/lifecycle/assignments/kid1', { body: { courses: ['math-fractions'], units: [], assignedBy: 'dad' } });
  const expected = { learnerId: 'kid1', courses: ['math-fractions'], units: [], programs: [], assignedBy: 'dad', updatedAt: stamp };
  assert.equal(response.status, 200); assert.deepEqual(response.json(), expected); assert.deepEqual(f.writes, [expected]); assert.deepEqual(f.rows.get('kid1'), expected);
});
check('UNWIRED-LIFECYCLE-ABSENT', async () => {
  const f = schoolHttpFixture({ unwired: true });
  const response = await f.request('PUT', '/lifecycle/assignments/kid1', { body: { courses: [], units: [], assignedBy: 'dad' } });
  assert.equal(response.status, 404); assert.deepEqual(f.writes, []); assert.equal(f.rows.size, 0);
});
