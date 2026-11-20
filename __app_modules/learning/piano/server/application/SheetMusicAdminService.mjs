/**
 * The admin side of the sheet music library: one row per score, and the Learn
 * file workflow (draft → approve → revert) with what approval does to each
 * learner's progress.
 *
 * Child progress is keyed by bar range, so approving segments orphans progress on
 * ranges that changed (reversibly: restoring a range restores its progress).
 * `approve` reports that impact, computed before the write against the new
 * segments. `revert` reports none: the kiosk falls back to its GENERATED segments,
 * which only the kiosk can compute, so impact against `[]` would read as
 * "everything orphaned" and mislead. A UI that wants revert impact computes it
 * from the generated plan and calls `impact(id, segments)`.
 *
 * Approval is pinned to the draft the parent reviewed: `getLearn`, `saveDraft` and
 * `draftImpact` return a `draftRevision`, and `approve` requires it back as
 * `expectedDraftRevision`, refusing with `draft-changed` if the stored draft moved.
 * Between reading the Learn file and writing it, `approve` does not await, so the
 * datastore's Learn and practice reads must be synchronous (the YAML datastore is).
 *
 * Errors carrying `code` are the router's contract: `invalid-request`,
 * `invalid-segments` (with `errors`: validateSegments codes plus `empty`),
 * `no-draft`, `draft-changed`, and the score reader's codes (NOT_LIBRARY_SCORE,
 * SCORE_NOT_FOUND, SCORE_UNREADABLE, SCORE_TOO_LARGE).
 *
 * Layer: APPLICATION. Everything external is injected.
 */
import { approvalImpact, normalizeLearnFile, validateSegments } from '../../portable/music/sheetMusicLearnFile.mjs';
import { libraryScoreLocalPath, practiceKeyOfScore } from '../../portable/music/practiceKey.mjs';
import { contentHash } from '../../portable/practice/lessonExpectation.mjs';

const READ_CONCURRENCY = 4;
const LEARN_SAVED = 'piano.sheetmusic.learn-saved';

const isObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

function codedError(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      try { return String.fromCodePoint(code); } catch { return whole; }
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

function tagText(xml, re) {
  const match = re.exec(xml);
  if (!match) return null;
  // CDATA content is literal: pull it out before tags are stripped and entities decoded.
  const parts = match[1].split(/(<!\[CDATA\[[\s\S]*?\]\]>)/);
  const text = parts.map((part) => (part.startsWith('<![CDATA[')
    ? part.slice(9, -3)
    : decodeXml(part.replace(/<[^>]*>/g, '')))).join('').replace(/\s+/g, ' ').trim();
  return text || null;
}

/** Title and composer from the MusicXML header; null where absent. */
export function scoreHeader(xml) {
  const text = String(xml || '');
  return {
    title: tagText(text, /<work-title\b[^>]*>([\s\S]*?)<\/work-title>/i)
      ?? tagText(text, /<movement-title\b[^>]*>([\s\S]*?)<\/movement-title>/i),
    composer: tagText(text, /<creator\b[^>]*\btype\s*=\s*["']composer["'][^>]*>([\s\S]*?)<\/creator>/i),
  };
}

/** "the_old-mill.musicxml" → "The Old Mill". */
export function titleFromFile(file) {
  return String(file || '')
    .replace(/\.[^.]+$/, '')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

function posterKind(coverUrl) {
  if (!coverUrl) return 'none';
  const path = decodeURIComponent(String(coverUrl).split('?')[0]);
  return /\.svg$/i.test(path) ? 'generated' : 'scan';
}

/** The learn state of a stored file; `currentSha256` undefined means unknown. */
function learnState(file, currentSha256) {
  const hasApproved = file.segments.length > 0;
  const hasDraft = file.draft != null;
  if (hasApproved && currentSha256 !== undefined && file.contentSha256 !== currentSha256) return 'stale';
  if (hasApproved && hasDraft) return 'approved+draft';
  if (hasApproved) return 'approved';
  if (hasDraft) return 'draft';
  return 'none';
}

/** A stable tag for a draft's segments; approve compares it to pin the reviewed draft. */
export function draftRevision(segments) {
  return contentHash(JSON.stringify(Array.isArray(segments) ? segments : []));
}

const EMPTY_ERRORS = [{ code: 'empty', id: null, index: -1 }];

/** validateSegments plus the service rule that a draft has at least one segment. */
function segmentErrors(segments, measureCount) {
  if (Array.isArray(segments) && segments.length === 0) return EMPTY_ERRORS;
  return validateSegments(segments, measureCount);
}

function requireLibrary(id) {
  if (!libraryScoreLocalPath(id)) throw codedError('NOT_LIBRARY_SCORE', `Not a sheet music library score: ${id}`);
}

const isThenable = (v) => v != null && typeof v.then === 'function';

const hasProgress = (passage) => Boolean(passage?.silver || passage?.gold);

export class SheetMusicAdminService {
  #datastore;
  #scoreReader;
  #listScores;
  #listLearners;
  #fileSignature;
  #clock;
  #logger;
  /** id → { signature, title, composer, contentSha256 } */
  #headerCache = new Map();

  constructor({ datastore, scoreReader, listScores, listLearners, fileSignature, clock = () => new Date(), logger } = {}) {
    if (!datastore) throw new Error('SheetMusicAdminService requires datastore');
    if (!scoreReader) throw new Error('SheetMusicAdminService requires scoreReader');
    if (typeof listScores !== 'function') throw new Error('SheetMusicAdminService requires listScores');
    if (typeof listLearners !== 'function') throw new Error('SheetMusicAdminService requires listLearners');
    this.#datastore = datastore;
    this.#scoreReader = scoreReader;
    this.#listScores = listScores;
    this.#listLearners = listLearners;
    this.#fileSignature = typeof fileSignature === 'function' ? fileSignature : () => null;
    this.#clock = clock;
    this.#logger = logger;
  }

  async library() {
    const scores = await this.#listScores();
    const learners = await this.#learners();
    const rows = new Array(scores.length);
    let next = 0;
    const worker = async () => {
      while (next < scores.length) {
        const index = next++;
        rows[index] = await this.#libraryRow(scores[index], learners);
      }
    };
    await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, scores.length) }, worker));
    this.#logger?.debug?.('piano.sheetmusic.library', { scores: rows.length, errors: rows.filter((r) => r.error).length });
    return rows;
  }

  async getLearn(id) {
    requireLibrary(id);
    const file = normalizeLearnFile(this.#storedFile(id));
    const { contentSha256 } = await this.#scoreInfo(id);
    return {
      ...file,
      scoreId: file.scoreId ?? id,
      currentSha256: contentSha256,
      stale: file.segments.length > 0 && file.contentSha256 !== contentSha256,
      draftRevision: file.draft ? draftRevision(file.draft.segments) : null,
    };
  }

  async saveDraft(id, { segments, proposal, measureCount } = {}) {
    requireLibrary(id);
    const errors = segmentErrors(segments, measureCount);
    if (errors.length) throw codedError('invalid-segments', `Invalid segments for ${id}`, { errors });
    // The score must exist, or the draft would be an orphan Learn file.
    await this.#scoreInfo(id);
    const stored = this.#storedFile(id);
    const { draft } = normalizeLearnFile({ draft: { segments, ...(isObject(proposal) ? { proposal } : {}) } });
    const next = { ...stored, version: 1, scoreId: stored.scoreId ?? id, draft };
    await this.#datastore.saveSheetMusicLearn(id, next);
    const revision = draftRevision(draft.segments);
    this.#logger?.info?.(LEARN_SAVED, { id, status: 'draft', segments: draft.segments.length, draftRevision: revision });
    return { ...normalizeLearnFile(next), draftRevision: revision };
  }

  async impact(id, segments) {
    requireLibrary(id);
    return this.#impactSync(id, segments, await this.#learners());
  }

  /** The impact of approving the stored draft, with the revision approve must be given. */
  async draftImpact(id) {
    requireLibrary(id);
    const learners = await this.#learners();
    const { draft } = normalizeLearnFile(this.#storedFile(id));
    if (!draft) throw codedError('no-draft', `No draft for ${id}`);
    return { draftRevision: draftRevision(draft.segments), impact: this.#impactSync(id, draft.segments, learners) };
  }

  async approve(id, { measureCount, expectedDraftRevision } = {}) {
    requireLibrary(id);
    if (typeof expectedDraftRevision !== 'string' || !expectedDraftRevision) {
      throw codedError('invalid-request', 'approve requires expectedDraftRevision');
    }
    // The sha comes from a fresh read, never the cache: approval pins the bytes.
    const { contentSha256 } = await this.#scoreReader.read(id);
    const learners = await this.#learners();
    // No await from here to the write, so a concurrent saveDraft cannot land in
    // between and get approved unseen.
    const stored = this.#storedFile(id);
    const { draft } = normalizeLearnFile(stored);
    if (!draft) throw codedError('no-draft', `No draft to approve for ${id}`);
    const revision = draftRevision(draft.segments);
    if (revision !== expectedDraftRevision) {
      throw codedError('draft-changed', `The draft for ${id} changed since it was reviewed`, { draftRevision: revision });
    }
    const errors = segmentErrors(draft.segments, measureCount);
    if (errors.length) throw codedError('invalid-segments', `Invalid draft segments for ${id}`, { errors });
    const impact = this.#impactSync(id, draft.segments, learners);
    const { draft: _dropped, ...rest } = stored;
    const next = {
      ...rest,
      version: 1,
      scoreId: stored.scoreId ?? id,
      contentSha256,
      segments: draft.segments,
      approved: { at: this.#clock().toISOString() },
    };
    const write = this.#datastore.saveSheetMusicLearn(id, next);
    if (isThenable(write)) await write;
    this.#logger?.info?.(LEARN_SAVED, {
      id,
      status: 'approved',
      segments: draft.segments.length,
      contentSha256: String(contentSha256).slice(0, 12),
      orphaned: impact.reduce((sum, row) => sum + row.orphaned.length, 0),
      learnersAffected: impact.filter((row) => row.orphaned.length > 0).length,
    });
    return { file: normalizeLearnFile(next), impact };
  }

  /**
   * Back to the kiosk's generated segments; the draft stays. Impact is null (see
   * header). With nothing approved there is nothing to write: `changed: false`.
   */
  async revert(id) {
    requireLibrary(id);
    const stored = this.#storedFile(id);
    const { segments: _s, contentSha256: _c, approved: _a, ...rest } = stored;
    if (!('segments' in stored) && !('contentSha256' in stored) && !('approved' in stored)) {
      return { file: normalizeLearnFile(stored), impact: null, changed: false };
    }
    const next = { ...rest, version: 1, scoreId: stored.scoreId ?? id };
    await this.#datastore.saveSheetMusicLearn(id, next);
    this.#logger?.info?.(LEARN_SAVED, { id, status: 'reverted', segments: 0 });
    return { file: normalizeLearnFile(next), impact: null, changed: true };
  }

  /** The stored Learn file, read synchronously (see header). */
  #storedFile(id) {
    const raw = this.#datastore.getSheetMusicLearn(id);
    if (isThenable(raw)) throw new Error('SheetMusicAdminService needs a synchronous getSheetMusicLearn');
    return isObject(raw) ? raw : {};
  }

  #impactSync(id, segments, learners) {
    const key = practiceKeyOfScore(id);
    const out = [];
    for (const userId of learners) {
      const record = this.#datastore.getPractice(userId, key);
      if (isThenable(record)) throw new Error('SheetMusicAdminService needs a synchronous getPractice');
      const coach = record?.learnCoach;
      if (coach?.scoreId !== id || !isObject(coach.summary)) continue;
      out.push({ userId, ...approvalImpact(coach.summary, segments) });
    }
    return out;
  }

  async #learners() {
    const list = await this.#listLearners();
    return Array.isArray(list) ? list.map(String) : [];
  }

  /** Header and sha of a score, cached while its file signature holds. */
  async #scoreInfo(id) {
    const signature = await this.#fileSignature(id);
    const cached = this.#headerCache.get(id);
    if (signature != null && cached?.signature === signature) return cached;
    const { xml, contentSha256 } = await this.#scoreReader.read(id);
    const info = { signature, ...scoreHeader(xml), contentSha256 };
    if (signature != null) this.#headerCache.set(id, info);
    else this.#headerCache.delete(id);
    return info;
  }

  /** Each part of a row fails on its own; the row keeps the first error code. */
  async #libraryRow({ id, folder, file }, learners) {
    const row = {
      id,
      folder,
      file,
      format: /\.mxl$/i.test(file || id) ? 'mxl' : 'musicxml',
      title: titleFromFile(file),
      composer: null,
    };
    const fail = (code, error) => {
      row.error ??= code;
      this.#logger?.warn?.('piano.sheetmusic.row-unreadable', { id, code, error: error?.message });
    };
    let currentSha256;
    try {
      const info = await this.#scoreInfo(id);
      row.title = info.title ?? row.title;
      row.composer = info.composer;
      currentSha256 = info.contentSha256;
    } catch (error) {
      fail(typeof error?.code === 'string' ? error.code : 'SCORE_UNREADABLE', error);
    }
    try {
      row.poster = posterKind(await this.#datastore.sheetMusicCover(id));
    } catch (error) {
      row.poster = 'none';
      fail('COVER_UNREADABLE', error);
    }
    try {
      row.learn = learnState(normalizeLearnFile(await this.#datastore.getSheetMusicLearn(id)), currentSha256);
    } catch (error) {
      row.learn = null;
      fail('LEARN_UNREADABLE', error);
    }
    row.learners = [];
    const key = practiceKeyOfScore(id);
    for (const userId of learners) {
      try {
        const coach = (await this.#datastore.getPractice(userId, key))?.learnCoach;
        if (coach?.scoreId !== id) continue;
        const passages = Array.isArray(coach.summary?.passages) ? coach.summary.passages : [];
        const passagesWithProgress = passages.filter(hasProgress).length;
        if (passagesWithProgress > 0) row.learners.push({ userId, passagesWithProgress });
      } catch (error) {
        fail('PRACTICE_UNREADABLE', error);
      }
    }
    return row;
  }
}
