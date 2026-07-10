import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Text, Checkbox, ActionIcon, Menu, TextInput, Modal } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconGripVertical, IconTrash, IconCopy, IconDotsVertical, IconPlus,
  IconPhoto, IconInfoCircle, IconPlayerPlay,
  IconArrowBarDown, IconLayoutList, IconAppWindow, IconBookmark,
  IconArrowBarUp, IconSection,
} from '@tabler/icons-react';
import { useSortable } from '@dnd-kit/sortable';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import ConfigIndicators from './ConfigIndicators.jsx';
import ProgressDisplay from './ProgressDisplay.jsx';
import { getCacheEntry, setCacheEntry } from './siblingsCache.js';
import { useListsContext } from './ListsContext.js';
import { isContentIdLike } from './contentSearchLogic.js';
import ContentCombobox from './combobox/ContentCombobox.jsx';
import { useAutoResolve } from './combobox/useAutoResolve.js';
import { ShimmerAvatar } from './ShimmerAvatar.jsx';
import {
  ContentValueCard, contentInfoFromPick, fetchContentMetadata, normalizeListSource,
} from './ContentDisplays.jsx';
import { ItemDetailsDrawer } from './ItemDetailsDrawer.jsx';
import { AppParamPicker } from './AppParamPicker.jsx';
import { ActionChipSelect } from './ActionChipSelect.jsx';
import { EmptyItemRow, InsertRowButton } from './EmptyItemRow.jsx';
import { DaylightMediaPath } from '../../../lib/api.mjs';
import ImagePickerModal from './ImagePickerModal.jsx';
import AdminPreviewPlayer from '../Preview/AdminPreviewPlayer.jsx';
import Displayer from '../../Displayer/Displayer.jsx';
import AppContainer from '../../AppContainer/AppContainer.jsx';
import { getChildLogger } from '../../../lib/logging/singleton.js';

// Lazy admin logger with session logging enabled
let _adminLog;
function adminLog(component) {
  if (!_adminLog) _adminLog = getChildLogger({ app: 'admin', sessionLog: true });
  return component ? _adminLog.child({ component }) : _adminLog;
}

/**
 * Fetch siblings data for an item. Returns processed data ready for state.
 * This is the core fetch logic extracted for use by both preload and direct calls.
 */
async function doFetchSiblings(contentId, contentInfo) {
  const match = contentId.match(/^([^:]+):\s*(.+)$/);
  if (!match) {
    adminLog('doFetchSiblings').debug('skip', { contentId, reason: 'no_match' });
    return null;
  }

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
    itemIndex: item.itemIndex ?? null,
    number: item.number ?? null,
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
 * Preload siblings for an item into the cache.
 * Skips if already cached or pending. Returns the promise for optional awaiting.
 */
export async function preloadSiblings(contentId, contentInfo) {
  if (!contentId || !contentInfo || contentInfo.unresolved) return null;

  // Skip if already cached or pending
  const existing = getCacheEntry(contentId);
  if (existing) return existing.promise;

  // Mark as pending immediately to prevent duplicate requests
  const promise = doFetchSiblings(contentId, contentInfo);
  setCacheEntry(contentId, { status: 'pending', data: null, promise });

  try {
    const data = await promise;
    setCacheEntry(contentId, { status: 'loaded', data, promise: null });
    return data;
  } catch (err) {
    adminLog('preloadSiblings').error('preload_siblings.error', { contentId, error: err.message });
    setCacheEntry(contentId, { status: 'error', data: null, promise: null });
    return null;
  }
}

function ListsItemRow({ item, onUpdate, onDelete, onToggleActive, onDuplicate, isWatchlist, onEdit, onSplit, sectionIndex, sectionCount, sections, itemCount, onMoveItem, activeContentDrag }) {
  const log = useMemo(() => adminLog('ListsItemRow'), []);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `row-${sectionIndex}-${item.index}`
  });

  const { attributes: contentDragAttrs, listeners: contentDragListeners, setNodeRef: setContentDragRef } = useDraggable({
    id: `content-${sectionIndex}-${item.index}`,
  });

  const { setNodeRef: setContentDropRef, isOver: isContentDropTarget } = useDroppable({
    id: `content-${sectionIndex}-${item.index}`,
  });

  const navigate = useNavigate();
  const { type: currentListType } = useParams();
  const { getNearbyItems, setContentInfo, contentInfoMap, inUseImages } = useListsContext();

  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [dragMenuOpen, setDragMenuOpen] = useState(false);

  // Resolve thumbnail for icon column: override image > UID image > input thumbnail
  const cachedInfo = contentInfoMap.get(item.input);
  const inheritedImage = cachedInfo?.thumbnail || null;
  const uidImage = item.uid ? DaylightMediaPath(`/media/img/lists/${item.uid}.jpg`) : null;
  const explicitImage = item.image
    ? (item.image.startsWith('/media/') || item.image.startsWith('media/')
        ? DaylightMediaPath(item.image)
        : item.image)
    : null;
  const rowThumbnail = explicitImage || uidImage || inheritedImage;

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

  const isContentSource = activeContentDrag?.sectionIndex === sectionIndex && activeContentDrag?.itemIndex === item.index;
  const rowClassName = [
    'item-row',
    isContentSource && 'content-dragging',
    isContentDropTarget && !isContentSource && 'content-drop-target',
  ].filter(Boolean).join(' ');

  // Focus label input when editing starts
  useEffect(() => {
    if (editingLabel && labelInputRef.current) {
      labelInputRef.current.focus();
      labelInputRef.current.select();
    }
  }, [editingLabel]);

  // Label editing handlers
  const handleLabelClick = () => {
    log.info('label.edit_start', { index: item.index, label: item.label });
    setLabelValue(item.label || '');
    setEditingLabel(true);
  };

  const handleLabelSave = () => {
    if (!labelValue?.trim()) {
      notifications.show({
        message: 'Label cannot be empty',
        color: 'red',
        autoClose: 2000,
      });
      setEditingLabel(false);
      return;
    }
    if (labelValue.trim() && labelValue !== item.label) {
      log.info('label.save', { index: item.index, oldLabel: item.label, newLabel: labelValue.trim() });
      onUpdate({ label: labelValue.trim() });
    }
    setEditingLabel(false);
  };

  const handleLabelBlur = () => {
    if (!labelValue?.trim()) {
      log.debug('label.blur.revert', { index: item.index, label: item.label });
      setLabelValue(item.label || '');
      setEditingLabel(false);
      return;
    }
    if (labelValue.trim() && labelValue !== item.label) {
      log.info('label.save', { index: item.index, oldLabel: item.label, newLabel: labelValue.trim() });
      onUpdate({ label: labelValue.trim() });
    }
    setEditingLabel(false);
  };

  const handleLabelKeyDown = (e) => {
    if (e.key === 'Enter') {
      log.debug('label.key.enter', { index: item.index });
      handleLabelSave();
    } else if (e.key === 'Escape') {
      log.debug('label.key.escape', { index: item.index });
      setLabelValue(item.label || '');
      setEditingLabel(false);
    }
  };

  // ── Content input (unified ContentCombobox wiring) ──
  // App-param picker state: {appId, param, options} while waiting for a param.
  const [pendingApp, setPendingApp] = useState(null);

  // Autosave the committed content id (twin parity: ignore empty/unchanged).
  const commitInput = (value) => {
    if (value && value !== item.input) {
      log.info('input.change', { index: item.index, oldInput: item.input, newInput: value });
      onUpdate({ input: value });
    }
  };

  // Phase 0 auto-resolve survives at row level: freeform commits search in
  // the background and replace the value only if it hasn't changed since.
  const { maybeResolve, cancel: cancelAutoResolve } = useAutoResolve({
    value: item.input,
    onChange: (id) => commitInput(id),
    setContentInfo,
    fetchMetadata: fetchContentMetadata,
  });

  // Input (content) change handler — receives (id, item?) from ContentCombobox.
  const handleRowInputChange = (value, selectedItem) => {
    // App that needs a parameter → show the param picker instead of saving.
    if (selectedItem?.isApp && selectedItem.hasParam) {
      log.info('app_param.prompt', { index: item.index, appId: selectedItem.appId, paramName: selectedItem.param?.name });
      import('../../../lib/appRegistry.js')
        .then(({ resolveParamOptions }) => resolveParamOptions(selectedItem.param))
        .then((options) => {
          setPendingApp({
            appId: selectedItem.appId,
            param: selectedItem.param,
            // Prepend "Random" option for dropdown-style params (twin parity)
            options: options ? [{ value: 'random', label: 'Random' }, ...options] : null,
          });
        });
      return;
    }
    // Seed the shared content-info cache from the picked item so the display
    // card renders instantly instead of flashing "Resolving...".
    if (value && selectedItem?.title) {
      setContentInfo(value, contentInfoFromPick(value, selectedItem));
    }
    // Freeform (non id-like) commit — kick off background auto-resolve.
    if (value && !selectedItem && !isContentIdLike(value)) {
      maybeResolve(value, 'row-commit');
    }
    commitInput(value);
  };

  // Action change handler
  const handleActionChange = (value) => {
    if (value && value !== item.action) {
      log.info('action.change', { index: item.index, oldAction: item.action, newAction: value });
      onUpdate({ action: value });
    }
  };

  return (
    <div ref={setNodeRef} style={style} className={rowClassName} data-testid={`item-row-${sectionIndex}-${item.index}`} onMouseEnter={handleRowHover}>
      <div className="col-active">
        <Checkbox
          checked={item.active !== false}
          onChange={() => { log.info('active.toggle', { index: item.index, newActive: item.active === false }); onToggleActive(); }}
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
              log.info('drag_menu.open', { index: item.index });
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
            onClick={() => { log.info('move.top', { index: item.index }); onMoveItem('top'); }}
          >
            Move to Top
          </Menu.Item>
          <Menu.Item
            leftSection={<IconArrowBarDown size={14} />}
            disabled={item.index === itemCount - 1}
            onClick={() => { log.info('move.bottom', { index: item.index }); onMoveItem('bottom'); }}
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
                onClick={() => { log.info('move.section', { index: item.index, targetSection: si }); onMoveItem('section', si); }}
              >
                {s.title || `Section ${si + 1}`}
              </Menu.Item>
            );
          })}
          <Menu.Item
            leftSection={<IconPlus size={14} />}
            onClick={() => { log.info('move.new_section', { index: item.index }); onMoveItem('new-section'); }}
          >
            New Section
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>

      <div className="col-index">
        <Text size="xs" c="dimmed">{item.index + 1}</Text>
      </div>

      <div className="col-icon" onClick={() => { log.info('image_picker.open', { index: item.index }); setImagePickerOpen(true); }}>
        <ShimmerAvatar src={rowThumbnail} size={28} radius="sm">
          {item.label ? item.label.charAt(0).toUpperCase() : '#'}
        </ShimmerAvatar>
      </div>
      <ImagePickerModal
        opened={imagePickerOpen}
        onClose={() => setImagePickerOpen(false)}
        currentImage={item.image || null}
        inheritedImage={inheritedImage}
        onSave={(path) => { log.info('image.save', { index: item.index, path }); onUpdate({ image: path }); }}
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
              onBlur={handleLabelBlur}
              styles={{ input: { minHeight: 22, height: 22 } }}
            />
          </div>
        ) : (
          <Text size="sm" truncate className="editable-text" onClick={handleLabelClick}>
            {item.label}
          </Text>
        )}
      </div>

      <div className="col-divider" />

      <div
        className="col-content-drag"
        ref={setContentDragRef}
        {...contentDragAttrs}
        {...contentDragListeners}
      >
        <IconGripVertical size={14} />
      </div>

      <div ref={setContentDropRef} className="content-drop-zone">
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
              onClick={() => { log.info('navigate.sublist', { index: item.index, listName }); navigate(`/admin/content/lists/${currentListType}/${listName}`); }}
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
            onClick={() => { log.info('preview.open', { index: item.index, action: item.action || 'Play', input: item.input }); setPreviewOpen(true); }}
            title="Preview"
          >
            <IconPlayerPlay size={14} />
          </ActionIcon>
        )}
        {item.action === 'Display' && item.input && (
          <ActionIcon
            variant="subtle"
            size="sm"
            color="cyan"
            onClick={() => { log.info('preview.open', { index: item.index, action: 'Display', input: item.input }); setPreviewOpen(true); }}
            title="Preview image"
          >
            <IconPhoto size={14} />
          </ActionIcon>
        )}
        {item.action === 'Open' && item.input && (
          <ActionIcon
            variant="subtle"
            size="sm"
            color="teal"
            onClick={() => { log.info('preview.open', { index: item.index, action: 'Open', input: item.input }); setPreviewOpen(true); }}
            title="Preview app"
          >
            <IconAppWindow size={14} />
          </ActionIcon>
        )}
        {item.action === 'Read' && item.input && (
          <ActionIcon
            variant="subtle"
            size="sm"
            color="orange"
            onClick={() => { log.info('preview.open', { index: item.index, action: 'Read', input: item.input }); setPreviewOpen(true); }}
            title="Preview reader"
          >
            <IconBookmark size={14} />
          </ActionIcon>
        )}
        <Modal
          opened={previewOpen}
          onClose={() => { log.info('preview.close', { index: item.index }); setPreviewOpen(false); }}
          title={item.label || 'Preview'}
          centered
          size={item.action === 'Display' ? 'lg' : item.action === 'Open' ? 'xl' : 980}
          padding="xs"
          styles={{ content: { marginLeft: 'var(--app-shell-navbar-width, 250px)' } }}
        >
          {previewOpen && item.action === 'Display' && (
            <div style={{ height: 500 }}>
              <Displayer
                display={{ id: item.input?.replace(/^(\w+):\s+/, '$1:').trim() }}
                onClose={() => setPreviewOpen(false)}
              />
            </div>
          )}
          {previewOpen && item.action === 'Open' && (
            <div style={{ height: 600 }}>
              <AppContainer
                open={item.input?.replace(/^app:\s*/, '')}
                clear={() => setPreviewOpen(false)}
              />
            </div>
          )}
          {previewOpen && item.action === 'Read' && (
            <AdminPreviewPlayer
              contentId={item.input?.replace(/^(\w+):\s+/, '$1:').trim()}
              action="Play"
              volume={item.volume}
              playbackRate={item.playbackRate}
              onClose={() => setPreviewOpen(false)}
            />
          )}
          {previewOpen && (item.action === 'Play' || item.action === 'Queue' || !item.action) && (
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
        {pendingApp ? (
          <AppParamPicker
            appId={pendingApp.appId}
            param={pendingApp.param}
            options={pendingApp.options}
            onCommit={(fullId) => { setPendingApp(null); commitInput(fullId); }}
            onCancel={() => setPendingApp(null)}
          />
        ) : (
          <ContentCombobox
            value={item.input}
            onChange={handleRowInputChange}
            appResults
            renderValue={({ onStartEdit }) => (
              <ContentValueCard
                value={item.input}
                contentInfoMap={contentInfoMap}
                onStartEdit={() => { cancelAutoResolve(); onStartEdit(); }}
              />
            )}
          />
        )}
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
            <ActionIcon variant="subtle" size="sm" data-testid={`row-menu-${sectionIndex}-${item.index}`}>
              <IconDotsVertical size={14} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item leftSection={<IconInfoCircle size={14} />} onClick={() => { log.info('menu.more_info', { index: item.index, input: item.input }); setDrawerOpen(true); }}>
              More Info
            </Menu.Item>
            <Menu.Item leftSection={<IconCopy size={14} />} onClick={() => { log.info('menu.duplicate', { index: item.index }); onDuplicate(); }}>
              Duplicate
            </Menu.Item>
            {onSplit && (
              <Menu.Item leftSection={<IconArrowBarDown size={14} />} onClick={() => { log.info('menu.split', { index: item.index }); onSplit(); }}>
                Split Below
              </Menu.Item>
            )}
            <Menu.Divider />
            <Menu.Item color="red" data-testid={`row-delete-${sectionIndex}-${item.index}`} leftSection={<IconTrash size={14} />} onClick={() => { log.info('menu.delete', { index: item.index, label: item.label }); onDelete(); }}>
              Delete
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </div>
      </div>

      <ItemDetailsDrawer
        opened={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        contentValue={item.input}
      />
    </div>
  );
}

export default ListsItemRow;
export { EmptyItemRow, InsertRowButton, ShimmerAvatar, fetchContentMetadata };
