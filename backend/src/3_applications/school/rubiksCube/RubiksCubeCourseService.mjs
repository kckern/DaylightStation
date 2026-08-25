import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { applyMove, applySequence, createCube, cubeFaces, goalReached, inverseMove, isSolved, scramble } from '#shared/gaming/rulesets/rubiks-cube/index.mjs';
import { RUBIKS_CUBE_COURSE, RUBIKS_CUBE_COURSE_ID, RUBIKS_CUBE_REVISION, activities, activityById, publicActivity } from './courseCatalog.mjs';
import { parsePhysicalCube } from './physicalCube.mjs';

const load = (file, fallback) => fs.existsSync(file) ? yaml.load(fs.readFileSync(file, 'utf8')) : fallback;
const save = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, yaml.dump(value, { noRefs: true })); };
const day = (now) => now.toISOString().slice(0, 10);

/** Server authority for the learner's actual cube, progress, hints, and quiz score. */
export class RubiksCubeCourseService {
  #config; #clock; #packetPlanner;
  constructor({ configService, recoverySolver = null, packetPlanner = null, clock = () => new Date() } = {}) { this.#config = configService; this.recoverySolver = recoverySolver; this.#packetPlanner = packetPlanner; this.#clock = clock; }
  #file(userId) {
    // No course.yml authored yet (RUBIKS_CUBE_COURSE_ID is null): fail with a
    // clear message rather than `path.join(..., null, ...)`'s TypeError. The
    // service is still constructed and mounted so the rest of school boots;
    // this only surfaces when someone actually reaches this program.
    if (!RUBIKS_CUBE_COURSE_ID) throw new Error('The Rubik’s Cube course is not installed.');
    if (!this.#config.getUserProfile?.(userId)) return null;
    return path.join(this.#config.getUserDir(userId), 'apps', 'school', 'rubiks-cube', RUBIKS_CUBE_COURSE_ID, 'progress.yml');
  }
  #fresh(userId) {
    return { schema: 'school.rubiks-cube-progress/v1', learnerId: userId, courseId: RUBIKS_CUBE_COURSE_ID, revision: RUBIKS_CUBE_REVISION,
      completed: {}, attempts: {}, challengeResults: {}, active: null,
      physical: { draft: null, coach: null, verified: {} }, packets: {}, activePacketId: null, updatedAt: this.#clock().toISOString() };
  }
  #read(userId) {
    const file = this.#file(userId); if (!file) throw new Error('identified learner is required');
    const record = load(file, this.#fresh(userId));
    // Course content is version-pinned. A revision is a new course contract,
    // never a silent reinterpretation of a learner's saved sticker state.
    if (record?.schema !== 'school.rubiks-cube-progress/v1' || record.revision !== RUBIKS_CUBE_REVISION) return this.#fresh(userId);
    record.completed ||= {}; record.attempts ||= {}; record.challengeResults ||= {}; record.physical ||= { draft: null, coach: null, verified: {} }; record.physical.verified ||= {}; record.packets ||= {};
    return record;
  }
  #write(userId, record) { const file = this.#file(userId); if (!file) throw new Error('identified learner is required'); record.updatedAt = this.#clock().toISOString(); save(file, record); return record; }
  #unlocked(record, lessonId) {
    const index = activities().findIndex((lesson) => lesson.id === lessonId);
    return index >= 0 && (index === 0 || Boolean(record.completed[activities()[index - 1].id]));
  }
  #start(record, lesson) {
    if (['demo', 'quiz'].includes(lesson.kind)) return { lessonId: lesson.id, revision: 0, cube: createCube(), moves: [], hints: 0, startedAt: this.#clock().toISOString() };
    const sequence = scramble(lesson.seed, lesson.scrambleLength ?? 3);
    return { lessonId: lesson.id, revision: 0, cube: applySequence(createCube(), sequence), moves: [], hints: 0, startedAt: this.#clock().toISOString() };
  }
  #projection(record, lesson = null) {
    const all = activities(); const active = record.active; const current = lesson || activityById(active?.lessonId) || all.find((item) => this.#unlocked(record, item.id) && !record.completed[item.id]) || all.at(-1);
    const bestSeconds = (lessonId) => {
      const runs = record.challengeResults[lessonId] || [];
      return runs.length ? Math.round(Math.min(...runs.map((run) => run.durationMs)) / 1000) : null;
    };
    return { course: { id: RUBIKS_CUBE_COURSE_ID, revision: RUBIKS_CUBE_REVISION, title: RUBIKS_CUBE_COURSE.title,
      units: RUBIKS_CUBE_COURSE.units.map((unit) => ({ id: unit.id, title: unit.title, lessons: unit.lessons.map((item) => ({ id: item.id, title: item.title, kind: item.kind, completed: Boolean(record.completed[item.id]), unlocked: this.#unlocked(record, item.id), bestSeconds: item.kind === 'challenge' ? bestSeconds(item.id) : null })) })) },
      lesson: publicActivity(current), active: active ? { ...active, cube: cubeFaces(active.cube) } : null,
      progress: { completed: Object.keys(record.completed).length, total: all.length, score: Math.round(Object.keys(record.completed).length / all.length * 100), personalBestSeconds: bestSeconds('personal-best-replay') },
      physical: this.#physicalProjection(record), packet: this.#packetProjection(record) };
  }
  open({ userId, lessonId = null }) {
    const record = this.#read(userId);
    const lesson = lessonId
      ? activityById(lessonId)
      : activityById(record.active?.lessonId) || activities().find((item) => this.#unlocked(record, item.id) && !record.completed[item.id]) || activities().at(-1);
    if (!lesson || !this.#unlocked(record, lesson.id)) throw new Error('lesson is locked');
    if (record.active?.lessonId !== lesson.id) record.active = this.#start(record, lesson);
    this.#write(userId, record); return this.#projection(record, lesson);
  }
  restart({ userId, lessonId }) {
    const record = this.#read(userId); const lesson = activityById(lessonId);
    if (!lesson || !this.#unlocked(record, lesson.id)) throw new Error('lesson is locked');
    record.active = this.#start(record, lesson); this.#write(userId, record); return this.#projection(record, lesson);
  }
  preview() { return { course: { id: RUBIKS_CUBE_COURSE_ID, revision: RUBIKS_CUBE_REVISION, title: RUBIKS_CUBE_COURSE.title }, lesson: publicActivity(activities()[0]), active: { cube: cubeFaces(createCube()), revision: 0, moves: [], hints: 0 }, preview: true }; }
  turn({ userId, lessonId, move, expectedRevision }) {
    const record = this.#read(userId); const lesson = activityById(lessonId); const active = record.active;
    if (!lesson || !active || active.lessonId !== lesson.id || active.revision !== expectedRevision) throw new Error('stale or missing lesson attempt');
    if (['demo', 'quiz'].includes(lesson.kind)) throw new Error('cube turns are not part of this activity');
    const cube = applyMove(active.cube, move); if (!cube) throw new Error('invalid cube move');
    active.cube = cube; active.moves.push(move); active.revision += 1;
    if (goalReached(cube, lesson.goal)) this.#complete(record, lesson, { assisted: active.hints > 0, durationMs: this.#clock().getTime() - new Date(active.startedAt).getTime() });
    this.#write(userId, record); return this.#projection(record, lesson);
  }
  completeDemo({ userId, lessonId }) {
    const record = this.#read(userId); const lesson = activityById(lessonId);
    if (!lesson || lesson.kind !== 'demo' || !this.#unlocked(record, lessonId) || record.active?.lessonId !== lessonId) throw new Error('demo is unavailable');
    this.#complete(record, lesson, { assisted: false }); this.#write(userId, record); return this.#projection(record, lesson);
  }
  hint({ userId, lessonId }) {
    const record = this.#read(userId); const lesson = activityById(lessonId); const active = record.active;
    if (!lesson || !active || active.lessonId !== lessonId) throw new Error('open this lesson first');
    active.hints = Math.min(3, active.hints + 1); const solution = lesson.solution || [];
    const hint = active.hints === 1 ? { level: 1, text: lesson.prompt }
      : active.hints === 2 ? { level: 2, text: `Try starting with ${solution[0] || 'a careful face turn'}.` }
        : { level: 3, text: `Reset if needed, then try: ${solution.join(' ') || 'watch the demonstration again'}.` };
    this.#write(userId, record); return { ...this.#projection(record, lesson), hint };
  }
  answer({ userId, lessonId, answers }) {
    const record = this.#read(userId); const lesson = activityById(lessonId);
    if (!lesson || lesson.kind !== 'quiz' || !this.#unlocked(record, lessonId) || record.active?.lessonId !== lessonId) throw new Error('quiz is unavailable');
    const response = Array.isArray(answers) ? answers : [];
    const correct = lesson.questions.filter((question, index) => Number(response[index]) === question.answer).length;
    const percent = Math.round(correct / lesson.questions.length * 100);
    record.attempts[lessonId] = [...(record.attempts[lessonId] || []), { id: crypto.randomUUID(), correct, total: lesson.questions.length, percent, at: this.#clock().toISOString() }];
    if (percent >= 80) this.#complete(record, lesson, { assisted: false });
    this.#write(userId, record); return { ...this.#projection(record, lesson), quiz: { correct, total: lesson.questions.length, percent, passed: percent >= 80 } };
  }
  #complete(record, lesson, { assisted, durationMs = null }) {
    const existing = record.completed[lesson.id];
    if (!existing) record.completed[lesson.id] = { at: this.#clock().toISOString(), assisted };
    // A later independent solve earns an independent completion without taking
    // away the fact that the learner first used help.
    else if (existing.assisted && !assisted) record.completed[lesson.id] = { ...existing, assisted: false };
    if (lesson.kind === 'challenge' && Number.isFinite(durationMs) && durationMs >= 0) {
      record.challengeResults[lesson.id] ||= [];
      record.challengeResults[lesson.id].push({ at: this.#clock().toISOString(), durationMs, assisted });
    }
    record.active = null;
  }
  status({ userId }) {
    const record = this.#read(userId); const all = activities(); const count = Object.keys(record.completed).length;
    const latest = Object.values(record.completed).at(-1);
    return { doneToday: Boolean(latest?.at && day(new Date(latest.at)) === day(this.#clock())), progressLabel: `${count} of ${all.length} activities complete`, score: Math.round(count / all.length * 100) };
  }
  #physicalProjection(record) {
    const coach = record.physical?.coach;
    if (!coach) return { entered: Boolean(record.physical?.draft), coach: null, verified: record.physical?.verified || {} };
    const moves = coach.phase === 'solve' ? coach.solveMoves : coach.setupMoves;
    return { entered: Boolean(record.physical?.draft), verified: record.physical?.verified || {}, coach: {
      lessonId: coach.lessonId, phase: coach.phase, completed: coach.completed, total: moves.length,
      nextMoves: moves.slice(coach.completed, coach.completed + 4), target: coach.phase === 'complete' ? cubeFaces(coach.targetCube) : null,
    } };
  }
  importPhysicalCube({ userId, faces }) {
    const record = this.#read(userId); const parsed = parsePhysicalCube(faces);
    if (!parsed.ok) return { ok: false, errors: parsed.errors, physical: this.#physicalProjection(record) };
    record.physical.draft = { facelets: parsed.facelets, cube: parsed.cube, centers: parsed.centers, enteredAt: this.#clock().toISOString() };
    record.physical.coach = null; this.#write(userId, record);
    return { ok: true, physical: this.#physicalProjection(record), cube: cubeFaces(parsed.cube) };
  }
  async beginPhysicalCoach({ userId, lessonId }) {
    const record = this.#read(userId); const lesson = activityById(lessonId);
    if (!lesson || !this.#unlocked(record, lessonId)) throw new Error('lesson is locked');
    if (!record.physical.draft || !this.recoverySolver) throw new Error('Enter your physical cube before starting the reset coach.');
    const solveMoves = await this.recoverySolver.solve(record.physical.draft.facelets);
    const setupMoves = [...(lesson.solution || [])].reverse().map(inverseMove);
    const targetCube = applySequence(createCube(), setupMoves);
    record.physical.coach = { lessonId, solveMoves, setupMoves, phase: solveMoves.length ? 'solve' : 'setup', completed: 0, twin: record.physical.draft.cube, targetCube };
    this.#write(userId, record); return this.#physicalProjection(record);
  }
  advancePhysicalCoach({ userId }) {
    const record = this.#read(userId); const coach = record.physical?.coach;
    if (!coach || coach.phase === 'complete') throw new Error('Start the reset coach first.');
    const moves = coach.phase === 'solve' ? coach.solveMoves : coach.setupMoves;
    const chunk = moves.slice(coach.completed, coach.completed + 4);
    coach.twin = applySequence(coach.twin, chunk); coach.completed += chunk.length;
    if (coach.completed >= moves.length) {
      if (coach.phase === 'solve') { coach.phase = 'setup'; coach.completed = 0; }
      else coach.phase = 'complete';
    }
    this.#write(userId, record); return this.#physicalProjection(record);
  }
  verifyPhysicalCube({ userId, lessonId, faces }) {
    const record = this.#read(userId); const lesson = activityById(lessonId); const parsed = parsePhysicalCube(faces);
    if (!lesson || !parsed.ok) return { ok: false, errors: parsed.errors || [ { code: 'LESSON', message: 'Open a lesson before verifying your cube.' } ] };
    if (!goalReached(parsed.cube, lesson.goal)) return { ok: false, errors: [{ code: 'GOAL_NOT_REACHED', message: 'Your cube is valid, but it does not yet match this lesson’s goal.' }], cube: cubeFaces(parsed.cube) };
    record.physical.draft = { facelets: parsed.facelets, cube: parsed.cube, centers: parsed.centers, enteredAt: this.#clock().toISOString() };
    record.physical.verified[lessonId] = { at: this.#clock().toISOString(), goal: lesson.goal };
    this.#write(userId, record); return { ok: true, physical: this.#physicalProjection(record), cube: cubeFaces(parsed.cube) };
  }
  #packetProjection(record, packet = record.packets?.[record.activePacketId]) {
    if (!packet) return null;
    return { id: packet.id, unitId: packet.unitId, lessonId: packet.lessonId, goal: packet.goal, generatedAt: packet.generatedAt,
      status: packet.status || 'issued', steps: packet.steps.map(({ moves, before, after, ...step }) => ({ ...step, moves, before, after })), supersededBy: packet.supersededBy || null };
  }
  async generatePacket({ userId, lessonId }) {
    const record = this.#read(userId); const lesson = activityById(lessonId);
    if (!lesson || !this.#unlocked(record, lessonId)) throw new Error('Open an unlocked lesson before making a paper packet.');
    if (!record.physical?.draft) throw new Error('Enter your physical cube before making a paper packet.');
    if (!this.#packetPlanner) throw new Error('The paper packet service is unavailable.');
    const activity = activities().find((item) => item.id === lessonId);
    const packet = await this.#packetPlanner.plan({ unitId: activity.unitId, lessonId, goal: lesson.goal || 'orientation', facelets: record.physical.draft.facelets, cube: record.physical.draft.cube });
    packet.status = 'issued'; packet.courseId = RUBIKS_CUBE_COURSE_ID; packet.courseRevision = RUBIKS_CUBE_REVISION; packet.learnerId = userId;
    const previous = record.packets[record.activePacketId]; if (previous && previous.status === 'issued') previous.status = 'superseded', previous.supersededBy = packet.id;
    record.packets[packet.id] = packet; record.activePacketId = packet.id; this.#write(userId, record);
    return { ...this.#projection(record, lesson), packet: this.#packetProjection(record, packet) };
  }
  packet({ userId, packetId = null }) {
    const record = this.#read(userId); const packet = record.packets?.[packetId || record.activePacketId];
    if (!packet) throw new Error('No paper packet is available yet.');
    return this.#packetProjection(record, packet);
  }
  verifyPacket({ userId, packetId, faces }) {
    const record = this.#read(userId); const packet = record.packets?.[packetId]; const parsed = parsePhysicalCube(faces);
    if (!packet) throw new Error('That paper packet is not available.');
    if (!parsed.ok) return { ok: false, errors: parsed.errors, packet: this.#packetProjection(record, packet) };
    const complete = packet.goal === 'orientation' || goalReached(parsed.cube, packet.goal);
    if (!complete) return { ok: false, errors: [{ code: 'GOAL_NOT_REACHED', message: 'Your cube is valid, but it has not reached this packet’s goal yet.' }], packet: this.#packetProjection(record, packet) };
    packet.status = 'verified'; packet.verifiedAt = this.#clock().toISOString();
    record.physical.draft = { facelets: parsed.facelets, cube: parsed.cube, centers: parsed.centers, enteredAt: this.#clock().toISOString() };
    record.physical.verified[packet.lessonId] = { at: packet.verifiedAt, goal: packet.goal, packetId: packet.id };
    this.#write(userId, record); return { ok: true, packet: this.#packetProjection(record, packet), physical: this.#physicalProjection(record) };
  }
}
export default RubiksCubeCourseService;
