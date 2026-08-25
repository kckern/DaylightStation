import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { RubiksCubeCourseService } from './RubiksCubeCourseService.mjs';
import { inverseMove, scramble } from '#shared/gaming/rulesets/rubiks-cube/index.mjs';

function subject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cube-course-'));
  const configService = { getUserProfile: (id) => id === 'milo' ? { id } : null, getUserDir: (id) => path.join(root, id) };
  return { service: new RubiksCubeCourseService({ configService, clock: () => new Date('2026-08-24T12:00:00Z') }), root };
}

test('the course starts at its first activity and keeps later work locked', () => {
  const { service } = subject(); const opened = service.open({ userId: 'milo' });
  assert.equal(opened.lesson.id, 'centres-and-pieces');
  assert.equal(opened.course.units[0].lessons[1].unlocked, false);
});

test('a demo completion unlocks the next activity', () => {
  const { service } = subject(); service.open({ userId: 'milo' });
  const completed = service.completeDemo({ userId: 'milo', lessonId: 'centres-and-pieces' });
  assert.equal(completed.course.units[0].lessons[1].unlocked, true);
});

test('a solved attempt unlocks the quiz, which requires eighty percent to advance', () => {
  const { service } = subject(); service.open({ userId: 'milo' });
  service.completeDemo({ userId: 'milo', lessonId: 'centres-and-pieces' });
  service.open({ userId: 'milo', lessonId: 'read-notation' });
  service.completeDemo({ userId: 'milo', lessonId: 'read-notation' });
  let opened = service.open({ userId: 'milo', lessonId: 'turn-practice' });
  for (const move of scramble(101, 3).reverse().map(inverseMove)) {
    opened = service.turn({ userId: 'milo', lessonId: 'turn-practice', move, expectedRevision: opened.active.revision });
  }
  assert.equal(opened.course.units[0].lessons[3].unlocked, true);
  service.open({ userId: 'milo', lessonId: 'know-the-cube-quiz' });
  const failed = service.answer({ userId: 'milo', lessonId: 'know-the-cube-quiz', answers: [1, 1, 1, 1, 1] });
  assert.equal(failed.quiz.passed, false);
  service.open({ userId: 'milo', lessonId: 'know-the-cube-quiz' });
  const passed = service.answer({ userId: 'milo', lessonId: 'know-the-cube-quiz', answers: [0, 2, 2, 1, 3] });
  assert.equal(passed.quiz.passed, true);
});

test('restart replaces a partially-played cube with the authored start state', () => {
  const { service } = subject(); service.open({ userId: 'milo' });
  service.completeDemo({ userId: 'milo', lessonId: 'centres-and-pieces' });
  service.open({ userId: 'milo', lessonId: 'read-notation' });
  service.completeDemo({ userId: 'milo', lessonId: 'read-notation' });
  const opened = service.open({ userId: 'milo', lessonId: 'turn-practice' });
  const moved = service.turn({ userId: 'milo', lessonId: 'turn-practice', move: 'R', expectedRevision: opened.active.revision });
  const restarted = service.restart({ userId: 'milo', lessonId: 'turn-practice' });
  assert.equal(moved.active.revision, 1);
  assert.equal(restarted.active.revision, 0);
  assert.deepEqual(restarted.active.moves, []);
});
