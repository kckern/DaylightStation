import React, { useState, useRef, useEffect, forwardRef, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Text, Checkbox, ActionIcon, Menu, TextInput, Combobox, useCombobox, InputBase, Loader, Group, Avatar, Badge, Box, Drawer, Stack, ScrollArea, Divider, Progress, Modal } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconGripVertical, IconTrash, IconCopy, IconDotsVertical, IconPlus,
  IconPhoto,
  IconChevronRight, IconChevronLeft, IconHome, IconInfoCircle,
  IconEye, IconEyeOff, IconPlayerPlay, IconExternalLink,
  IconArrowBarDown, IconPlayerPlayFilled, IconPlaylistAdd,
  IconLayoutList, IconAppWindow, IconDeviceDesktop, IconBookmark,
  IconArrowBarUp, IconSection,
  IconArrowsShuffle, IconRocket
} from '@tabler/icons-react';
import { useSortable } from '@dnd-kit/sortable';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import ConfigIndicators from './ConfigIndicators.jsx';
import ProgressDisplay from './ProgressDisplay.jsx';
import { getCacheEntry, setCacheEntry } from './siblingsCache.js';
import { useListsContext } from './ListsContext.js';
import { isContentIdLike, shouldAutoAdd } from './contentSearchLogic.js';
import ContentCombobox from './combobox/ContentCombobox.jsx';
import { useAutoResolve } from './combobox/useAutoResolve.js';
import { ShimmerAvatar } from './ShimmerAvatar.jsx';
import {
  ContentValueCard, contentInfoFromPick, fetchContentMetadata,
  normalizeListSource, CONTAINER_TYPES, SOURCE_COLORS, getTypeIcon, TYPE_LABELS,
} from './ContentDisplays.jsx';
import { DaylightMediaPath } from '../../../lib/api.mjs';
import ImagePickerModal from './ImagePickerModal.jsx';
import AdminPreviewPlayer from '../Preview/AdminPreviewPlayer.jsx';
import Displayer from '../../Displayer/Displayer.jsx';
import AppContainer from '../../AppContainer/AppContainer.jsx';
import { getChildLogger } from '../../../lib/logging/singleton.js';
import { ACTION_OPTIONS } from './listConstants.js';

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

/**
 * App parameter picker — rendered in place of the combobox after selecting an
 * app that requires a parameter (e.g. `app:hymn` needs a number). Ported from
 * the inline twin; stays row-level per the unified-combobox design (Task 13).
 *
 * @param {string} appId
 * @param {object} param - the app registry param spec ({name, options})
 * @param {Array|null} options - resolved [{value, label}] options, or null for free text
 * @param {(fullId: string) => void} onCommit
 * @param {() => void} onCancel
 */
function AppParamPicker({ appId, param, options, onCommit, onCancel }) {
  const log = useMemo(() => adminLog('AppParamPicker'), []);
  const combobox = useCombobox({
    onDropdownClose: () => combobox.resetSelectedOption(),
  });
  const [paramInput, setParamInput] = useState('');
  const inputRef = useRef(null);

  const finishWithParam = (paramVal) => {
    const fullId = paramVal ? `app:${appId}/${paramVal}` : `app:${appId}`;
    log.info('app_param.commit', { appId, paramVal, fullId });
    onCommit(fullId);
  };

  const cancelParam = () => {
    log.info('app_param.cancel', { appId });
    onCancel();
  };

  // Dropdown options
  if (options) {
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
              log.debug('param_input.change', { value: e.currentTarget.value, appId });
              setParamInput(e.currentTarget.value);
              combobox.openDropdown();
            }}
            onClick={() => combobox.openDropdown()}
            onFocus={() => combobox.openDropdown()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') cancelParam();
              if (e.key === 'Enter' && paramInput) finishWithParam(paramInput);
            }}
            placeholder={`Choose or type ${param.name}...`}
            autoFocus
            styles={{ input: { minHeight: 24, height: 24, fontSize: 12 } }}
          />
        </Combobox.Target>
        <Combobox.Dropdown>
          <Combobox.Options>
            <ScrollArea.Autosize mah={200}>
              {options
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
      placeholder={`Type ${param.name}...`}
      autoFocus
      styles={{ input: { minHeight: 24, height: 24, fontSize: 12 } }}
    />
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
  Launch:  { color: 'teal',   icon: IconRocket },
  Shuffle: { color: 'grape',  icon: IconArrowsShuffle },
};

// Action chip select
function ActionChipSelect({ value, onChange }) {
  const log = useMemo(() => adminLog('ActionChipSelect'), []);
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
        log.info('action.select', { oldAction: value, newAction: val });
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
  const log = useMemo(() => adminLog('ItemDetailsDrawer'), []);
  const [loading, setLoading] = useState(true);
  const [itemInfo, setItemInfo] = useState(null);
  const [children, setChildren] = useState([]);
  const [navStack, setNavStack] = useState([]); // [{id, title}] for navigation
  const [currentContentId, setCurrentContentId] = useState(null); // To highlight in parent view
  const originalValueRef = useRef(contentValue);

  // Fetch details for a specific item
  const fetchItemDetails = async (contentId) => {
    const match = contentId.match(/^([^:]+):\s*(.+)$/);
    if (!match) return null;
    const [, source, localId] = [null, match[1].trim(), match[2].trim()];
    log.info('details.fetch', { contentId, source, localId });

    try {
      setLoading(true);

      // Fetch item info
      const itemResponse = await fetch(`/api/v1/info/${source}/${localId}`);
      let info = null;
      if (itemResponse.ok) {
        info = await itemResponse.json();
        setItemInfo(info);
      }

      // No children endpoint available — /info endpoint does not return .items
      setChildren([]);

      return info;
    } catch (err) {
      adminLog('ItemDetailsDrawer').error('item_details.error', { error: err.message });
      return null;
    } finally {
      setLoading(false);
    }
  };

  // Navigate to parent
  const navigateToParent = async () => {
    if (!itemInfo?.metadata?.parentRatingKey) return;
    log.info('details.navigate_parent', { parentKey: itemInfo.metadata.parentRatingKey, currentTitle: itemInfo.title });

    const parentId = `${itemInfo.source}:${itemInfo.metadata.parentRatingKey}`;

    // Save current item to highlight in parent's list
    setCurrentContentId(itemInfo.id);

    // Push current to nav stack
    setNavStack([...navStack, { id: itemInfo.id, title: itemInfo.title }]);

    await fetchItemDetails(parentId);
  };

  // Navigate back to child
  const navigateBack = async () => {
    if (navStack.length === 0) return;
    log.info('details.navigate_back', { stackDepth: navStack.length });

    const newStack = [...navStack];
    const target = newStack.pop();
    setNavStack(newStack);
    setCurrentContentId(null);

    await fetchItemDetails(target.id);
  };

  // Reset to original item
  const navigateToOriginal = async () => {
    log.info('details.navigate_original', { originalValue: originalValueRef.current });
    setNavStack([]);
    setCurrentContentId(null);
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
    setCurrentContentId(null);
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
                      setCurrentContentId(null);
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
                    const isCurrentItem = currentContentId && child.id === currentContentId;
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
                          log.info('details.child_click', { childId: child.id, childTitle: child.title, childType: childType });
                          setNavStack([...navStack, { id: itemInfo.id, title: itemInfo.title }]);
                          setCurrentContentId(null);
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
            <ActionIcon variant="subtle" size="sm">
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
            <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={() => { log.info('menu.delete', { index: item.index, label: item.label }); onDelete(); }}>
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

// Empty row for adding new items at the bottom
function EmptyItemRow({ onAdd, nextIndex, isWatchlist }) {
  const log = useMemo(() => adminLog('EmptyItemRow'), []);
  const { contentInfoMap, setContentInfo } = useListsContext();
  const [label, setLabel] = useState('');
  const [action, setAction] = useState('Play');
  const [input, setInput] = useState('');
  const [pendingApp, setPendingApp] = useState(null); // {appId, param, options}
  const addedRef = useRef(false); // prevent double-add from rapid state changes
  const labelInputRef = useRef(null);

  // Freeform staged text auto-resolves in the background; the resolved id
  // lands via setInput, where the gated effect below auto-adds it (intended
  // chain: freeform stays staged, a real content id persists).
  const { maybeResolve, cancel: cancelAutoResolve } = useAutoResolve({
    value: input,
    onChange: (id) => setInput(id),
    setContentInfo,
    fetchMetadata: fetchContentMetadata,
  });

  // Combobox change handler — receives (id, item?) from ContentCombobox.
  const handleComboboxChange = (value, selectedItem) => {
    // App that needs a parameter → show the param picker instead of staging.
    if (selectedItem?.isApp && selectedItem.hasParam) {
      log.info('app_param.prompt', { nextIndex, appId: selectedItem.appId, paramName: selectedItem.param?.name });
      import('../../../lib/appRegistry.js')
        .then(({ resolveParamOptions }) => resolveParamOptions(selectedItem.param))
        .then((options) => {
          setPendingApp({
            appId: selectedItem.appId,
            param: selectedItem.param,
            options: options ? [{ value: 'random', label: 'Random' }, ...options] : null,
          });
        });
      return;
    }
    // Seed the cache from picks so the staged card (and derived label on add)
    // uses the resolved title immediately.
    if (value && selectedItem?.title) {
      setContentInfo(value, contentInfoFromPick(value, selectedItem));
    }
    if (value && !selectedItem && !isContentIdLike(value)) {
      maybeResolve(value, 'empty-row-commit');
    }
    setInput(value);
  };

  const doAdd = useCallback((currentInput, currentLabel, currentAction) => {
    if (addedRef.current) return;
    if (!currentInput) return;
    addedRef.current = true;
    // Derive label: explicit label > resolved content title > freeform input
    const resolvedInfo = contentInfoMap.get(currentInput);
    const derivedLabel = currentLabel.trim()
      || resolvedInfo?.title
      || currentInput.replace(/^[^:]+:\s*/, '');
    log.info('item.add', { nextIndex, label: derivedLabel, action: currentAction, input: currentInput });
    onAdd({
      label: derivedLabel,
      action: currentAction,
      input: currentInput,
      active: true
    });
    // Reset fields
    setLabel('');
    setAction('Play');
    setInput('');
    // Allow next add after reset settles
    setTimeout(() => { addedRef.current = false; }, 100);
  }, [onAdd, nextIndex, contentInfoMap, log]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (label.trim() || input)) {
      doAdd(input, label, action);
    }
  };

  // Auto-save only when the input is a real content id (dropdown pick or
  // pasted id). Freeform text stays staged; Enter adds it explicitly.
  useEffect(() => {
    if (input && shouldAutoAdd(input)) {
      doAdd(input, label, action);
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
      <div className="col-divider" />
      <div className="col-content-drag"></div>
      <div className="col-action">
        <ActionChipSelect value={action} onChange={setAction} />
      </div>
      <div className="col-preview"></div>
      <div className="col-input">
        {pendingApp ? (
          <AppParamPicker
            appId={pendingApp.appId}
            param={pendingApp.param}
            options={pendingApp.options}
            onCommit={(fullId) => { setPendingApp(null); setInput(fullId); }}
            onCancel={() => setPendingApp(null)}
          />
        ) : (
          <ContentCombobox
            value={input}
            onChange={handleComboboxChange}
            appResults
            renderValue={({ onStartEdit }) => (
              <ContentValueCard
                value={input}
                contentInfoMap={contentInfoMap}
                onStartEdit={() => { cancelAutoResolve(); onStartEdit(); }}
              />
            )}
          />
        )}
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
export { EmptyItemRow, InsertRowButton, ShimmerAvatar, fetchContentMetadata };
