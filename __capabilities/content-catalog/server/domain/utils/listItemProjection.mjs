import { Item } from '../entities/Item.mjs';
import { extractContentId } from './listItemInput.mjs';

// Shared ordinary mapping; policy enrichment remains the caller's responsibility.
export function listItemParts(item, listMetadata = {}) {
  // Extract content ID from normalized item (play/list/queue/display action keys or legacy input)
  const contentId = extractContentId(item);
  let source = 'list';
  let localId = contentId;

  // Handle various input formats (trim whitespace after colon for YAML compat)
  const inputMatch = contentId.match(/^([\w-]+):\s*(.+?)(?:;.*)?$/);
  if (inputMatch) {
    source = inputMatch[1];
    localId = inputMatch[2].trim();
  }

  if (source === 'list') {
    source = 'menu';
  }

  // Build the asset ID for watch state lookup
  const assetId = item.assetId || localId;

  // Determine action type from YAML (default to Play)
  const actionType = (item.action || 'Play').toLowerCase();

  // Build the base action key - use src override or parsed source
  const src = item.src || source;
  const normalizedSrc = src === 'list' ? 'menu' : src;
  const baseAction = {};
  baseAction[normalizedSrc] = assetId;

  // Add options to action object
  if (item.shuffle) baseAction.shuffle = true;
  if (item.continuous) baseAction.continuous = true;
  if (item.playable !== undefined) baseAction.playable = item.playable;

  // Build actions object
  const playAction = {};
  const openAction = {};
  const listAction = {};
  const queueAction = {};
  const displayAction = {};

  // Handle raw YAML action overrides first.
  // Merge baseAction first so behavior flags (shuffle/continuous/playable) propagate;
  // the explicit YAML action block overlays on top for contentId/overrides.
  if (item.play) {
    Object.assign(playAction, baseAction, item.play);
  } else if (item.open) {
    // open is a string (e.g., "family-selector/user_4") — wrap as { app: value }
    Object.assign(openAction, typeof item.open === 'string' ? { app: item.open } : item.open);
  } else if (item.queue) {
    Object.assign(queueAction, baseAction, item.queue);
  } else if (item.list) {
    Object.assign(listAction, baseAction, item.list);
  } else if (item.display) {
    Object.assign(displayAction, baseAction, item.display);
  } else if (actionType === 'open' || source === 'app') {
    Object.assign(openAction, baseAction);
  } else if (actionType === 'queue') {
    Object.assign(queueAction, baseAction);
  } else if (actionType === 'list') {
    Object.assign(listAction, baseAction);
  } else if (actionType === 'display') {
    Object.assign(displayAction, baseAction);
  } else {
    // Default: play
    Object.assign(playAction, baseAction);
  }

  // Start policy belongs to this menu launch, never the saved media progress.
  // Explicit action options win over item fields, then menu metadata defaults.
  for (const action of [playAction, queueAction]) {
    if (Object.keys(action).length === 0) continue;
    const resume = item.resume ?? listMetadata?.resume;
    const seconds = item.seconds ?? listMetadata?.seconds;
    if (action.resume === undefined && typeof resume === 'boolean') action.resume = resume;
    if (action.seconds === undefined && Number.isFinite(seconds) && seconds >= 0) action.seconds = seconds;
  }

  // Merge display hints into the resolved action object
  if (item.menuStyle) {
    const target = listAction || queueAction || playAction;
    if (target) target.menuStyle = item.menuStyle;
  }

  return { contentId, source, localId, assetId, actionType, normalizedSrc, playAction, queueAction, listAction, openAction, displayAction };
}

export async function listItemThumbnail(item, contentId, { registry, artworkForUid } = {}) {
  // Auto-resolve thumbnail from uploaded list images when no explicit image
  let thumbnail = item.image || null;
  if (!thumbnail && item.uid && artworkForUid) thumbnail = await artworkForUid(item.uid) || null;

  // A menu entry may point at a collection whose artwork is authored by
  // that collection (for example a saved query cover). Ask for the cheap
  // thumbnail capability only; never resolve the target's full queue just
  // to paint a menu tile.
  if (!thumbnail && registry) {
    const resolved = registry.resolve(contentId);
    if (typeof resolved?.adapter?.getThumbnailUrl === 'function') {
      try {
        thumbnail = await resolved.adapter.getThumbnailUrl(resolved.localId) || null;
      } catch { /* thumbnail is decorative */ }
    }
  }

  return thumbnail;
}

export function makeListItem({ item, listPrefix, source, localId, compoundId, thumbnail, metadata, actions, actionType }) {
  return new Item({
    id: compoundId || `${listPrefix}:${item.title || item.label}`,
    source, localId, title: item.title || item.label || localId, label: item.label,
    type: listPrefix === 'watchlist' ? (actionType === 'queue' ? 'queue' : 'list') : undefined,
    thumbnail, metadata, actions,
  });
}
