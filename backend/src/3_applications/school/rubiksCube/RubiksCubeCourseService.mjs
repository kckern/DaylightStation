import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { applyMove, applySequence, createCube, cubeFaces, isSolved, scramble } from '#shared/gaming/rulesets/rubiks-cube/index.mjs';
import { RUBIKS_CUBE_COURSE, RUBIKS_CUBE_COURSE_ID, RUBIKS_CUBE_REVISION, activities, activityById, publicActivity } from './courseCatalog.mjs';

const load = (file, fallback) => fs.existsSync(file) ? yaml.load(fs.readFileSync(file, 'utf8')) : fallback;
const save = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, yaml.dump(value, { noRefs: true })); };
const day = (now) => now.toISOString().slice(0, 10);

/** Server authority for the learner's actual cube, progress, hints, and quiz score. */
export class RubiksCubeCourseService {
  #config; #clock;
  constructor({ configService, clock = () => new Date() } = {}) { this.#config = configService; this.#clock = clock; }
  #file(userId) {
    if (!this.#config.getUserProfile?.(userId)) return null;
    return path.join(this.#config.getUserDir(userId), 'apps', 'school', 'rubiks-cube', RUBIKS_CUBE_COURSE_ID, 'progress.yml');
  }
  #fresh(userId) {
    return { schema: 'school.rubiks-cube-progress/v1', learnerId: userId, courseId: RUBIKS_CUBE_COURSE_ID, revision: RUBIKS_CUBE_REVISION,
      completed: {}, attempts: {}, challengeResults: {}, active: null, updatedAt: this.#clock().toISOString() };
  }
  #read(userId) {
    const file = this.#file(userId); if (!file) throw new Error('identified learner is required');
    const record = load(file, this.#fresh(userId));
    // Course content is version-pinned. A revision is a new course contract,
    // never a silent reinterpretation of a learner's saved sticker state.
    if (record?.schema !== 'school.rubiks-cube-progress/v1' || record.revision !== RUBIKS_CUBE_REVISION) return this.#fresh(userId);
    record.completed ||= {}; record.attempts ||= {}; record.challengeResults ||= {};
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
      progress: { completed: Object.keys(record.completed).length, total: all.length, score: Math.round(Object.keys(record.completed).length / all.length * 100), personalBestSeconds: bestSeconds('personal-best-replay') } };
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
    if (isSolved(cube)) this.#complete(record, lesson, { assisted: active.hints > 0, durationMs: this.#clock().getTime() - new Date(active.startedAt).getTime() });
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
}
export default RubiksCubeCourseService;
