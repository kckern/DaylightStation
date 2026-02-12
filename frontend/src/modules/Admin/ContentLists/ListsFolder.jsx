import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Stack, Group, Title, TextInput, Center, Loader, Alert,
  ActionIcon, Menu, Text, Collapse, Button, Box
} from '@mantine/core';
import {
  IconSearch, IconArrowLeft, IconAlertCircle,
  IconTrash, IconDotsVertical, IconPlus, IconSettings
} from '@tabler/icons-react';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, arrayMove
} from '@dnd-kit/sortable';
import { useAdminLists } from '../../../hooks/admin/useAdminLists.js';
import ListsItemRow, { EmptyItemRow, preloadSiblings, fetchContentMetadata } from './ListsItemRow.jsx';
import SectionHeader from './SectionHeader.jsx';
import ListsItemEditor from './ListsItemEditor.jsx';
import { ListsContext } from './ListsContext.js';
import ListSettingsModal from './ListSettingsModal.jsx';
import SectionSettingsModal from './SectionSettingsModal.jsx';
import './ContentLists.scss';

// Type display names (singular)
const TYPE_LABELS = {
  menus: 'Menu',
  watchlists: 'Watchlist',
  programs: 'Program'
};

function ListsFolder() {
  const { type, name: listName } = useParams();
  const navigate = useNavigate();
  const {
    sections, flatItems, loading, error, listMetadata,
    fetchList, addItem, updateItem, deleteItem, reorderItems, toggleItemActive,
    deleteList, updateListSettings, addSection, updateSection, deleteSection, reorderSections, moveItem, splitSection
  } = useAdminLists();

  const [searchQuery, setSearchQuery] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sectionSettingsOpen, setSectionSettingsOpen] = useState(null);
  const [collapsedSections, setCollapsedSections] = useState(new Set());
  const toggleCollapse = (si) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      next.has(si) ? next.delete(si) : next.add(si);
      return next;
    });
  };

  // Content info cache for preloading
  const [contentInfoMap, setContentInfoMap] = useState(new Map());

  const setContentInfo = useCallback((itemId, info) => {
    setContentInfoMap(prev => {
      const next = new Map(prev);
      next.set(itemId, info);
      return next;
    });
  }, []);

  const getNearbyItems = useCallback((index, radius = 2) => {
    const start = Math.max(0, index - radius);
    const end = Math.min(flatItems.length - 1, index + radius);
    return flatItems.slice(start, end + 1).map((item, i) => ({
      ...item,
      index: start + i,
      contentInfo: contentInfoMap.get(item.input)
    }));
  }, [flatItems, contentInfoMap]);

  // Preload first 10 rows on mount
  useEffect(() => {
    const first10 = flatItems.slice(0, 10);
    first10.forEach(item => {
      if (item.input && !contentInfoMap.has(item.input)) {
        fetchContentMetadata(item.input).then(info => {
          if (info && !info.unresolved) {
            setContentInfo(item.input, info);
            preloadSiblings(item.input, info);
          }
        });
      }
    });
  }, [flatItems]); // Only run when flatItems change

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor)
  );

  useEffect(() => {
    if (type && listName) {
      fetchList(type, listName);
    }
  }, [type, listName, fetchList]);

  // Filter items by search query
  const filteredItems = useMemo(() => {
    if (!searchQuery) return null;
    const query = searchQuery.toLowerCase();
    return flatItems.filter(item =>
      item.title?.toLowerCase().includes(query) ||
      item.label?.toLowerCase().includes(query)
    );
  }, [flatItems, searchQuery]);

  const handleDragEnd = async (event, sectionIndex) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const sectionItems = sections[sectionIndex]?.items || [];
    const oldIndex = parseInt(String(active.id).split('-')[1]);
    const newIndex = parseInt(String(over.id).split('-')[1]);
    const reordered = arrayMove(sectionItems, oldIndex, newIndex);
    await reorderItems(sectionIndex, reordered);
  };

  const handleAddItem = () => {
    setEditingItem(null);
    setEditorOpen(true);
  };

  const handleEditItem = (item) => {
    setEditingItem(item);
    setEditorOpen(true);
  };

  const handleSaveItem = async (itemData) => {
    if (editingItem) {
      const oldSection = editingItem.sectionIndex ?? 0;
      const newSection = itemData.sectionIndex ?? oldSection;
      const { sectionIndex, ...cleanData } = itemData;

      if (newSection !== oldSection) {
        await moveItem(
          { section: oldSection, index: editingItem.itemIndex },
          { section: newSection, index: 0 }
        );
        await updateItem(newSection, 0, cleanData);
      } else {
        await updateItem(oldSection, editingItem.itemIndex, cleanData);
      }
    } else {
      const { sectionIndex, ...cleanData } = itemData;
      await addItem(sectionIndex ?? 0, cleanData);
    }
    setEditorOpen(false);
    setEditingItem(null);
  };

  const handleMoveSection = async (fromIndex, direction) => {
    const newOrder = sections.map((_, i) => i);
    const toIndex = fromIndex + direction;
    if (toIndex < 0 || toIndex >= sections.length) return;
    [newOrder[fromIndex], newOrder[toIndex]] = [newOrder[toIndex], newOrder[fromIndex]];
    await reorderSections(newOrder);
  };

  const handleDeleteList = async () => {
    const typeLabel = TYPE_LABELS[type] || type;
    if (window.confirm(`Delete ${typeLabel.toLowerCase()} "${listName}"? This cannot be undone.`)) {
      await deleteList(type, listName);
      navigate(`/admin/content/lists/${type}`);
    }
  };

  // Set of image paths currently assigned to items in this list
  const inUseImages = useMemo(() => {
    return new Set(flatItems.filter(i => i.image).map(i => i.image));
  }, [flatItems]);

  // Context value must be defined before any early returns (React hooks rules)
  const contextValue = useMemo(() => ({
    sections,
    flatItems,
    contentInfoMap,
    setContentInfo,
    getNearbyItems,
    inUseImages,
  }), [sections, flatItems, contentInfoMap, setContentInfo, getNearbyItems, inUseImages]);

  if (loading && sections.length === 0) {
    return (
      <Center h="60vh">
        <Loader size="lg" />
      </Center>
    );
  }

  const listTitle = listName.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const typeLabel = TYPE_LABELS[type] || type;
  const handleInlineUpdate = async (sectionIndex, itemIndex, updates) => {
    await updateItem(sectionIndex, itemIndex, updates);
  };

  const handleDuplicateItem = async (sectionIndex, item) => {
    const newItem = {
      ...item,
      title: `${item.title || item.label} (copy)`,
    };
    delete newItem.sectionIndex;
    delete newItem.itemIndex;
    delete newItem.sectionTitle;
    await addItem(sectionIndex, newItem);
  };

  const renderItems = (itemsToRender, sectionIndex) => (
    <Box className="items-container">
      <SortableContext
        items={itemsToRender.map((_, i) => `${sectionIndex}-${i}`)}
        strategy={verticalListSortingStrategy}
      >
        {itemsToRender.map((item, idx) => (
          <ListsItemRow
            key={item.uid || `${sectionIndex}-${idx}`}
            item={{ ...item, index: idx }}
            onUpdate={(updates) => handleInlineUpdate(sectionIndex, idx, updates)}
            onDelete={() => deleteItem(sectionIndex, idx)}
            onToggleActive={() => toggleItemActive(sectionIndex, idx)}
            onDuplicate={() => handleDuplicateItem(sectionIndex, item)}
            isWatchlist={type === 'watchlists'}
            onEdit={() => { setEditingItem({ ...item, sectionIndex, itemIndex: idx }); setEditorOpen(true); }}
            onSplit={idx < itemsToRender.length - 1 ? () => splitSection(sectionIndex, idx) : undefined}
          />
        ))}
      </SortableContext>
      <EmptyItemRow onAdd={handleAddItem} nextIndex={itemsToRender.length} isWatchlist={type === 'watchlists'} />
    </Box>
  );

  return (
    <ListsContext.Provider value={contextValue}>
      <Stack gap="xs" className="lists-view">
      <Group justify="space-between" className="ds-page-header" style={{ marginBottom: 0 }}>
        <Group>
          <ActionIcon variant="subtle" onClick={() => navigate(`/admin/content/lists/${type}`)}>
            <IconArrowLeft size={20} />
          </ActionIcon>
          <span className="ds-page-title">{listTitle}</span>
        </Group>
        <Group>
          <TextInput
            placeholder="Search items..."
            leftSection={<IconSearch size={16} />}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="lists-folder-search"
          />
          <Menu position="bottom-end">
            <Menu.Target>
              <ActionIcon variant="subtle" data-testid="list-menu-button">
                <IconDotsVertical size={20} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                leftSection={<IconSettings size={16} />}
                onClick={() => setSettingsOpen(true)}
              >
                {typeLabel} Settings
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item
                color="red"
                leftSection={<IconTrash size={16} />}
                onClick={handleDeleteList}
              >
                Delete {typeLabel}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>

      {error && (
        <Alert icon={<IconAlertCircle size={16} />} color="red" title="Error">
          {error.message || 'Failed to load items'}
        </Alert>
      )}

      {/* Table header */}
      {flatItems.length > 0 && (
        <div className="table-header">
          <div className="col-active"></div>
          <div className="col-drag"></div>
          <div className="col-index"><Text size="xs" fw={600} c="dimmed">#</Text></div>
          <div className="col-icon"></div>
          <div className="col-label"><Text size="xs" fw={600} c="dimmed">Label</Text></div>
          <div className="col-action"><Text size="xs" fw={600} c="dimmed">Action</Text></div>
          <div className="col-preview"></div>
          <div className="col-input"><Text size="xs" fw={600} c="dimmed">Input</Text></div>
          {type === 'watchlists' && (
            <div className="col-progress"><Text size="xs" fw={600} c="dimmed">Progress</Text></div>
          )}
          <div className="col-config"><Text size="xs" fw={600} c="dimmed">Config</Text></div>
          <div className="col-menu"></div>
        </div>
      )}

      <div className="sections-scroll">
        {filteredItems ? (
          // Search mode — flat list
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => handleDragEnd(e, 0)}>
            {renderItems(filteredItems, 0)}
          </DndContext>
        ) : (
          // Normal mode — sections
          <Stack gap="md">
            {sections.map((section, si) => (
              <Box key={si} className="section-container">
                <SectionHeader
                  section={section}
                  sectionIndex={si}
                  collapsed={collapsedSections.has(si)}
                  onToggleCollapse={toggleCollapse}
                  onUpdate={(idx, updates) => updates ? updateSection(idx, updates) : setSectionSettingsOpen(idx)}
                  onDelete={deleteSection}
                  onMoveUp={(idx) => handleMoveSection(idx, -1)}
                  onMoveDown={(idx) => handleMoveSection(idx, 1)}
                  isFirst={si === 0}
                  isLast={si === sections.length - 1}
                  itemCount={section.items.length}
                />
                <Collapse in={!collapsedSections.has(si)}>
                  <DndContext sensors={sensors} collisionDetection={closestCenter}
                    onDragEnd={(e) => handleDragEnd(e, si)}>
                    {renderItems(section.items, si)}
                  </DndContext>
                </Collapse>
              </Box>
            ))}
            <Button variant="light" leftSection={<IconPlus size={16} />}
              onClick={() => addSection({ title: `Section ${sections.length + 1}` })}>
              Add Section
            </Button>
          </Stack>
        )}
      </div>

      {flatItems.length === 0 && !filteredItems && !loading && (
        <Center h="40vh">
          <Stack align="center">
            <IconSearch size={48} stroke={1} color="gray" />
            <Title order={4} c="dimmed">
              {searchQuery ? 'No matching items' : 'No items yet'}
            </Title>
          </Stack>
        </Center>
      )}

      <ListsItemEditor
        opened={editorOpen}
        onClose={() => { setEditorOpen(false); setEditingItem(null); }}
        onSave={handleSaveItem}
        item={editingItem}
        loading={loading}
        sections={sections}
      />

      <ListSettingsModal
        opened={settingsOpen === true}
        onClose={() => setSettingsOpen(false)}
        metadata={listMetadata}
        onSave={async (settings) => {
          await updateListSettings(settings);
          setSettingsOpen(false);
        }}
        loading={loading}
      />

      <SectionSettingsModal
        opened={sectionSettingsOpen !== null}
        onClose={() => setSectionSettingsOpen(null)}
        section={sectionSettingsOpen !== null ? sections[sectionSettingsOpen] : null}
        sectionIndex={sectionSettingsOpen}
        onSave={async (idx, updates) => {
          await updateSection(idx, updates);
          setSectionSettingsOpen(null);
        }}
        loading={loading}
      />
      </Stack>
    </ListsContext.Provider>
  );
}

export default ListsFolder;
