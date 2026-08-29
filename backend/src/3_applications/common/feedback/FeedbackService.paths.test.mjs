import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedbackItemPath } from '#adapters/feedback/FilesystemFeedbackRepository.mjs';

test('partitions by the month embedded in the id', () => {
  assert.equal(
    feedbackItemPath('/d/household/feedback', 'piano', '20260817193407_NhEu1Y'),
    '/d/household/feedback/piano/2026-08/20260817193407_NhEu1Y.yml',
  );
});

test('handles a different app and month', () => {
  assert.equal(
    feedbackItemPath('/d/household/feedback', 'fitness', '20260702215307_J0bvRU'),
    '/d/household/feedback/fitness/2026-07/20260702215307_J0bvRU.yml',
  );
});

test('rejects an id without a leading YYYYMM rather than writing to a junk dir', () => {
  assert.throws(() => feedbackItemPath('/d', 'piano', 'nope'), /unpartitionable/);
});
