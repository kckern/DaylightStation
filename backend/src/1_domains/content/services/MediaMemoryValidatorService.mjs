// backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs

const CONFIDENCE_THRESHOLD = 0.8;
const SAMPLE_SIZE = 50;

/**
 * Service for validating and backfilling orphan Plex IDs in media memory
 * Migrated from: backend/_legacy/lib/mediaMemoryValidator.mjs
 */
export class MediaMemoryValidatorService {
  #plexClient;
  #watchStateStore;
  #logger;

  constructor({ plexClient, watchStateStore, logger }) {
    this.#plexClient = plexClient;
    this.#watchStateStore = watchStateStore;
    this.#logger = logger || console;
  }

  /**
   * Main validation function - find and backfill orphan IDs
   * Migrated from: mediaMemoryValidator.mjs:165-278
   */
  async validateMediaMemory(options = {}) {
    const { maxItems = SAMPLE_SIZE, dryRun = false } = options;

    this.#logger.info('validator.start', { maxItems, dryRun });

    // Get orphan entries (IDs that no longer exist in Plex)
    const orphans = await this.#watchStateStore.getAllOrphans();
    const selected = this.selectEntriesToCheck(orphans, maxItems);

    const results = { checked: 0, backfilled: 0, removed: 0, failed: 0 };

    for (const entry of selected) {
      results.checked++;

      try {
        const match = await this.findBestMatch(entry);

        if (match && match.confidence >= CONFIDENCE_THRESHOLD) {
          if (!dryRun) {
            await this.#watchStateStore.updateId(entry.id, match.ratingKey);
          }
          results.backfilled++;
          this.#logger.info('validator.backfill', {
            oldId: entry.id,
            newId: match.ratingKey,
            confidence: match.confidence
          });
        } else if (!match) {
          if (!dryRun) {
            await this.#watchStateStore.remove(entry.id);
          }
          results.removed++;
        }
      } catch (error) {
        results.failed++;
        this.#logger.error('validator.error', { id: entry.id, error: error.message });
      }
    }

    this.#logger.info('validator.complete', results);
    return results;
  }

  /**
   * Select random sample of entries to validate
   * Migrated from: mediaMemoryValidator.mjs:141-163
   */
  selectEntriesToCheck(entries, maxItems = SAMPLE_SIZE) {
    if (entries.length <= maxItems) return entries;

    // Shuffle and take first N
    const shuffled = [...entries].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, maxItems);
  }

  /**
   * Find best matching Plex item for orphan entry
   * Migrated from: mediaMemoryValidator.mjs:113-139
   */
  async findBestMatch(entry) {
    const searchTerms = [entry.title];
    if (entry.year) searchTerms.push(String(entry.year));

    const results = await this.#plexClient.hubSearch(searchTerms.join(' '));

    if (!results?.results?.length) return null;

    let bestMatch = null;
    let bestConfidence = 0;

    for (const result of results.results) {
      const confidence = this.calculateConfidence(entry, result);
      if (confidence > bestConfidence) {
        bestConfidence = confidence;
        bestMatch = { ...result, confidence };
      }
    }

    return bestConfidence >= CONFIDENCE_THRESHOLD ? bestMatch : null;
  }

  /**
   * Calculate match confidence between stored entry and search result
   * Migrated from: mediaMemoryValidator.mjs:86-111
   */
  calculateConfidence(stored, result) {
    let score = 0;
    let factors = 0;

    // GUID match (highest confidence) - check first
    if (stored.guid && result.guid && stored.guid === result.guid) {
      return 1.0;
    }

    // Title match (weighted heavily)
    if (stored.title && result.title) {
      const titleSimilarity = this.#stringSimilarity(stored.title, result.title);
      score += titleSimilarity * 0.5;
      factors += 0.5;
    }

    // Year match
    if (stored.year && result.year) {
      score += stored.year === result.year ? 0.3 : 0;
      factors += 0.3;
    }

    return factors > 0 ? score / factors : 0;
  }

  /**
   * Simple string similarity (containment-based)
   * @private
   */
  #stringSimilarity(a, b) {
    const aLower = a.toLowerCase().trim();
    const bLower = b.toLowerCase().trim();

    if (aLower === bLower) return 1;

    const longer = aLower.length > bLower.length ? aLower : bLower;
    const shorter = aLower.length > bLower.length ? bLower : aLower;

    if (longer.length === 0) return 1;

    // Simple containment check
    if (longer.includes(shorter)) return shorter.length / longer.length;

    return 0;
  }
}
