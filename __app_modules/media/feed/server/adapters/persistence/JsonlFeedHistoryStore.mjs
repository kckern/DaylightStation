import path from 'node:path';
import { appendTextFile, deleteFile, readDirectory, readTextFromPath } from '#system/utils/FileIO.mjs';
import { effectiveFeedItemState } from '../../domain/feedItem.mjs';
import { isPlainMapping } from './isPlainMapping.mjs';

const RETENTION_MONTHS = 12;
const SAVED_PATH = 'feed/saved-items';
const BACKFILL_PATH = 'feed/history-status';

function monthKey(value) {
  const date = value ? new Date(value) : new Date();
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  return `${safe.getUTCFullYear()}-${String(safe.getUTCMonth() + 1).padStart(2, '0')}`;
}

export class JsonlFeedHistoryStore {
  #dataService;
  #logger;
  #docs = new Map();
  #loaded = new Set();
  #indexes = new Map();

  constructor({ dataService, logger = console }) {
    this.#dataService = dataService;
    this.#logger = logger;
  }

  record(username, items) {
    this.#load(username);
    const stagedByKey = new Map();
    for (const item of items) {
      const key = `${username}:${item.stateKey}`;
      const prior = stagedByKey.get(key) || this.#docs.get(key);
      const sourceLinks = [...(prior?.sourceLinks || []), ...(item.sourceLinks || []), {
        type: item.sourceInfo?.type || item.source,
        id: item.id,
      }].filter(link => link?.type && link?.id);
      const uniqueSourceLinks = [...new Map(sourceLinks.map(link => [`${link.type}:${link.id}`, link])).values()];
      const merged = prior ? {
        ...prior,
        ...item,
        origins: [...new Set([...(prior.origins || []), ...(item.origins || [])])],
        sourceRefs: [...new Set([...(prior.sourceRefs || []), item.id])],
        sourceLinks: uniqueSourceLinks,
      } : { ...item, sourceRefs: [item.id], sourceLinks: uniqueSourceLinks };
      stagedByKey.set(key, merged);
    }

    const fresh = [...stagedByKey.entries()]
      .filter(([key, doc]) => JSON.stringify(this.#docs.get(key)) !== JSON.stringify(doc))
      .map(([, doc]) => doc);
    const byMonth = new Map();
    for (const item of fresh) {
      const key = monthKey(item.publishedAt);
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key).push(item);
    }
    for (const [key, docs] of byMonth) {
      const dir = this.#dataService.user.resolveDir('feed/history', username);
      // Isolate any partial tail left by a previous failed append before adding
      // valid records, so the loader can discard the fragment independently.
      appendTextFile(path.join(dir, `${key}.jsonl`), `\n${docs.map(doc => JSON.stringify(doc)).join('\n')}\n`);
      for (const doc of docs) {
        this.#docs.set(`${username}:${doc.stateKey}`, doc);
        this.#indexDocument(username, doc);
      }
    }
    return fresh.length;
  }

  findById(username, id) {
    this.#load(username);
    for (const [key, doc] of this.#docs) {
      if (key.startsWith(`${username}:`) && (doc.id === id || doc.sourceRefs?.includes(id))) return doc;
    }
    return null;
  }

  setSaved(username, items, isSaved) {
    const saved = this.#readSaved(username);
    saved.version = 1;
    for (const item of items) {
      if (!this.#isHistoryDocument(item)) throw new Error('Invalid Feed saved item');
      this.#tokensFor(item);
      if (isSaved) saved.items[item.stateKey] = { ...item, savedAt: new Date().toISOString() };
      else delete saved.items[item.stateKey];
    }
    if (this.#dataService.user.writeAtomic(SAVED_PATH, saved, username) !== true) {
      throw new Error('Failed to persist Feed saved items');
    }
    for (const item of Object.values(saved.items)) {
      if (item?.stateKey) {
        this.#docs.set(`${username}:${item.stateKey}`, item);
        this.#indexDocument(username, item);
      }
    }
  }

  getBackfillStatus(username) {
    return this.#dataService.user.read(BACKFILL_PATH, username) || null;
  }

  setBackfillStatus(username, status) {
    this.#dataService.user.write(BACKFILL_PATH, status, username);
  }

  exportDocuments(username) {
    this.#load(username);
    const keys = this.#indexes.get(username)?.documents || [];
    return [...keys].map(stateKey => this.#docs.get(`${username}:${stateKey}`)).filter(Boolean);
  }

  summarize(username, states = new Map()) {
    this.#load(username);
    const summary = { unread: 0, readerUnread: 0, saved: 0, archived: 0 };
    for (const stateKey of this.#indexes.get(username)?.documents || []) {
      const doc = this.#docs.get(`${username}:${stateKey}`);
      const state = effectiveFeedItemState(doc, states.get(stateKey));
      if (!state.isRead && !state.isArchived) {
        summary.unread += 1;
        if (doc?.origins?.includes('reader')) summary.readerUnread += 1;
      }
      if (state.isSaved) summary.saved += 1;
      if (state.isArchived) summary.archived += 1;
    }
    return summary;
  }

  search(username, { query = '', state = null, mode = null, source = null, from = null, to = null, limit = 30, offset = 0, states = new Map() } = {}) {
    this.#load(username);
    const tokens = this.#tokens(query);
    const results = [];
    const index = this.#indexes.get(username);
    const candidateKeys = tokens.length ? new Set() : new Set(index?.documents || []);
    for (const token of tokens) {
      for (const [word, keys] of index?.all || []) {
        if (word === token || word.startsWith(token)) for (const key of keys) candidateKeys.add(key);
      }
    }
    for (const stateKey of candidateKeys) {
      const doc = this.#docs.get(`${username}:${stateKey}`);
      if (!doc) continue;
      const itemState = effectiveFeedItemState(doc, states.get(doc.stateKey));
      if (state === 'read' && !itemState.isRead) continue;
      if (state === 'unread' && itemState.isRead) continue;
      if (state === 'saved' && !itemState.isSaved) continue;
      if (state === 'archived' && !itemState.isArchived) continue;
      if (mode && !doc.origins?.includes(mode)) continue;
      const sourceQuery = String(source || '').toLowerCase();
      const sourceHaystack = `${doc.sourceInfo?.type || ''} ${doc.sourceInfo?.id || ''} ${doc.sourceInfo?.label || ''} ${doc.source || ''}`.toLowerCase();
      if (sourceQuery && !sourceHaystack.includes(sourceQuery)) continue;
      const publishedAt = new Date(doc.publishedAt || doc.published || 0).getTime();
      if (from && publishedAt < new Date(from).getTime()) continue;
      if (to && publishedAt > new Date(to).getTime()) continue;
      const fields = {
        title: this.#tokens(doc.title),
        source: this.#tokens(`${doc.sourceInfo?.label || doc.source || ''} ${doc.tags?.join(' ') || ''}`),
        summary: this.#tokens(doc.summary),
      };
      let score = 0;
      for (const token of tokens) {
        if (fields.title.some(word => word === token || word.startsWith(token))) score += 4;
        if (fields.source.some(word => word === token || word.startsWith(token))) score += 2;
        if (fields.summary.some(word => word === token || word.startsWith(token))) score += 1;
      }
      if (tokens.length && score === 0) continue;
      results.push({ doc, score });
    }
    results.sort((a, b) => b.score - a.score || new Date(b.doc.publishedAt || 0) - new Date(a.doc.publishedAt || 0));
    return {
      items: results.slice(offset, offset + limit).map(result => result.doc),
      total: results.length,
      nextOffset: offset + limit < results.length ? offset + limit : null,
    };
  }

  #tokens(value) {
    return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z0-9]{2,}/g) || [];
  }

  #indexDocument(username, doc) {
    if (!this.#indexes.has(username)) this.#indexes.set(username, { documents: new Set(), all: new Map(), tokensByDocument: new Map() });
    const index = this.#indexes.get(username);
    this.#addToIndex(index, doc, this.#tokensFor(doc));
  }

  #addToIndex(index, doc, tokens) {
    const priorTokens = index.tokensByDocument.get(doc.stateKey) || [];
    for (const token of priorTokens) {
      const keys = index.all.get(token);
      keys?.delete(doc.stateKey);
      if (keys?.size === 0) index.all.delete(token);
    }
    for (const token of tokens) {
      if (!index.all.has(token)) index.all.set(token, new Set());
      index.all.get(token).add(doc.stateKey);
    }
    index.documents.add(doc.stateKey);
    index.tokensByDocument.set(doc.stateKey, tokens);
  }

  #load(username) {
    if (this.#loaded.has(username)) return;
    const dir = this.#dataService.user.resolveDir('feed/history', username);
    const saved = this.#readSaved(username);
    const documents = new Map();
    const tokensByStateKey = new Map();
    for (const item of Object.values(saved.items || {})) {
      documents.set(item.stateKey, item);
      tokensByStateKey.set(item.stateKey, this.#tokensFor(item));
    }
    const expiredFiles = [];
    const cutoff = new Date();
    cutoff.setUTCMonth(cutoff.getUTCMonth() - RETENTION_MONTHS);
    let filenames;
    try { filenames = readDirectory(dir); }
    catch (error) {
      if (error.code === 'ENOENT') filenames = [];
      else throw error;
    }
    for (const filename of filenames.filter(name => /^\d{4}-\d{2}\.jsonl$/.test(name)).sort()) {
      if (filename.slice(0, 7) < monthKey(cutoff)) {
        expiredFiles.push(filename);
        continue;
      }
      const lines = readTextFromPath(path.join(dir, filename)).split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const doc = JSON.parse(line);
          if (!this.#isHistoryDocument(doc)) throw new Error('Invalid history document');
          const tokens = this.#tokensFor(doc);
          documents.set(doc.stateKey, doc);
          tokensByStateKey.set(doc.stateKey, tokens);
        } catch (error) {
          this.#logger.warn?.('feed.history.line.invalid', { username, filename, error: error.message });
        }
      }
    }
    const index = { documents: new Set(), all: new Map(), tokensByDocument: new Map() };
    for (const [stateKey, doc] of documents) {
      this.#addToIndex(index, doc, tokensByStateKey.get(stateKey));
    }
    for (const filename of expiredFiles) {
      try { deleteFile(path.join(dir, filename)); }
      catch (error) { this.#logger.warn?.('feed.history.prune_failed', { username, filename, error: error.message }); }
    }
    for (const key of this.#docs.keys()) {
      if (key.startsWith(`${username}:`)) this.#docs.delete(key);
    }
    for (const [stateKey, doc] of documents) {
      this.#docs.set(`${username}:${stateKey}`, doc);
    }
    this.#indexes.set(username, index);
    this.#loaded.add(username);
  }

  #readSaved(username) {
    const entry = this.#dataService.user.readStrictEntry(SAVED_PATH, username);
    if (!entry.found) return { version: 1, items: {} };
    if (!isPlainMapping(entry.value) || !isPlainMapping(entry.value.items)) {
      throw new Error(`Invalid Feed saved items for ${username}`);
    }
    for (const [stateKey, item] of Object.entries(entry.value.items)) {
      if (!this.#isHistoryDocument(item) || item.stateKey !== stateKey) {
        throw new Error(`Invalid Feed saved item for ${username}`);
      }
      try { this.#tokensFor(item); }
      catch { throw new Error(`Invalid Feed saved item for ${username}`); }
    }
    return entry.value;
  }

  #isHistoryDocument(doc) {
    return isPlainMapping(doc)
      && typeof doc.stateKey === 'string' && doc.stateKey.length > 0
      && (doc.sourceInfo == null || isPlainMapping(doc.sourceInfo))
      && (doc.tags == null || Array.isArray(doc.tags))
      && (doc.origins == null || Array.isArray(doc.origins))
      && (doc.sourceRefs == null || Array.isArray(doc.sourceRefs))
      && (doc.sourceLinks == null || Array.isArray(doc.sourceLinks));
  }

  #tokensFor(doc) {
    return [...new Set([
      ...this.#tokens(doc.title),
      ...this.#tokens(`${doc.sourceInfo?.label || doc.source || ''} ${doc.tags?.join(' ') || ''}`),
      ...this.#tokens(doc.summary),
    ])];
  }
}

export default JsonlFeedHistoryStore;
