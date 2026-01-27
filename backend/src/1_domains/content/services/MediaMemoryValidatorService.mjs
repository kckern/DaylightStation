// backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs

/**
 * Configuration matching legacy behavior
 * Legacy: MIN_CONFIDENCE = 90, RECENT_DAYS = 30, SAMPLE_PERCENT = 10
 */
const MIN_CONFIDENCE = 90; // 90% confidence required (legacy uses 90)
const RECENT_DAYS = 30;
const SAMPLE_PERCENT = 10;

/**
 * Service for validating and backfilling orphan Plex IDs in media memory
 * Migrated from: backend/_legacy/lib/mediaMemoryValidator.mjs
 *
 * IMPORTANT: This service NEVER deletes orphan entries.
 * If no match is found, the entry is logged as "unresolved" but preserved.
 */
export class MediaMemoryValidatorService {
  #plexClient;
  #watchStateStore;

  constructor({ plexClient, watchStateStore }) {
    this.#plexClient = plexClient;
    this.#watchStateStore = watchStateStore;
  }

  /**
   * Main validation function - find and backfill orphan IDs
   * Migrated from: mediaMemoryValidator.mjs:165-278
   *
   * Safety features (matching legacy):
   * - Aborts if Plex server unreachable
   * - Only updates when high-confidence match found (>=90%)
   * - Preserves old IDs in oldPlexIds array
   * - NEVER deletes orphan entries - only logs unresolved
   *
   * @param {Object} options
   * @param {boolean} [options.dryRun=false] - If true, don't actually update entries
   * @param {number} options.nowMs - Current timestamp in milliseconds (required, from application layer)
   */
  async validateMediaMemory(options = {}) {
    const { dryRun = false, nowMs } = options;

    if (typeof nowMs !== 'number') {
      throw new Error('nowMs timestamp required for validateMediaMemory');
    }

    // Safety: Check Plex connectivity first (matching legacy behavior)
    const isConnected = await this.#plexClient.checkConnectivity?.();
    if (isConnected === false) {
      return { aborted: true, reason: 'Plex unreachable' };
    }

    // Get all entries from watch state store
    const allEntries = await this.#watchStateStore.getAllEntries();
    const selected = this.selectEntriesToCheck(allEntries, nowMs);

    const results = { checked: 0, valid: 0, backfilled: 0, unresolved: 0, failed: 0 };
    const changesList = [];
    const unresolvedList = [];

    for (const entry of selected) {
      results.checked++;

      try {
        // First verify if the ID still exists in Plex (matching legacy)
        const exists = await this.#plexClient.verifyId?.(entry.id);
        if (exists) {
          results.valid++;
          continue;
        }

        // ID is orphaned - try to find match
        const match = await this.findBestMatch(entry);

        if (match && match.confidence >= MIN_CONFIDENCE) {
          if (!dryRun) {
            // Preserve old ID in oldPlexIds array (matching legacy)
            const oldIds = entry.oldPlexIds || [];
            oldIds.push(parseInt(entry.id, 10));

            await this.#watchStateStore.updateId(entry.id, match.id, {
              oldPlexIds: oldIds
            });
          }
          results.backfilled++;

          changesList.push({
            oldId: parseInt(entry.id, 10),
            newId: parseInt(match.id, 10),
            title: entry.title,
            parent: entry.parent,
            grandparent: entry.grandparent,
            confidence: match.confidence
          });
        } else {
          // IMPORTANT: Never delete orphans - just record as unresolved (matching legacy)
          results.unresolved++;
          unresolvedList.push({
            id: parseInt(entry.id, 10),
            title: entry.title,
            reason: match ? `low confidence (${match.confidence}%)` : 'no match found'
          });
        }
      } catch (error) {
        results.failed++;
      }
    }

    return { ...results, changes: changesList, unresolvedList };
  }

  /**
   * Select entries to validate - prioritizes recent, samples older
   * Migrated from: mediaMemoryValidator.mjs:141-163
   *
   * Legacy behavior:
   * - All entries played in last RECENT_DAYS are checked
   * - SAMPLE_PERCENT of older entries are randomly sampled
   *
   * @param {Array} entries - All entries to check
   * @param {number} nowMs - Current timestamp in milliseconds (from application layer)
   */
  selectEntriesToCheck(entries, nowMs) {
    if (typeof nowMs !== 'number') {
      throw new Error('nowMs timestamp required for selectEntriesToCheck');
    }
    const recentCutoff = nowMs - (RECENT_DAYS * 24 * 60 * 60 * 1000);

    const recent = [];
    const older = [];

    for (const entry of entries) {
      const lastPlayed = entry.lastPlayed ? new Date(entry.lastPlayed).getTime() : 0;
      if (lastPlayed > recentCutoff) {
        recent.push(entry);
      } else {
        older.push(entry);
      }
    }

    // Sample older entries (matching legacy SAMPLE_PERCENT)
    const sampleCount = Math.ceil(older.length * SAMPLE_PERCENT / 100);
    const shuffled = [...older].sort(() => Math.random() - 0.5);
    const sampled = shuffled.slice(0, sampleCount);

    return [...recent, ...sampled];
  }

  /**
   * Find best matching Plex item for orphan entry
   * Migrated from: mediaMemoryValidator.mjs:113-139
   *
   * Search strategy (matching legacy):
   * 1. Try "grandparent title" (e.g., "Breaking Bad Ozymandias")
   * 2. Fall back to just "title"
   */
  async findBestMatch(entry) {
    const queries = [];

    // Build search queries matching legacy strategy
    if (entry.grandparent && entry.title) {
      queries.push(`${entry.grandparent} ${entry.title}`);
    }
    if (entry.title) {
      queries.push(entry.title);
    }

    let bestMatch = null;
    let bestConfidence = 0;

    for (const query of queries) {
      const results = await this.#plexClient.hubSearch(query, entry.libraryId);

      // Handle both array and object response formats
      const items = Array.isArray(results) ? results : (results?.results || []);

      for (const result of items) {
        const confidence = this.calculateConfidence(entry, result);
        if (confidence > bestConfidence) {
          bestConfidence = confidence;
          bestMatch = { ...result, confidence };
        }
        // Early exit if very high confidence (matching legacy)
        if (confidence >= 95) break;
      }
      if (bestConfidence >= MIN_CONFIDENCE) break;
    }

    return bestMatch;
  }

  /**
   * Calculate match confidence between stored entry and search result
   * Migrated from: mediaMemoryValidator.mjs:86-111
   *
   * Weighting (matching legacy):
   * - title: 50%
   * - grandparent: 30%
   * - parent: 20%
   *
   * Uses Dice coefficient (string-similarity) for comparison
   */
  calculateConfidence(stored, result) {
    // Title similarity (50% weight)
    const titleSim = this.#stringSimilarity(
      (stored.title || '').toLowerCase(),
      (result.title || '').toLowerCase()
    );

    // Parent similarity (20% weight) - e.g., season name
    let parentSim = 0;
    if (stored.parent && result.parent) {
      parentSim = this.#stringSimilarity(
        stored.parent.toLowerCase(),
        result.parent.toLowerCase()
      );
    }

    // Grandparent similarity (30% weight) - e.g., show name
    let grandparentSim = 0;
    if (stored.grandparent && result.grandparent) {
      grandparentSim = this.#stringSimilarity(
        stored.grandparent.toLowerCase(),
        result.grandparent.toLowerCase()
      );
    }

    // Weighted score matching legacy: title 50%, grandparent 30%, parent 20%
    const score = (titleSim * 0.5) + (grandparentSim * 0.3) + (parentSim * 0.2);
    return Math.round(score * 100);
  }

  /**
   * Dice coefficient string similarity (matching legacy string-similarity library)
   * @private
   */
  #stringSimilarity(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;

    const aLower = a.toLowerCase().trim();
    const bLower = b.toLowerCase().trim();

    if (aLower === bLower) return 1;
    if (aLower.length < 2 || bLower.length < 2) return 0;

    // Dice coefficient: 2 * |intersection| / (|a| + |b|)
    // Uses bigrams (2-character sequences)
    const aBigrams = new Map();
    for (let i = 0; i < aLower.length - 1; i++) {
      const bigram = aLower.substring(i, i + 2);
      const count = aBigrams.get(bigram) || 0;
      aBigrams.set(bigram, count + 1);
    }

    let intersectionSize = 0;
    for (let i = 0; i < bLower.length - 1; i++) {
      const bigram = bLower.substring(i, i + 2);
      const count = aBigrams.get(bigram) || 0;
      if (count > 0) {
        aBigrams.set(bigram, count - 1);
        intersectionSize++;
      }
    }

    return (2 * intersectionSize) / (aLower.length + bLower.length - 2);
  }
}
