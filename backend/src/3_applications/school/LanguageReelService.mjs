import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { EntityNotFoundError, ValidationError } from '#domains/core/errors/index.mjs';

const ID_RE = /^\d+$/;
const load = (file) => yaml.load(fs.readFileSync(file, 'utf8'));
const save = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, yaml.dump(value, { noRefs: true })); };

/**
 * Owns one reel's immutable session snapshot. The content loader intentionally
 * reads only approved reels; imported drafts stay safely author-visible only.
 */
export class LanguageReelService {
  #config; #clock;
  constructor({ configService, clock = () => new Date() } = {}) { this.#config = configService; this.#clock = clock; }
  #root() { return path.join(this.#config.getDataDir(), 'content', 'school', 'language', 'korean-language-reels'); }
  #reelFile(reelId) {
    if (!ID_RE.test(String(reelId))) return null;
    const root = path.join(this.#root(), 'reels');
    for (const category of fs.existsSync(root) ? fs.readdirSync(root) : []) {
      const candidate = path.join(root, category, `${reelId}.reel.yml`);
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  }
  #sessionFile(userId, reelId) {
    if (!this.#config.getUserProfile?.(userId) || !ID_RE.test(String(reelId))) return null;
    return path.join(this.#config.getUserDir(userId), 'apps', 'school', 'language-reels', `${reelId}.yml`);
  }
  #mediaFile(reel) {
    const parts = String(reel?.media?.assetId ?? '').replace(/^school:language\//, '').split('/');
    if (parts.length !== 3 || parts[0] !== 'korean-language-reels') return null;
    // asset form is course/category/id; reject anything that cannot be a file.
    const [course, category, id] = parts;
    if (course !== 'korean-language-reels' || !/^[a-z0-9-]+$/.test(category) || !ID_RE.test(id)) return null;
    return path.join(this.#config.getMediaDir(), 'school', 'language', course, category, `${id}.mp4`);
  }
  getReel(reelId, { approvedOnly = true } = {}) {
    const file = this.#reelFile(reelId); if (!file) throw new EntityNotFoundError('language reel', reelId);
    const reel = load(file);
    if (approvedOnly && reel?.reviewState !== 'approved') throw new EntityNotFoundError('language reel', reelId);
    if (approvedOnly) this.#validatePublished(reel, reelId);
    return { reel, revision: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16) };
  }
  #validatePublished(reel, reelId) {
    const cues = Array.isArray(reel?.transcript) ? reel.transcript : [];
    if (!reel?.title || !reel?.media?.assetId || !cues.length) throw new ValidationError(`language reel '${reelId}' is not publishable`);
    let previousEnd = -1;
    const ids = new Set();
    for (const cue of cues) {
      if (!cue?.id || ids.has(cue.id) || !Number.isFinite(cue.startMs) || !Number.isFinite(cue.endMs) || cue.startMs >= cue.endMs || cue.startMs < previousEnd) throw new ValidationError(`language reel '${reelId}' has an invalid transcript`);
      ids.add(cue.id); previousEnd = cue.endMs;
    }
    for (const cloze of reel.authoring?.cloze ?? reel.cloze ?? []) {
      const options = [cloze.answer, ...(cloze.decoys ?? [])];
      if (!ids.has(cloze.lineId) || !cloze.prompt || !cloze.answer || new Set(options).size !== 4 || options.length !== 4) throw new ValidationError(`language reel '${reelId}' has an invalid cloze item`);
    }
    for (const segment of reel.authoring?.speaking?.segments ?? []) {
      if ((!segment.lineId && !(Number.isFinite(segment.startMs) && Number.isFinite(segment.endMs))) || (segment.startMs != null && segment.startMs >= segment.endMs)) throw new ValidationError(`language reel '${reelId}' has an invalid speaking segment`);
    }
  }
  open({ userId, reelId }) {
    const { reel, revision } = this.getReel(reelId);
    const file = this.#sessionFile(userId, reelId); if (!file) throw new ValidationError('identified learner is required');
    const prior = fs.existsSync(file) ? load(file) : null;
    if (prior?.revision === revision && !prior.completedAt) return { ...prior, reel };
    const session = { schema: 'school.language-reel-session/v1', id: `lr_${crypto.randomUUID()}`,
      learnerId: userId, reelId: String(reelId), revision, openedAt: this.#clock().toISOString(), updatedAt: this.#clock().toISOString(),
      stages: { flashcards: !reel.vocabulary?.length, listen: false, cloze: false, watch: false, comprehension: false,
        speaking: !reel.authoring?.speaking?.enabled }, attempts: [], completedAt: null };
    save(file, session); return { ...session, reel };
  }
  status({ userId, reelId }) {
    const file = this.#sessionFile(userId, reelId); const session = file && fs.existsSync(file) ? load(file) : null;
    const terminal = Boolean(session?.completedAt);
    return { doneToday: terminal && session.completedAt.slice(0, 10) === this.#clock().toISOString().slice(0, 10), terminal,
      progressLabel: terminal ? 'Reel complete' : session ? 'Reel in progress' : 'Not started', score: session?.score ?? null };
  }
  markStage({ userId, reelId, stage }) {
    const file = this.#sessionFile(userId, reelId); if (!file || !fs.existsSync(file)) throw new ValidationError('open the reel first');
    const session = load(file); if (!(stage in session.stages)) throw new ValidationError('unknown reel stage');
    session.stages[stage] = true; session.updatedAt = this.#clock().toISOString();
    if (Object.values(session.stages).every(Boolean) && !session.completedAt) session.completedAt = session.updatedAt;
    save(file, session); return session;
  }
  recordAttempt({ userId, reelId, type, itemId, answer, correct }) {
    const file = this.#sessionFile(userId, reelId); if (!file || !fs.existsSync(file)) throw new ValidationError('open the reel first');
    if (!['cloze', 'comprehension'].includes(type) || !itemId || typeof correct !== 'boolean') throw new ValidationError('invalid reel attempt');
    const session = load(file);
    session.attempts = [...(session.attempts ?? []), { type, itemId: String(itemId), answer: answer ?? null, correct, at: this.#clock().toISOString() }];
    session.updatedAt = this.#clock().toISOString(); save(file, session); return session;
  }
  mediaPath(reelId) { const { reel } = this.getReel(reelId); const file = this.#mediaFile(reel); return file && fs.existsSync(file) ? file : null; }
}
export default LanguageReelService;
