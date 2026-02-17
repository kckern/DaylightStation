/**
 * SpacingEnforcer
 *
 * Pure function module. Takes an interleaved feed item array and scroll config,
 * returns a reordered/trimmed array satisfying distribution and spacing rules.
 *
 * Enforcement order:
 *   1. Source-level max_per_batch — drop excess items per source
 *   2. Subsource-level max_per_batch — drop excess items per subsource
 *   3. max_consecutive — no N+ items from same source in a row
 *  3b. max_consecutive_subsource — no N+ items from same subsource in a row (global)
 *   4. Source-level min_spacing — reposition items that are too close
 *   5. Subsource-level min_spacing — reposition items from same subsource that are too close
 *
 * @module applications/feed/services
 */
export class SpacingEnforcer {

  enforce(items, config) {
    if (!items.length) return [];

    // Build flat source config from tier-structured config
    const sources = this.#flattenSources(config);

    let result = [...items];

    // 1. Source-level max_per_batch
    result = this.#enforceMaxPerBatch(result, sources);

    // 2. Subsource-level max_per_batch
    result = this.#enforceSubsourceMaxPerBatch(result, sources);

    // 3. max_consecutive (no N+ same source in a row)
    result = this.#enforceMaxConsecutive(result, config.spacing?.max_consecutive ?? 1);

    // 3b. max_consecutive_subsource (no N+ same subsource in a row)
    const maxConsecSub = config.spacing?.max_consecutive_subsource ?? 0;
    if (maxConsecSub > 0) {
      result = this.#enforceMaxConsecutiveSubsource(result, maxConsecSub);
    }

    // 4. Source-level min_spacing
    result = this.#enforceMinSpacing(result, sources);

    // 5. Subsource-level min_spacing
    result = this.#enforceSubsourceMinSpacing(result, sources);

    return result;
  }

  /**
   * Flatten tier-structured sources into a single { [sourceName]: config } map.
   */
  #flattenSources(config) {
    const flat = {};
    const tiers = config.tiers || {};
    for (const tier of Object.values(tiers)) {
      for (const [key, val] of Object.entries(tier.sources || {})) {
        flat[key] = val;
      }
    }
    return flat;
  }

  #enforceMaxPerBatch(items, sources) {
    const counts = {};
    return items.filter(item => {
      const sourceConfig = sources[item.source];
      if (!sourceConfig?.max_per_batch) return true;
      counts[item.source] = (counts[item.source] || 0) + 1;
      return counts[item.source] <= sourceConfig.max_per_batch;
    });
  }

  #enforceSubsourceMaxPerBatch(items, sources) {
    const counts = {};
    return items.filter(item => {
      const sourceConfig = sources[item.source];
      if (!sourceConfig?.subsources?.max_per_batch) return true;
      const subKey = this.#getSubsourceKey(item);
      if (!subKey) return true;
      const key = `${item.source}:${subKey}`;
      counts[key] = (counts[key] || 0) + 1;
      return counts[key] <= sourceConfig.subsources.max_per_batch;
    });
  }

  #enforceMaxConsecutive(items, maxConsecutive) {
    if (maxConsecutive <= 0 || items.length <= 1) return items;

    const result = [items[0]];
    const deferred = [];

    for (let i = 1; i < items.length; i++) {
      let consecutive = 0;
      for (let j = result.length - 1; j >= 0; j--) {
        if (result[j].source === items[i].source) consecutive++;
        else break;
      }

      if (consecutive < maxConsecutive) {
        result.push(items[i]);
      } else {
        deferred.push(items[i]);
      }
    }

    // Re-insert deferred items at valid positions
    for (const item of deferred) {
      let inserted = false;
      for (let pos = 0; pos <= result.length; pos++) {
        if (this.#canInsertAt(result, pos, item.source, maxConsecutive)) {
          result.splice(pos, 0, item);
          inserted = true;
          break;
        }
      }
      if (!inserted) result.push(item);
    }

    return result;
  }

  #canInsertAt(arr, pos, source, maxConsecutive) {
    let before = 0;
    for (let i = pos - 1; i >= 0; i--) {
      if (arr[i].source === source) before++;
      else break;
    }
    let after = 0;
    for (let i = pos; i < arr.length; i++) {
      if (arr[i].source === source) after++;
      else break;
    }
    return (before + after + 1) <= maxConsecutive;
  }

  #enforceMinSpacing(items, sources) {
    const result = [];
    const deferred = [];

    for (const item of items) {
      const minSpacing = sources[item.source]?.min_spacing || 0;
      if (minSpacing <= 0) {
        result.push(item);
        continue;
      }

      let lastIdx = -1;
      for (let i = result.length - 1; i >= 0; i--) {
        if (result[i].source === item.source) { lastIdx = i; break; }
      }

      if (lastIdx === -1 || (result.length - lastIdx) >= minSpacing) {
        result.push(item);
      } else {
        deferred.push(item);
      }
    }

    for (const item of deferred) {
      const minSpacing = sources[item.source]?.min_spacing || 0;
      let inserted = false;
      for (let pos = 0; pos <= result.length; pos++) {
        if (this.#canInsertWithSpacing(result, pos, item.source, minSpacing)) {
          result.splice(pos, 0, item);
          inserted = true;
          break;
        }
      }
      if (!inserted) result.push(item);
    }

    return result;
  }

  #canInsertWithSpacing(arr, pos, source, minSpacing) {
    for (let i = pos - 1; i >= Math.max(0, pos - minSpacing); i--) {
      if (arr[i].source === source) return false;
    }
    for (let i = pos; i < Math.min(arr.length, pos + minSpacing); i++) {
      if (arr[i].source === source) return false;
    }
    return true;
  }

  #enforceSubsourceMinSpacing(items, sources) {
    const result = [];
    const deferred = [];

    for (const item of items) {
      const minSpacing = sources[item.source]?.subsources?.min_spacing || 0;
      const subKey = this.#getSubsourceKey(item);
      if (minSpacing <= 0 || !subKey) {
        result.push(item);
        continue;
      }

      let lastIdx = -1;
      for (let i = result.length - 1; i >= 0; i--) {
        const rSubKey = this.#getSubsourceKey(result[i]);
        if (result[i].source === item.source && rSubKey === subKey) { lastIdx = i; break; }
      }

      if (lastIdx === -1 || (result.length - lastIdx) >= minSpacing) {
        result.push(item);
      } else {
        deferred.push(item);
      }
    }

    for (const item of deferred) {
      const minSpacing = sources[item.source]?.subsources?.min_spacing || 0;
      const subKey = this.#getSubsourceKey(item);
      let inserted = false;
      for (let pos = 0; pos <= result.length; pos++) {
        if (this.#canInsertWithSubsourceSpacing(result, pos, item.source, subKey, minSpacing)) {
          result.splice(pos, 0, item);
          inserted = true;
          break;
        }
      }
      if (!inserted) result.push(item);
    }

    return result;
  }

  #canInsertWithSubsourceSpacing(arr, pos, source, subKey, minSpacing) {
    for (let i = pos - 1; i >= Math.max(0, pos - minSpacing); i--) {
      if (arr[i].source === source && this.#getSubsourceKey(arr[i]) === subKey) return false;
    }
    for (let i = pos; i < Math.min(arr.length, pos + minSpacing); i++) {
      if (arr[i].source === source && this.#getSubsourceKey(arr[i]) === subKey) return false;
    }
    return true;
  }

  #enforceMaxConsecutiveSubsource(items, maxConsecutive) {
    if (maxConsecutive <= 0 || items.length <= 1) return items;

    const result = [items[0]];
    const deferred = [];

    for (let i = 1; i < items.length; i++) {
      const itemSub = this.#getSubsourceKey(items[i]);
      if (!itemSub) {
        result.push(items[i]);
        continue;
      }

      let consecutive = 0;
      for (let j = result.length - 1; j >= 0; j--) {
        if (this.#getSubsourceKey(result[j]) === itemSub) consecutive++;
        else break;
      }

      if (consecutive < maxConsecutive) {
        result.push(items[i]);
      } else {
        deferred.push(items[i]);
      }
    }

    for (const item of deferred) {
      const itemSub = this.#getSubsourceKey(item);
      let inserted = false;
      for (let pos = 0; pos <= result.length; pos++) {
        if (this.#canInsertSubsourceAt(result, pos, itemSub, maxConsecutive)) {
          result.splice(pos, 0, item);
          inserted = true;
          break;
        }
      }
      if (!inserted) result.push(item);
    }

    return result;
  }

  #canInsertSubsourceAt(arr, pos, subsourceKey, maxConsecutive) {
    let before = 0;
    for (let i = pos - 1; i >= 0; i--) {
      if (this.#getSubsourceKey(arr[i]) === subsourceKey) before++;
      else break;
    }
    let after = 0;
    for (let i = pos; i < arr.length; i++) {
      if (this.#getSubsourceKey(arr[i]) === subsourceKey) after++;
      else break;
    }
    return (before + after + 1) <= maxConsecutive;
  }

  #getSubsourceKey(item) {
    const m = item.meta;
    if (!m) return null;
    return m.subreddit || m.sourceId || m.outlet || m.feedTitle || null;
  }
}
