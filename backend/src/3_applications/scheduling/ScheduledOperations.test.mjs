import test from 'node:test';
import assert from 'node:assert/strict';
import { LoggedScheduledOperation } from './LoggedScheduledOperation.mjs';
import { ScheduledAudienceOperation } from './ScheduledAudienceOperation.mjs';

test('logged operation preserves the scheduled non-throwing failure policy', async () => {
  const warnings = [];
  const operation = new LoggedScheduledOperation({
    run: async () => { throw new Error('offline'); },
    failureEvent: 'task.failed',
    logger: { warn: (...args) => warnings.push(args) },
  });
  assert.equal(await operation.execute(), null);
  assert.deepEqual(warnings, [['task.failed', { error: 'offline' }]]);
});

test('audience operation continues after a per-user failure when configured', async () => {
  const visited = [];
  const warnings = [];
  const operation = new ScheduledAudienceOperation({
    listSubjects: () => ['a', 'b'],
    executeForSubject: async (subject) => {
      visited.push(subject);
      if (subject === 'a') throw new Error('bad snapshot');
    },
    continueOnError: true,
    failureEvent: 'refresh.failed',
    logger: { warn: (...args) => warnings.push(args) },
  });
  await operation.execute();
  assert.deepEqual(visited, ['a', 'b']);
  assert.deepEqual(warnings, [['refresh.failed', { username: 'a', error: 'bad snapshot' }]]);
});
