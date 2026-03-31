/**
 * ContentExpression — use-case-agnostic value object for content expressions.
 *
 * Represents: do [action] with [contentId] on [screen] with [options].
 * Query object is the gold standard. Strings are serialized representations.
 *
 * @module domains/content/ContentExpression
 */

const ACTION_KEYS = new Set(['play', 'queue', 'list', 'open', 'display', 'read']);
const RESERVED_KEYS = new Set([...ACTION_KEYS, 'screen']);

export class ContentExpression {
  constructor({ screen = null, action = null, contentId = null, options = {} }) {
    this.screen = screen;
    this.action = action;
    this.contentId = contentId;
    this.options = options;
  }

  static fromQuery(query = {}) {
    let screen = null;
    let action = null;
    let contentId = null;
    const options = {};

    for (const [key, value] of Object.entries(query)) {
      if (key === 'screen') {
        screen = value || null;
      } else if (ACTION_KEYS.has(key) && !action && value != null && value !== '' && value !== true) {
        action = key;
        contentId = value;
      } else if (!RESERVED_KEYS.has(key)) {
        options[key] = (value === '' || value === undefined) ? true : value;
      }
    }

    return new ContentExpression({ screen, action, contentId, options });
  }

  static fromString(str, knownActions) {
    if (!str || typeof str !== 'string') {
      return new ContentExpression({});
    }

    const actions = knownActions ? new Set(knownActions) : ACTION_KEYS;

    // Split options (everything after first +)
    const plusIdx = str.indexOf('+');
    const mainPart = plusIdx !== -1 ? str.slice(0, plusIdx) : str;
    const optStr = plusIdx !== -1 ? str.slice(plusIdx + 1) : '';

    const options = {};
    if (optStr) {
      for (const part of optStr.split('+')) {
        if (!part) continue;
        const eqIdx = part.indexOf('=');
        if (eqIdx !== -1) {
          options[part.slice(0, eqIdx)] = part.slice(eqIdx + 1);
        } else {
          options[part] = true;
        }
      }
    }

    // Normalize delimiters and split segments
    const normalized = mainPart.replace(/[; ]/g, ':');
    const segments = normalized.split(':');

    let screen = null;
    let action = null;
    let contentId = null;

    if (segments.length < 2) {
      if (actions.has(segments[0])) {
        action = segments[0];
      }
      return new ContentExpression({ screen, action, contentId, options });
    }

    // Content IDs are always source:localId (last two segments)
    contentId = segments.slice(-2).join(':');
    const prefixes = segments.slice(0, -2);

    if (prefixes.length === 0) {
      // source:id only
    } else if (prefixes.length === 1) {
      if (actions.has(prefixes[0])) {
        action = prefixes[0];
      } else {
        screen = prefixes[0];
      }
    } else if (prefixes.length === 2) {
      screen = prefixes[0];
      action = prefixes[1];
    }

    return new ContentExpression({ screen, action, contentId, options });
  }

  toString() {
    const parts = [];
    if (this.screen) parts.push(this.screen);
    if (this.action) parts.push(this.action);
    if (this.contentId) parts.push(this.contentId);

    let result = parts.join(':');

    const optParts = [];
    for (const [key, value] of Object.entries(this.options)) {
      if (value === true) {
        optParts.push(key);
      } else if (value != null && value !== '') {
        optParts.push(`${key}=${value}`);
      }
    }
    if (optParts.length > 0) {
      result += '+' + optParts.join('+');
    }

    return result;
  }

  toQuery() {
    const query = {};
    if (this.screen) query.screen = this.screen;
    if (this.action && this.contentId) query[this.action] = this.contentId;
    for (const [key, value] of Object.entries(this.options)) {
      query[key] = value === true ? '' : value;
    }
    return query;
  }
}
