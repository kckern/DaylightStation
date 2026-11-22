import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Text, Checkbox, ActionIcon, Menu, TextInput, Modal, UnstyledButton, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconGripVertical, IconTrash, IconCopy, IconDotsVertical, IconPlus,
  IconPhoto, IconInfoCircle, IconPlayerPlay,
  IconArrowBarDown, IconLayoutList, IconAppWindow, IconBookmark,
  IconArrowBarUp, IconSection, IconSettings,
} from '@tabler/icons-react';
import { useSortable } from '@dnd-kit/sortable';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import ConfigIndicators from "./ConfigIndicators.jsx";
import ProgressDisplay from "./ProgressDisplay.jsx";
import { hasCacheEntry, loadSiblings } from "../lib/siblingsCache.js";
import { useListsContext } from "./ListsContext.js";
import { isContentIdLike } from "../lib/contentSearchLogic.js";
import ContentCombobox from "../combobox/ContentCombobox.jsx";
import { useAutoResolve } from "../combobox/useAutoResolve.js";
import { ShimmerAvatar } from "./ShimmerAvatar.jsx";
import { ContentValueCard, contentInfoFromPick } from './ContentDisplays.jsx';
import { getCachedCatalogContentInfo, useCatalogContentInfo } from './catalogContentInfo.js';
import { ItemDetailsDrawer } from "./ItemDetailsDrawer.jsx";
import { AppParamPicker, AppParamResolutionNotice } from "./AppParamPicker.jsx";
import { useAppParamOptions } from "./useAppParamOptions.js";
import { ActionChipSelect } from "./ActionChipSelect.jsx";
import { CapabilityWarning } from "./CapabilityWarning.jsx";
import { ActionMenu } from "../../../../frontend/src/lib/ui/ActionMenu.jsx";
import { DaylightMediaPath } from "../../../../frontend/src/lib/api.mjs";
import ImagePickerModal from "./ImagePickerModal.jsx";
import AdminPreviewPlayer from "../../../../frontend/src/modules/Admin/Preview/AdminPreviewPlayer.jsx";
import Displayer from "../../../../frontend/src/modules/Displayer/Displayer.jsx";
import AppContainer from "../../../../frontend/src/modules/AppContainer/AppContainer.jsx";
import { paramsTypeFor } from "./itemParams/registry.js";
import ItemParamsModal from "./itemParams/ItemParamsModal.jsx";
import { getChildLogger } from "../../../../frontend/src/lib/logging/singleton.js";

// Lazy admin logger with session logging enabled
let _adminLog;
function adminLog(component) {
  if (!_adminLog) _adminLog = getChildLogger({ app: 'admin', sessionLog: true });
  return component ? _adminLog.child({ component }) : _adminLog;
}

async function preloadSiblings(contentId, contentInfo) {
  if (!contentId || !contentInfo || contentInfo.unresolved || hasCacheEntry(contentId)) return;
  try {
    await loadSiblings(contentId, contentInfo.source);
  } catch (err) {
    adminLog('preloadSiblings').error('preload_siblings.error', { contentId, error: err.message });
  }
}

const SIBLING_PRELOAD_RADIUS = 2;

function getNearbyItems(flatItems, sectionIndex, itemIndex) {
  const index = flatItems.findIndex(item => item.sectionIndex === sectionIndex && item.itemIndex === itemIndex);
  if (index < 0) return [];
  return flatItems.slice(Math.max(0, index - SIBLING_PRELOAD_RADIUS), index + SIBLING_PRELOAD_RADIUS + 1);
}

function ListsItemRow({ item, onUpdate, onDelete, onToggleActive, onDuplicate, isWatchlist, onEdit, onSplit, sectionIndex, sectionCount, sections, itemCount, onMoveItem, activeContentDrag, swapFlashKey, dragId, allowSublistNavigation = true, allowNewSection = true }) {
  const log = useMemo(() => adminLog('ListsItemRow'), []);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: dragId ? `row:${dragId}` : `row-${sectionIndex}-${item.index}`
  });

  const { attributes: contentDragAttrs, listeners: contentDragListeners, setNodeRef: setContentDragRef } = useDraggable({
    id: dragId ? `content:${dragId}` : `content-${sectionIndex}-${item.index}`,
  });

  const { setNodeRef: setContentDropRef, isOver: isContentDropTarget } = useDroppable({
    id: dragId ? `content:${dragId}` : `content-${sectionIndex}-${item.index}`,
  });

  const navigate = useNavigate();
  const { type: currentListType } = useParams();
  const { flatItems, setContentInfo, contentInfoMap, inUseImages } = useListsContext();

  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [dragMenuOpen, setDragMenuOpen] = useState(false);
  const [paramsOpen, setParamsOpen] = useState(false);

  // Per-type parameters (itemParams/registry.js). Null for most items, and
  // then the row renders exactly as it did before parameters existed.
  const paramsType = paramsTypeFor(item);
  const itemName = item.label || item.input || 'item';
  const paramsSummary = paramsType ? paramsType.summary(item.params || {}) : '';
  const openParams = (from) => {
    log.info('lists.item.params.open', { index: item.index, type: paramsType.id, from });
    setParamsOpen(true);
  };

  // Resolve thumbnail for icon column: override image > UID image > input thumbnail
  const contentInfo = useCatalogContentInfo(item.input, contentInfoMap.get(item.input));
  const inheritedImage = contentInfo?.thumbnail || null;
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
  const rowActionsRef = useRef(null);

  const handleRowHover = useCallback(() => {
    if (!item.input) return;

    const nearbyItems = getNearbyItems(flatItems, sectionIndex, item.index);
    nearbyItems.forEach(nearbyItem => {
      if (!nearbyItem.input) return;

      const info = nearbyItem.input === item.input ? contentInfo
        : getCachedCatalogContentInfo(nearbyItem.input, contentInfoMap.get(nearbyItem.input));
      preloadSiblings(nearbyItem.input, info);
    });
  }, [item.input, item.index, sectionIndex, flatItems, contentInfo, contentInfoMap]);

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
  const { resolution: pendingApp, select: selectAppParam, retry: retryAppParam, clear: clearAppParam } = useAppParamOptions();

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
    onChange: (id, choice) => {
      if (choice?.title) setContentInfo(id, contentInfoFromPick(id, choice));
      commitInput(id);
    },
  });

  // Input (content) change handler — receives (id, item?) from ContentCombobox.
  const handleRowInputChange = (value, selectedItem) => {
    // App that needs a parameter → show the param picker instead of saving.
    if (selectedItem?.isApp && selectedItem.hasParam) {
      log.info('app_param.prompt', { index: item.index, appId: selectedItem.appId, paramName: selectedItem.param?.name });
      selectAppParam({ appId: selectedItem.appId, param: selectedItem.param });
      return;
    }
    clearAppParam();
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
      {swapFlashKey != null && <span key={swapFlashKey} className="swap-flash" aria-hidden="true" />}
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
          {allowNewSection && <Menu.Item
            leftSection={<IconPlus size={14} />}
            onClick={() => { log.info('move.new_section', { index: item.index }); onMoveItem('new-section'); }}
          >
            New Section
          </Menu.Item>}
        </Menu.Dropdown>
      </Menu>

      <div className="col-index">
        <Text size="xs" c="dimmed">{item.index + 1}</Text>
      </div>

      <UnstyledButton type="button" className="col-icon" aria-label={`Edit image for ${item.label || item.input || 'item'}`} onClick={() => { log.info('image_picker.open', { index: item.index }); setImagePickerOpen(true); }}>
        <ShimmerAvatar src={rowThumbnail} size={28} radius="sm">
          {item.label ? item.label.charAt(0).toUpperCase() : '#'}
        </ShimmerAvatar>
      </UnstyledButton>
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
        {allowSublistNavigation && item.action === 'List' && item.input && (() => {
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
        >
          {previewOpen && item.action === 'Display' && (
            <div style={{ height: 500 }}>
              <Displayer
                display={{ id: item.input }}
                reuseRecentDescriptor
                onClose={() => setPreviewOpen(false)}
              />
            </div>
          )}
          {previewOpen && item.action === 'Open' && (
            <div style={{ height: 600 }}>
              <AppContainer
                open={item.params
                  ? { app: item.input?.replace(/^app:\s*/, ''), params: item.params }
                  : item.input?.replace(/^app:\s*/, '')}
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
        {pendingApp?.phase === 'ready' ? (
          <AppParamPicker
            appId={pendingApp.appId}
            param={pendingApp.param}
            options={pendingApp.options}
            onCommit={(fullId) => { clearAppParam(); commitInput(fullId); }}
            onCancel={clearAppParam}
          />
        ) : (
          <>
            <AppParamResolutionNotice resolution={pendingApp} onRetry={retryAppParam} onCancel={clearAppParam} />
            <ContentCombobox
              value={item.input}
              onChange={handleRowInputChange}
              appResults
              selectContainers
              renderValue={({ onStartEdit }) => (
                <ContentValueCard
                  value={item.input}
                  contentInfo={contentInfo}
                  onStartEdit={() => { cancelAutoResolve(); onStartEdit(); }}
                />
              )}
            />
          </>
        )}
        {/* Catches an action pointed at a source that can't perform it — the
            failure mode that rendered `action: Display` on a files: image as a
            blank frame with no error on either the screen or this preview. */}
        <CapabilityWarning
          input={item.input}
          action={item.action}
          onUpdate={onUpdate}
        />
      </div>

      {isWatchlist && (
        <div className="col-progress">
          <ProgressDisplay item={item} />
        </div>
      )}

      <div className="col-config">
        {paramsType && (
          <Tooltip label={paramsSummary} withArrow position="top">
            <ActionIcon
              size="sm"
              variant="subtle"
              color={item.params ? undefined : 'gray'}
              c={item.params ? undefined : 'dimmed'}
              data-params-set={item.params ? 'true' : 'false'}
              aria-label={`Parameters for ${itemName}: ${paramsSummary}`}
              onClick={() => openParams('gear')}
            >
              <IconSettings size={14} />
            </ActionIcon>
          </Tooltip>
        )}
        <ConfigIndicators item={item} onClick={onEdit ? () => onEdit() : undefined} />
      </div>
      {paramsType && (
        <ItemParamsModal
          opened={paramsOpen}
          onClose={() => setParamsOpen(false)}
          paramsType={paramsType}
          item={item}
          itemLabel={itemName}
          onUpdate={onUpdate}
          log={log}
        />
      )}

      <div className="col-menu">
        <ActionMenu position="bottom-end" trigger={
          <ActionIcon ref={rowActionsRef} variant="subtle" size="sm" aria-label={`Actions for ${item.label || item.input || 'item'}`} data-testid={`row-menu-${sectionIndex}-${item.index}`}>
            <IconDotsVertical size={14} />
          </ActionIcon>
        }>
          <Menu.Item leftSection={<IconInfoCircle size={14} />} onClick={() => { log.info('menu.more_info', { index: item.index, input: item.input }); setDrawerOpen(true); }}>
            More Info
          </Menu.Item>
          {paramsType && (
            <Menu.Item leftSection={<IconSettings size={14} />} onClick={() => openParams('menu')}>
              Parameters…
            </Menu.Item>
          )}
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
        </ActionMenu>
      </div>
      </div>

      <ItemDetailsDrawer
        opened={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        contentValue={item.input}
        returnFocusRef={rowActionsRef}
      />
    </div>
  );
}

export default ListsItemRow;
