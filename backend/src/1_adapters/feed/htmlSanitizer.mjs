// backend/src/1_adapters/feed/htmlSanitizer.mjs
/**
 * htmlSanitizer
 *
 * Shared, strict HTML sanitizer for externally-sourced feed content
 * (FreshRSS summaries, extracted web articles). This is the authoritative
 * server-side gate against XSS before HTML is stored/served to the frontend.
 *
 * Backed by `sanitize-html` (pure htmlparser2, no jsdom) so it runs on every
 * Node version we deploy to — the prod container ships Node 20.11, which the
 * jsdom/DOMPurify stack cannot import (its transitive css deps require 20.19+).
 *
 * @module adapters/feed/htmlSanitizer
 */

import sanitizeHtml from 'sanitize-html';

// Tags we allow through. Deliberately narrow: text formatting, lists,
// links, images, tables, and code blocks — nothing that can execute or
// load scripts/plugins.
const ALLOWED_TAGS = [
  'a', 'p', 'br', 'h2', 'h3', 'h4',
  'b', 'strong', 'em', 'i', 'u',
  'ul', 'ol', 'li', 'blockquote', 'hr',
  'img', 'figure', 'figcaption',
  'pre', 'code', 'span',
  'table', 'thead', 'tbody', 'tr', 'td', 'th',
];

const SANITIZE_CONFIG = {
  allowedTags: ALLOWED_TAGS,
  // Per-tag attribute allowlist. No `style`, no `on*`, no `class`/`id`.
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title'],
    '*': [],
  },
  // Only these URL schemes survive on href/src. Everything else —
  // javascript:, data:, vbscript:, file: — is dropped. Relative and
  // protocol-relative URLs are allowed.
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: {},
  allowProtocolRelative: true,
  // Strip disallowed tags entirely (drop their text) for script/style so
  // their contents never leak as text; other disallowed tags are unwrapped
  // (text kept) by sanitize-html's default `discard*: false`.
  nonTextTags: ['script', 'style', 'textarea', 'noscript', 'iframe', 'object', 'embed', 'form', 'svg', 'math'],
  // Force safe target/rel on external links so they can't hijack the opener
  // or leak referrer.
  transformTags: {
    a: (tagName, attribs) => ({
      tagName: 'a',
      attribs: {
        ...attribs,
        target: '_blank',
        rel: 'noopener noreferrer nofollow',
      },
    }),
  },
  // Disallow inline styles outright.
  allowedStyles: {},
};

/**
 * Sanitize externally-sourced HTML for safe rendering.
 *
 * @param {string} html - Untrusted HTML string.
 * @returns {string} Sanitized HTML, or '' for falsy/non-string input.
 */
export function sanitizeFeedHtml(html) {
  if (!html || typeof html !== 'string') return '';
  return sanitizeHtml(html, SANITIZE_CONFIG);
}

export default sanitizeFeedHtml;
