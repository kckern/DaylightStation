import { UiIcon } from '../../../../frontend/src/lib/ui/UiIcon.jsx';
import React, { useEffect, useLayoutEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Stack, Group, Title, TextInput, Center, Loader, Alert,
  ActionIcon, Menu, Text, Collapse, Button, Box
} from '@mantine/core';
import {
  IconArrowLeft, IconAlertCircle,
  IconTrash, IconDotsVertical, IconPlus, IconSettings
} from '@tabler/icons-react';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragOverlay
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, arrayMove
} from '@dnd-kit/sortable';
import { useAdminLists } from "../../../../frontend/src/hooks/admin/useAdminLists.js";
import { getChildLogger } from "../../../../frontend/src/lib/logging/singleton.js";
import { runWithFeedback, showUndoToast } from "../../../../frontend/src/modules/Admin/shared/feedback.js";
import { ConfirmModal } from "../../../../frontend/src/lib/ui/ConfirmModal.jsx";
import ListsItemRow from "./ListsItemRow.jsx";
import { useRetryRegion } from '../../../../frontend/src/lib/ui/useRetryRegion.js';
import { ListReadError } from './ListReadError.jsx';
import { ActionMenu } from "../../../../frontend/src/lib/ui/ActionMenu.jsx";
import { EmptyItemRow } from "./EmptyItemRow.jsx";
import { useCatalogContentInfo } from './catalogContentInfo.js';
import { swapContentPayloads } from "./listConstants.js";

let _log;
function dndLog() {
  if (!_log) _log = getChildLogger({ app: 'admin', sessionLog: true }).child({ component: 'ListsDnd' });
  return _log;
}

let _mutLog;
function mutationLog() {
  if (!_mutLog) _mutLog = getChildLogger({ app: 'admin', sessionLog: true }).child({ component: 'ListsMutations' });
  return _mutLog;
}
import SectionHeader from "./SectionHeader.jsx";
import ListsItemEditor from "./ListsItemEditor.jsx";
import { ListsContext } from "./ListsContext.js";
import ListSettingsModal from "./ListSettingsModal.jsx";
import SectionSettingsModal from "./SectionSettingsModal.jsx";
import "./ContentLists.scss";

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
  return <FolderEditor key={JSON.stringify([type, listName])} type={type} listName={listName} />;
}

function ContentDragPreview({ value, pickedInfo }) {
  const info = useCatalogContentInfo(value, pickedInfo);
  return (
    <div className="content-drag-overlay">
      <Text size="xs" fw={500} truncate style={{ maxWidth: 200 }}>{info?.title || value || 'Content'}</Text>
      {info?.source && <Text size="xs" c="dimmed">{info.source.toUpperCase()}</Text>}
    </div>
  );
}

function FolderEditor({ type, listName }) {
  const navigate = useNavigate();
  const {
    sections, setSections, flatItems, reading, error, readError, canEditList, listMetadata,
    fetchList, addItem, updateItem, swapItems, deleteItem, reorderItems, toggleItemActive,
    deleteList, updateListSettings, addSection, updateSection, deleteSection, reorderSections, moveItem, splitSection
  } = useAdminLists(type, listName);

  const active = useRef(false);
  useLayoutEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const [swapFlash, setSwapFlash] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [deleteListOpen, setDeleteListOpen] = useState(false);
  const [deletingList, setDeletingList] = useState(false);

  const commands = useRef({ count: 0, structural: false });
  const [pending, setPending] = useState(commands.current);
  const loading = pending.count > 0 || reading;
  const setCommands = useCallback(next => {
    commands.current = next;
    setPending(next);
  }, []);

  // Independent field edits can overlap. Changes to row or section positions
  // need the last confirmed list until their command and refresh both finish.
  const mutate = useCallback(async (eventName, failureTitle, fn, {
    recover = false, refresh = true, fieldEdit = false,
  } = {}) => {
    const current = commands.current;
    if (!canEditList() || current.structural || (current.count && !fieldEdit)) return { ok: false };
    setCommands({ count: current.count + 1, structural: !fieldEdit });
    try {
      const result = await runWithFeedback(fn, {
        logger: mutationLog(), eventName, failureTitle, logContext: { type, list: listName },
      });
      // A failed snapshot has its own recovery and cannot undo an acknowledged write.
      if ((result.ok && refresh) || (!result.ok && recover)) {
        try {
          await fetchList(result.ok);
        } catch {
          if (result.ok) return { ...result, snapshotFailed: true };
        }
      }
      return result;
    } finally {
      setCommands({ count: commands.current.count - 1, structural: false });
    }
  }, [type, listName, canEditList, fetchList, setCommands]);

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
  // Search picks can paint immediately while the mounted row reads its descriptor.
  const [contentInfoMap, setContentInfoMap] = useState(new Map());

  const setContentInfo = useCallback((contentId, info) => {
    setContentInfoMap(prev => {
      const next = new Map(prev);
      next.set(contentId, info);
      return next;
    });
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor)
  );

  const loadFolder = useCallback(afterSave => {
    if (type && listName) {
      return fetchList(afterSave).catch(error => {
        const target = error?.body?.adminUrl;
        if (active.current && error?.body?.code === 'resource_moved' && typeof target === 'string'
          && /^\/admin\/content\/agendas\/[A-Za-z0-9_.-]+$/.test(target)) {
          navigate(target, { replace: true });
        }
      });
    }
  }, [type, listName, fetchList, navigate]);
  useEffect(() => { loadFolder(false); }, [loadFolder]);
  const retryRead = () => loadFolder(readError?.afterSave);
  const { regionProps, retry } = useRetryRegion(retryRead, reading);
  const settingsRead = { error: readError, loading: reading, retry: retryRead };

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
    if (!canEditList() || commands.current.count) {
      setActiveContentDrag(null);
      return;
    }
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

      // Optimistic local update: swap content fields immediately
      const { updatesForA, updatesForB } = swapContentPayloads(srcItem, dstItem);
      setSections(prev => {
        const next = prev.map(s => ({ ...s, items: [...s.items] }));
        next[dstSi].items[dstIdx] = { ...next[dstSi].items[dstIdx], ...updatesForA };
        next[srcSi].items[srcIdx] = { ...next[srcSi].items[srcIdx], ...updatesForB };
        return next;
      });

      const result = await mutate(
        'lists.swap',
        'Could not swap content — reloading the list',
        () => swapItems(srcSi, srcIdx, dstSi, dstIdx),
        { recover: true }
      );

      if (result.ok) {
        setSwapFlash(previous => ({
          sequence: (previous?.sequence ?? 0) + 1,
          rows: [srcItem.uid || activeId, dstItem.uid || overId],
        }));
      }
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
      await mutate('lists.reorder', 'Could not reorder rows — reloading the list',
        () => reorderItems(activeSi, reordered), { recover: true, refresh: false });
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
      await mutate('lists.add', 'Could not add item', () => addItem(sectionIndex, itemData));
      return;
    }
    // No data — open editor modal
    setEditingItem(null);
    setEditorOpen(true);
  };

  
  const handleSaveItem = async (itemData) => {
    const oldSection = editingItem?.sectionIndex ?? 0;
    const newSection = itemData.sectionIndex ?? oldSection;
    const moving = Boolean(editingItem && newSection !== oldSection);
    const res = await mutate('lists.save_item', 'Could not save item', async () => {
      if (editingItem) {
        const { sectionIndex: _sectionIndex, ...cleanData } = itemData;

        if (moving) {
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
    }, { recover: moving });
    // Keep the editor open on failure so the user can retry without losing input
    if (res.ok) {
      setEditorOpen(false);
      setEditingItem(null);
    }
  };

  const handleMoveSection = async (fromIndex, direction) => {
    const newOrder = sections.map((_, i) => i);
    const toIndex = fromIndex + direction;
    if (toIndex < 0 || toIndex >= sections.length) return;
    [newOrder[fromIndex], newOrder[toIndex]] = [newOrder[toIndex], newOrder[fromIndex]];
    await mutate('lists.reorder_sections', 'Could not reorder sections — reloading the list',
      () => reorderSections(newOrder), { recover: true });
  };

  const handleDeleteList = async () => {
    setDeletingList(true);
    const res = await mutate('lists.delete_list', 'Could not delete list', () => deleteList(type, listName), { refresh: false });
    if (!active.current) return;
    setDeletingList(false);
    if (res.ok) {
      setDeleteListOpen(false);
      navigate(`/admin/content/lists/${type}`);
    }
  };

  // Row delete: remove immediately, offer Undo (audit C4). Captures the item's
  // full payload + position so Undo can re-insert it where it was.
  const handleDeleteItem = async (sectionIndex, itemIndex) => {
    const removed = sections[sectionIndex]?.items?.[itemIndex];
    const preCount = sections[sectionIndex]?.items?.length ?? 0;
    const res = await mutate('lists.delete_item', 'Could not delete item', () => deleteItem(sectionIndex, itemIndex));
    if (!res.ok || !removed || !canEditList()) return;
    const { sectionIndex: _sectionIndex, itemIndex: _itemIndex, sectionTitle: _sectionTitle, index: _index, ...payload } = removed;
    showUndoToast({
      id: `undo-delete-${removed.uid || `${sectionIndex}-${itemIndex}`}`,
      title: 'Item deleted',
      message: `Removed “${removed.label || removed.title || removed.input}”`,
      onUndo: () => mutate('lists.delete_undo', 'Could not restore item', async () => {
        // addItem appends to the section end; after re-add the section holds
        // `preCount` items again, so the restored item sits at index preCount-1.
        await addItem(sectionIndex, payload);
        const landedIndex = preCount - 1;
        if (itemIndex < landedIndex) {
          await moveItem(
            { section: sectionIndex, index: landedIndex },
            { section: sectionIndex, index: itemIndex }
          );
        }
      }, { recover: true }),
    });
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
    inUseImages,
  }), [sections, flatItems, contentInfoMap, setContentInfo, inUseImages]);

  if (reading && !readError && !listMetadata) {
    return (
      <Center h="60vh">
        <Loader size="lg" />
      </Center>
    );
  }

  const listTitle = listName.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const typeLabel = TYPE_LABELS[type] || type;
  const handleInlineUpdate = async (sectionIndex, itemIndex, updates) => {
    await mutate('lists.update', 'Could not save change', () => updateItem(sectionIndex, itemIndex, updates), { fieldEdit: true });
  };

  const handleDuplicateItem = async (sectionIndex, item) => {
    const newItem = {
      ...item,
      title: `${item.title || item.label} (copy)`,
    };
    delete newItem.sectionIndex;
    delete newItem.itemIndex;
    delete newItem.sectionTitle;
    await mutate('lists.duplicate', 'Could not duplicate item', () => addItem(sectionIndex, newItem));
  };

  const handleMoveItem = async (sectionIndex, itemIndex, action, targetSection) => {
    const sectionItems = sections[sectionIndex]?.items || [];
    await mutate('lists.move_item', 'Could not move item — reloading the list', async () => {
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
        const { sectionIndex: newSectionIndex } = await addSection({ title: `Section ${sections.length + 1}` });
        await moveItem(
          { section: sectionIndex, index: itemIndex },
          { section: newSectionIndex, index: 0 }
        );
      }
    }, { recover: true, refresh: action !== 'top' && action !== 'bottom' });
  };

  const renderItems = (positions, addToSection) => (
    <Box className="items-container">
      <SortableContext
        items={positions.map(({ sectionIndex, itemIndex }) => `row-${sectionIndex}-${itemIndex}`)}
        strategy={verticalListSortingStrategy}
      >
        {positions.map(({ sectionIndex, itemIndex }) => {
          const sectionItems = sections[sectionIndex].items;
          const item = sectionItems[itemIndex];
          const split = itemIndex < sectionItems.length - 1
            ? () => mutate('lists.split', 'Could not split section', () => splitSection(sectionIndex, itemIndex))
            : undefined;
          return (
            <ListsItemRow
              key={item.uid || `${sectionIndex}-${itemIndex}`}
              item={{ ...item, index: itemIndex }}
              onUpdate={(updates) => handleInlineUpdate(sectionIndex, itemIndex, updates)}
              onDelete={() => handleDeleteItem(sectionIndex, itemIndex)}
              onToggleActive={() => mutate('lists.toggle_active', 'Could not toggle item', () => toggleItemActive(sectionIndex, itemIndex), { fieldEdit: true })}
              onDuplicate={() => handleDuplicateItem(sectionIndex, item)}
              isWatchlist={type === 'watchlists'}
              onEdit={() => { setEditingItem({ ...item, sectionIndex, itemIndex }); setEditorOpen(true); }}
              onSplit={split}
              sectionIndex={sectionIndex}
              sectionCount={sections.length}
              sections={sections}
              itemCount={sectionItems.length}
              onMoveItem={(action, targetSection) => handleMoveItem(sectionIndex, itemIndex, action, targetSection)}
              activeContentDrag={activeContentDrag}
              swapFlashKey={swapFlash?.rows.includes(item.uid || `content-${sectionIndex}-${itemIndex}`) ? swapFlash.sequence : null}
            />
          );
        })}
      </SortableContext>
      <EmptyItemRow onAdd={(data) => handleAddItem(data, addToSection)} nextIndex={sections[addToSection]?.items.length ?? 0} isWatchlist={type === 'watchlists'} />
    </Box>
  );

  return (
    <ListsContext.Provider value={contextValue}>
      <Stack gap="xs" className="lists-view">
      <Group justify="space-between" className="ds-page-header" style={{ marginBottom: 0 }}>
        <Group>
          <ActionIcon className="ds-touch-target" variant="subtle" aria-label="Back" onClick={() => navigate(-1)}>
            <IconArrowLeft size={20} aria-hidden="true" />
          </ActionIcon>
          <span className="ds-page-title">{listTitle}</span>
        </Group>
        <Group>
          <TextInput
            placeholder="Search items..."
            leftSection={<UiIcon name="search" />}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="lists-folder-search"
          />
          <ActionMenu position="bottom-end" disabled={Boolean(readError) || pending.structural} trigger={
            <ActionIcon className="ds-touch-target" variant="subtle" aria-label="List actions" disabled={Boolean(readError) || pending.structural} data-testid="list-menu-button">
              <IconDotsVertical size={20} aria-hidden="true" />
            </ActionIcon>
          }>
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
              onClick={() => setDeleteListOpen(true)}
            >
              Delete {typeLabel}
            </Menu.Item>
          </ActionMenu>
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
        <div className="sections-scroll" role="region" aria-label="List contents" {...regionProps}>
          <ListReadError error={readError} reading={reading} onRetry={retry} />
          <div inert={readError || pending.structural ? '' : undefined} onBlurCapture={event => {
            // Suspending the controls blurs an active inline editor. Keep its
            // draft until the snapshot recovers and the user finishes editing.
            if (event.currentTarget.inert) event.stopPropagation();
          }}>
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
                      onUpdate={(idx, updates) => updates ? mutate('lists.update_section', 'Could not update section', () => updateSection(idx, updates)) : setSectionSettingsOpen(idx)}
                      onDelete={idx => mutate('lists.delete_section', 'Could not delete section', () => deleteSection(idx))}
                      onMoveUp={(idx) => handleMoveSection(idx, -1)}
                      onMoveDown={(idx) => handleMoveSection(idx, 1)}
                      isFirst={si === 0}
                      isLast={si === sections.length - 1}
                      itemCount={section.items.length}
                    />
                    <Collapse in={!collapsedSections.has(si)}>
                      {renderItems(section.items.map((_, itemIndex) => ({ sectionIndex: si, itemIndex })), si)}
                    </Collapse>
                  </Box>
                ))}
                <Button variant="light" leftSection={<IconPlus size={16} />}
                  disabled={loading || Boolean(readError)}
                  onClick={() => mutate('lists.add_section', 'Could not add section', () => addSection({ title: `Section ${sections.length + 1}` }))}>
                  Add Section
                </Button>
              </Stack>
            )}
          </div>
        </div>

        <DragOverlay dropAnimation={null}>
          {activeContentDrag && <ContentDragPreview value={activeContentDrag.item.input}
            pickedInfo={contentInfoMap.get(activeContentDrag.item.input)} />}
        </DragOverlay>
      </DndContext>

      {flatItems.length === 0 && !filteredItems && !loading && (
        <Center h="40vh">
          <Stack align="center">
            <UiIcon name="search" size={48} stroke={1} color="gray" />
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
        loading={loading || Boolean(readError)}
        sections={sections}
      />

      <ListSettingsModal
        opened={settingsOpen === true}
        onClose={() => setSettingsOpen(false)}
        metadata={listMetadata}
        onSave={settings => mutate('lists.settings', 'Could not save list settings',
          () => updateListSettings(settings), { refresh: false })}
        loading={loading}
        read={settingsRead}
      />

      <SectionSettingsModal
        opened={sectionSettingsOpen !== null}
        onClose={() => setSectionSettingsOpen(null)}
        section={sectionSettingsOpen !== null ? sections[sectionSettingsOpen] : null}
        onSave={updates => mutate('lists.update_section', 'Could not save section settings',
          () => updateSection(sectionSettingsOpen, updates))}
        loading={loading}
        read={settingsRead}
      />

      <ConfirmModal
        opened={deleteListOpen}
        onClose={() => setDeleteListOpen(false)}
        onConfirm={handleDeleteList}
        title={`Delete ${typeLabel}`}
        message={`Delete ${typeLabel.toLowerCase()} "${listTitle}"? This cannot be undone.`}
        impact={flatItems.length > 0 ? `${flatItems.length} item${flatItems.length === 1 ? '' : 's'} will be removed.` : undefined}
        confirmLabel={`Delete ${typeLabel}`}
        loading={deletingList}
      />
      </Stack>
    </ListsContext.Provider>
  );
}

export default ListsFolder;
