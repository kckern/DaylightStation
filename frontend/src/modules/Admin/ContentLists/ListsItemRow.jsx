import React, { useState, useRef, useEffect, forwardRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Text, Checkbox, ActionIcon, Menu, TextInput, Combobox, useCombobox, InputBase, Loader, Group, Avatar, Badge, Box, Drawer, Stack, ScrollArea, Divider, Progress, Modal } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import {
  IconGripVertical, IconTrash, IconCopy, IconDotsVertical, IconPlus,
  IconMusic, IconDeviceTv, IconMovie, IconDeviceTvOld, IconStack2,
  IconUser, IconDisc, IconPhoto, IconPlaylist, IconFile, IconBook,
  IconChevronRight, IconChevronLeft, IconHome, IconInfoCircle,
  IconEye, IconEyeOff, IconPlayerPlay, IconExternalLink, IconAlertTriangle,
  IconList, IconMicrophone, IconVideo, IconFolder, IconFileText, IconSearch,
  IconBroadcast, IconPresentation, IconSchool, IconUsers, IconStack3,
  IconCheck, IconArrowBarDown, IconPlayerPlayFilled, IconPlaylistAdd,
  IconLayoutList, IconAppWindow, IconDeviceDesktop, IconBookmark,
  IconArrowUp, IconArrowDown, IconArrowBarUp, IconSection
} from '@tabler/icons-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import ConfigIndicators from './ConfigIndicators.jsx';
import ProgressDisplay from './ProgressDisplay.jsx';
import { getCacheEntry, setCacheEntry, hasCacheEntry } from './siblingsCache.js';
import { useListsContext } from './ListsContext.js';
import { DaylightMediaPath } from '../../../lib/api.mjs';
import ImagePickerModal from './ImagePickerModal.jsx';
import AdminPreviewPlayer from '../Preview/AdminPreviewPlayer.jsx';

const ACTION_OPTIONS = [
  { value: 'Play', label: 'Play' },
  { value: 'Queue', label: 'Queue' },
  { value: 'List', label: 'List' },
  { value: 'Open', label: 'Open' },
  { value: 'Display', label: 'Display' },
  { value: 'Read', label: 'Read' },
];

// Types that represent containers (can be drilled into)
const CONTAINER_TYPES = [
  'show', 'season', 'artist', 'album', 'collection', 'playlist', 'watchlist', 'container',
  'series', 'channel', 'conference', 'watchlist', 'query', 'menu', 'program'
];

/**
 * Check if an item is a container that can be browsed into
 */
function isContainerItem(item) {
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
  // Legacy collection names (backward compat)
  hymn: IconMusic,
  primary: IconMusic,
  scripture: IconBook,
  poem: IconFileText,
  default: IconFile
};

function normalizeListSource(source) {
  return source === 'list' ? 'menu' : source;
}

/**
 * Fetch siblings data for an item. Returns processed data ready for state.
 * This is the core fetch logic extracted for use by both preload and direct calls.
 */
async function doFetchSiblings(itemId, contentInfo) {
  const match = itemId.match(/^([^:]+):\s*(.+)$/);
  if (!match) return null;

  const source = contentInfo?.source || normalizeListSource(match[1].trim());
  const localId = match[2].trim();
  const response = await fetch(`/api/v1/siblings/${source}/${encodeURIComponent(localId)}`);
  if (!response.ok) return null;

  const data = await response.json();
  const browseItems = (data.items || []).map(item => ({
    value: item.id,
    title: item.title,
    source: item.source,
    type: item.type || item.itemType,
    thumbnail: item.thumbnail,
    grandparent: item.grandparentTitle,
    parent: item.parentTitle,
    library: item.libraryTitle,
    itemCount: item.childCount ?? null,
    isContainer: item.isContainer || item.itemType === 'container'
  }));

  const currentParent = data.parent ? {
    id: data.parent.id,
    title: data.parent.title,
    source: data.parent.source,
    thumbnail: data.parent.thumbnail,
    parentKey: data.parent.parentId ?? null,
    libraryId: data.parent.libraryId ?? null
  } : null;

  return {
    browseItems,
    currentParent,
    pagination: data.pagination || null,
    referenceIndex: data.referenceIndex ?? -1
  };
}

/**
 * Fetch a page of siblings for pagination follow-ups.
 * @param {string} itemId - Compound ID (e.g., "plex:12345")
 * @param {Object} contentInfo - Content metadata
 * @param {number} offset - Start offset
 * @param {number} limit - Number of items
 * @returns {Promise<{items: Array, pagination: Object}|null>}
 */
export async function fetchSiblingsPage(itemId, contentInfo, offset, limit) {
  const match = itemId.match(/^([^:]+):\s*(.+)$/);
  if (!match) return null;

  const source = contentInfo?.source || normalizeListSource(match[1].trim());
  const localId = match[2].trim();
  const response = await fetch(`/api/v1/siblings/${source}/${encodeURIComponent(localId)}?offset=${offset}&limit=${limit}`);
  if (!response.ok) return null;

  const data = await response.json();
  const items = (data.items || []).map(item => ({
    value: item.id,
    title: item.title,
    source: item.source,
    type: item.type || item.itemType,
    thumbnail: item.thumbnail,
    grandparent: item.grandparentTitle,
    parent: item.parentTitle,
    library: item.libraryTitle,
    itemCount: item.childCount ?? null,
    isContainer: item.isContainer || item.itemType === 'container'
  }));

  return { items, pagination: data.pagination || null };
}

/**
 * Preload siblings for an item into the cache.
 * Skips if already cached or pending. Returns the promise for optional awaiting.
 */
export async function preloadSiblings(itemId, contentInfo) {
  if (!itemId || !contentInfo || contentInfo.unresolved) return null;

  // Skip if already cached or pending
  const existing = getCacheEntry(itemId);
  if (existing) return existing.promise;

  // Mark as pending immediately to prevent duplicate requests
  const promise = doFetchSiblings(itemId, contentInfo);
  setCacheEntry(itemId, { status: 'pending', data: null, promise });

  try {
    const data = await promise;
    setCacheEntry(itemId, { status: 'loaded', data, promise: null });
    return data;
  } catch (err) {
    console.error('Preload siblings failed:', itemId, err);
    setCacheEntry(itemId, { status: 'error', data: null, promise: null });
    return null;
  }
}

// Source badge colors
const SOURCE_COLORS = {
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

function getTypeIcon(type) {
  const Icon = TYPE_ICONS[type] || TYPE_ICONS.default;
  return <Icon size={14} />;
}

// Type labels for display
const TYPE_LABELS = {
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
  if (typeLabel) parts.push(typeLabel);
  else if (item.library) parts.push(item.library);

  // Parent info
  if (item.parent) parts.push(item.parent);
  else if (item.grandparent) parts.push(item.grandparent);
  else if (item.library && !usedLibraryAsType) parts.push(item.library);

  return parts.join(' • ');
}

// Shimmer Avatar - shows shimmer placeholder while image loads
function ShimmerAvatar({ src, size = 36, radius = 'sm', color, children, ...props }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  // Reset state when src changes
  useEffect(() => {
    setLoaded(false);
    setError(false);
  }, [src]);

  // Preload image
  useEffect(() => {
    if (!src) {
      setError(true);
      return;
    }
    const img = new Image();
    img.onload = () => setLoaded(true);
    img.onerror = () => setError(true);
    img.src = src;
  }, [src]);

  // No src or error - show fallback avatar with optional color
  if (!src || error) {
    return (
      <Avatar size={size} radius={radius} color={color} {...props}>
        {children}
      </Avatar>
    );
  }

  // Still loading - show shimmer
  if (!loaded) {
    return (
      <div
        className="avatar-shimmer"
        style={{
          width: size,
          height: size,
          minWidth: size,
          borderRadius: radius === 'sm' ? 4 : radius === 'md' ? 8 : radius
        }}
      />
    );
  }

  // Loaded - show actual avatar
  return (
    <Avatar src={src} size={size} radius={radius} {...props}>
      {children}
    </Avatar>
  );
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

// Custom option component for the dropdown - wraps ContentItemDisplay
function ContentOption({ item, isCurrent, isHighlighted, onDrillDown, ...others }) {
  const isContainer = isContainerItem(item);

  // Build class names for styling
  const classNames = ['content-option'];
  if (isHighlighted) classNames.push('highlighted');
  if (isCurrent) classNames.push('current');

  return (
    <Combobox.Option
      value={item.value}
      data-value={item.value}
      data-highlighted={isHighlighted ? 'true' : 'false'}
      data-current={isCurrent ? 'true' : 'false'}
      className={classNames.join(' ')}
      {...others}
    >
      <ContentItemDisplay
        item={item}
        isCurrent={isCurrent}
        isHighlighted={isHighlighted}
        showChevron={true}
        onChevronClick={onDrillDown}
      />
    </Combobox.Option>
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
function ContentDisplay({ item, onClick, loading }) {
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
function UnresolvedContentDisplay({ item, onClick }) {
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
      const response = await fetch(`/api/v1/info/${normalizedSource}/${localId}`);
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
          unresolved: false
        };
        contentInfoCache.set(value, info);
        return info;
      } else {
        // API returned error status - return unresolved
        console.warn(`Content API returned ${response.status} for ${value}`);
        return { value, title: localId, source: normalizedSource, type: null, unresolved: true };
      }
    } catch (err) {
      console.error('Failed to fetch content info:', err);
      // Return unresolved on network/parse failure
      return { value, title: localId, source: normalizedSource, type: null, unresolved: true };
    }
  })().finally(() => inflightRequests.delete(value));

  inflightRequests.set(value, promise);
  return promise;
}

// Content search combobox component with browser navigation
function ContentSearchCombobox({ value, onChange }) {
  const [highlightedIdx, setHighlightedIdx] = useState(-1);
  const { contentInfoMap } = useListsContext();
  const [pagination, setPagination] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const combobox = useCombobox({
    onDropdownClose: () => {
      combobox.resetSelectedOption();
      setHighlightedIdx(-1);
    },
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch] = useDebouncedValue(searchQuery, 300);
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const contentInfo = contentInfoMap.get(value) || null;
  const loadingInfo = value && !contentInfoMap.has(value);
  const [browseItems, setBrowseItems] = useState([]);
  const [loadingBrowse, setLoadingBrowse] = useState(false);
  const [navStack, setNavStack] = useState([]); // [{id, title, source, thumbnail}] breadcrumb trail
  const [currentParent, setCurrentParent] = useState(null); // Current parent being browsed {id, title, source, thumbnail, parentKey, libraryId}
  const optionsRef = useRef(null);
  const blurTimeoutRef = useRef(null);
  const prevIdxRef = useRef(-1);
  const scrollAnimRef = useRef(null);

  // Cleanup blur timeout on unmount
  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
    };
  }, []);

  // Scroll a specific item into view using rAF for reliable post-render timing.
  // Cancels any running scroll animation first to prevent race conditions.
  const scrollOptionIntoView = useCallback((selector) => {
    if (scrollAnimRef.current) cancelAnimationFrame(scrollAnimRef.current);
    requestAnimationFrame(() => {
      if (optionsRef.current) {
        const option = optionsRef.current.querySelector(selector);
        if (option) {
          const container = optionsRef.current;
          // Position the item ~1 row from the top so the user has room to
          // navigate downward before scrolling kicks in (VS Code behavior).
          const topOffset = option.offsetHeight * 1.5;
          container.scrollTop = option.offsetTop - topOffset;
        }
      }
    });
  }, []);

  const inputRef = useRef(null);
  const freshOpenRef = useRef(false); // true until first non-navigation keypress after open
  const [pendingApp, setPendingApp] = useState(null); // {appId, param} — waiting for param input
  const [paramOptions, setParamOptions] = useState(null); // [{value, label}] or null
  const [paramInput, setParamInput] = useState('');

  // Shared cleanup for dismissing the combobox (used by blur, Escape, Tab, and selection)
  const resetComboboxState = useCallback(() => {
    setSearchQuery('');
    setIsEditing(false);
    setBrowseItems([]);
    setNavStack([]);
    setCurrentParent(null);
    setHighlightedIdx(-1);
    setPendingApp(null);
    setParamOptions(null);
    setPagination(null);
    freshOpenRef.current = false;
    combobox.closeDropdown();
  }, [combobox]);

  // Content info is now derived from contentInfoMap via context (no independent fetch needed)

  // Search content when query changes
  useEffect(() => {
    if (!debouncedSearch || debouncedSearch.length < 2) {
      setSearchResults([]);
      return;
    }
    // Don't search when query matches the current value (just opened for browsing)
    if (debouncedSearch === value) {
      setSearchResults([]);
      return;
    }
    // Don't search backend when user is refining within loaded browse items (e.g. hymn: 113)
    const prefix = value?.split(':')[0];
    if (prefix && debouncedSearch.startsWith(prefix + ':') && browseItems.length > 0) {
      return;
    }

    const searchContent = async () => {
      setSearching(true);
      try {
        const response = await fetch(`/api/v1/content/query/search?text=${encodeURIComponent(debouncedSearch)}&take=20`);
        if (response.ok) {
          const data = await response.json();
          const results = (data.items || []).map(item => ({
            value: item.id || `${item.source}:${item.localId}`,
            title: item.title,
            source: item.source,
            type: item.metadata?.type || item.type,
            thumbnail: item.thumbnail,
            grandparent: item.metadata?.grandparentTitle,
            parent: item.metadata?.parentTitle,
            library: item.metadata?.librarySectionTitle,
            itemCount: item.metadata?.childCount ?? item.metadata?.leafCount ?? null
          }));
          // Merge in local app results
          const { searchApps, APP_REGISTRY: appReg } = await import('../../../lib/appRegistry.js');
          const appMatches = searchApps(debouncedSearch).map(app => ({
            value: `app:${app.id}`,
            title: app.label,
            source: 'app',
            type: 'app',
            thumbnail: appReg[app.id]?.icon || null,
            isApp: true,
            appId: app.id,
            hasParam: !!app.param,
            param: app.param,
          }));
          setSearchResults([...appMatches, ...results]);
        }
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        setSearching(false);
      }
    };

    searchContent();
  }, [debouncedSearch, value, browseItems.length]);

  const handleOptionSelect = async (val) => {
    // Check if this is an app with params
    const item = [...searchResults, ...browseItems].find(r => r.value === val);
    if (item?.isApp && item.hasParam) {
      // App needs a parameter — show param picker
      setPendingApp({ appId: item.appId, param: item.param });
      setParamInput('');
      const { resolveParamOptions } = await import('../../../lib/appRegistry.js');
      const options = await resolveParamOptions(item.param);
      // Prepend "Random" option for dropdown-style params
      setParamOptions(options ? [{ value: 'random', label: 'Random' }, ...options] : options);
      combobox.closeDropdown();
      return;
    }

    onChange(val);
    resetComboboxState();
  };

  // Fetch children of a container for drill-down
  const fetchContainerChildren = async (containerId, containerTitle, source, thumbnail = null) => {
    const localId = containerId.replace(/^[^:]+:/, '');
    try {
      setLoadingBrowse(true);

      // Also fetch parent info to get parentKey for going up further
      const parentResponse = await fetch(`/api/v1/info/${source}/${localId}`);
      let parentKey = null;
      let libraryId = null;
      let containerThumb = thumbnail;

      if (parentResponse.ok) {
        const parentData = await parentResponse.json();
        parentKey = parentData.metadata?.parentRatingKey;
        libraryId = parentData.metadata?.librarySectionID;
        containerThumb = containerThumb || parentData.thumbnail;
      }

      // Set current parent
      setCurrentParent({
        id: containerId,
        title: containerTitle,
        source,
        thumbnail: containerThumb,
        parentKey,
        libraryId
      });

      const response = await fetch(`/api/v1/list/${source}/${localId}`);
      if (response.ok) {
        const data = await response.json();
        const children = (data.items || []).map(item => ({
          value: item.id || `${item.source}:${item.localId}`,
          title: item.title,
          source: item.source,
          type: item.metadata?.type || item.type,
          thumbnail: item.thumbnail,
          grandparent: item.metadata?.grandparentTitle,
          parent: item.metadata?.parentTitle,
          library: item.metadata?.librarySectionTitle,
          itemCount: item.metadata?.childCount ?? item.metadata?.leafCount ?? null,
          isContainer: CONTAINER_TYPES.includes(item.metadata?.type || item.type)
        }));
        setBrowseItems(children);
        setHighlightedIdx(0);
        return children;
      }
    } catch (err) {
      console.error('Failed to fetch container children:', err);
      setHighlightedIdx(0);
    } finally {
      setLoadingBrowse(false);
    }
    return [];
  };

  // Drill down into a container (right arrow)
  const drillDown = async (item) => {
    if (!isContainerItem(item)) {
      return false;
    }

    // Push current parent to nav stack (if we have one)
    if (currentParent) {
      setNavStack([...navStack, {
        id: currentParent.id,
        title: currentParent.title,
        source: currentParent.source,
        thumbnail: currentParent.thumbnail
      }]);
    }

    setSearchQuery('');

    // Fetch the new container's children and set it as current parent
    await fetchContainerChildren(item.value, item.title, item.source, item.thumbnail);
    return true;
  };

  // Go up to parent (left arrow) - also loads parent level when at root
  const goUp = async () => {
    setSearchQuery('');

    if (navStack.length > 0) {
      // We have a nav stack - go back one level
      const newStack = [...navStack];
      const previousParent = newStack.pop();
      setNavStack(newStack);

      if (previousParent) {
        // Go back to the previous parent
        await fetchContainerChildren(previousParent.id, previousParent.title, previousParent.source, previousParent.thumbnail);
      } else {
        // Back to initial siblings view
        await fetchSiblings();
      }
      return true;
    }

    // At root level (navStack empty) - try to go up to parent's parent
    if (currentParent?.parentKey) {
      // We're viewing children of a parent container - go up to grandparent
      await loadParentLevel(currentParent.parentKey, currentParent.source);
      return true;
    }

    // No parentKey but have libraryId - go to library level
    if (currentParent?.libraryId && currentParent?.id && !currentParent.id.startsWith('library:')) {
      await loadLibraryLevel(currentParent.libraryId, currentParent.source, currentParent.id);
      return true;
    }

    // Already at library level - can't go higher
    return false;
  };

  // Load library level items
  const loadLibraryLevel = async (libraryId, source, currentContextId) => {
    try {
      setLoadingBrowse(true);

      const response = await fetch(`/api/v1/list/${source}/library/sections/${libraryId}/all`);
      if (!response.ok) return;

      const data = await response.json();
      const items = data.items || [];
      const libraryItems = items.map(item => ({
        value: item.id || `${item.source}:${item.localId}`,
        title: item.title,
        source: item.source,
        type: item.metadata?.type || item.type,
        thumbnail: item.thumbnail,
        grandparent: item.metadata?.grandparentTitle,
        parent: item.metadata?.parentTitle,
        library: item.metadata?.librarySectionTitle,
        itemCount: item.metadata?.childCount ?? item.metadata?.leafCount ?? null,
        isContainer: CONTAINER_TYPES.includes(item.metadata?.type || item.type)
      }));

      setBrowseItems(libraryItems);
      setCurrentParent({
        id: `library:${libraryId}`,
        source,
        parentKey: null,
        libraryId
      });

      // Find and highlight the container we came from
      const normalizedContextId = currentContextId?.replace(/:\s+/g, ':');
      const contextIndex = libraryItems.findIndex(i => i.value === normalizedContextId);
      setHighlightedIdx(contextIndex >= 0 ? contextIndex : 0);

      if (contextIndex >= 0) {
        scrollOptionIntoView(`[data-value="${normalizedContextId}"]`);
      }
    } catch (err) {
      console.error('Failed to load library level:', err);
      setHighlightedIdx(0);
    } finally {
      setLoadingBrowse(false);
    }
  };

  // Load parent level (grandparent's children) for left arrow at root
  const loadParentLevel = async (parentKey, source) => {
    try {
      setLoadingBrowse(true);

      // First get the parent's info to find its parent
      const parentResponse = await fetch(`/api/v1/info/${source}/${parentKey}`);
      if (!parentResponse.ok) return;

      const parentData = await parentResponse.json();
      const grandparentKey = parentData.metadata?.parentRatingKey || parentData.metadata?.parentKey ||
                            parentData.metadata?.artistId;
      const libraryId = parentData.metadata?.librarySectionID;

      let siblingsUrl = null;
      let newContext = null;

      if (grandparentKey) {
        // Parent has a parent (e.g., album -> artist) - fetch grandparent's children
        siblingsUrl = `/api/v1/list/${source}/${grandparentKey}`;
        newContext = {
          id: `${source}:${grandparentKey}`,
          source,
          parentKey: null, // Will be updated when we fetch
          libraryId
        };
      } else if (libraryId) {
        // Parent is at library level - fetch library items
        siblingsUrl = `/api/v1/list/${source}/library/sections/${libraryId}/all`;
        newContext = {
          id: `library:${libraryId}`,
          source,
          parentKey: null,
          libraryId
        };
      }

      if (!siblingsUrl) return;

      const siblingsResponse = await fetch(siblingsUrl);
      if (!siblingsResponse.ok) return;

      const siblingsData = await siblingsResponse.json();
      const siblingItems = siblingsData.items || [];
      const siblings = siblingItems.map(item => ({
        value: item.id || `${item.source}:${item.localId}`,
        title: item.title,
        source: item.source,
        type: item.metadata?.type || item.type,
        thumbnail: item.thumbnail,
        grandparent: item.metadata?.grandparentTitle,
        parent: item.metadata?.parentTitle,
        library: item.metadata?.librarySectionTitle,
        itemCount: item.metadata?.childCount ?? item.metadata?.leafCount ?? null,
        isContainer: CONTAINER_TYPES.includes(item.metadata?.type || item.type)
      }));

      setBrowseItems(siblings);
      setCurrentParent(newContext);
      setHighlightedIdx(0);

      // Find and highlight the parent we came from
      const parentIndex = siblings.findIndex(s => s.value === `${source}:${parentKey}`);
      if (parentIndex >= 0) {
        setHighlightedIdx(parentIndex);
        scrollOptionIntoView(`[data-value="${source}:${parentKey}"]`);
      }
    } catch (err) {
      console.error('Failed to load parent level:', err);
      setHighlightedIdx(0);
    } finally {
      setLoadingBrowse(false);
    }
  };

  // Navigate to specific breadcrumb level
  const navigateTo = async (index) => {
    if (index < 0) {
      // Go to root (siblings)
      setNavStack([]);
      setSearchQuery('');
      await fetchSiblings();
    } else {
      // Keep history up to (but not including) the clicked breadcrumb
      // The clicked item becomes currentParent via fetchContainerChildren
      const newStack = navStack.slice(0, index);
      setNavStack(newStack);
      setSearchQuery('');
      const target = navStack[index];
      await fetchContainerChildren(target.id, target.title, target.source, target.thumbnail);
    }
  };

  // Fetch siblings (items from the same parent) when opening dropdown
  const fetchSiblings = async () => {
    const rawSource = value?.split(':')[0]?.trim();
    const source = normalizeListSource(contentInfo?.source || rawSource);
    const localId = value?.split(':').slice(1).join(':').trim();

    if (!source || !localId) return;

    // App items — resolve siblings locally from registry
    if (source === 'app') {
      try {
        setLoadingBrowse(true);
        const { resolveAppDisplay, resolveParamOptions, getAllApps, getApp, APP_REGISTRY } = await import('../../../lib/appRegistry.js');
        const appInfo = resolveAppDisplay(value);

        let siblings;
        let parentTitle;

        if (appInfo && appInfo.paramName) {
          // Parameterized app — siblings are the param options
          const appEntry = getApp(appInfo.appId);
          const options = await resolveParamOptions(appEntry?.param);
          if (options) {
            siblings = [
              { value: `app:${appInfo.appId}/random`, title: `${appInfo.label} / Random`, source: 'app', type: 'app', thumbnail: null },
              ...options.map(o => ({
                value: `app:${appInfo.appId}/${o.value}`,
                title: `${appInfo.label} / ${o.label}`,
                source: 'app',
                type: 'app',
                thumbnail: o.thumbnail || appEntry?.icon || null,
              }))
            ];
            parentTitle = appInfo.label;
          } else {
            // Free-text param (e.g. art) — no siblings, show all apps
            siblings = getAllApps().map(a => ({
              value: `app:${a.id}`,
              title: a.label,
              source: 'app',
              type: 'app',
              thumbnail: APP_REGISTRY[a.id]?.icon || null,
            }));
            parentTitle = 'Apps';
          }
        } else {
          // Non-parameterized app — siblings are all apps
          siblings = getAllApps().map(a => ({
            value: `app:${a.id}`,
            title: a.label,
            source: 'app',
            type: 'app',
            thumbnail: APP_REGISTRY[a.id]?.icon || null,
          }));
          parentTitle = 'Apps';
        }

        setBrowseItems(siblings);
        setCurrentParent({ id: 'app:', title: parentTitle, source: 'app', thumbnail: null, parentKey: null, libraryId: null });

        // Highlight current item
        const normalizedVal = value?.replace(/:\s+/g, ':');
        const currentIndex = siblings.findIndex(s => s.value === normalizedVal);
        setHighlightedIdx(currentIndex >= 0 ? currentIndex : 0);

        scrollOptionIntoView(`[data-value="${normalizedVal}"]`);
      } catch (err) {
        console.error('Failed to fetch app siblings:', err);
      } finally {
        setLoadingBrowse(false);
      }
      return;
    }

    try {
      setLoadingBrowse(true);
      const data = await doFetchSiblings(value, contentInfo);
      if (!data) return;
      setBrowseItems(data.browseItems);
      setCurrentParent(data.currentParent);
      setPagination(data.pagination || null);

      // Use referenceIndex from API if available, otherwise find by value
      const normalizedVal = value?.replace(/:\s+/g, ':');
      const currentIndex = data.referenceIndex >= 0
        ? data.referenceIndex
        : data.browseItems.findIndex(s => s.value === normalizedVal);
      setHighlightedIdx(currentIndex >= 0 ? currentIndex : 0);
      scrollOptionIntoView(`[data-value="${normalizedVal}"]`);
    } catch (err) {
      console.error('Failed to fetch siblings:', err);
    } finally {
      setLoadingBrowse(false);
    }
  };

  const handleStartEditing = () => {
    setIsEditing(true);
    const q = value || '';
    setSearchQuery(q);
    combobox.openDropdown();

    // Auto-select the part after the colon so typing replaces just the
    // local ID (e.g. "147" in "hymn: 147") while keeping the source prefix.
    // Backspace on a fully-selected suffix clears everything for a fresh start.
    const colonIdx = q.indexOf(':');
    if (colonIdx >= 0) {
      freshOpenRef.current = true;
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el) {
          const selStart = colonIdx + 1;
          // skip the space after colon if present
          const trimmedStart = q[selStart] === ' ' ? selStart + 1 : selStart;
          el.setSelectionRange(trimmedStart, q.length);
        }
      });
    }

    // Check cache first
    const cached = getCacheEntry(value);

    if (cached?.status === 'loaded' && cached.data) {
      // Cache hit - use instantly
      setBrowseItems(cached.data.browseItems);
      setCurrentParent(cached.data.currentParent);
      setPagination(cached.data.pagination || null);
      setLoadingBrowse(false);
      // Use referenceIndex from cache if available
      const normalizedVal = value?.replace(/:\s+/g, ':');
      const currentIndex = cached.data.referenceIndex >= 0
        ? cached.data.referenceIndex
        : cached.data.browseItems.findIndex(s => s.value === normalizedVal);
      setHighlightedIdx(currentIndex >= 0 ? currentIndex : 0);
      // Scroll to current item
      scrollOptionIntoView(`[data-value="${normalizedVal}"]`);
    } else if (cached?.status === 'pending' && cached.promise) {
      // In flight - wait for it
      setLoadingBrowse(true);
      cached.promise.then(data => {
        if (data) {
          setBrowseItems(data.browseItems);
          setCurrentParent(data.currentParent);
          setPagination(data.pagination || null);
          const normalizedVal = value?.replace(/:\s+/g, ':');
          const currentIndex = data.referenceIndex >= 0
            ? data.referenceIndex
            : data.browseItems.findIndex(s => s.value === normalizedVal);
          setHighlightedIdx(currentIndex >= 0 ? currentIndex : 0);
          scrollOptionIntoView(`[data-value="${normalizedVal}"]`);
        }
        setLoadingBrowse(false);
      });
    } else {
      // Cache miss - fetch normally
      fetchSiblings();
    }
  };

  const handleBlur = () => {
    // Delay to allow click events on dropdown to fire first
    blurTimeoutRef.current = setTimeout(() => resetComboboxState(), 150);
  };

  // Normalize value for comparison (handle "plex: 123" vs "plex:123")
  const normalizeValue = (v) => v?.replace(/:\s+/g, ':');
  const normalizedValue = normalizeValue(value);

  // Use search results if actively searching, otherwise show browse items
  // When searchQuery matches the original value, we're browsing (not searching)
  const isActiveSearch = searchQuery.length >= 2 && searchQuery !== value;

  // When browseItems are loaded and user refines with same source prefix, filter locally
  const sourcePrefix = value?.split(':')[0];
  const queryMatchesSource = sourcePrefix && searchQuery.startsWith(sourcePrefix + ':');
  const localFilterQuery = queryMatchesSource ? searchQuery.split(':').slice(1).join(':').trim() : '';
  const canFilterLocally = browseItems.length > 0 && queryMatchesSource && isActiveSearch;

  const displayItems = canFilterLocally
    ? browseItems.filter(item => {
        if (!localFilterQuery) return true;
        const q = localFilterQuery.toLowerCase();
        const num = item.value?.split(':')[1]?.trim();
        return (num && num.startsWith(q)) || item.title?.toLowerCase().includes(q);
      })
    : isActiveSearch ? searchResults : browseItems;

  // Keyboard handler for navigation
  const handleKeyDown = async (e) => {
    // On fresh open, Backspace clears the entire input (prefix + selected suffix)
    // so the user can start with a completely different content type.
    if (e.key === 'Backspace' && freshOpenRef.current) {
      e.preventDefault();
      freshOpenRef.current = false;
      setSearchQuery('');
      setHighlightedIdx(0);
      return;
    }
    // Any non-navigation key clears the fresh-open state
    if (freshOpenRef.current && !['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      freshOpenRef.current = false;
    }

    const items = displayItems;

    // Handle Enter/Escape/Tab before the items-length guard so manual
    // input is always accepted, even when no results match.
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = items[highlightedIdx];
      if (item) {
        handleOptionSelect(item.value);
      } else if (searchQuery) {
        // No matching item highlighted — save raw text as-is
        onChange(searchQuery);
        resetComboboxState();
      }
      return;
    } else if (e.key === 'Escape') {
      e.preventDefault();
      resetComboboxState();
      return;
    } else if (e.key === 'Tab') {
      // Tab: close dropdown without selecting, let natural focus move happen
      resetComboboxState();
      // Don't preventDefault — allow Tab to move focus naturally
      return;
    }

    // Arrow navigation requires items
    if (items.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIdx(prev => (prev + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIdx(prev => prev <= 0 ? items.length - 1 : prev - 1);
    } else if (e.key === 'ArrowRight') {
      const item = items[highlightedIdx];
      if (item && isContainerItem(item)) {
        e.preventDefault();
        await drillDown(item);
      }
      // If not a container, let default cursor movement happen
    } else if (e.key === 'ArrowLeft') {
      // Only navigate up when cursor is at position 0 (or in browse mode)
      const cursorAtStart = e.target.selectionStart === 0;
      if (cursorAtStart || !isActiveSearch) {
        e.preventDefault();
        await goUp();
      }
      // Otherwise, let default cursor movement happen
    }
  };

  // VS Code file-picker scroll: no scroll while item is visible, ease-snap
  // to nearest edge when it goes off-screen, instant jump + flash on pac-man wrap.
  useEffect(() => {
    if (scrollAnimRef.current) cancelAnimationFrame(scrollAnimRef.current);

    if (highlightedIdx < 0 || !optionsRef.current) {
      prevIdxRef.current = highlightedIdx;
      return;
    }

    const container = optionsRef.current;
    const opts = container.querySelectorAll('[data-value]');
    const option = opts[highlightedIdx];
    if (!option) {
      prevIdxRef.current = highlightedIdx;
      return;
    }

    const prevIdx = prevIdxRef.current;
    const itemCount = opts.length;

    // On initial render (prevIdx === -1), skip edge-snap entirely —
    // scrollOptionIntoView handles initial positioning via rAF.
    if (prevIdx === -1) {
      prevIdxRef.current = highlightedIdx;
      return;
    }

    // Detect pac-man wrap
    const isWrap = (prevIdx === itemCount - 1 && highlightedIdx === 0)
                || (prevIdx === 0 && highlightedIdx === itemCount - 1);

    if (isWrap) {
      // Instant jump — no animation
      if (highlightedIdx === 0) {
        container.scrollTop = 0;
      } else {
        container.scrollTop = container.scrollHeight - container.clientHeight;
      }
      // Trigger flash
      option.classList.add('wrap-flash');
      const onEnd = () => { option.classList.remove('wrap-flash'); option.removeEventListener('animationend', onEnd); };
      option.addEventListener('animationend', onEnd);
    } else {
      // Normal navigation — ease-snap if off-screen.
      // Reserve 1 row of padding at the top so the item isn't jammed
      // against the dropdown header (navigation hint / breadcrumb).
      const headerPad = option.offsetHeight * 2.5;
      const optTop = option.offsetTop;
      const optBot = optTop + option.offsetHeight;
      const visTop = container.scrollTop;
      const visBot = visTop + container.clientHeight;

      let target = null;
      if (optTop < visTop + headerPad) {
        target = Math.max(0, optTop - headerPad);
      } else if (optBot > visBot) {
        target = optBot - container.clientHeight;
      }

      if (target !== null) {
        const start = container.scrollTop;
        const delta = target - start;
        const duration = 120;
        const t0 = performance.now();
        const step = (now) => {
          const p = Math.min((now - t0) / duration, 1);
          const ease = 1 - (1 - p) * (1 - p); // ease-out quad
          container.scrollTop = start + delta * ease;
          if (p < 1) scrollAnimRef.current = requestAnimationFrame(step);
        };
        scrollAnimRef.current = requestAnimationFrame(step);
      }
    }

    prevIdxRef.current = highlightedIdx;

    return () => {
      if (scrollAnimRef.current) cancelAnimationFrame(scrollAnimRef.current);
    };
  }, [highlightedIdx, displayItems.length]);

  const options = displayItems.map((item, idx) => (
    <ContentOption
      key={item.value}
      item={item}
      isCurrent={normalizeValue(item.value) === normalizedValue}
      isHighlighted={idx === highlightedIdx}
      onDrillDown={() => drillDown(item)}
    />
  ));

  // Not editing - show display mode
  if (!isEditing) {
    // Loading state - unified shimmer skeleton
    if (loadingInfo) {
      return <ContentDisplayShimmer onClick={handleStartEditing} />;
    }

    // Have content info - check if unresolved
    if (contentInfo) {
      if (contentInfo.unresolved) {
        return (
          <UnresolvedContentDisplay item={contentInfo} onClick={handleStartEditing} />
        );
      }
      return (
        <ContentDisplay item={contentInfo} onClick={handleStartEditing} />
      );
    }

    // No value - show placeholder with avatar footprint
    if (!value) {
      return (
        <Group gap={6} wrap="nowrap" onClick={handleStartEditing} className="content-display">
          <Avatar size={28} radius="sm" color="dark">
            <IconPhoto size={16} />
          </Avatar>
          <Text size="xs" c="dimmed">Click to select content...</Text>
        </Group>
      );
    }

    // Fallback - raw value (shouldn't normally reach here)
    return (
      <Text size="xs" c="dimmed" onClick={handleStartEditing} className="content-display">
        {value}
      </Text>
    );
  }

  // Param picker mode — app selected, waiting for param
  if (pendingApp) {
    const finishWithParam = (paramVal) => {
      const fullId = paramVal
        ? `app:${pendingApp.appId}/${paramVal}`
        : `app:${pendingApp.appId}`;
      onChange(fullId);
      setSearchQuery('');
      setIsEditing(false);
      setPendingApp(null);
      setParamOptions(null);
      setParamInput('');
    };

    const cancelParam = () => {
      setPendingApp(null);
      setParamOptions(null);
      setParamInput('');
    };

    // Dropdown options
    if (paramOptions) {
      return (
        <Combobox
          store={combobox}
          onOptionSubmit={(val) => finishWithParam(val)}
        >
          <Combobox.Target>
            <InputBase
              ref={inputRef}
              size="xs"
              pointer
              rightSection={<Combobox.Chevron />}
              rightSectionPointerEvents="none"
              value={paramInput}
              onChange={(e) => {
                setParamInput(e.currentTarget.value);
                combobox.openDropdown();
              }}
              onClick={() => combobox.openDropdown()}
              onFocus={() => combobox.openDropdown()}
              onKeyDown={(e) => {
                if (e.key === 'Escape') cancelParam();
                if (e.key === 'Enter' && paramInput) finishWithParam(paramInput);
              }}
              placeholder={`Choose or type ${pendingApp.param.name}...`}
              autoFocus
              styles={{ input: { minHeight: 24, height: 24, fontSize: 12 } }}
            />
          </Combobox.Target>
          <Combobox.Dropdown>
            <Combobox.Options>
              <ScrollArea.Autosize mah={200}>
                {paramOptions
                  .filter(o => !paramInput || o.label.toLowerCase().includes(paramInput.toLowerCase()))
                  .map(o => (
                    <Combobox.Option key={o.value} value={o.value}>
                      <Text size="xs">{o.label}</Text>
                    </Combobox.Option>
                  ))}
              </ScrollArea.Autosize>
            </Combobox.Options>
          </Combobox.Dropdown>
        </Combobox>
      );
    }

    // Free text input (no options defined)
    return (
      <TextInput
        ref={inputRef}
        size="xs"
        value={paramInput}
        onChange={(e) => setParamInput(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && paramInput) finishWithParam(paramInput);
          if (e.key === 'Escape') cancelParam();
        }}
        onBlur={() => {
          if (paramInput) finishWithParam(paramInput);
          else cancelParam();
        }}
        placeholder={`Type ${pendingApp.param.name}...`}
        autoFocus
        styles={{ input: { minHeight: 24, height: 24, fontSize: 12 } }}
      />
    );
  }

  // Editing mode - show combobox
  return (
    <Combobox
      store={combobox}
      onOptionSubmit={handleOptionSelect}
      withinPortal={true}
    >
      <Combobox.Target withKeyboardNavigation={false}>
        <InputBase
          ref={inputRef}
          size="xs"
          pointer
          rightSection={searching || loadingBrowse ? <Loader size={12} /> : <Combobox.Chevron />}
          rightSectionPointerEvents="none"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.currentTarget.value);
            setHighlightedIdx(0);
            combobox.openDropdown();
          }}
          onKeyDown={handleKeyDown}
          onClick={() => combobox.openDropdown()}
          onFocus={() => {
            if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
            combobox.openDropdown();
          }}
          onBlur={handleBlur}
          placeholder={navStack.length > 0 ? "Filter..." : "Search or browse..."}
          autoFocus={isEditing}
          styles={{
            input: {
              minHeight: 24,
              height: 24,
              fontSize: 12,
              background: 'transparent',
              borderColor: 'transparent',
              fontFamily: /^\w+:\S/.test(searchQuery) ? 'monospace' : undefined,
            }
          }}
        />
      </Combobox.Target>

      <Combobox.Dropdown>
        {/* Breadcrumb navigation */}
        {navStack.length > 0 && (
          <Box px="xs" py={4} style={{ borderBottom: '1px solid var(--mantine-color-dark-4)' }}>
            <Group gap={4} wrap="nowrap">
              <ActionIcon size="xs" variant="subtle" onClick={() => navigateTo(-1)} title="Back to start">
                <IconHome size={12} />
              </ActionIcon>
              {navStack.map((nav, idx) => (
                <Group key={nav.id} gap={4} wrap="nowrap">
                  <IconChevronRight size={10} color="gray" />
                  <Text
                    size="xs"
                    c={idx === navStack.length - 1 ? undefined : 'dimmed'}
                    fw={idx === navStack.length - 1 ? 500 : undefined}
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigateTo(idx)}
                    truncate
                  >
                    {nav.title}
                  </Text>
                </Group>
              ))}
            </Group>
          </Box>
        )}

        {/* Navigation hint */}
        {displayItems.length > 0 && (!isActiveSearch || canFilterLocally) && (
          <Box px="xs" py={2} style={{ borderBottom: '1px solid var(--mantine-color-dark-5)' }}>
            <Text size="xs" c="dimmed">
              ↑↓ navigate • ← back/up • → drill down • Enter select
            </Text>
          </Box>
        )}

        {/* Current parent header - shows what container we're browsing */}
        {currentParent && (!isActiveSearch || canFilterLocally) && (
          <Box
            px="xs"
            py={4}
            style={{
              borderBottom: '1px solid var(--mantine-color-dark-5)',
              background: 'var(--mantine-color-dark-7)'
            }}
          >
            <Group gap={8} wrap="nowrap">
              <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>In:</Text>
              {currentParent.thumbnail && (
                <ShimmerAvatar src={currentParent.thumbnail} size={20} radius={2} />
              )}
              <Text size="xs" fw={500} truncate style={{ flex: 1 }}>
                {currentParent.title || 'Container'}
              </Text>
              {currentParent.parentKey && (
                <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>← for parent</Text>
              )}
            </Group>
          </Box>
        )}

        <Combobox.Options
          mah={280}
          style={{ overflowY: 'auto' }}
          ref={optionsRef}
          onScroll={(e) => {
            if (!pagination || loadingMore || isActiveSearch) return;
            const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
            if (pagination.hasAfter && scrollHeight - scrollTop - clientHeight < 50) {
              // Load more after
              const offset = pagination.offset + pagination.window;
              setLoadingMore(true);
              fetchSiblingsPage(value, contentInfo, offset, 21).then(result => {
                if (result) {
                  setBrowseItems(prev => [...prev, ...result.items]);
                  setPagination(prev => {
                    if (!prev) return result.pagination;
                    const newWindow = prev.window + result.items.length;
                    return { ...prev, window: newWindow, hasAfter: prev.offset + newWindow < prev.total };
                  });
                }
                setLoadingMore(false);
              });
            }
            if (pagination.hasBefore && scrollTop < 50) {
              // Load more before
              const newOffset = Math.max(0, pagination.offset - 21);
              const limit = Math.min(21, pagination.offset);
              if (limit <= 0) return;
              setLoadingMore(true);
              const prevScrollHeight = e.currentTarget.scrollHeight;
              fetchSiblingsPage(value, contentInfo, newOffset, limit).then(result => {
                if (result) {
                  setBrowseItems(prev => [...result.items, ...prev]);
                  setPagination(prev => {
                    if (!prev) return result.pagination;
                    const newWindow = prev.window + result.items.length;
                    return { ...prev, offset: newOffset, window: newWindow, hasBefore: newOffset > 0 };
                  });
                  // Maintain scroll position after prepending
                  requestAnimationFrame(() => {
                    if (optionsRef.current) {
                      const newScrollHeight = optionsRef.current.scrollHeight;
                      optionsRef.current.scrollTop += (newScrollHeight - prevScrollHeight);
                    }
                  });
                }
                setLoadingMore(false);
              });
            }
          }}
        >
          {loadingMore && pagination?.hasBefore && (
            <Box py={4} style={{ textAlign: 'center' }}><Loader size={12} /></Box>
          )}
          {(searching || loadingBrowse) && displayItems.length === 0 && (
            <Combobox.Empty>{searching ? 'Searching...' : 'Loading...'}</Combobox.Empty>
          )}
          {!searching && !loadingBrowse && displayItems.length === 0 && (isActiveSearch || canFilterLocally) && (
            <Combobox.Empty>No results found</Combobox.Empty>
          )}
          {!searching && !loadingBrowse && displayItems.length === 0 && !isActiveSearch && navStack.length === 0 && (
            <Combobox.Empty>Type to search or wait for items</Combobox.Empty>
          )}
          {!searching && !loadingBrowse && displayItems.length === 0 && navStack.length > 0 && (
            <Combobox.Empty>No items in this container</Combobox.Empty>
          )}
          {options}
          {loadingMore && pagination?.hasAfter && (
            <Box py={4} style={{ textAlign: 'center' }}><Loader size={12} /></Box>
          )}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}

// Action colors and icons for chips
const ACTION_META = {
  Play:    { color: 'blue',   icon: IconPlayerPlayFilled },
  Queue:   { color: 'green',  icon: IconPlaylistAdd },
  List:    { color: 'violet', icon: IconLayoutList },
  Open:    { color: 'gray',   icon: IconAppWindow },
  Display: { color: 'cyan',   icon: IconDeviceDesktop },
  Read:    { color: 'orange', icon: IconBookmark },
};

// Action chip select
function ActionChipSelect({ value, onChange }) {
  const combobox = useCombobox({
    onDropdownClose: () => combobox.resetSelectedOption(),
  });

  const currentValue = value || 'Play';
  const meta = ACTION_META[currentValue] || { color: 'gray', icon: IconPlayerPlayFilled };
  const Icon = meta.icon;

  return (
    <Combobox
      store={combobox}
      onOptionSubmit={(val) => {
        onChange(val);
        combobox.closeDropdown();
      }}
      withinPortal={true}
      classNames={{ dropdown: 'action-dropdown' }}
    >
      <Combobox.Target>
        <Badge
          size="sm"
          variant="light"
          color={meta.color}
          leftSection={<Icon size={12} />}
          style={{ cursor: 'pointer', width: 82, justifyContent: 'flex-start' }}
          onClick={() => combobox.toggleDropdown()}
        >
          {currentValue}
        </Badge>
      </Combobox.Target>

      <Combobox.Dropdown>
        <Combobox.Options>
          {ACTION_OPTIONS.map((opt) => {
            const optMeta = ACTION_META[opt.value] || { color: 'gray', icon: IconPlayerPlayFilled };
            const OptIcon = optMeta.icon;
            return (
              <Combobox.Option key={opt.value} value={opt.value}>
                <Badge
                  size="sm"
                  variant="light"
                  color={optMeta.color}
                  leftSection={<OptIcon size={12} />}
                  style={{ width: 82, justifyContent: 'flex-start' }}
                >
                  {opt.label}
                </Badge>
              </Combobox.Option>
            );
          })}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}

// Item Details Drawer - shows full info, children list, watch states
function ItemDetailsDrawer({ opened, onClose, contentValue }) {
  const [loading, setLoading] = useState(true);
  const [itemInfo, setItemInfo] = useState(null);
  const [children, setChildren] = useState([]);
  const [navStack, setNavStack] = useState([]); // [{id, title}] for navigation
  const [currentItemId, setCurrentItemId] = useState(null); // To highlight in parent view
  const originalValueRef = useRef(contentValue);

  // Fetch details for a specific item
  const fetchItemDetails = async (itemId) => {
    const match = itemId.match(/^([^:]+):\s*(.+)$/);
    if (!match) return null;
    const [, source, localId] = [null, match[1].trim(), match[2].trim()];

    try {
      setLoading(true);

      // Fetch item info
      const itemResponse = await fetch(`/api/v1/info/${source}/${localId}`);
      let info = null;
      if (itemResponse.ok) {
        info = await itemResponse.json();
        setItemInfo(info);
      }

      // Fetch children
      const childrenResponse = await fetch(`/api/v1/info/${source}/${localId}`);
      if (childrenResponse.ok) {
        const childData = await childrenResponse.json();
        setChildren(childData.items || []);
      } else {
        setChildren([]);
      }

      return info;
    } catch (err) {
      console.error('Failed to fetch item details:', err);
      return null;
    } finally {
      setLoading(false);
    }
  };

  // Navigate to parent
  const navigateToParent = async () => {
    if (!itemInfo?.metadata?.parentRatingKey) return;

    const parentId = `${itemInfo.source}:${itemInfo.metadata.parentRatingKey}`;

    // Save current item to highlight in parent's list
    setCurrentItemId(itemInfo.id);

    // Push current to nav stack
    setNavStack([...navStack, { id: itemInfo.id, title: itemInfo.title }]);

    await fetchItemDetails(parentId);
  };

  // Navigate back to child
  const navigateBack = async () => {
    if (navStack.length === 0) return;

    const newStack = [...navStack];
    const target = newStack.pop();
    setNavStack(newStack);
    setCurrentItemId(null);

    await fetchItemDetails(target.id);
  };

  // Reset to original item
  const navigateToOriginal = async () => {
    setNavStack([]);
    setCurrentItemId(null);
    await fetchItemDetails(originalValueRef.current);
  };

  useEffect(() => {
    if (!opened || !contentValue) {
      setLoading(false);
      return;
    }

    // Reset state when opening
    originalValueRef.current = contentValue;
    setNavStack([]);
    setCurrentItemId(null);
    fetchItemDetails(contentValue);
  }, [opened, contentValue]);

  const watchedCount = children.filter(c => c.watched || c.viewCount > 0).length;
  const totalCount = children.length;
  const watchProgress = totalCount > 0 ? (watchedCount / totalCount) * 100 : 0;

  const hasParent = itemInfo?.metadata?.parentRatingKey;

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      title="Item Details"
      position="right"
      size="md"
      padding="md"
    >
      {loading ? (
        <Group justify="center" py="xl">
          <Loader size="lg" />
        </Group>
      ) : itemInfo ? (
        <Stack gap="md">
          {/* Navigation breadcrumb */}
          {navStack.length > 0 && (
            <Group gap="xs">
              <ActionIcon size="sm" variant="subtle" onClick={navigateToOriginal} title="Back to original">
                <IconHome size={14} />
              </ActionIcon>
              {navStack.map((item, idx) => (
                <Group key={item.id} gap={4} wrap="nowrap">
                  <IconChevronRight size={12} color="gray" />
                  <Text
                    size="xs"
                    c="dimmed"
                    style={{ cursor: 'pointer' }}
                    onClick={() => {
                      const newStack = navStack.slice(0, idx);
                      setNavStack(newStack);
                      setCurrentItemId(null);
                      fetchItemDetails(item.id);
                    }}
                  >
                    {item.title}
                  </Text>
                </Group>
              ))}
              <IconChevronRight size={12} color="gray" />
              <Text size="xs" fw={500}>{itemInfo.title}</Text>
            </Group>
          )}

          {/* Header with thumbnail and basic info */}
          <Group align="flex-start" gap="md">
            <ShimmerAvatar src={itemInfo.thumbnail} size={80} radius="sm">
              {itemInfo.title?.[0]}
            </ShimmerAvatar>
            <Box style={{ flex: 1 }}>
              <Text fw={600} size="lg">{itemInfo.title}</Text>
              <Group gap="xs" mt={4}>
                {itemInfo.metadata?.type && (
                  <Badge size="sm" variant="light" color="gray">
                    {itemInfo.metadata.type}
                  </Badge>
                )}
                <Badge size="sm" variant="light" color={SOURCE_COLORS[itemInfo.source] || 'gray'}>
                  {itemInfo.source?.toUpperCase()}
                </Badge>
              </Group>
              {hasParent && (
                <Group
                  gap={4}
                  mt={4}
                  style={{ cursor: 'pointer' }}
                  onClick={navigateToParent}
                >
                  <IconChevronLeft size={14} color="var(--mantine-color-blue-5)" />
                  <Text size="sm" c="blue" td="underline">
                    {itemInfo.metadata.parentTitle}
                    {itemInfo.metadata.grandparentTitle && ` • ${itemInfo.metadata.grandparentTitle}`}
                  </Text>
                </Group>
              )}
              {/* Load Content link - opens in TV app */}
              <Text
                component="a"
                href={`/tv?${CONTAINER_TYPES.includes(itemInfo.metadata?.type) ? 'list' : 'play'}=${itemInfo.id}`}
                target="_blank"
                size="sm"
                c="blue"
                mt={8}
                style={{ display: 'block' }}
              >
                Load Content →
              </Text>
            </Box>
          </Group>

          <Divider />

          {/* Watch Progress */}
          {totalCount > 0 && (
            <Box>
              <Group justify="space-between" mb={4}>
                <Text size="sm" fw={500}>Watch Progress</Text>
                <Text size="sm" c="dimmed">{watchedCount} / {totalCount}</Text>
              </Group>
              <Progress value={watchProgress} size="sm" color={watchProgress === 100 ? 'green' : 'blue'} />
            </Box>
          )}

          {/* Children List */}
          {totalCount > 0 && (
            <Box>
              <Text size="sm" fw={500} mb="xs">Items ({totalCount})</Text>
              <ScrollArea h={400} offsetScrollbars>
                <Stack gap={4}>
                  {children.map((child, idx) => {
                    const isWatched = child.watched || child.viewCount > 0;
                    const childType = child.metadata?.type || child.type;
                    const isCurrentItem = currentItemId && child.id === currentItemId;
                    const isContainer = CONTAINER_TYPES.includes(childType);

                    return (
                      <Group
                        key={child.id || idx}
                        gap="xs"
                        p="xs"
                        style={{
                          background: isCurrentItem
                            ? 'var(--mantine-color-blue-9)'
                            : isWatched
                              ? 'var(--mantine-color-dark-6)'
                              : 'transparent',
                          borderRadius: 4,
                          borderLeft: isCurrentItem ? '3px solid var(--mantine-color-blue-5)' : undefined,
                          opacity: isWatched && !isCurrentItem ? 0.7 : 1,
                          cursor: isContainer ? 'pointer' : 'default'
                        }}
                        onClick={isContainer ? () => {
                          setNavStack([...navStack, { id: itemInfo.id, title: itemInfo.title }]);
                          setCurrentItemId(null);
                          fetchItemDetails(child.id);
                        } : undefined}
                      >
                        <ShimmerAvatar src={child.thumbnail} size={32} radius="sm">
                          {child.title?.[0]}
                        </ShimmerAvatar>
                        <Box style={{ flex: 1, minWidth: 0 }}>
                          <Text size="xs" truncate fw={isCurrentItem ? 600 : undefined}>{child.title}</Text>
                          <Group gap={4}>
                            {getTypeIcon(childType)}
                            <Text size="xs" c="dimmed">
                              {TYPE_LABELS[childType] || childType}
                            </Text>
                          </Group>
                        </Box>
                        <ActionIcon
                          component="a"
                          href={`/tv?${isContainer ? 'list' : 'play'}=${child.id}`}
                          target="_blank"
                          variant="subtle"
                          size="sm"
                          color="blue"
                          onClick={(e) => e.stopPropagation()}
                          title="Load in TV"
                        >
                          <IconExternalLink size={14} />
                        </ActionIcon>
                        {isWatched ? (
                          <IconEye size={16} color="var(--mantine-color-green-6)" />
                        ) : (
                          <IconEyeOff size={16} color="var(--mantine-color-dark-3)" />
                        )}
                        {isContainer && (
                          <IconChevronRight size={14} color="var(--mantine-color-dark-3)" />
                        )}
                      </Group>
                    );
                  })}
                </Stack>
              </ScrollArea>
            </Box>
          )}

          {totalCount === 0 && !loading && (
            <Text size="sm" c="dimmed" ta="center" py="xl">
              No child items
            </Text>
          )}

          {/* Metadata Details */}
          {itemInfo.metadata && (
            <>
              <Divider />
              <Box>
                <Text size="sm" fw={500} mb="xs">Details</Text>
                <Stack gap={4}>
                  {itemInfo.metadata.librarySectionTitle && (
                    <Group gap="xs">
                      <Text size="xs" c="dimmed" w={80}>Library:</Text>
                      <Text size="xs">{itemInfo.metadata.librarySectionTitle}</Text>
                    </Group>
                  )}
                  {itemInfo.metadata.childCount != null && (
                    <Group gap="xs">
                      <Text size="xs" c="dimmed" w={80}>Items:</Text>
                      <Text size="xs">{itemInfo.metadata.childCount}</Text>
                    </Group>
                  )}
                  {itemInfo.metadata.summary && (
                    <Box mt="xs">
                      <Text size="xs" c="dimmed">Summary:</Text>
                      <Text size="xs" mt={2}>{itemInfo.metadata.summary}</Text>
                    </Box>
                  )}
                </Stack>
              </Box>
            </>
          )}
        </Stack>
      ) : (
        <Text size="sm" c="dimmed" ta="center" py="xl">
          No item selected
        </Text>
      )}
    </Drawer>
  );
}

function ListsItemRow({ item, onUpdate, onDelete, onToggleActive, onDuplicate, isWatchlist, onEdit, onSplit, sectionIndex, sectionCount, sections, itemCount, onMoveItem }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.index
  });

  const navigate = useNavigate();
  const { type: currentListType } = useParams();
  const { getNearbyItems, setContentInfo, contentInfoMap, inUseImages } = useListsContext();

  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [dragMenuOpen, setDragMenuOpen] = useState(false);

  // Resolve thumbnail for icon column: override image > input thumbnail (derived from context)
  const cachedInfo = contentInfoMap.get(item.input);
  const inheritedImage = cachedInfo?.thumbnail || null;
  const rowThumbnail = item.image
    ? (item.image.startsWith('/media/') || item.image.startsWith('media/')
        ? DaylightMediaPath(item.image)
        : item.image)
    : inheritedImage;

  // Inline editing state
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelValue, setLabelValue] = useState(item.label || '');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const labelInputRef = useRef(null);

  const handleRowHover = useCallback(() => {
    if (!item.input) return;

    const nearbyItems = getNearbyItems(item.index, 2);
    nearbyItems.forEach(nearbyItem => {
      if (!nearbyItem.input) return;

      // Get or fetch content info
      let info = nearbyItem.contentInfo || contentInfoMap.get(nearbyItem.input);

      if (info && !info.unresolved) {
        preloadSiblings(nearbyItem.input, info);
      } else if (!contentInfoMap.has(nearbyItem.input)) {
        // Fetch content info first, then preload
        fetchContentMetadata(nearbyItem.input).then(fetchedInfo => {
          if (fetchedInfo && !fetchedInfo.unresolved) {
            setContentInfo(nearbyItem.input, fetchedInfo);
            preloadSiblings(nearbyItem.input, fetchedInfo);
          }
        });
      }
    });
  }, [item.input, item.index, getNearbyItems, contentInfoMap, setContentInfo]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // Focus label input when editing starts
  useEffect(() => {
    if (editingLabel && labelInputRef.current) {
      labelInputRef.current.focus();
      labelInputRef.current.select();
    }
  }, [editingLabel]);

  // Label editing handlers
  const handleLabelClick = () => {
    setLabelValue(item.label || '');
    setEditingLabel(true);
  };

  const handleLabelSave = () => {
    if (labelValue.trim() && labelValue !== item.label) {
      onUpdate({ label: labelValue.trim() });
    }
    setEditingLabel(false);
  };

  const handleLabelKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleLabelSave();
    } else if (e.key === 'Escape') {
      setLabelValue(item.label || '');
      setEditingLabel(false);
    }
  };

  // Input (content) change handler
  const handleInputChange = (value) => {
    if (value && value !== item.input) {
      onUpdate({ input: value });
    }
  };

  // Action change handler
  const handleActionChange = (value) => {
    if (value && value !== item.action) {
      onUpdate({ action: value });
    }
  };

  return (
    <div ref={setNodeRef} style={style} className="item-row" data-testid={`item-row-${item.index}`} onMouseEnter={handleRowHover}>
      <div className="col-active">
        <Checkbox
          checked={item.active !== false}
          onChange={onToggleActive}
          size="xs"
        />
      </div>

      <Menu opened={dragMenuOpen} onChange={setDragMenuOpen} position="bottom-start" withinPortal>
        <Menu.Target>
          <div
            className="col-drag drag-handle"
            {...attributes}
            {...listeners}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragMenuOpen(true);
            }}
          >
            <IconGripVertical size={14} />
          </div>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>Reorder</Menu.Label>
          <Menu.Item
            leftSection={<IconArrowBarUp size={14} />}
            disabled={item.index === 0}
            onClick={() => onMoveItem('top')}
          >
            Move to Top
          </Menu.Item>
          <Menu.Item
            leftSection={<IconArrowBarDown size={14} />}
            disabled={item.index === itemCount - 1}
            onClick={() => onMoveItem('bottom')}
          >
            Move to Bottom
          </Menu.Item>
          <Menu.Divider />
          <Menu.Label>Move to Section</Menu.Label>
          {sectionCount > 1 && sections.map((s, si) => {
            if (si === sectionIndex) return null;
            return (
              <Menu.Item
                key={si}
                leftSection={<IconSection size={14} />}
                onClick={() => onMoveItem('section', si)}
              >
                {s.title || `Section ${si + 1}`}
              </Menu.Item>
            );
          })}
          <Menu.Item
            leftSection={<IconPlus size={14} />}
            onClick={() => onMoveItem('new-section')}
          >
            New Section
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>

      <div className="col-index">
        <Text size="xs" c="dimmed">{item.index + 1}</Text>
      </div>

      <div className="col-icon" onClick={() => setImagePickerOpen(true)}>
        <Avatar src={rowThumbnail} size={28} radius="sm">
          {item.label ? item.label.charAt(0).toUpperCase() : '#'}
        </Avatar>
      </div>
      <ImagePickerModal
        opened={imagePickerOpen}
        onClose={() => setImagePickerOpen(false)}
        currentImage={item.image || null}
        inheritedImage={inheritedImage}
        onSave={(path) => onUpdate({ image: path })}
        inUseImages={inUseImages || new Set()}
      />

      <div className="col-label">
        {editingLabel ? (
          <div className="inline-edit">
            <TextInput
              ref={labelInputRef}
              size="xs"
              value={labelValue}
              onChange={(e) => setLabelValue(e.target.value)}
              onKeyDown={handleLabelKeyDown}
              onBlur={handleLabelSave}
              styles={{ input: { minHeight: 22, height: 22 } }}
            />
          </div>
        ) : (
          <Text size="sm" truncate className="editable-text" onClick={handleLabelClick}>
            {item.label}
          </Text>
        )}
      </div>

      <div className="col-action">
        <ActionChipSelect
          value={item.action || 'Play'}
          onChange={handleActionChange}
        />
      </div>

      <div className="col-preview">
        {item.action === 'List' && item.input && (() => {
          const match = item.input.match(/^([^:]+):\s*(.+)$/);
          const listName = match ? match[2].trim() : item.input.trim();
          if (!listName) return null;
          return (
            <ActionIcon
              variant="subtle"
              size="sm"
              color="violet"
              onClick={() => navigate(`/admin/content/lists/${currentListType}/${listName}`)}
              title={`Open list: ${listName}`}
            >
              <IconLayoutList size={14} />
            </ActionIcon>
          );
        })()}
        {(item.action === 'Play' || item.action === 'Queue' || !item.action) && item.input && (
          <ActionIcon
            variant="subtle"
            size="sm"
            color="gray"
            onClick={() => setPreviewOpen(true)}
            title="Preview"
          >
            <IconPlayerPlay size={14} />
          </ActionIcon>
        )}
        <Modal
          opened={previewOpen}
          onClose={() => setPreviewOpen(false)}
          title={item.label || 'Preview'}
          centered
          size={980}
          padding="xs"
          styles={{ content: { marginLeft: 'var(--app-shell-navbar-width, 250px)' } }}
        >
          {previewOpen && (
            <AdminPreviewPlayer
              contentId={item.input?.replace(/^(\w+):\s+/, '$1:').trim()}
              action={item.action || 'Play'}
              volume={item.volume}
              playbackRate={item.playbackRate}
              shuffle={item.shuffle}
              onClose={() => setPreviewOpen(false)}
            />
          )}
        </Modal>
      </div>

      <div className="col-input">
        <ContentSearchCombobox
          value={item.input}
          onChange={handleInputChange}
        />
      </div>

      {isWatchlist && (
        <div className="col-progress">
          <ProgressDisplay item={item} />
        </div>
      )}

      <div className="col-config">
        <ConfigIndicators item={item} onClick={onEdit ? () => onEdit() : undefined} />
      </div>

      <div className="col-menu">
        <Menu position="bottom-end">
          <Menu.Target>
            <ActionIcon variant="subtle" size="sm">
              <IconDotsVertical size={14} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item leftSection={<IconInfoCircle size={14} />} onClick={() => setDrawerOpen(true)}>
              More Info
            </Menu.Item>
            <Menu.Item leftSection={<IconCopy size={14} />} onClick={onDuplicate}>
              Duplicate
            </Menu.Item>
            {onSplit && (
              <Menu.Item leftSection={<IconArrowBarDown size={14} />} onClick={onSplit}>
                Split Below
              </Menu.Item>
            )}
            <Menu.Divider />
            <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={onDelete}>
              Delete
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </div>

      <ItemDetailsDrawer
        opened={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        contentValue={item.input}
      />
    </div>
  );
}

// Empty row for adding new items at the bottom
function EmptyItemRow({ onAdd, nextIndex, isWatchlist }) {
  const [label, setLabel] = useState('');
  const [action, setAction] = useState('Play');
  const [input, setInput] = useState('');
  const labelInputRef = useRef(null);

  const handleAdd = () => {
    if (label.trim() || input) {
      onAdd({
        label: label.trim() || `Item ${nextIndex + 1}`,
        action,
        input,
        active: true
      });
      // Reset fields
      setLabel('');
      setAction('Play');
      setInput('');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (label.trim() || input)) {
      handleAdd();
    }
  };

  // Auto-save when input is selected (content picked)
  useEffect(() => {
    if (input && label.trim()) {
      handleAdd();
    }
  }, [input]);

  return (
    <div className="item-row empty-row">
      <div className="col-active">
        <Checkbox checked={true} disabled size="xs" />
      </div>
      <div className="col-drag"></div>
      <div className="col-index">
        <Text size="xs" c="dimmed">{nextIndex + 1}</Text>
      </div>
      <div className="col-icon">
        <Avatar size={28} radius="sm" color="dark">
          <IconPlus size={14} />
        </Avatar>
      </div>
      <div className="col-label">
        <TextInput
          ref={labelInputRef}
          size="xs"
          placeholder="New item label..."
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={handleKeyDown}
          styles={{ input: { minHeight: 22, height: 22, background: 'transparent', border: 'none' } }}
        />
      </div>
      <div className="col-action">
        <ActionChipSelect value={action} onChange={setAction} />
      </div>
      <div className="col-preview"></div>
      <div className="col-input">
        <ContentSearchCombobox value={input} onChange={setInput} />
      </div>
      {isWatchlist && (
        <div className="col-progress"></div>
      )}
      <div className="col-config"></div>
      <div className="col-menu"></div>
    </div>
  );
}

// Insert button that appears between rows on hover
function InsertRowButton({ onInsert }) {
  const [visible, setVisible] = useState(false);

  return (
    <div
      className="insert-row-zone"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      <div className={`insert-row-button ${visible ? 'visible' : ''}`}>
        <ActionIcon
          size="xs"
          variant="filled"
          color="blue"
          radius="xl"
          onClick={onInsert}
        >
          <IconPlus size={10} />
        </ActionIcon>
      </div>
    </div>
  );
}

export default ListsItemRow;
export { EmptyItemRow, InsertRowButton };
