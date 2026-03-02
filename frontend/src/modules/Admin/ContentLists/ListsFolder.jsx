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
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragOverlay
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, arrayMove
} from '@dnd-kit/sortable';
import { useAdminLists } from '../../../hooks/admin/useAdminLists.js';
import { getChildLogger } from '../../../lib/logging/singleton.js';
import ListsItemRow, { EmptyItemRow, fetchContentMetadata } from './ListsItemRow.jsx';
import { swapContentPayloads } from './listConstants.js';

let _log;
function dndLog() {
  if (!_log) _log = getChildLogger({ app: 'admin', sessionLog: true }).child({ component: 'ListsDnd' });
  return _log;
}
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

/**
 * Custom collision detection that filters targets based on active drag type.
 * Row drags (id starts with 'row-') collide with sortable items.
 * Content drags (id starts with 'content-') collide only with content drop zones.
 */
function dualCollisionDetection(args) {
  const activeId = String(args.active.id);
  if (activeId.startsWith('content-')) {
    const filtered = args.droppableContainers.filter(
      c => String(c.id).startsWith('content-') && c.id !== args.active.id
    );
    const result = closestCenter({ ...args, droppableContainers: filtered });
    if (result.length > 0) {
      const top = result[0];
      const rect = args.droppableRects?.get(top.id);
      if (rect && rect.width === 0 && rect.height === 0) {
        dndLog().warn('collision.zero-rect', { targetId: top.id, activeId });
      }
    }
    return result;
  }
  return closestCenter(args);
}

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
  const [activeContentDrag, setActiveContentDrag] = useState(null); // { sectionIndex, itemIndex, item }
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

  // Preload content info for all items — single source of truth for children
  // Siblings preloading is deferred to row hover (ListsItemRow.handleRowHover)
  useEffect(() => {
    flatItems.forEach(item => {
      if (item.input && !contentInfoMap.has(item.input)) {
        fetchContentMetadata(item.input).then(info => {
          if (info) {
            setContentInfo(item.input, info);
          }
        });
      }
    });
  }, [flatItems]); // eslint-disable-line react-hooks/exhaustive-deps -- contentInfoMap intentionally omitted: re-running on every cache update would loop; setContentInfo is stable (useCallback)

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

  const handleDragEnd = async (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      dndLog().debug('drag.cancel', { activeId: String(active.id), reason: !over ? 'no_target' : 'same_item' });
      setActiveContentDrag(null);
      return;
    }

    const activeId = String(active.id);
    const overId = String(over.id);

    // Content swap
    if (activeId.startsWith('content-')) {
      if (!overId.startsWith('content-')) {
        dndLog().debug('drag.cancel', { activeId, overId, reason: 'invalid_target_type' });
        setActiveContentDrag(null);
        return;
      }
      const srcParts = activeId.replace('content-', '').split('-');
      const dstParts = overId.replace('content-', '').split('-');
      const [srcSi, srcIdx] = [Number(srcParts[0]), Number(srcParts[1])];
      const [dstSi, dstIdx] = [Number(dstParts[0]), Number(dstParts[1])];
      const srcItem = sections[srcSi]?.items?.[srcIdx];
      const dstItem = sections[dstSi]?.items?.[dstIdx];
      if (!srcItem || !dstItem) {
        dndLog().warn('content.swap.invalid', { srcSi, srcIdx, dstSi, dstIdx, reason: 'item_not_found' });
        setActiveContentDrag(null);
        return;
      }

      dndLog().info('content.swap', {
        src: { section: srcSi, index: srcIdx, input: srcItem.input },
        dst: { section: dstSi, index: dstIdx, input: dstItem.input },
      });
      const { updatesForA, updatesForB } = swapContentPayloads(srcItem, dstItem);
      try {
        await updateItem(dstSi, dstIdx, updatesForA);
        await updateItem(srcSi, srcIdx, updatesForB);
      } catch (err) {
        // updateItem refetches on success, so partial failure auto-corrects on next refetch
        dndLog().error('content.swap.failed', { srcSi, srcIdx, dstSi, dstIdx, error: err.message });
      }

      // Flash both rows
      requestAnimationFrame(() => {
        document.querySelectorAll('.item-row.swap-flash').forEach(el => el.classList.remove('swap-flash'));
        const allRows = document.querySelectorAll('[data-testid^="item-row-"]');
        allRows.forEach(row => {
          const testId = row.getAttribute('data-testid');
          if (testId === `item-row-${srcSi}-${srcIdx}` || testId === `item-row-${dstSi}-${dstIdx}`) {
            row.classList.add('swap-flash');
            row.addEventListener('animationend', () => row.classList.remove('swap-flash'), { once: true });
          }
        });
      });
      setActiveContentDrag(null);
      return;
    }

    // Row reorder
    if (activeId.startsWith('row-') && overId.startsWith('row-')) {
      const activeParts = activeId.replace('row-', '').split('-');
      const overParts = overId.replace('row-', '').split('-');
      const [activeSi, activeIdx] = [Number(activeParts[0]), Number(activeParts[1])];
      const [overSi, overIdx] = [Number(overParts[0]), Number(overParts[1])];
      // Only reorder within the same section
      if (activeSi !== overSi) {
        dndLog().debug('row.reorder.cancel', { activeSi, overSi, reason: 'cross_section' });
        return;
      }
      dndLog().info('row.reorder', { section: activeSi, from: activeIdx, to: overIdx });
      const sectionItems = sections[activeSi]?.items || [];
      const reordered = arrayMove(sectionItems, activeIdx, overIdx);
      await reorderItems(activeSi, reordered);
    }
  };

  const handleDragStart = (event) => {
    const activeId = String(event.active.id);
    if (activeId.startsWith('content-')) {
      const parts = activeId.replace('content-', '').split('-');
      const [si, idx] = [Number(parts[0]), Number(parts[1])];
      const item = sections[si]?.items?.[idx];
      if (item) {
        dndLog().info('drag.start', { type: 'content', section: si, index: idx, input: item.input });
        setActiveContentDrag({ sectionIndex: si, itemIndex: idx, item });
      }
    } else if (activeId.startsWith('row-')) {
      const parts = activeId.replace('row-', '').split('-');
      const [si, idx] = [Number(parts[0]), Number(parts[1])];
      dndLog().info('drag.start', { type: 'row', section: si, index: idx });
    }
  };

  const handleAddItem = async (itemData, sectionIndex = 0) => {
    if (itemData && itemData.input) {
      // Inline add from EmptyItemRow — directly add to list
      await addItem(sectionIndex, itemData);
      return;
    }
    // No data — open editor modal
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

  const handleMoveItem = async (sectionIndex, itemIndex, action, targetSection) => {
    const sectionItems = sections[sectionIndex]?.items || [];
    if (action === 'top') {
      const reordered = [...sectionItems];
      const [item] = reordered.splice(itemIndex, 1);
      reordered.unshift(item);
      await reorderItems(sectionIndex, reordered);
    } else if (action === 'bottom') {
      const reordered = [...sectionItems];
      const [item] = reordered.splice(itemIndex, 1);
      reordered.push(item);
      await reorderItems(sectionIndex, reordered);
    } else if (action === 'section') {
      const targetItems = sections[targetSection]?.items || [];
      await moveItem(
        { section: sectionIndex, index: itemIndex },
        { section: targetSection, index: targetItems.length }
      );
    } else if (action === 'new-section') {
      const newSectionIndex = sections.length;
      await addSection({ title: `Section ${newSectionIndex + 1}` });
      // After adding, move the item to the newly created section (last index)
      await moveItem(
        { section: sectionIndex, index: itemIndex },
        { section: newSectionIndex, index: 0 }
      );
    }
  };

  const renderItems = (itemsToRender, sectionIndex) => (
    <Box className="items-container">
      <SortableContext
        items={itemsToRender.map((_, i) => `row-${sectionIndex}-${i}`)}
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
            sectionIndex={sectionIndex}
            sectionCount={sections.length}
            sections={sections}
            itemCount={itemsToRender.length}
            onMoveItem={(action, targetSection) => handleMoveItem(sectionIndex, idx, action, targetSection)}
            activeContentDrag={activeContentDrag}
          />
        ))}
      </SortableContext>
      <EmptyItemRow onAdd={(data) => handleAddItem(data, sectionIndex)} nextIndex={itemsToRender.length} isWatchlist={type === 'watchlists'} />
    </Box>
  );

  return (
    <ListsContext.Provider value={contextValue}>
      <Stack gap="xs" className="lists-view">
      <Group justify="space-between" className="ds-page-header" style={{ marginBottom: 0 }}>
        <Group>
          <ActionIcon variant="subtle" onClick={() => navigate(-1)}>
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
          <div className="col-divider"></div>
          <div className="col-content-drag"></div>
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

      <DndContext
        sensors={sensors}
        collisionDetection={dualCollisionDetection}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="sections-scroll">
          {filteredItems ? (
            renderItems(filteredItems, 0)
          ) : (
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
                    {renderItems(section.items, si)}
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

        <DragOverlay dropAnimation={null}>
          {activeContentDrag && (() => {
            const { item } = activeContentDrag;
            const info = contentInfoMap.get(item.input);
            return (
              <div className="content-drag-overlay">
                <Text size="xs" fw={500} truncate style={{ maxWidth: 200 }}>
                  {info?.title || item.input || 'Content'}
                </Text>
                {info?.source && (
                  <Text size="xs" c="dimmed">{info.source.toUpperCase()}</Text>
                )}
              </div>
            );
          })()}
        </DragOverlay>
      </DndContext>

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
