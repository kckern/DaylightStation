import React, { useState, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  SimpleGrid, Card, Text, Badge, Group, Button,
  Stack, Box
} from '@mantine/core';
import {
  IconPlus, IconList,
  // Common icons for lists
  IconHome, IconStar, IconHeart, IconBookmark, IconFolder,
  IconMusic, IconVideo, IconPhoto, IconBook, IconMovie,
  IconDeviceTv, IconPlaylist, IconCalendar, IconClock,
  IconRun, IconBolt, IconFlame, IconTrophy, IconTarget,
  IconSettings, IconMenu2, IconPlayerPlay
} from '@tabler/icons-react';
import { useApiResource } from "../../../../frontend/src/lib/hooks/useApiResource.js";
import { LoadingState, ErrorState, EmptyState } from "../../../../frontend/src/lib/ui/states.jsx";
import { adminListsPath, createAdminList } from "../../../../frontend/src/hooks/admin/useAdminLists.js";
import ListCreate from "./ListCreate.jsx";
import "./ContentLists.scss";

// Type display names
const TYPE_LABELS = {
  menus: 'Menus',
  watchlists: 'Watchlists',
  programs: 'Programs'
};

// Map icon name strings to actual icon components
const ICON_MAP = {
  IconList,
  IconHome,
  IconStar,
  IconHeart,
  IconBookmark,
  IconFolder,
  IconMusic,
  IconVideo,
  IconPhoto,
  IconBook,
  IconMovie,
  IconDeviceTv,
  IconPlaylist,
  IconCalendar,
  IconClock,
  IconRun,
  IconBolt,
  IconFlame,
  IconTrophy,
  IconTarget,
  IconSettings,
  IconMenu2,
  IconPlayerPlay
};

/**
 * Render a dynamic icon by name
 * Falls back to IconList if icon name not found
 */
function DynamicIcon({ name, size = 24, stroke = 1.5 }) {
  const IconComponent = ICON_MAP[name] || IconList;
  return <IconComponent size={size} stroke={stroke} />;
}

/**
 * Format a list name for display (fallback when no title)
 * e.g., "my-cool-list" -> "My Cool List"
 */
function formatName(name) {
  return name
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function ListsIndex() {
  const { type } = useParams();
  return <ListCollection key={type} type={type} />;
}

function ListCollection({ type }) {
  const { data, loading, error, reload } = useApiResource(adminListsPath(type), { retryTransient: false });
  const [createModalOpen, setCreateModalOpen] = useState(false);

  // Group lists by their group field
  const groupedLists = useMemo(() => {
    const groups = {};

    (data?.lists ?? []).forEach(list => {
      const groupName = list.group || 'Ungrouped';
      if (!groups[groupName]) {
        groups[groupName] = [];
      }
      groups[groupName].push(list);
    });

    // Sort groups: named groups first (alphabetically), then Ungrouped last
    const sortedGroupNames = Object.keys(groups).sort((a, b) => {
      if (a === 'Ungrouped') return 1;
      if (b === 'Ungrouped') return -1;
      return a.localeCompare(b);
    });

    return sortedGroupNames.map(name => ({
      name,
      lists: groups[name]
    }));
  }, [data]);

  const handleCreateList = async (name) => {
    await createAdminList(type, name);
    setCreateModalOpen(false);
  };

  const typeLabel = TYPE_LABELS[type] || type;

  if (loading && !data) return <LoadingState label={typeLabel.toLowerCase()} />;

  return (
    <Stack gap="md">
      <Group justify="space-between" className="ds-page-header">
        <span className="ds-page-title">{typeLabel}</span>
        <Button
          leftSection={<IconPlus size={16} />}
          onClick={() => setCreateModalOpen(true)}
          data-testid="new-list-button"
          size="sm"
        >
          New {typeLabel.slice(0, -1)}
        </Button>
      </Group>

      {error && <ErrorState label={typeLabel} error={error} onRetry={reload} />}

      {groupedLists.map(group => (
        <Box key={group.name}>
          {group.name !== 'Ungrouped' && (
            <Text size="sm" fw={600} c="dimmed" tt="uppercase" mb="xs">
              {group.name}
            </Text>
          )}
          <SimpleGrid cols={{ base: 1, sm: 2, md: 3, lg: 4 }} spacing="md">
            {group.lists.map(list => (
              <Card
                key={list.name}
                shadow="sm"
                padding="lg"
                radius="md"
                withBorder
                className="list-card"
                component={Link}
                to={`/admin/content/lists/${type}/${list.name}`}
                data-testid={`list-card-${list.name}`}
              >
                <Group justify="space-between" wrap="nowrap">
                  <Group gap="xs" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
                    {list.icon ? (
                      <DynamicIcon name={list.icon} />
                    ) : (
                      <IconList size={24} stroke={1.5} />
                    )}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <Text fw={500} truncate>
                        {list.title || formatName(list.name)}
                      </Text>
                      {list.description && (
                        <Text size="xs" c="dimmed" lineClamp={1}>
                          {list.description}
                        </Text>
                      )}
                    </div>
                  </Group>
                  <Group gap="xs" wrap="nowrap">
                    {!list.active && (
                      <Badge color="red" variant="light" size="xs">
                        Inactive
                      </Badge>
                    )}
                    <Badge color="blue" variant="light">
                      {list.itemCount ?? list.count ?? 0}
                    </Badge>
                  </Group>
                </Group>
              </Card>
            ))}
          </SimpleGrid>
        </Box>
      ))}

      {!groupedLists.length && !loading && !error && (
        <EmptyState title={`No ${typeLabel.toLowerCase()} yet`} hint="Create one to get started." />
      )}

      <ListCreate
        opened={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreate={handleCreateList}
        typeLabel={typeLabel.slice(0, -1)}
      />
    </Stack>
  );
}

export default ListsIndex;
