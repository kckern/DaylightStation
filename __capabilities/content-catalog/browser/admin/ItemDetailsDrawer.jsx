import { useApiResource } from '../../../../frontend/src/lib/hooks/useApiResource.js';
import { ErrorState } from '../../../../frontend/src/lib/ui/states.jsx';
import { contentInfoPath, splitContentId } from '../lib/contentSearchLogic.js';
import React, { useState, useMemo } from 'react';
import {
  Text, ActionIcon, Loader, Group, Badge, Box, Drawer, Stack, UnstyledButton,
  Divider,
} from '@mantine/core';
import {
  IconChevronRight, IconChevronLeft, IconHome,
} from '@tabler/icons-react';
import { getChildLogger } from "../../../../frontend/src/lib/logging/singleton.js";
import { ShimmerAvatar } from "./ShimmerAvatar.jsx";
import { CONTAINER_TYPES, SOURCE_COLORS } from "./contentDisplaysUtils.jsx";

export function ItemDetailsDrawer({ opened, onClose, contentValue }) {
  return (
    <Drawer opened={opened} onClose={onClose} title="Item Details" position="right" size="md" padding="md">
      {opened && <ItemDetails key={contentValue} contentValue={contentValue} />}
    </Drawer>
  );
}

function ItemDetails({ contentValue }) {
  const log = useMemo(() => getChildLogger({ app: 'admin', component: 'ItemDetailsDrawer', sessionLog: true }), []);
  const [navStack, setNavStack] = useState([]);
  const currentId = navStack.at(-1)?.parentId ?? contentValue;
  const parsed = splitContentId(currentId);
  const path = contentInfoPath(parsed?.source, parsed?.localId);
  const { data: itemInfo, loading, error, reload } = useApiResource(path, { label: 'Item details', logger: log });
  const hasParent = itemInfo?.metadata?.parentRatingKey;

  function navigateToParent() {
    if (!hasParent) return;
    const parentId = `${itemInfo.source}:${hasParent}`;
    log.info('details.navigate_parent', { parentKey: hasParent, currentTitle: itemInfo.title });
    setNavStack(stack => [...stack, { id: itemInfo.id, title: itemInfo.title, parentId }]);
  }

  return (
    <Stack gap="md">
      {/* Navigation breadcrumb */}
      {navStack.length > 0 && (
        <Group gap="xs">
          <ActionIcon size="sm" variant="subtle" onClick={() => setNavStack([])} title="Back to original">
            <IconHome size={14} />
          </ActionIcon>
          {navStack.map((item, idx) => (
            <Group key={item.id} gap={4} wrap="nowrap">
              <IconChevronRight size={12} color="gray" />
              <Text
                size="xs"
                c="dimmed"
                component={UnstyledButton}
                onClick={() => setNavStack(stack => stack.slice(0, idx))}
              >
                {item.title}
              </Text>
            </Group>
          ))}
          <IconChevronRight size={12} color="gray" />
          <Text size="xs" fw={500}>{itemInfo?.title}</Text>
        </Group>
      )}

      <ItemDetailsBody {...{ itemInfo, loading, error, reload, hasParent, navigateToParent }} />
    </Stack>
  );
}

function ItemDetailsBody({ itemInfo, loading, error, reload, hasParent, navigateToParent }) {
  if (error) return <ErrorState label="Item details" error={error} onRetry={reload} />;
  if (loading) return <Group justify="center" py="xl"><Loader size="lg" /></Group>;
  if (!itemInfo) return <Text size="sm" c="dimmed" ta="center" py="xl">No item selected</Text>;

  return (
    <>
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
              component={UnstyledButton}
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

      <Text size="sm" c="dimmed" ta="center" py="xl">No child items</Text>

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
    </>
  );
}

export default ItemDetailsDrawer;
