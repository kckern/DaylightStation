// ItemDetailsDrawer.jsx — right-hand drawer showing full item info with
// parent/child navigation and watch states. Extracted verbatim from
// ListsItemRow.jsx (Task 14).
import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Text, ActionIcon, Loader, Group, Badge, Box, Drawer, Stack, ScrollArea,
  Divider, Progress,
} from '@mantine/core';
import {
  IconChevronRight, IconChevronLeft, IconHome, IconEye, IconEyeOff,
  IconExternalLink,
} from '@tabler/icons-react';
import { getChildLogger } from '../../../lib/logging/singleton.js';
import { ShimmerAvatar } from './ShimmerAvatar.jsx';
import { CONTAINER_TYPES, SOURCE_COLORS, getTypeIcon, TYPE_LABELS } from './ContentDisplays.jsx';

// Lazy admin logger with session logging enabled
let _adminLog;
function adminLog(component) {
  if (!_adminLog) _adminLog = getChildLogger({ app: 'admin', sessionLog: true });
  return component ? _adminLog.child({ component }) : _adminLog;
}

// Item Details Drawer - shows full info, children list, watch states
export function ItemDetailsDrawer({ opened, onClose, contentValue }) {
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

export default ItemDetailsDrawer;
