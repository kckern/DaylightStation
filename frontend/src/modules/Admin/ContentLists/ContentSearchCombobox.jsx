import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
import { getChildLogger } from '../../../lib/logging/singleton.js';
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
  const log = useMemo(() => getChildLogger({ component: 'ContentSearchCombobox' }), []);
  const [search, setSearch] = useState(null); // null = not editing (show value), string = user's input
  const [browseResults, setBrowseResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [breadcrumbs, setBreadcrumbs] = useState([]); // [{id, title, source, localId}]
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [pagination, setPagination] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const scrollViewportRef = useRef(null);

  // Log prop changes
  useEffect(() => {
    log.debug('props.value_changed', { value, selectContainers, searchParams });
  }, [value, selectContainers, searchParams]);

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
      log.debug('batch_search.skip', { text, reason: 'too_short' });
      setFallbackResults([]);
      return;
    }

    log.info('batch_search.start', { text });
    setFallbackLoading(true);
    try {
      const response = await fetch(`/api/v1/content/query/search?text=${encodeURIComponent(text)}&take=20${searchParams ? '&' + searchParams : ''}`);
      if (!response.ok) throw new Error('Search failed');
      const data = await response.json();
      log.info('batch_search.done', { text, resultCount: (data.items || []).length });
      setFallbackResults(data.items || []);
    } catch (err) {
      log.error('batch_search.error', { text, error: err.message });
      setFallbackResults([]);
    } finally {
      setFallbackLoading(false);
    }
  }, []);

  // Debounced search function
  const debouncedSearch = useDebouncedCallback((text) => {
    if (breadcrumbs.length > 0) {
      log.debug('search.skip_browsing', { text, breadcrumbDepth: breadcrumbs.length });
      return;
    }

    const mode = supportsSSE() ? 'sse' : 'batch';
    log.info('search.dispatch', { text, mode });
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
      log.debug('dropdown.close', { search, value, breadcrumbDepth: breadcrumbs.length, resultCount: results.length });
      combobox.resetSelectedOption();
    },
    onDropdownOpen: () => {
      log.debug('dropdown.open', { value, search, initialLoadDone, resultCount: results.length });
      // Initialize search with current value so user can see/edit it
      if (value && search === null) {
        log.debug('dropdown.open.init_search_from_value', { value });
        setSearch(value);
      }
      // When opening, if we have a value and haven't loaded siblings yet, browse to parent
      if (value && !initialLoadDone && results.length === 0) {
        log.info('dropdown.open.load_siblings', { value });
        loadSiblings(value);
      }
    }
  });

  // Load siblings of the current value (browse to parent folder)
  const loadSiblings = useCallback(async (inputValue) => {
    if (!inputValue) {
      log.debug('load_siblings.skip', { reason: 'no_input' });
      return;
    }

    // Parse source:localId format
    const colonIndex = inputValue.indexOf(':');
    if (colonIndex === -1) {
      log.debug('load_siblings.skip', { reason: 'no_colon', inputValue });
      return;
    }

    const source = normalizeListSource(inputValue.substring(0, colonIndex));
    const localId = inputValue.substring(colonIndex + 1);

    log.info('load_siblings.start', { inputValue, source, localId });
    setLoading(true);
    try {
      const url = `/api/v1/siblings/${source}/${encodeURIComponent(localId)}`;
      log.debug('load_siblings.fetch', { url });
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Browse failed: ${response.status}`);
      const data = await response.json();
      const itemCount = (data.items || []).length;
      log.info('load_siblings.done', { source, localId, itemCount, hasParent: !!data.parent?.id, parentId: data.parent?.id, pagination: data.pagination });
      setBrowseResults(data.items || []);
      setPagination(data.pagination || null);

      if (data.parent?.id) {
        const parentLocalId = data.parent.id.split(':').slice(1).join(':');
        const crumb = { id: data.parent.id, title: data.parent.title, source: data.parent.source || source, localId: parentLocalId };
        log.debug('load_siblings.set_breadcrumb', crumb);
        setBreadcrumbs([crumb]);
      } else {
        log.debug('load_siblings.no_parent', { source, localId });
        setBreadcrumbs([]);
      }

      // Scroll to reference item after render
      if (data.referenceIndex != null && data.referenceIndex >= 0) {
        requestAnimationFrame(() => {
          const viewport = scrollViewportRef.current;
          if (viewport) {
            const options = viewport.querySelectorAll('[data-combobox-option]');
            const refOption = options[data.referenceIndex];
            if (refOption) {
              refOption.scrollIntoView({ block: 'center' });
            }
          }
        });
      }
    } catch (err) {
      log.error('load_siblings.error', { inputValue, source, localId, error: err.message });
    } finally {
      setLoading(false);
      setInitialLoadDone(true);
    }
  }, []);

  // Load more siblings for infinite scroll pagination
  const loadMoreSiblings = useCallback(async (direction) => {
    if (!value || !pagination || loadingMore) return;

    const colonIndex = value.indexOf(':');
    if (colonIndex === -1) return;

    const source = normalizeListSource(value.substring(0, colonIndex));
    const localId = value.substring(colonIndex + 1);

    let offset, limit;
    if (direction === 'after') {
      if (!pagination.hasAfter) return;
      offset = pagination.offset + pagination.window;
      limit = 21;
    } else {
      if (!pagination.hasBefore) return;
      offset = Math.max(0, pagination.offset - 21);
      limit = Math.min(21, pagination.offset);
      if (limit <= 0) return;
    }

    log.info('load_more_siblings', { direction, offset, limit, source, localId });
    setLoadingMore(true);
    try {
      const url = `/api/v1/siblings/${source}/${encodeURIComponent(localId)}?offset=${offset}&limit=${limit}`;
      const response = await fetch(url);
      if (!response.ok) return;
      const data = await response.json();

      if (direction === 'after') {
        setBrowseResults(prev => [...prev, ...(data.items || [])]);
      } else {
        const viewport = scrollViewportRef.current;
        const prevScrollHeight = viewport?.scrollHeight || 0;

        setBrowseResults(prev => [...(data.items || []), ...prev]);

        // Maintain scroll position after prepending
        requestAnimationFrame(() => {
          if (viewport) {
            const newScrollHeight = viewport.scrollHeight;
            viewport.scrollTop += (newScrollHeight - prevScrollHeight);
          }
        });
      }

      // Update pagination to reflect expanded window
      setPagination(prev => {
        if (!prev) return data.pagination;
        const newOffset = direction === 'before' ? offset : prev.offset;
        const newWindow = prev.window + (data.items || []).length;
        return {
          ...prev,
          offset: newOffset,
          window: newWindow,
          hasBefore: newOffset > 0,
          hasAfter: newOffset + newWindow < prev.total
        };
      });
    } catch (err) {
      log.error('load_more_siblings.error', { direction, error: err.message });
    } finally {
      setLoadingMore(false);
    }
  }, [value, pagination, loadingMore]);

  // Reset editing state when value changes (including after commit)
  useEffect(() => {
    log.debug('value_changed.reset_initial_load', { value, prevInitialLoadDone: initialLoadDone });
    setInitialLoadDone(false);
    setSearch(null);
  }, [value]);

  // Browse into a container
  const browseContainer = useCallback(async (item) => {
    const source = normalizeListSource(item.source || item.id?.split(':')[0]);
    const localId = item.localId || item.id?.replace(`${source}:`, '');

    log.info('browse_container.start', {
      itemId: item.id, title: item.title, source, localId,
      type: item.type, isContainer: item.isContainer, itemType: item.itemType,
      prevBreadcrumbDepth: breadcrumbs.length
    });
    setLoading(true);
    try {
      const url = `/api/v1/list/${source}/${encodeURIComponent(localId)}`;
      log.debug('browse_container.fetch', { url });
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Browse failed: ${response.status}`);
      const data = await response.json();
      const itemCount = (data.items || []).length;
      const newCrumb = { id: item.id, title: item.title, source, localId };
      log.info('browse_container.done', { source, localId, itemCount, newCrumb });
      setBrowseResults(data.items || []);
      setBreadcrumbs(prev => [...prev, newCrumb]);
    } catch (err) {
      log.error('browse_container.error', { itemId: item.id, source, localId, error: err.message });
    } finally {
      setLoading(false);
    }
  }, [breadcrumbs.length]);

  // Go back in breadcrumbs
  const goBack = useCallback(async () => {
    log.info('go_back.start', {
      breadcrumbDepth: breadcrumbs.length,
      breadcrumbs: breadcrumbs.map(b => ({ id: b.id, title: b.title }))
    });

    if (breadcrumbs.length <= 1) {
      log.info('go_back.to_search_results', { reason: 'at_root_or_single_crumb' });
      setBreadcrumbs([]);
      setBrowseResults([]);
      return;
    }

    // Go to parent
    const newBreadcrumbs = breadcrumbs.slice(0, -1);
    const parent = newBreadcrumbs[newBreadcrumbs.length - 1];

    log.info('go_back.to_parent', { parentId: parent.id, parentTitle: parent.title, source: parent.source, localId: parent.localId, newDepth: newBreadcrumbs.length });
    setLoading(true);
    try {
      const url = `/api/v1/list/${parent.source}/${encodeURIComponent(parent.localId)}`;
      log.debug('go_back.fetch', { url });
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Browse failed: ${response.status}`);
      const data = await response.json();
      const itemCount = (data.items || []).length;
      log.info('go_back.done', { parentId: parent.id, itemCount, newDepth: newBreadcrumbs.length });
      setBrowseResults(data.items || []);
      setBreadcrumbs(newBreadcrumbs);
    } catch (err) {
      log.error('go_back.error', { parentId: parent.id, error: err.message });
    } finally {
      setLoading(false);
    }
  }, [breadcrumbs]);

  // Handle item click
  const handleItemClick = (item) => {
    const container = isContainer(item);
    log.info('item_click', {
      itemId: item.id, title: item.title, type: item.type,
      isContainer: container, selectContainers,
      action: (container && !selectContainers) ? 'browse_into' : 'select',
      breadcrumbDepth: breadcrumbs.length
    });

    if (container && !selectContainers) {
      browseContainer(item);
    } else {
      log.info('item_select', { itemId: item.id, title: item.title, prevValue: value });
      onChange(item.id, item);
      setSearch(null);
      setBreadcrumbs([]);
      setBrowseResults([]);
      combobox.closeDropdown();
    }
  };

  // Get display value for input
  // When editing (search !== null): show user's text
  // When not editing (search === null): show committed value
  const displayValue = search !== null ? search : (value || '');

  // Browse to parent folder
  const browseParent = useCallback(async (item) => {
    const source = normalizeListSource(item.source || item.id?.split(':')[0]);
    const localId = item.localId || item.id?.replace(`${source}:`, '');

    // Get parent path by removing the last segment
    const parts = localId.split('/');
    if (parts.length <= 1) {
      log.debug('browse_parent.skip', { reason: 'no_parent_path', itemId: item.id, localId });
      return;
    }

    const parentPath = parts.slice(0, -1).join('/');
    const parentTitle = item.metadata?.parentTitle || parts[parts.length - 2];

    log.info('browse_parent.start', {
      itemId: item.id, title: item.title, source, localId,
      parentPath, parentTitle, pathParts: parts
    });
    setLoading(true);
    try {
      const url = `/api/v1/list/${source}/${encodeURIComponent(parentPath)}`;
      log.debug('browse_parent.fetch', { url });
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Browse failed: ${response.status}`);
      const data = await response.json();
      const itemCount = (data.items || []).length;
      const crumb = { id: `${source}:${parentPath}`, title: parentTitle, source, localId: parentPath };
      log.info('browse_parent.done', { parentPath, itemCount, crumb });
      setBrowseResults(data.items || []);
      setBreadcrumbs([crumb]);
    } catch (err) {
      log.error('browse_parent.error', { itemId: item.id, parentPath, error: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  const renderOption = (item) => {
    const isContainerItem = isContainer(item);
    const source = item.source || item.id?.split(':')[0];
    const type = item.type || item.metadata?.type || item.mediaType;
    const parentTitle = item.metadata?.parentTitle;
    const hasParent = parentTitle && item.localId?.includes('/');
    const localId = item.localId || item.id?.replace(`${source}:`, '');
    const childCount = item.childCount ?? item.metadata?.childCount ?? null;
    const TypeIcon = TYPE_ICONS[type] || TYPE_ICONS.default;

    // Build subtitle: parentTitle if navigable, otherwise "Type: localId"
    const subtitleText = parentTitle || (
      type
        ? `${type.charAt(0).toUpperCase() + type.slice(1)}: ${localId}`
        : localId
    );

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
              <Group gap={4} wrap="nowrap">
                <Text size="sm" truncate fw={500}>{item.title}</Text>
                {childCount != null && <Badge size="xs" variant="filled" color="gray" style={{ flexShrink: 0 }}>{childCount}</Badge>}
              </Group>
              <Group gap={4} wrap="nowrap">
                <TypeIcon size={12} style={{ flexShrink: 0, opacity: 0.5 }} />
                <Text
                  size="xs"
                  c="dimmed"
                  truncate
                  onClick={hasParent ? (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    log.debug('parent_title.click', { itemId: item.id, parentTitle });
                    browseParent(item);
                  } : undefined}
                  style={hasParent ? { cursor: 'pointer', textDecoration: 'underline' } : undefined}
                >
                  {subtitleText}
                </Text>
              </Group>
            </Stack>
          </Group>
          <Group gap="xs" wrap="nowrap">
            <Badge size="xs" variant="light" color="gray">{source.toUpperCase()}</Badge>
            {isContainerItem && !selectContainers && (
              <IconChevronRight size={16} color="var(--mantine-color-dimmed)" />
            )}
          </Group>
        </Group>
      </Combobox.Option>
    );
  };

  // Group items by `group` field if present, otherwise render flat
  const options = useMemo(() => {
    const hasGroups = results.some(item => item.group);
    if (!hasGroups) return results.map(renderOption);

    const groups = [];
    const groupMap = new Map();
    for (const item of results) {
      const key = item.group || '';
      if (!groupMap.has(key)) {
        groupMap.set(key, []);
        groups.push(key);
      }
      groupMap.get(key).push(item);
    }

    return groups.map(groupLabel =>
      groupLabel ? (
        <Combobox.Group label={groupLabel} key={groupLabel}>
          {groupMap.get(groupLabel).map(renderOption)}
        </Combobox.Group>
      ) : (
        groupMap.get(groupLabel).map(renderOption)
      )
    );
  }, [results, selectContainers]);

  return (
    <Combobox
      store={combobox}
      onOptionSubmit={(val) => {
        const item = results.find(r => r.id === val);
        log.debug('option_submit', { val, found: !!item, title: item?.title });
        if (item) handleItemClick(item);
      }}
    >
      <Combobox.Target>
        <TextInput
          value={displayValue}
          onChange={(e) => {
            const newValue = e.target.value;
            log.debug('input.change', { newValue, prevSearch: search, breadcrumbDepth: breadcrumbs.length });
            setSearch(newValue);
            debouncedSearch(newValue);
            combobox.openDropdown();
            combobox.updateSelectedOptionIndex();
          }}
          onClick={() => {
            log.debug('input.click');
            combobox.openDropdown();
          }}
          onFocus={() => {
            log.debug('input.focus', { value, search });
            combobox.openDropdown();
          }}
          onBlur={() => {
            log.debug('input.blur', { search, value, willCommitFreeform: !!(search && search !== value) });
            // Commit freeform text if user typed something different from current value
            if (search && search !== value) {
              log.info('freeform.commit_on_blur', { freeformValue: search, prevValue: value });
              onChange(search);
              // Don't clear search here — let useEffect on [value] handle it
              // after parent updates, to avoid display flash
            }
            combobox.closeDropdown();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && search && search !== value) {
              const idx = combobox.getSelectedOptionIndex();
              log.debug('input.enter', { search, value, selectedOptionIndex: idx, resultCount: results.length });
              // Commit freeform text on Enter when no dropdown option is highlighted
              if (idx === -1 || results.length === 0) {
                log.info('freeform.commit_on_enter', { freeformValue: search, prevValue: value });
                e.preventDefault();
                onChange(search);
                // Don't clear search — useEffect on [value] resets it after parent updates
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
                  log.debug('back_button.click', { breadcrumbDepth: breadcrumbs.length });
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
          <ScrollArea.Autosize
            mah={300}
            viewportRef={scrollViewportRef}
            onScrollPositionChange={({ y }) => {
              if (!pagination || loadingMore || breadcrumbs.length === 0) return;
              const viewport = scrollViewportRef.current;
              if (!viewport) return;
              const { scrollHeight, clientHeight } = viewport;
              // Near bottom — load more after
              if (pagination.hasAfter && scrollHeight - y - clientHeight < 50) {
                loadMoreSiblings('after');
              }
              // Near top — load more before
              if (pagination.hasBefore && y < 50) {
                loadMoreSiblings('before');
              }
            }}
          >
            {loadingMore && pagination?.hasBefore && (
              <Group justify="center" py={4}>
                <Loader size="xs" />
              </Group>
            )}
            {isLoading && results.length === 0 ? (
              <Combobox.Empty>
                <Group justify="center" p="md">
                  <Loader size="sm" />
                  <Text size="sm" c="dimmed">Searching...</Text>
                </Group>
              </Combobox.Empty>
            ) : results.length === 0 ? (
              <Combobox.Empty>
                {(!search || search.length < 2) ? 'Type to search...' : 'No results — press Enter to use as-is'}
              </Combobox.Empty>
            ) : (
              options
            )}
            {loadingMore && pagination?.hasAfter && (
              <Group justify="center" py={4}>
                <Loader size="xs" />
              </Group>
            )}
          </ScrollArea.Autosize>
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}

export default ContentSearchCombobox;
