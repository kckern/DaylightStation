import React, { useState, useEffect, useCallback } from 'react';
import {
  Combobox, TextInput, ScrollArea, Group, Text, Avatar, Badge, Loader,
  Stack, ActionIcon, Box, useCombobox
} from '@mantine/core';
import { useDebouncedCallback } from '@mantine/hooks';
import {
  IconSearch, IconChevronRight, IconArrowLeft, IconFolder,
  IconMusic, IconVideo, IconPhoto, IconFile, IconList
} from '@tabler/icons-react';
import { useStreamingSearch } from '../../../hooks/useStreamingSearch';
import './ContentSearchCombobox.scss';

const TYPE_ICONS = {
  show: IconVideo,
  movie: IconVideo,
  episode: IconVideo,
  video: IconVideo,
  track: IconMusic,
  album: IconMusic,
  artist: IconMusic,
  audio: IconMusic,
  photo: IconPhoto,
  image: IconPhoto,
  folder: IconFolder,
  channel: IconList,
  series: IconFolder,
  conference: IconFolder,
  playlist: IconList,
  default: IconFile
};

const SOURCE_ICONS = {
  plex: '\uD83C\uDFAC',
  immich: '\uD83D\uDCF7',
  audiobookshelf: '\uD83D\uDCDA',
  singalong: '\uD83C\uDFB5',
  media: '\uD83D\uDCC1',
  default: '\uD83D\uDD0D'
};

/**
 * Check if browser supports Server-Sent Events
 */
function supportsSSE() {
  return typeof EventSource !== 'undefined';
}

function getIcon(item) {
  const type = item.type || item.metadata?.type || item.mediaType;
  const Icon = TYPE_ICONS[type] || TYPE_ICONS.default;
  return <Icon size={16} />;
}

function isContainer(item) {
  return item.itemType === 'container' ||
    item.isContainer ||
    ['show', 'album', 'artist', 'watchlist', 'channel', 'series', 'conference', 'playlist', 'container'].includes(item.type);
}

function normalizeListSource(source) {
  return source === 'list' ? 'menu' : source;
}

/**
 * ContentSearchCombobox - Searchable combobox for selecting content items
 * Supports search and drilling down into containers
 * Uses streaming search via SSE for progressive results
 */
function ContentSearchCombobox({ value, onChange, placeholder = 'Search content...', selectContainers = false, searchParams = '' }) {
  const [search, setSearch] = useState('');
  const [browseResults, setBrowseResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [breadcrumbs, setBreadcrumbs] = useState([]); // [{id, title, source, localId}]
  const [initialLoadDone, setInitialLoadDone] = useState(false);

  // Streaming search hook for SSE-enabled browsers
  const {
    results: streamResults,
    pending: pendingSources,
    isSearching: streamLoading,
    search: streamSearch
  } = useStreamingSearch('/api/v1/content/query/search/stream', searchParams);

  // Fallback batch search state for non-SSE browsers
  const [fallbackResults, setFallbackResults] = useState([]);
  const [fallbackLoading, setFallbackLoading] = useState(false);

  // Batch search fallback for browsers without SSE
  const doBatchSearch = useCallback(async (text) => {
    if (!text || text.length < 2) {
      setFallbackResults([]);
      return;
    }

    setFallbackLoading(true);
    try {
      const response = await fetch(`/api/v1/content/query/search?text=${encodeURIComponent(text)}&take=20${searchParams ? '&' + searchParams : ''}`);
      if (!response.ok) throw new Error('Search failed');
      const data = await response.json();
      setFallbackResults(data.items || []);
    } catch (err) {
      console.error('Search error:', err);
      setFallbackResults([]);
    } finally {
      setFallbackLoading(false);
    }
  }, []);

  // Debounced search function
  const debouncedSearch = useDebouncedCallback((text) => {
    if (breadcrumbs.length > 0) return; // Don't search while browsing

    if (supportsSSE()) {
      streamSearch(text);
    } else {
      doBatchSearch(text);
    }
  }, 300);

  // Determine which results to display
  const results = breadcrumbs.length > 0
    ? browseResults
    : supportsSSE()
      ? streamResults
      : fallbackResults;

  // Determine loading state
  const isLoading = loading || streamLoading || fallbackLoading;

  const combobox = useCombobox({
    onDropdownClose: () => {
      combobox.resetSelectedOption();
    },
    onDropdownOpen: () => {
      // Initialize search with current value so user can see/edit it
      if (value && !search) {
        setSearch(value);
      }
      // When opening, if we have a value and haven't loaded siblings yet, browse to parent
      if (value && !initialLoadDone && results.length === 0) {
        loadSiblings(value);
      }
    }
  });

  // Load siblings of the current value (browse to parent folder)
  const loadSiblings = useCallback(async (inputValue) => {
    if (!inputValue) return;

    // Parse source:localId format
    const colonIndex = inputValue.indexOf(':');
    if (colonIndex === -1) return;

    const source = normalizeListSource(inputValue.substring(0, colonIndex));
    const localId = inputValue.substring(colonIndex + 1);

    setLoading(true);
    try {
      const response = await fetch(`/api/v1/siblings/${source}/${encodeURIComponent(localId)}`);
      if (!response.ok) throw new Error('Browse failed');
      const data = await response.json();
      setBrowseResults(data.items || []);

      if (data.parent?.id) {
        const parentLocalId = data.parent.id.split(':').slice(1).join(':');
        setBreadcrumbs([
          {
            id: data.parent.id,
            title: data.parent.title,
            source: data.parent.source || source,
            localId: parentLocalId
          }
        ]);
      } else {
        setBreadcrumbs([]);
      }
    } catch (err) {
      console.error('Load siblings error:', err);
    } finally {
      setLoading(false);
      setInitialLoadDone(true);
    }
  }, []);

  // Reset initial load state when value changes
  useEffect(() => {
    setInitialLoadDone(false);
  }, [value]);

  // Browse into a container
  const browseContainer = useCallback(async (item) => {
    const source = normalizeListSource(item.source || item.id?.split(':')[0]);
    const localId = item.localId || item.id?.replace(`${source}:`, '');

    setLoading(true);
    try {
      const response = await fetch(`/api/v1/list/${source}/${encodeURIComponent(localId)}`);
      if (!response.ok) throw new Error('Browse failed');
      const data = await response.json();
      setBrowseResults(data.items || []);
      setBreadcrumbs(prev => [...prev, { id: item.id, title: item.title, source, localId }]);
    } catch (err) {
      console.error('Browse error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Go back in breadcrumbs
  const goBack = useCallback(async () => {
    if (breadcrumbs.length <= 1) {
      // Back to search results - just clear breadcrumbs, streaming/fallback results will show
      setBreadcrumbs([]);
      setBrowseResults([]);
      return;
    }

    // Go to parent
    const newBreadcrumbs = breadcrumbs.slice(0, -1);
    const parent = newBreadcrumbs[newBreadcrumbs.length - 1];

    setLoading(true);
    try {
      const response = await fetch(`/api/v1/list/${parent.source}/${encodeURIComponent(parent.localId)}`);
      if (!response.ok) throw new Error('Browse failed');
      const data = await response.json();
      setBrowseResults(data.items || []);
      setBreadcrumbs(newBreadcrumbs);
    } catch (err) {
      console.error('Browse error:', err);
    } finally {
      setLoading(false);
    }
  }, [breadcrumbs]);

  // Handle item click
  const handleItemClick = (item) => {
    if (isContainer(item) && !selectContainers) {
      browseContainer(item);
    } else {
      // Select the item (or container when selectContainers is true)
      onChange(item.id, item);
      setSearch('');
      setBreadcrumbs([]);
      setBrowseResults([]);
      combobox.closeDropdown();
    }
  };

  // Get display value for input
  // When dropdown is open: show search term, falling back to value if search is empty
  // When dropdown is closed: show the selected value
  const displayValue = combobox.dropdownOpened ? (search || value || '') : (value || '');

  // Browse to parent folder
  const browseParent = useCallback(async (item) => {
    const source = normalizeListSource(item.source || item.id?.split(':')[0]);
    const localId = item.localId || item.id?.replace(`${source}:`, '');

    // Get parent path by removing the last segment
    const parts = localId.split('/');
    if (parts.length <= 1) return; // No parent to browse

    const parentPath = parts.slice(0, -1).join('/');
    const parentTitle = item.metadata?.parentTitle || parts[parts.length - 2];

    setLoading(true);
    try {
      const response = await fetch(`/api/v1/list/${source}/${encodeURIComponent(parentPath)}`);
      if (!response.ok) throw new Error('Browse failed');
      const data = await response.json();
      setBrowseResults(data.items || []);
      setBreadcrumbs([{ id: `${source}:${parentPath}`, title: parentTitle, source, localId: parentPath }]);
    } catch (err) {
      console.error('Browse parent error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const options = results.map((item) => {
    const isContainerItem = isContainer(item);
    const source = item.source || item.id?.split(':')[0];
    const type = item.type || item.metadata?.type || item.mediaType;
    const parentTitle = item.metadata?.parentTitle;
    const hasParent = parentTitle && item.localId?.includes('/');

    return (
      <Combobox.Option
        key={item.id}
        value={item.id}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          handleItemClick(item);
        }}
      >
        <Group gap="sm" wrap="nowrap" justify="space-between">
          <Group gap="sm" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
            <Avatar size="sm" src={item.thumbnail || item.imageUrl} radius="sm">
              {getIcon(item)}
            </Avatar>
            <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
              <Text size="sm" truncate fw={500}>{item.title}</Text>
              {parentTitle && (
                <Text
                  size="xs"
                  c="dimmed"
                  truncate
                  onClick={hasParent ? (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    browseParent(item);
                  } : undefined}
                  style={hasParent ? { cursor: 'pointer', textDecoration: 'underline' } : undefined}
                >
                  {parentTitle}
                </Text>
              )}
            </Stack>
          </Group>
          <Group gap="xs" wrap="nowrap">
            <Badge size="xs" variant="light" color="gray">{source}</Badge>
            {type && <Badge size="xs" variant="outline" color="blue">{type}</Badge>}
            {isContainerItem && !selectContainers && (
              <IconChevronRight size={16} color="var(--mantine-color-dimmed)" />
            )}
          </Group>
        </Group>
      </Combobox.Option>
    );
  });

  return (
    <Combobox
      store={combobox}
      onOptionSubmit={(val) => {
        const item = results.find(r => r.id === val);
        if (item) handleItemClick(item);
      }}
    >
      <Combobox.Target>
        <TextInput
          value={displayValue}
          onChange={(e) => {
            const newValue = e.target.value;
            setSearch(newValue);
            debouncedSearch(newValue);
            combobox.openDropdown();
            combobox.updateSelectedOptionIndex();
          }}
          onClick={() => combobox.openDropdown()}
          onFocus={() => combobox.openDropdown()}
          onBlur={() => {
            // Commit freeform text if user typed something different from current value
            if (search && search !== value) {
              onChange(search);
            }
            combobox.closeDropdown();
          }}
          onKeyDown={(e) => {
            // Commit freeform text on Enter when no dropdown option is highlighted
            if (e.key === 'Enter' && search && search !== value) {
              const idx = combobox.getSelectedOptionIndex();
              if (idx === -1 || results.length === 0) {
                e.preventDefault();
                onChange(search);
                setSearch('');
                combobox.closeDropdown();
              }
            }
          }}
          placeholder={placeholder}
          leftSection={<IconSearch size={16} />}
          rightSection={isLoading ? <Loader size="xs" /> : null}
        />
      </Combobox.Target>

      <Combobox.Dropdown>
        {/* Breadcrumb navigation */}
        {breadcrumbs.length > 0 && (
          <Box p="xs" style={{ borderBottom: '1px solid var(--mantine-color-dark-4)' }}>
            <Group gap="xs">
              <ActionIcon
                size="sm"
                variant="subtle"
                onClick={(e) => {
                  e.stopPropagation();
                  goBack();
                }}
              >
                <IconArrowLeft size={14} />
              </ActionIcon>
              <Text size="xs" c="dimmed" truncate>
                {breadcrumbs.map(b => b.title).join(' / ')}
              </Text>
            </Group>
          </Box>
        )}

        {/* Pending sources indicator */}
        {pendingSources.length > 0 && breadcrumbs.length === 0 && (
          <Box p="xs" className="pending-sources" data-pending-sources style={{ borderBottom: '1px solid var(--mantine-color-dark-4)' }}>
            <Group gap="xs">
              <Loader size="xs" />
              <Text size="xs" c="dimmed">Searching:</Text>
              {pendingSources.map(source => (
                <Badge key={source} size="xs" variant="light" color="gray">
                  {SOURCE_ICONS[source] || SOURCE_ICONS.default} {source}
                </Badge>
              ))}
            </Group>
          </Box>
        )}

        <Combobox.Options>
          <ScrollArea.Autosize mah={300}>
            {isLoading && results.length === 0 ? (
              <Combobox.Empty>
                <Group justify="center" p="md">
                  <Loader size="sm" />
                  <Text size="sm" c="dimmed">Searching...</Text>
                </Group>
              </Combobox.Empty>
            ) : results.length === 0 ? (
              <Combobox.Empty>
                {search.length < 2 ? 'Type to search...' : 'No results — press Enter to use as-is'}
              </Combobox.Empty>
            ) : (
              options
            )}
          </ScrollArea.Autosize>
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}

export default ContentSearchCombobox;
