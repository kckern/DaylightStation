import React, { useState, useEffect, useCallback } from 'react';
import {
  Combobox, TextInput, ScrollArea, Group, Text, Avatar, Badge, Loader,
  Stack, ActionIcon, Box, useCombobox
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import {
  IconSearch, IconChevronRight, IconArrowLeft, IconFolder,
  IconMusic, IconVideo, IconPhoto, IconFile, IconList
} from '@tabler/icons-react';

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

function getIcon(item) {
  const type = item.type || item.metadata?.type || item.mediaType;
  const Icon = TYPE_ICONS[type] || TYPE_ICONS.default;
  return <Icon size={16} />;
}

function isContainer(item) {
  return item.itemType === 'container' ||
    item.isContainer ||
    ['show', 'album', 'artist', 'folder', 'channel', 'series', 'conference', 'playlist'].includes(item.type);
}

/**
 * ContentSearchCombobox - Searchable combobox for selecting content items
 * Supports search and drilling down into containers
 */
function ContentSearchCombobox({ value, onChange, placeholder = 'Search content...' }) {
  const [search, setSearch] = useState('');
  const [debouncedSearch] = useDebouncedValue(search, 300);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [breadcrumbs, setBreadcrumbs] = useState([]); // [{id, title, source, localId}]

  const [initialLoadDone, setInitialLoadDone] = useState(false);

  const combobox = useCombobox({
    onDropdownClose: () => {
      combobox.resetSelectedOption();
    },
    onDropdownOpen: () => {
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

    const source = inputValue.substring(0, colonIndex);
    const localId = inputValue.substring(colonIndex + 1);

    // Get parent path
    const parts = localId.split('/');
    if (parts.length <= 1) {
      // No parent, try to list root
      setLoading(true);
      try {
        const response = await fetch(`/api/v1/list/${source}/`);
        if (response.ok) {
          const data = await response.json();
          setResults(data.items || []);
        }
      } catch (err) {
        console.error('Load siblings error:', err);
      } finally {
        setLoading(false);
        setInitialLoadDone(true);
      }
      return;
    }

    const parentPath = parts.slice(0, -1).join('/');
    const parentTitle = parts[parts.length - 2] || source;

    setLoading(true);
    try {
      const response = await fetch(`/api/v1/list/${source}/${encodeURIComponent(parentPath)}`);
      if (!response.ok) throw new Error('Browse failed');
      const data = await response.json();
      setResults(data.items || []);
      setBreadcrumbs([{ id: `${source}:${parentPath}`, title: parentTitle, source, localId: parentPath }]);
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

  // Search for content
  const doSearch = useCallback(async (text) => {
    if (!text || text.length < 2) {
      setResults([]);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/v1/content/query/search?text=${encodeURIComponent(text)}&take=20`);
      if (!response.ok) throw new Error('Search failed');
      const data = await response.json();
      setResults(data.items || []);
      setBreadcrumbs([]); // Clear breadcrumbs on new search
    } catch (err) {
      console.error('Search error:', err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Browse into a container
  const browseContainer = useCallback(async (item) => {
    const source = item.source || item.id?.split(':')[0];
    const localId = item.localId || item.id?.replace(`${source}:`, '');

    setLoading(true);
    try {
      const response = await fetch(`/api/v1/list/${source}/${encodeURIComponent(localId)}`);
      if (!response.ok) throw new Error('Browse failed');
      const data = await response.json();
      setResults(data.items || []);
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
      // Back to search results
      setBreadcrumbs([]);
      if (debouncedSearch) {
        doSearch(debouncedSearch);
      } else {
        setResults([]);
      }
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
      setResults(data.items || []);
      setBreadcrumbs(newBreadcrumbs);
    } catch (err) {
      console.error('Browse error:', err);
    } finally {
      setLoading(false);
    }
  }, [breadcrumbs, debouncedSearch, doSearch]);

  // Search when debounced value changes
  useEffect(() => {
    if (breadcrumbs.length === 0) {
      doSearch(debouncedSearch);
    }
  }, [debouncedSearch, breadcrumbs.length, doSearch]);

  // Handle item click
  const handleItemClick = (item) => {
    if (isContainer(item)) {
      browseContainer(item);
    } else {
      // Select the item
      onChange(item.id);
      setSearch('');
      setBreadcrumbs([]);
      combobox.closeDropdown();
    }
  };

  // Get display value for input
  const displayValue = combobox.dropdownOpened ? search : (value || '');

  // Browse to parent folder
  const browseParent = useCallback(async (item) => {
    const source = item.source || item.id?.split(':')[0];
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
      setResults(data.items || []);
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
            {isContainerItem && (
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
            setSearch(e.target.value);
            combobox.openDropdown();
            combobox.updateSelectedOptionIndex();
          }}
          onClick={() => combobox.openDropdown()}
          onFocus={() => combobox.openDropdown()}
          onBlur={() => combobox.closeDropdown()}
          placeholder={placeholder}
          leftSection={<IconSearch size={16} />}
          rightSection={loading ? <Loader size="xs" /> : null}
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

        <Combobox.Options>
          <ScrollArea.Autosize mah={300}>
            {loading && results.length === 0 ? (
              <Combobox.Empty>
                <Group justify="center" p="md">
                  <Loader size="sm" />
                  <Text size="sm" c="dimmed">Searching...</Text>
                </Group>
              </Combobox.Empty>
            ) : results.length === 0 ? (
              <Combobox.Empty>
                {debouncedSearch.length < 2 ? 'Type to search...' : 'No results found'}
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
