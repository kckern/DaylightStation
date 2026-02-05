import React, { useState, useRef, useEffect, forwardRef } from 'react';
import { Text, Checkbox, ActionIcon, Menu, TextInput, Combobox, useCombobox, InputBase, Loader, Group, Avatar, Badge, Box, Drawer, Stack, ScrollArea, Divider, Progress } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import {
  IconGripVertical, IconTrash, IconCopy, IconDotsVertical, IconPlus,
  IconMusic, IconDeviceTv, IconMovie, IconDeviceTvOld, IconStack2,
  IconUser, IconDisc, IconPhoto, IconPlaylist, IconFile, IconBook,
  IconChevronRight, IconChevronLeft, IconHome, IconInfoCircle,
  IconEye, IconEyeOff, IconPlayerPlay, IconExternalLink, IconAlertTriangle,
  IconList, IconMicrophone, IconVideo, IconFolder, IconFileText, IconSearch,
  IconBroadcast, IconPresentation, IconSchool, IconUsers, IconStack3
} from '@tabler/icons-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import ConfigIndicators from './ConfigIndicators.jsx';
import ProgressDisplay from './ProgressDisplay.jsx';

const ACTION_OPTIONS = [
  { value: 'Play', label: 'Play' },
  { value: 'Queue', label: 'Queue' },
  { value: 'List', label: 'List' },
  { value: 'Display', label: 'Display' },
  { value: 'Read', label: 'Read' },
];

// Types that represent containers (can be drilled into)
const CONTAINER_TYPES = [
  'show', 'season', 'artist', 'album', 'collection', 'playlist', 'folder', 'container',
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
  default: IconFile
};

// Source badge colors
const SOURCE_COLORS = {
  plex: 'orange',
  immich: 'blue',
  abs: 'green',
  media: 'gray',
  filesystem: 'gray',
  watchlist: 'violet',
  query: 'cyan',
  menu: 'teal',
  program: 'teal',
  freshvideo: 'lime',
  talk: 'pink',
  'local-content': 'pink',
  list: 'violet',
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
  collection: 'Collection'
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
  if (typeLabel) parts.push(typeLabel);

  // Parent info
  if (item.parent) parts.push(item.parent);
  else if (item.grandparent) parts.push(item.grandparent);
  else if (item.library) parts.push(item.library);

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

// Compact display for current content value - reuses ContentItemDisplay
function ContentDisplay({ item, onClick, loading }) {
  if (loading) {
    return (
      <Group gap={6} wrap="nowrap" onClick={onClick} className="content-display">
        <div className="avatar-shimmer" />
        <Box style={{ flex: 1, minWidth: 0 }}>
          <div style={{ height: 12, width: '60%', background: 'var(--mantine-color-dark-5)', borderRadius: 2, marginBottom: 4 }} />
          <div style={{ height: 10, width: '40%', background: 'var(--mantine-color-dark-6)', borderRadius: 2 }} />
        </Box>
      </Group>
    );
  }

  if (!item) return null;

  return (
    <div onClick={onClick} className="content-display" style={{ cursor: 'pointer' }}>
      <ContentItemDisplay item={item} showChevron={false} />
    </div>
  );
}

/**
 * Display for unresolved content - warning state
 */
function UnresolvedContentDisplay({ item, onClick }) {
  const source = parseSource(item.value);

  return (
    <div
      onClick={onClick}
      className="content-display content-display--unresolved"
      style={{ cursor: 'pointer' }}
    >
      <Group gap={6} wrap="nowrap" style={{ flex: 1 }}>
        <Avatar size={36} radius="sm" color="yellow">
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

async function fetchContentMetadata(value) {
  if (!value) return null;

  // Check cache first
  if (contentInfoCache.has(value)) {
    return contentInfoCache.get(value);
  }

  // Parse source:id format (trim whitespace from parts)
  const match = value.match(/^([^:]+):\s*(.+)$/);
  if (!match) {
    // Format can't be parsed - return unresolved
    return { value, unresolved: true };
  }

  const [, source, localId] = [null, match[1].trim(), match[2].trim()];

  try {
    const response = await fetch(`/api/v1/content/item/${source}/${localId}`);
    if (response.ok) {
      const data = await response.json();
      const info = {
        value: value,
        title: data.title || localId,
        source: source,
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
      return { value, title: localId, source, type: null, unresolved: true };
    }
  } catch (err) {
    console.error('Failed to fetch content info:', err);
    // Return unresolved on network/parse failure
    return { value, title: localId, source, type: null, unresolved: true };
  }
}

// Content search combobox component with browser navigation
function ContentSearchCombobox({ value, onChange }) {
  const [highlightedIdx, setHighlightedIdx] = useState(-1);

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
  const [contentInfo, setContentInfo] = useState(null);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [browseItems, setBrowseItems] = useState([]);
  const [loadingBrowse, setLoadingBrowse] = useState(false);
  const [navStack, setNavStack] = useState([]); // [{id, title, source, thumbnail}] breadcrumb trail
  const [currentParent, setCurrentParent] = useState(null); // Current parent being browsed {id, title, source, thumbnail, parentKey, libraryId}
  const optionsRef = useRef(null);
  const inputRef = useRef(null);

  // Fetch content info for current value
  useEffect(() => {
    let cancelled = false;

    if (!value) {
      setContentInfo(null);
      setLoadingInfo(false);
      return;
    }

    if (isEditing) {
      return; // Don't fetch while editing
    }

    setLoadingInfo(true);

    fetchContentMetadata(value).then(info => {
      if (!cancelled) {
        setContentInfo(info);
        setLoadingInfo(false);
      }
    });

    return () => { cancelled = true; };
  }, [value, isEditing]);

  // Search content when query changes
  useEffect(() => {
    if (!debouncedSearch || debouncedSearch.length < 2) {
      setSearchResults([]);
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
          setSearchResults(results);
        }
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        setSearching(false);
      }
    };

    searchContent();
  }, [debouncedSearch]);

  const handleOptionSelect = (val) => {
    onChange(val);
    setSearchQuery('');
    setIsEditing(false);
    setBrowseItems([]);
    setNavStack([]);
    setCurrentParent(null);
    combobox.closeDropdown();
  };

  // Fetch children of a container for drill-down
  const fetchContainerChildren = async (containerId, containerTitle, source, thumbnail = null) => {
    const localId = containerId.replace(/^[^:]+:/, '');
    try {
      setLoadingBrowse(true);

      // Also fetch parent info to get parentKey for going up further
      const parentResponse = await fetch(`/api/v1/content/item/${source}/${localId}`);
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

      const response = await fetch(`/api/v1/item/${source}/${localId}`);
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

      const response = await fetch(`/api/v1/item/${source}/library/sections/${libraryId}/all`);
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
        setTimeout(() => {
          if (optionsRef.current) {
            const contextOption = optionsRef.current.querySelector(`[data-value="${normalizedContextId}"]`);
            if (contextOption) {
              contextOption.scrollIntoView({ block: 'center' });
            }
          }
        }, 50);
      }
    } catch (err) {
      console.error('Failed to load library level:', err);
    } finally {
      setLoadingBrowse(false);
    }
  };

  // Load parent level (grandparent's children) for left arrow at root
  const loadParentLevel = async (parentKey, source) => {
    try {
      setLoadingBrowse(true);

      // First get the parent's info to find its parent
      const parentResponse = await fetch(`/api/v1/content/item/${source}/${parentKey}`);
      if (!parentResponse.ok) return;

      const parentData = await parentResponse.json();
      const grandparentKey = parentData.metadata?.parentRatingKey || parentData.metadata?.parentKey ||
                            parentData.metadata?.artistId;
      const libraryId = parentData.metadata?.librarySectionID;

      let siblingsUrl = null;
      let newContext = null;

      if (grandparentKey) {
        // Parent has a parent (e.g., album -> artist) - fetch grandparent's children
        siblingsUrl = `/api/v1/item/${source}/${grandparentKey}`;
        newContext = {
          id: `${source}:${grandparentKey}`,
          source,
          parentKey: null, // Will be updated when we fetch
          libraryId
        };
      } else if (libraryId) {
        // Parent is at library level - fetch library items
        siblingsUrl = `/api/v1/item/${source}/library/sections/${libraryId}/all`;
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
        setTimeout(() => {
          if (optionsRef.current) {
            const parentOption = optionsRef.current.querySelector(`[data-value="${source}:${parentKey}"]`);
            if (parentOption) {
              parentOption.scrollIntoView({ block: 'center' });
            }
          }
        }, 50);
      }
    } catch (err) {
      console.error('Failed to load parent level:', err);
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
    if (!contentInfo) return;

    const { source } = contentInfo;
    const localId = value.split(':')[1]?.trim();

    try {
      setLoadingBrowse(true);
      // Fetch current item to get parent key or library info
      const response = await fetch(`/api/v1/content/item/${source}/${localId}`);
      if (!response.ok) return;

      const data = await response.json();
      const parentKey = data.metadata?.parentRatingKey || data.metadata?.parentKey ||
                       data.metadata?.parentId || data.metadata?.albumId || data.metadata?.artistId;
      const libraryId = data.metadata?.librarySectionID;
      const libraryTitle = data.metadata?.librarySectionTitle;

      let childrenUrl = null;
      let parentInfo = null;

      if (parentKey) {
        // Has a parent container - fetch parent info and its children
        childrenUrl = `/api/v1/item/${source}/${parentKey}`;

        // Fetch parent details for the header
        const parentResponse = await fetch(`/api/v1/content/item/${source}/${parentKey}`);
        if (parentResponse.ok) {
          const parentData = await parentResponse.json();
          parentInfo = {
            id: `${source}:${parentKey}`,
            title: parentData.title || data.metadata?.parentTitle,
            source,
            thumbnail: parentData.thumbnail,
            parentKey: parentData.metadata?.parentRatingKey || null,
            libraryId
          };
        }
      } else if (libraryId) {
        // Top-level item - show library as parent
        childrenUrl = `/api/v1/item/${source}/library/sections/${libraryId}/all`;
        parentInfo = {
          id: `library:${libraryId}`,
          title: libraryTitle || 'Library',
          source,
          thumbnail: null,
          parentKey: null,
          libraryId
        };
      } else if (['watchlist', 'query', 'menu', 'program'].includes(source)) {
        // List-based items - siblings are other lists of same type
        childrenUrl = `/api/v1/item/list/${source}:`;
        parentInfo = {
          id: `${source}:`,
          title: source.charAt(0).toUpperCase() + source.slice(1) + 's',
          source: 'list',
          thumbnail: null,
          parentKey: null,
          libraryId: null
        };
      } else if (source === 'freshvideo') {
        // Freshvideo channels - siblings are other channels in video/news
        childrenUrl = `/api/v1/item/filesystem/video/news`;
        parentInfo = {
          id: 'filesystem:video/news',
          title: 'Fresh Video Channels',
          source: 'filesystem',
          thumbnail: null,
          parentKey: null,
          libraryId: null
        };
      } else if (source === 'talk' || source === 'local-content') {
        // Talk series - siblings are other talk series
        childrenUrl = `/api/v1/item/local-content/talk:`;
        parentInfo = {
          id: 'talk:',
          title: 'Talk Series',
          source: 'local-content',
          thumbnail: null,
          parentKey: null,
          libraryId: null
        };
      } else if (localId.includes('/')) {
        // Path-based item (e.g., media:sfx/intro) - use parent path as container
        const parts = localId.split('/');
        const parentPath = parts.slice(0, -1).join('/');
        const parentTitle = parts[parts.length - 2] || parentPath;
        childrenUrl = `/api/v1/item/${source}/${parentPath}`;
        parentInfo = {
          id: `${source}:${parentPath}`,
          title: parentTitle,
          source,
          thumbnail: null,
          parentKey: null,
          libraryId: null
        };
      }

      setCurrentParent(parentInfo);

      if (!childrenUrl) return;

      const childrenResponse = await fetch(childrenUrl);
      if (!childrenResponse.ok) return;

      const childrenData = await childrenResponse.json();
      const childItems = childrenData.items || [];
      const siblings = childItems.map(item => {
        // Extract source from item or from compound ID (e.g., "filesystem:media:path" or "plex:123")
        const itemSource = item.source || item.id?.split(':')[0];
        return {
        value: item.id || `${itemSource}:${item.localId}`,
        title: item.title,
        source: itemSource,
        type: item.metadata?.type || item.type || item.itemType,
        thumbnail: item.thumbnail,
        grandparent: item.metadata?.grandparentTitle,
        parent: item.metadata?.parentTitle,
        library: item.metadata?.librarySectionTitle,
        itemCount: item.metadata?.childCount ?? item.metadata?.leafCount ?? item.childCount ?? null,
        isContainer: isContainerItem(item)
      };});
      setBrowseItems(siblings);

      // Find and highlight current item
      const normalizedVal = value?.replace(/:\s+/g, ':');
      const currentIndex = siblings.findIndex(s => s.value === normalizedVal);
      setHighlightedIdx(currentIndex >= 0 ? currentIndex : 0);

      // Scroll to current item after render
      setTimeout(() => {
        if (optionsRef.current) {
          const currentOption = optionsRef.current.querySelector(`[data-value="${normalizedVal}"]`);
          if (currentOption) {
            currentOption.scrollIntoView({ block: 'center' });
          }
        }
      }, 50);
    } catch (err) {
      console.error('Failed to fetch siblings:', err);
    } finally {
      setLoadingBrowse(false);
    }
  };

  const handleStartEditing = () => {
    setIsEditing(true);
    combobox.openDropdown();
    fetchSiblings();
  };

  const handleBlur = () => {
    // Delay to allow click events on dropdown to fire first
    setTimeout(() => {
      combobox.closeDropdown();
      setSearchQuery('');
      setIsEditing(false);
      setBrowseItems([]);
      setNavStack([]);
      setCurrentParent(null);
      setHighlightedIdx(-1);
    }, 150);
  };

  // Normalize value for comparison (handle "plex: 123" vs "plex:123")
  const normalizeValue = (v) => v?.replace(/:\s+/g, ':');
  const normalizedValue = normalizeValue(value);

  // Use search results if searching, otherwise show browse items
  const displayItems = searchQuery.length >= 2 ? searchResults : browseItems;

  // Keyboard handler for navigation
  const handleKeyDown = async (e) => {
    const items = displayItems;
    if (items.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIdx(prev => Math.min(prev + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIdx(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      const item = items[highlightedIdx];
      if (item) {
        await drillDown(item);
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      await goUp();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = items[highlightedIdx];
      if (item) {
        handleOptionSelect(item.value);
      }
    }
  };

  // Scroll highlighted item into view only if it's outside the visible area
  // Uses minimal scrolling - just enough to bring the item into view
  useEffect(() => {
    if (highlightedIdx >= 0 && optionsRef.current) {
      const container = optionsRef.current;
      const options = container.querySelectorAll('[data-value]');
      const option = options[highlightedIdx];
      if (option) {
        // Calculate positions relative to the scroll container
        const optionTop = option.offsetTop;
        const optionBottom = optionTop + option.offsetHeight;
        const containerScrollTop = container.scrollTop;
        const containerVisibleBottom = containerScrollTop + container.clientHeight;

        // Only scroll the minimum amount needed
        if (optionTop < containerScrollTop) {
          // Option is above visible area - scroll up just enough
          container.scrollTop = optionTop;
        } else if (optionBottom > containerVisibleBottom) {
          // Option is below visible area - scroll down just enough
          container.scrollTop = optionBottom - container.clientHeight;
        }
        // Otherwise, option is fully visible - don't scroll at all
      }
    }
  }, [highlightedIdx]);

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
    // Loading state
    if (loadingInfo) {
      return (
        <Group gap="xs" onClick={handleStartEditing} className="content-display">
          <Loader size={16} />
          <Text size="xs" c="dimmed">{value || 'Loading...'}</Text>
        </Group>
      );
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
          <Avatar size={36} radius="sm" color="dark">
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

  // Editing mode - show combobox
  return (
    <Combobox
      store={combobox}
      onOptionSubmit={handleOptionSelect}
      withinPortal={true}
    >
      <Combobox.Target>
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
          onFocus={() => combobox.openDropdown()}
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
        {displayItems.length > 0 && !searchQuery && (
          <Box px="xs" py={2} style={{ borderBottom: '1px solid var(--mantine-color-dark-5)' }}>
            <Text size="xs" c="dimmed">
              ↑↓ navigate • ← back/up • → drill down • Enter select
            </Text>
          </Box>
        )}

        {/* Current parent header - shows what container we're browsing */}
        {currentParent && !searchQuery && (
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

        <Combobox.Options mah={280} style={{ overflowY: 'auto' }} ref={optionsRef}>
          {(searching || loadingBrowse) && displayItems.length === 0 && (
            <Combobox.Empty>{searching ? 'Searching...' : 'Loading...'}</Combobox.Empty>
          )}
          {!searching && !loadingBrowse && displayItems.length === 0 && searchQuery.length >= 2 && (
            <Combobox.Empty>No results found</Combobox.Empty>
          )}
          {!searching && !loadingBrowse && displayItems.length === 0 && searchQuery.length < 2 && navStack.length === 0 && (
            <Combobox.Empty>Type to search or wait for items</Combobox.Empty>
          )}
          {!searching && !loadingBrowse && displayItems.length === 0 && navStack.length > 0 && (
            <Combobox.Empty>No items in this container</Combobox.Empty>
          )}
          {options}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}

// Action colors for chips
const ACTION_COLORS = {
  Play: 'blue',
  Queue: 'green',
  List: 'violet',
  Display: 'cyan',
  Read: 'orange'
};

// Action chip select
function ActionChipSelect({ value, onChange }) {
  const combobox = useCombobox({
    onDropdownClose: () => combobox.resetSelectedOption(),
  });

  const currentValue = value || 'Play';
  const color = ACTION_COLORS[currentValue] || 'gray';

  return (
    <Combobox
      store={combobox}
      onOptionSubmit={(val) => {
        onChange(val);
        combobox.closeDropdown();
      }}
      withinPortal={true}
    >
      <Combobox.Target>
        <Badge
          size="sm"
          variant="light"
          color={color}
          style={{ cursor: 'pointer' }}
          onClick={() => combobox.toggleDropdown()}
        >
          {currentValue}
        </Badge>
      </Combobox.Target>

      <Combobox.Dropdown>
        <Combobox.Options>
          {ACTION_OPTIONS.map((opt) => (
            <Combobox.Option key={opt.value} value={opt.value}>
              <Badge size="sm" variant="light" color={ACTION_COLORS[opt.value] || 'gray'}>
                {opt.label}
              </Badge>
            </Combobox.Option>
          ))}
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
      const itemResponse = await fetch(`/api/v1/content/item/${source}/${localId}`);
      let info = null;
      if (itemResponse.ok) {
        info = await itemResponse.json();
        setItemInfo(info);
      }

      // Fetch children
      const childrenResponse = await fetch(`/api/v1/item/${source}/${localId}`);
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

function ListsItemRow({ item, onUpdate, onDelete, onToggleActive, onDuplicate, isWatchlist, onEdit }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.index
  });

  // Inline editing state
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelValue, setLabelValue] = useState(item.label || '');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const labelInputRef = useRef(null);

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
    <div ref={setNodeRef} style={style} className="item-row" data-testid={`item-row-${item.index}`}>
      <div className="col-active">
        <Checkbox
          checked={item.active !== false}
          onChange={onToggleActive}
          size="xs"
        />
      </div>

      <div className="col-drag drag-handle" {...attributes} {...listeners}>
        <IconGripVertical size={14} />
      </div>

      <div className="col-index">
        <Text size="xs" c="dimmed">{item.index + 1}</Text>
      </div>

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
