// backend/src/1_adapters/content/list/listConfigNormalizer.mjs

/**
 * Normalize YAML list item input field.
 * Handles the space-after-colon YAML quirk and semicolon composites.
 * "plex: 663846; overlay: 440630" → "plex:663846;overlay:440630"
 * @param {string} input
 * @returns {string}
 */
function normalizeInput(input) {
  if (!input) return '';
  // Normalize each semicolon-separated segment: trim and collapse space after first colon
  return input
    .split(';')
    .map(seg => seg.trim().replace(/^(\w+):\s+/, '$1:'))
    .join(';');
}

/**
 * Normalize a single list config item from old format to action-as-key format.
 *
 * Old format (menu/program): { label, input, action }
 * Old format (watchlist):    { title, src, media_key }
 * New format:                { title, play|open|display|list|queue }
 *
 * Items already in new format (with play/open/display/list/queue keys) pass through.
 *
 * @param {Object} item - Raw YAML list item
 * @returns {Object} Normalized item
 */
export function normalizeListItem(item) {
  if (!item) return item;

  // Already new format with no old-format keys — pass through
  if (!item.input && !item.label && (item.play || item.open || item.display || item.list || item.queue)) {
    return { ...item };
  }

  const result = {};

  // ── Title ───────────────────────────────────────────────
  result.title = item.title || item.label;

  // ── Watchlist format: src + media_key ───────────────────
  if (item.src && item.media_key != null) {
    const contentId = `${item.src}:${String(item.media_key)}`;
    result.play = { contentId };

    // Watchlist-specific fields
    if (item.program != null) result.program = item.program;
    if (item.priority != null) result.priority = item.priority;
    if (item.wait_until != null) result.wait_until = item.wait_until;
    if (item.skip_after != null) result.skip_after = item.skip_after;
    if (item.watched != null) result.watched = item.watched;
    if (item.progress != null) result.progress = item.progress;
    if (item.summary != null) result.summary = item.summary;
    if (item.hold != null) result.hold = item.hold;
    if (item.assetId != null) result.assetId = item.assetId;
    if (item.playable != null) result.playable = item.playable;
  }

  // ── Menu/program format: input + action ─────────────────
  else if (item.input) {
    const normalized = normalizeInput(item.input);
    const action = (item.action || 'Play').toLowerCase();

    switch (action) {
      case 'open': {
        // Extract local part after "app:" prefix (or use raw if no prefix)
        const colonIdx = normalized.indexOf(':');
        result.open = colonIdx >= 0 ? normalized.slice(colonIdx + 1) : normalized;
        break;
      }
      case 'display':
        result.display = { contentId: normalized };
        break;
      case 'list':
        result.list = { contentId: normalized };
        break;
      case 'queue':
        result.queue = { contentId: normalized };
        break;
      default: // 'play' or unrecognized
        result.play = { contentId: normalized };
        break;
    }
  }

  // ── Common fields ───────────────────────────────────────
  if (item.uid != null) result.uid = item.uid;
  if (item.image != null) result.image = item.image;
  if (item.fixed_order != null) result.fixed_order = item.fixed_order;
  if (item.active != null) result.active = item.active;
  if (item.continuous != null) result.continuous = item.continuous;
  if (item.shuffle != null) result.shuffle = item.shuffle;
  if (item.playbackrate != null) result.playbackrate = item.playbackrate;
  if (item.days != null) result.days = item.days;
  if (item.applySchedule != null) result.applySchedule = item.applySchedule;

  return result;
}

/**
 * Extract the content ID string from a normalized list item.
 * Checks action keys (play/list/queue/display/open) and falls back to legacy input.
 * @param {Object} item - Normalized list item
 * @returns {string} Content ID or empty string
 */
export function extractContentId(item) {
  if (!item) return '';
  return item.input
    || item.play?.contentId
    || item.list?.contentId
    || item.queue?.contentId
    || item.display?.contentId
    || (item.open ? `app:${item.open}` : '')
    || '';
}

/**
 * Extract the action name from a normalized list item.
 * Returns the capitalized action key name (Play, Queue, List, Display, Open).
 * Falls back to action field or 'Play'.
 * @param {Object} item
 * @returns {string}
 */
export function extractActionName(item) {
  if (!item) return 'Play';
  if (item.action) return item.action;
  if (item.play) return 'Play';
  if (item.queue) return 'Queue';
  if (item.list) return 'List';
  if (item.display) return 'Display';
  if (item.open) return 'Open';
  return 'Play';
}

/**
 * Inheritable fields that cascade from list metadata → section → item.
 */
export const INHERITABLE_FIELDS = [
  'priority', 'hold', 'watched', 'skip_after', 'wait_until',
  'playbackrate', 'continuous', 'shuffle',
  'days', 'applySchedule',
  'active', 'fixed_order'
];

/**
 * Normalize raw YAML list config into a canonical sections-based structure.
 *
 * Accepts three input shapes:
 * - Array: bare item list → single anonymous section
 * - { items: [] }: flat list with metadata → single anonymous section
 * - { sections: [] }: full sections format → pass through
 *
 * Each item is run through normalizeListItem() for old→new format compat.
 *
 * @param {any} raw - Parsed YAML content
 * @param {string} [filename] - Optional filename for deriving title
 * @returns {{ title, description, image, metadata, sections: Array }}
 */
export function normalizeListConfig(raw, filename) {
  // Handle null/undefined
  if (!raw) {
    return {
      title: filename || undefined,
      description: undefined,
      image: undefined,
      metadata: {},
      sections: [{ items: [] }]
    };
  }

  // Bare array → single anonymous section
  if (Array.isArray(raw)) {
    return {
      title: filename || undefined,
      description: undefined,
      image: undefined,
      metadata: {},
      sections: [{
        items: raw.map(item => normalizeListItem(item)).filter(Boolean)
      }]
    };
  }

  // Object format
  const title = raw.title || raw.label || filename || undefined;
  const description = raw.description || undefined;
  const image = raw.image || undefined;

  // Build metadata from known top-level fields
  const metadata = { ...(raw.metadata || {}) };

  // Lift only fields known to exist at top-level in current YAML files.
  // Other inheritable fields belong inside the metadata: block.
  if (raw.fixed_order != null && metadata.fixed_order == null) metadata.fixed_order = raw.fixed_order;
  // Backward compat: ListAdapter.getItem reads listData.group for section titles
  if (raw.group != null && metadata.group == null) metadata.group = raw.group;

  // { sections: [] } → pass through
  if (Array.isArray(raw.sections)) {
    const sections = raw.sections.map(section => {
      const { items: rawItems, ...sectionFields } = section;
      return {
        ...sectionFields,
        items: (rawItems || []).map(item => normalizeListItem(item)).filter(Boolean)
      };
    });
    return { title, description, image, metadata, sections };
  }

  // { items: [] } → single anonymous section
  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  return {
    title,
    description,
    image,
    metadata,
    sections: [{
      items: rawItems.map(item => normalizeListItem(item)).filter(Boolean)
    }]
  };
}

/**
 * Convert a normalized (action-key) item back to input+action format for persistence.
 * Strips derived action keys (play/open/display/list/queue) and ensures input+action are set.
 *
 * @param {Object} item - Normalized list item
 * @returns {Object} Denormalized item with input+action (SSOT format)
 */
export function denormalizeItem(item) {
  if (!item) return item;
  const result = { ...item };

  // Derive input from action keys if missing
  if (!result.input) {
    const contentId = extractContentId(result);
    if (contentId) result.input = contentId;
  }

  // Derive action name; omit if default (Play)
  if (!result.action) {
    const actionName = extractActionName(result);
    if (actionName !== 'Play') result.action = actionName;
  }

  // Normalize title → label for admin-format consistency
  if (result.title && !result.label) {
    result.label = result.title;
  }
  delete result.title;

  // Strip derived action keys — these are rebuilt at read time
  delete result.play;
  delete result.open;
  delete result.display;
  delete result.list;
  delete result.queue;

  return result;
}

/**
 * Serialize a normalized list config back to a YAML-ready object.
 * Uses the most compact valid format:
 * - Single anonymous section with no config → { title, items }
 * - Otherwise → { title, sections }
 *
 * @param {{ title, description, image, metadata, sections }} config
 * @returns {Object} YAML-ready object
 */
export function serializeListConfig(config) {
  const output = {};

  if (config.title) output.title = config.title;
  if (config.description) output.description = config.description;
  if (config.image) output.image = config.image;
  if (config.metadata && Object.keys(config.metadata).length > 0) {
    output.metadata = config.metadata;
  }

  const sections = config.sections || [];

  // Compact form: single section with no title and no section-level config
  const canCompact = sections.length <= 1 && !sectionHasConfig(sections[0]);
  if (canCompact) {
    output.items = (sections[0]?.items || []).map(denormalizeItem);
  } else {
    output.sections = sections.map(section => {
      const { items, ...rest } = section;
      const s = { ...rest };
      s.items = (items || []).map(denormalizeItem);
      return s;
    });
  }

  return output;
}

/**
 * Apply cascading inheritance: list metadata → section defaults → item fields.
 * Returns a new config with resolved items (does not mutate input).
 *
 * @param {{ metadata, sections }} config - Normalized config from normalizeListConfig
 * @returns {{ metadata, sections }} Config with cascaded item fields
 */
export function applyCascade(config) {
  const listDefaults = {};
  for (const field of INHERITABLE_FIELDS) {
    if (config.metadata?.[field] != null) {
      listDefaults[field] = config.metadata[field];
    }
  }

  const sections = (config.sections || []).map(section => {
    // Build section-level defaults (list defaults + section overrides)
    const sectionDefaults = { ...listDefaults };
    for (const field of INHERITABLE_FIELDS) {
      if (section[field] != null) {
        sectionDefaults[field] = section[field];
      }
    }

    // Apply to each item (item overrides section)
    const items = (section.items || []).map(item => {
      const resolved = {};
      for (const field of INHERITABLE_FIELDS) {
        if (item[field] != null) {
          resolved[field] = item[field];
        } else if (sectionDefaults[field] != null) {
          resolved[field] = sectionDefaults[field];
        }
      }
      return { ...item, ...resolved };
    });

    return { ...section, items };
  });

  return { ...config, sections };
}

/**
 * Check if a section has any config beyond just items.
 * @param {Object} section
 * @returns {boolean}
 */
function sectionHasConfig(section) {
  if (!section) return false;
  const { items, ...rest } = section;
  return Object.keys(rest).some(key => rest[key] != null);
}
