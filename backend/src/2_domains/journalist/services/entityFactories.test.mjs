import { describe, expect, it } from 'vitest';
import { QuizAnswer } from '../entities/QuizAnswer.mjs';
import { createQueueFromQuestions } from './QueueManager.mjs';

describe('journalist entity factories', () => {
  it('fromChoice carries caller-supplied identity into QuizAnswer', () => {
    const answer = QuizAnswer.fromChoice(
      { uuid: 'question-1', choices: ['A', 'B'] },
      'chat-1',
      '2026-08-28',
      1,
      '2026-08-28T12:00:00.000Z',
      'answer-1',
    );
    expect(answer.uuid).toBe('answer-1');
    expect(answer.answer).toBe(1);
  });

  it('requires identity rather than reading ambient entropy', () => {
    expect(() => QuizAnswer.fromChoice(
      { uuid: 'question-1', choices: ['A'] },
      'chat-1', '2026-08-28', 0, '2026-08-28T12:00:00.000Z',
    )).toThrow(/uuid is required/);
  });

  it('creates queue identities from the caller source', () => {
    let next = 0;
    const queue = createQueueFromQuestions(
      'chat-1', ['First?', 'Second?'], { quiz: true }, '2026-08-28T12:00:00.000Z', () => `queue-${++next}`,
    );
    expect(queue.map((item) => item.uuid)).toEqual(['queue-1', 'queue-2']);
  });

  it('requires an identity source for a nonempty queue', () => {
    expect(() => createQueueFromQuestions(
      'chat-1', ['Question?'], {}, '2026-08-28T12:00:00.000Z',
    )).toThrow(/newId required/);
  });
});
