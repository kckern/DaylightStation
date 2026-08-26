import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { RubiksCubeCourseService } from './RubiksCubeCourseService.mjs';
import { YamlDocumentFileStore } from '#adapters/school/YamlDocumentFileStore.mjs';
import { RubiksPacketPlanner } from './RubiksPacketPlanner.mjs';
import { inverseMove, scramble } from '#shared/gaming/rulesets/rubiks-cube/index.mjs';
import { engineCubeToFacelets } from './physicalCube.mjs';

function subject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cube-course-'));
  const configService = { getUserProfile: (id) => id === 'learner3' ? { id } : null, getUserDir: (id) => path.join(root, id) };
  const clock = () => new Date('2026-08-24T12:00:00Z'); const recoverySolver = { solve: async () => [] };
  return { service: new RubiksCubeCourseService({ configService, store: new YamlDocumentFileStore(), recoverySolver, packetPlanner: new RubiksPacketPlanner({ solver: recoverySolver, clock }), clock }), root };
}

const colors = { U: 'white', R: 'red', F: 'green', D: 'yellow', L: 'orange', B: 'blue' };
const solvedFaces = () => {
  const facelets = engineCubeToFacelets({ U: Array(9).fill('white'), R: Array(9).fill('red'), F: Array(9).fill('green'), D: Array(9).fill('yellow'), L: Array(9).fill('orange'), B: Array(9).fill('blue') });
  return Object.fromEntries(['U', 'R', 'F', 'D', 'L', 'B'].map((face, index) => [face, [...facelets.slice(index * 9, index * 9 + 9)].map((role) => colors[role])]));
};

test('the course starts at its first activity and keeps later work locked', () => {
  const { service } = subject(); const opened = service.open({ userId: 'learner3' });
  assert.equal(opened.lesson.id, 'centres-and-pieces');
  assert.equal(opened.course.units[0].lessons[1].unlocked, false);
});

test('a demo completion unlocks the next activity', () => {
  const { service } = subject(); service.open({ userId: 'learner3' });
  const completed = service.completeDemo({ userId: 'learner3', lessonId: 'centres-and-pieces' });
  assert.equal(completed.course.units[0].lessons[1].unlocked, true);
});

test('a solved attempt unlocks the quiz, which requires eighty percent to advance', () => {
  const { service } = subject(); service.open({ userId: 'learner3' });
  service.completeDemo({ userId: 'learner3', lessonId: 'centres-and-pieces' });
  service.open({ userId: 'learner3', lessonId: 'read-notation' });
  service.completeDemo({ userId: 'learner3', lessonId: 'read-notation' });
  let opened = service.open({ userId: 'learner3', lessonId: 'turn-practice' });
  for (const move of scramble(101, 3).reverse().map(inverseMove)) {
    opened = service.turn({ userId: 'learner3', lessonId: 'turn-practice', move, expectedRevision: opened.active.revision });
  }
  assert.equal(opened.course.units[0].lessons[3].unlocked, true);
  service.open({ userId: 'learner3', lessonId: 'know-the-cube-quiz' });
  const failed = service.answer({ userId: 'learner3', lessonId: 'know-the-cube-quiz', answers: [1, 1, 1, 1, 1] });
  assert.equal(failed.quiz.passed, false);
  service.open({ userId: 'learner3', lessonId: 'know-the-cube-quiz' });
  const passed = service.answer({ userId: 'learner3', lessonId: 'know-the-cube-quiz', answers: [0, 2, 2, 1, 3] });
  assert.equal(passed.quiz.passed, true);
});

test('restart replaces a partially-played cube with the authored start state', () => {
  const { service } = subject(); service.open({ userId: 'learner3' });
  service.completeDemo({ userId: 'learner3', lessonId: 'centres-and-pieces' });
  service.open({ userId: 'learner3', lessonId: 'read-notation' });
  service.completeDemo({ userId: 'learner3', lessonId: 'read-notation' });
  const opened = service.open({ userId: 'learner3', lessonId: 'turn-practice' });
  const moved = service.turn({ userId: 'learner3', lessonId: 'turn-practice', move: 'R', expectedRevision: opened.active.revision });
  const restarted = service.restart({ userId: 'learner3', lessonId: 'turn-practice' });
  assert.equal(moved.active.revision, 1);
  assert.equal(restarted.active.revision, 0);
  assert.deepEqual(restarted.active.moves, []);
});

test('a valid physical cube can be reset and prepared for the current worksheet', async () => {
  const { service } = subject(); const opened = service.open({ userId: 'learner3' });
  const imported = service.importPhysicalCube({ userId: 'learner3', faces: solvedFaces() });
  assert.equal(imported.ok, true);
  const coach = await service.beginPhysicalCoach({ userId: 'learner3', lessonId: opened.lesson.id });
  assert.equal(coach.coach.phase, 'setup');
  const advanced = service.advancePhysicalCoach({ userId: 'learner3' });
  assert.equal(advanced.coach.phase, 'complete');
  const verified = service.verifyPhysicalCube({ userId: 'learner3', lessonId: opened.lesson.id, faces: solvedFaces() });
  assert.equal(verified.ok, true);
});

test('a physical cube becomes a frozen, verifiable paper packet', async () => {
  const { service } = subject(); const opened = service.open({ userId: 'learner3' });
  assert.equal(service.importPhysicalCube({ userId: 'learner3', faces: solvedFaces() }).ok, true);
  const packet = await service.generatePacket({ userId: 'learner3', lessonId: opened.lesson.id });
  assert.equal(packet.packet.goal, 'orientation');
  assert.equal(packet.packet.steps.length, 2);
  const checked = service.verifyPacket({ userId: 'learner3', packetId: packet.packet.id, faces: solvedFaces() });
  assert.equal(checked.ok, true);
  assert.equal(checked.packet.status, 'verified');
});
