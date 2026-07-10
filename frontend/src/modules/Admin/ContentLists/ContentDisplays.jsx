// ContentDisplays.jsx — display-mode cards for a row's committed content value
// (resolved card, unresolved warning, resolving spinner, empty placeholder)
// plus the content-metadata fetch layer (module-level cache + in-flight
// dedupe) and the shared type/source display metadata they render with.
// Extracted verbatim from ListsItemRow.jsx (Task 14). The module caches
// (contentInfoCache / inflightRequests) are shared state — this module is
// their single instance.
import React, { useState, useEffect } from 'react';
import { Text, Loader, Group, Avatar, Badge, Box, ActionIcon } from '@mantine/core';
import {
  IconMusic, IconDeviceTv, IconMovie, IconDeviceTvOld, IconStack2,
  IconUser, IconDisc, IconPhoto, IconPlaylist, IconFile, IconBook,
  IconChevronRight, IconAlertTriangle, IconCheck,
  IconList, IconMicrophone, IconVideo, IconFolder, IconFileText, IconSearch,
  IconBroadcast, IconPresentation, IconSchool, IconUsers, IconStack3,
  IconPlayerPlay, IconDeviceGamepad2,
} from '@tabler/icons-react';
import { getChildLogger } from '../../../lib/logging/singleton.js';
import { ShimmerAvatar } from './ShimmerAvatar.jsx';

// Lazy admin logger with session logging enabled
let _adminLog;
function adminLog(component) {
  if (!_adminLog) _adminLog = getChildLogger({ app: 'admin', sessionLog: true });
  return component ? _adminLog.child({ component }) : _adminLog;
}

// Types that represent containers (can be drilled into)
export const CONTAINER_TYPES = [
  'show', 'season', 'artist', 'album', 'collection', 'playlist', 'watchlist', 'container',
  'series', 'channel', 'conference', 'query', 'menu', 'program', 'console'
];

/**
 * Check if an item is a container that can be browsed into
 */
export function isContainerItem(item) {
  if (!item) return false;
  if (item.isContainer || item.itemType === 'container') return true;
  const type = item.type || item.metadata?.type;
  return CONTAINER_TYPES.includes(type);
}

// Type to icon mapping
const TYPE_ICONS = {
  track: IconMusic,
  episode: IconDeviceTv,
  movie: IconMovie,
  show: IconDeviceTvOld,
  season: IconStack2,
  artist: IconUser,
  album: IconDisc,
  image: IconPhoto,
  photo: IconPhoto,
  playlist: IconPlaylist,
  book: IconBook,
  // Custom types for DaylightStation
  watchlist: IconList,
  program: IconList,
  menu: IconList,
  query: IconSearch,
  talk: IconMicrophone,
  freshvideo: IconVideo,
  folder: IconFolder,
  container: IconFolder,
  media: IconFileText,
  audio: IconMusic,
  video: IconVideo,
  // Container types for talks/channels
  channel: IconBroadcast,
  series: IconStack3,
  conference: IconPresentation,
  course: IconSchool,
  meeting: IconUsers,
  collection: IconStack2,
  // Format-based icons (preferred over collection-specific)
  singalong: IconMusic,
  readalong: IconBook,
  chapter: IconBook,
  game: IconDeviceGamepad2,
  // Legacy collection names (backward compat)
  hymn: IconMusic,
  primary: IconMusic,
  scripture: IconBook,
  poem: IconFileText,
  default: IconFile
};

export function normalizeListSource(source) {
  return source === 'list' ? 'menu' : source;
}

// Source badge colors
export const SOURCE_COLORS = {
  plex: 'orange',
  immich: 'blue',
  abs: 'green',
  media: 'gray',
  watchlist: 'violet',
  query: 'cyan',
  menu: 'teal',
  program: 'teal',
  freshvideo: 'lime',
  canvas: 'yellow',
  talk: 'pink',
  'local-content': 'pink',
  list: 'violet',
  singalong: 'indigo',
  readalong: 'orange',
  hymn: 'indigo',
  primary: 'grape',
  app: 'teal',
  default: 'gray'
};

/**
 * Parse source prefix from raw input value
 * @param {string} input - Raw input like "plex:12345"
 * @returns {string} Source name uppercase or "UNKNOWN"
 */
function parseSource(input) {
  if (!input) return 'UNKNOWN';
  const match = input.match(/^([a-z]+):/i);
  return match ? match[1].toUpperCase() : 'UNKNOWN';
}

export function getTypeIcon(type) {
  const Icon = TYPE_ICONS[type] || TYPE_ICONS.default;
  return <Icon size={14} />;
}

// Type labels for display
export const TYPE_LABELS = {
  track: 'Track',
  episode: 'Episode',
  movie: 'Movie',
  show: 'Show',
  season: 'Season',
  artist: 'Artist',
  album: 'Album',
  image: 'Image',
  photo: 'Photo',
  playlist: 'Playlist',
  book: 'Book',
  clip: 'Clip',
  // Custom types for DaylightStation
  watchlist: 'Watchlist',
  program: 'Program',
  menu: 'Menu',
  query: 'Query',
  talk: 'Talk',
  freshvideo: 'Video',
  folder: 'Folder',
  container: 'Container',
  media: 'Media',
  audio: 'Audio',
  video: 'Video',
  // Container types for talks/channels
  channel: 'Channel',
  series: 'Series',
  conference: 'Conference',
  course: 'Course',
  meeting: 'Meeting',
  collection: 'Collection',
  singalong: 'Song',
  readalong: 'Reading',
  chapter: 'Chapter',
  hymn: 'Hymn',
  primary: 'Primary',
  app: 'App'
};

// Color palette for seeded avatars (Mantine color names)
const AVATAR_COLORS = [
  'red', 'pink', 'grape', 'violet', 'indigo', 'blue', 'cyan', 'teal',
  'green', 'lime', 'yellow', 'orange'
];

/**
 * Generate a consistent color from a string (seeded by hash)
 * @param {string} str - String to hash
 * @returns {string} Mantine color name
 */
function getSeededColor(str) {
  if (!str) return 'gray';
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/**
 * Types that should get seeded colored avatars when no thumbnail
 */
const SEEDED_COLOR_TYPES = ['query', 'watchlist', 'program', 'menu'];

/**
 * Get avatar content (icon or letter) based on item type
 */
function getAvatarContent(item) {
  const type = item.type;
  // Return icon for specific types, otherwise first letter
  if (type === 'query') return <IconSearch size={18} />;
  if (type === 'watchlist') return <IconList size={18} />;
  if (type === 'program') return <IconPlayerPlay size={18} />;
  if (type === 'menu') return <IconList size={18} />;
  return item.title?.[0];
}

// Build subtitle showing type • parent
function buildSubtitle(item) {
  const parts = [];
  const typeLabel = TYPE_LABELS[item.type];

  // For items with explicit number metadata (e.g., singalong:hymn/97 → "Hymn: 97")
  if (item.number != null) {
    const label = typeLabel || TYPE_LABELS[item.source] || (item.source ? item.source.charAt(0).toUpperCase() + item.source.slice(1) : null);
    if (label) {
      parts.push(`${label}: ${item.number}`);
      return parts.join(' • ');
    }
  }

  // For numbered collection items (e.g., hymn:308, primary:5), show "Hymn: 308"
  // Generic: any source with a numeric localId and no parent hierarchy
  const localIdPart = item.value?.split(':')[1]?.trim();
  const isNumberedCollection = localIdPart && /^\d+$/.test(localIdPart) && !item.parent && !item.library && !item.grandparent;
  if (isNumberedCollection) {
    const label = TYPE_LABELS[item.type] || TYPE_LABELS[item.source] || (item.source ? item.source.charAt(0).toUpperCase() + item.source.slice(1) : null);
    if (label) {
      parts.push(`${label}: ${localIdPart}`);
      return parts.join(' • ');
    }
  }

  const usedLibraryAsType = !typeLabel && item.library;
  const itemIndex = item.itemIndex ?? item.metadata?.itemIndex;
  if (typeLabel && itemIndex != null) parts.push(`${typeLabel} ${itemIndex}`);
  else if (typeLabel) parts.push(typeLabel);
  else if (item.library) parts.push(item.library);

  // Parent info
  if (item.parent) parts.push(item.parent);
  else if (item.grandparent) parts.push(item.grandparent);
  else if (item.library && !usedLibraryAsType) parts.push(item.library);

  return parts.join(' • ');
}

// Shared content item display - used in both table rows and combobox options
function ContentItemDisplay({ item, isHighlighted, isCurrent, showChevron, onChevronClick, compact = false }) {
  const sourceColor = SOURCE_COLORS[item.source] || SOURCE_COLORS.default;
  const isContainer = isContainerItem(item);
  const subtitle = buildSubtitle(item);
  const size = compact ? 28 : 36;

  // Get seeded color for types that should have colored avatars
  const avatarColor = SEEDED_COLOR_TYPES.includes(item.type) ? getSeededColor(item.title) : undefined;

  return (
    <Group gap={6} wrap="nowrap" style={{ flex: 1 }}>
      <ShimmerAvatar src={item.thumbnail} size={size} radius="sm" color={avatarColor}>
        {getAvatarContent(item)}
      </ShimmerAvatar>
      <Box style={{ flex: 1, minWidth: 0 }}>
        <Group gap={4} wrap="nowrap">
          <Text size="xs" truncate fw={isCurrent ? 600 : undefined}>
            {item.title}
          </Text>
          {isCurrent && (
            <IconCheck size={12} style={{ flexShrink: 0, opacity: 0.7 }} />
          )}
          {item.itemCount != null && item.itemCount > 0 && (
            <Badge size="xs" variant="light" color="gray" style={{ flexShrink: 0 }}>
              {item.itemCount}
            </Badge>
          )}
          <Box style={{ flex: 1 }} />
          {item.source && (
            <Badge size="xs" variant="light" color={sourceColor} style={{ flexShrink: 0 }}>
              {item.source.toUpperCase()}
            </Badge>
          )}
        </Group>
        <Group gap={4} wrap="nowrap">
          {getTypeIcon(item.type)}
          <Text size="xs" c="dimmed" truncate>
            {subtitle}
          </Text>
        </Group>
      </Box>
      {showChevron && isContainer && (
        <ActionIcon
          size="xs"
          variant="subtle"
          color="gray"
          onClick={(e) => {
            e.stopPropagation();
            onChevronClick?.();
          }}
          title="Browse contents"
        >
          <IconChevronRight size={14} />
        </ActionIcon>
      )}
    </Group>
  );
}

// Loading display with countup timer — shows user's intent while resolving
export function ResolvingDisplay({ value, onClick }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div onClick={onClick} className="content-display" style={{ cursor: 'pointer' }}>
      <Group gap={6} wrap="nowrap" style={{ flex: 1 }}>
        <Avatar size={28} radius="sm" color="dark">
          <Loader size={14} color="dimmed" />
        </Avatar>
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Text size="xs" truncate fw={500} c="dimmed">{value}</Text>
          <Text size="xs" c="dimmed" fs="italic">Resolving...{elapsed > 0 ? ` ${elapsed}s` : ''}</Text>
        </Box>
      </Group>
    </div>
  );
}

// Shimmer skeleton matching resolved ContentItemDisplay layout (compact)
function ContentDisplayShimmer({ onClick }) {
  return (
    <div onClick={onClick} className="content-display" style={{ cursor: 'pointer' }}>
      <Group gap={6} wrap="nowrap" style={{ flex: 1 }}>
        <div className="avatar-shimmer" style={{ width: 28, height: 28, minWidth: 28 }} />
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Group gap={4} wrap="nowrap">
            <div className="text-shimmer" style={{ height: 12, width: '45%' }} />
            <Box style={{ flex: 1 }} />
            <div className="text-shimmer" style={{ height: 14, width: 40 }} />
          </Group>
          <Group gap={4} wrap="nowrap" mt={4}>
            <div className="text-shimmer" style={{ height: 10, width: 14 }} />
            <div className="text-shimmer" style={{ height: 10, width: '55%' }} />
          </Group>
        </Box>
      </Group>
    </div>
  );
}

// Compact display for current content value - reuses ContentItemDisplay
export function ContentDisplay({ item, onClick, loading }) {
  if (loading) {
    return <ContentDisplayShimmer onClick={onClick} />;
  }

  if (!item) return null;

  return (
    <div onClick={onClick} className="content-display" style={{ cursor: 'pointer' }}>
      <ContentItemDisplay item={item} showChevron={false} compact />
    </div>
  );
}

/**
 * Display for unresolved content - warning state
 */
export function UnresolvedContentDisplay({ item, onClick }) {
  const source = normalizeListSource(parseSource(item.value));

  return (
    <div
      onClick={onClick}
      className="content-display content-display--unresolved"
      style={{ cursor: 'pointer' }}
    >
      <Group gap={6} wrap="nowrap" style={{ flex: 1 }}>
        <Avatar size={28} radius="sm" color="yellow">
          <IconAlertTriangle size={16} />
        </Avatar>
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Group gap={4} wrap="nowrap">
            <Text size="xs" truncate fw={500}>
              {item.value}
            </Text>
            <Box style={{ flex: 1 }} />
            <Badge size="xs" variant="light" color="yellow" style={{ flexShrink: 0 }}>
              {source}
            </Badge>
          </Group>
          <Group gap={4} wrap="nowrap">
            <IconAlertTriangle size={14} color="var(--mantine-color-yellow-6)" />
            <Text size="xs" c="yellow">
              Unknown • Unresolved
            </Text>
          </Group>
        </Box>
      </Group>
    </div>
  );
}

/**
 * Display-mode card for a row's committed content value: resolving spinner,
 * unresolved warning, resolved card, or empty placeholder. Passed to the
 * unified ContentCombobox as `renderValue` — clicking any card enters edit
 * mode via onStartEdit.
 */
export function ContentValueCard({ value, contentInfoMap, onStartEdit }) {
  const contentInfo = value ? contentInfoMap.get(value) : null;
  const loadingInfo = !!value && !contentInfoMap.has(value);

  // Loading state - show user's input text with a spinner and countup so intent is visible
  if (loadingInfo) {
    return <ResolvingDisplay value={value} onClick={onStartEdit} />;
  }

  if (contentInfo) {
    if (contentInfo.unresolved) {
      return <UnresolvedContentDisplay item={contentInfo} onClick={onStartEdit} />;
    }
    return <ContentDisplay item={contentInfo} onClick={onStartEdit} />;
  }

  // No value - show placeholder with avatar footprint
  if (!value) {
    return (
      <Group gap={6} wrap="nowrap" onClick={onStartEdit} className="content-display">
        <Avatar size={28} radius="sm" color="dark">
          <IconPhoto size={16} />
        </Avatar>
        <Text size="xs" c="dimmed">Click to select content...</Text>
      </Group>
    );
  }

  // Fallback - raw value (shouldn't normally reach here)
  return (
    <Text size="xs" c="dimmed" onClick={onStartEdit} className="content-display">
      {value}
    </Text>
  );
}

/**
 * Shape a picked combobox item (search result, browse item, or app entry)
 * into the contentInfoMap entry format so the row card renders instantly
 * without waiting for ListsFolder's metadata refetch.
 */
export function contentInfoFromPick(value, item) {
  return {
    value,
    title: item.title,
    source: item.source || value.split(':')[0],
    type: item.type || item.metadata?.type || null,
    thumbnail: item.thumbnail || null,
    grandparent: item.grandparent ?? item.metadata?.grandparentTitle,
    parent: item.parent ?? item.metadata?.parentTitle,
    library: item.library ?? item.metadata?.librarySectionTitle,
    itemCount: item.itemCount ?? item.metadata?.childCount ?? item.metadata?.leafCount ?? null,
    itemIndex: item.itemIndex ?? item.metadata?.itemIndex ?? null,
    number: item.number ?? item.metadata?.number ?? null,
    unresolved: false,
  };
}

// Cache for content info to avoid re-fetching
const contentInfoCache = new Map();
// Deduplicate in-flight requests so concurrent callers share one fetch
const inflightRequests = new Map();

export async function fetchContentMetadata(value) {
  if (!value) return null;

  // Check cache first
  if (contentInfoCache.has(value)) {
    return contentInfoCache.get(value);
  }

  // If a fetch is already in flight for this value, reuse it
  if (inflightRequests.has(value)) {
    return inflightRequests.get(value);
  }

  // Wrap the actual work in a shared promise so concurrent callers deduplicate
  const promise = (async () => {
    // Resolve app items locally from registry (no backend call needed)
    if (value.startsWith('app:')) {
      const { resolveAppDisplay, getApp } = await import('../../../lib/appRegistry.js');
      const appInfo = resolveAppDisplay(value);
      if (appInfo) {
        const entry = getApp(appInfo.appId);
        const info = {
          value,
          title: appInfo.paramValue
            ? `${appInfo.label} / ${appInfo.paramValue}`
            : appInfo.label,
          source: 'app',
          type: 'app',
          thumbnail: entry?.icon || null,
          unresolved: false,
        };
        contentInfoCache.set(value, info);
        return info;
      }
      // Unknown app — fall through to unresolved
      return { value, title: value.slice(4), source: 'app', type: null, unresolved: true };
    }

    // Parse source:id format (trim whitespace from parts)
    const match = value.match(/^([^:]+):\s*(.+)$/);
    if (!match) {
      // Format can't be parsed - return unresolved
      return { value, unresolved: true };
    }

    const [, source, localId] = [null, match[1].trim(), match[2].trim()];
    const normalizedSource = normalizeListSource(source);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      let response;
      try {
        response = await fetch(`/api/v1/info/${normalizedSource}/${localId}`, { signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }
      if (response.ok) {
        const data = await response.json();
        const info = {
          value: value,
          title: data.title || localId,
          source: normalizedSource,
          type: data.metadata?.type || data.type || null,
          thumbnail: data.thumbnail,
          grandparent: data.metadata?.grandparentTitle,
          parent: data.metadata?.parentTitle,
          library: data.metadata?.librarySectionTitle,
          itemCount: data.metadata?.childCount ?? data.metadata?.leafCount ?? null,
          itemIndex: data.metadata?.itemIndex ?? null,
          number: data.metadata?.number ?? null,
          unresolved: false
        };
        contentInfoCache.set(value, info);
        return info;
      } else {
        // API returned error status - return unresolved
        adminLog('fetchContentMetadata').warn('content_api.error_status', { value, status: response.status });
        return { value, title: localId, source: normalizedSource, type: null, unresolved: true };
      }
    } catch (err) {
      adminLog('fetchContentMetadata').error('content_info.fetch_error', { value, error: err.message });
      // Return unresolved on network/parse failure
      return { value, title: localId, source: normalizedSource, type: null, unresolved: true };
    }
  })().finally(() => inflightRequests.delete(value));

  inflightRequests.set(value, promise);
  return promise;
}
