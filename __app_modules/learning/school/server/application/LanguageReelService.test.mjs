// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { LanguageReelService } from './LanguageReelService.mjs';

function fixture({ speaking = false } = {}) {
  const reel = { reviewState: 'approved', title: 'Conversation', media: { assetId: 'school:language/korean-language-reels/dialogue/123' },
    transcript: [{ id: 'line', startMs: 0, endMs: 1000, text: 'Hello' }], vocabulary: [],
    authoring: { cloze: [{ id: 'fill', lineId: 'line', prompt: 'Say ___', answer: 'hello', decoys: ['bye', 'yes', 'no'] }],
      comprehension: [{ id: 'meaning', prompt: 'Meaning?', choices: ['greeting', 'farewell'], answer: 'greeting' }], speaking: { enabled: speaking, segments: [] } } };
  const sessions = new Map();
  const key = (u, r) => `${u}/${r}`;
  const repository = { findReel: () => ({ reel, bytes: JSON.stringify(reel) }),
    readSession: (u, r) => structuredClone(sessions.get(key(u, r)) ?? null), sessionExists: (u, r) => sessions.has(key(u, r)),
    writeSession: (u, r, s) => sessions.set(key(u, r), structuredClone(s)) };
  const service = new LanguageReelService({ repository, idFactory: () => '1', clock: () => new Date('2026-11-16T12:00:00Z') });
  const identity = { userId: 'learner', reelId: '123' };
  service.open(identity);
  return { service, repository, identity, reel };
}
const listen = (h) => h.service.markStage({ ...h.identity, stage: 'listen' });
const attempt = (h, extra = {}) => h.service.recordAttempt({ ...h.identity, type: 'cloze', itemId: 'fill', answer: 'hello', ...extra });

describe('LanguageReelService durable authority', () => {
  it('rejects skipping an unfinished stage', () => {
    const h = fixture();
    expect(() => h.service.markStage({ ...h.identity, stage: 'watch' })).toThrow(/order|first/i);
    expect(h.repository.readSession('learner', '123').stages.watch).toBe(false);
  });
  it('rejects nonexistent authored items without persisting an attempt', () => {
    const h = fixture(); listen(h);
    expect(() => attempt(h, { itemId: 'invented', correct: true })).toThrow(/item/i);
    expect(h.repository.readSession('learner', '123').attempts).toEqual([]);
  });
  it('grades authored answers regardless of submitted correctness and requires durable success', () => {
    const h = fixture(); listen(h);
    const wrong = attempt(h, { answer: 'bye', correct: true });
    expect(wrong.attempts[0].correct).toBe(false);
    expect(() => h.service.markStage({ ...h.identity, stage: 'cloze' })).toThrow(/correct|attempt/i);
    const right = attempt(h, { correct: false });
    expect(right.attempts[1].correct).toBe(true);
    expect(h.service.markStage({ ...h.identity, stage: 'cloze' }).stages.cloze).toBe(true);
  });
  it('does not accept an answer outside authored choices', () => {
    const h = fixture(); listen(h);
    expect(() => attempt(h, { answer: 'invented', correct: true })).toThrow(/answer|choice/i);
  });
  it('requires every comprehension item and preserves optional speaking participation', () => {
    const h = fixture();
    h.reel.authoring.comprehension.push({ id: 'second', prompt: 'Who?', choices: ['friend', 'stranger'], correctAnswer: 'friend' });
    h.service.open(h.identity); listen(h); attempt(h); h.service.markStage({ ...h.identity, stage: 'cloze' }); h.service.markStage({ ...h.identity, stage: 'watch' });
    expect(() => h.service.markStage({ ...h.identity, stage: 'comprehension' })).toThrow(/correct|attempt/i);
    const result = h.service.recordAttempt({ ...h.identity, type: 'comprehension', itemId: 'meaning', answer: 'greeting' });
    expect(result.attempts.at(-1).correct).toBe(true);
    expect(() => h.service.markStage({ ...h.identity, stage: 'comprehension' })).toThrow(/correct|attempt/i);
    h.service.recordAttempt({ ...h.identity, type: 'comprehension', itemId: 'second', answer: 'friend' });
    expect(h.service.markStage({ ...h.identity, stage: 'comprehension' }).completedAt).toBe('2026-11-16T12:00:00.000Z');
  });
  it('propagates a durable write failure and leaves the stage unrecorded', () => {
    const h = fixture(); listen(h); h.repository.writeSession = () => { throw new Error('disk unavailable'); };
    expect(() => attempt(h)).toThrow('disk unavailable');
    expect(h.repository.readSession('learner', '123').attempts).toEqual([]);
  });
});
