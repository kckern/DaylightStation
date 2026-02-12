import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  SimpleGrid, Card, Text, Badge, Group, Button,
  Center, Loader, Alert, Stack, Box
} from '@mantine/core';
import {
  IconPlus, IconList, IconAlertCircle,
  // Common icons for lists
  IconHome, IconStar, IconHeart, IconBookmark, IconFolder,
  IconMusic, IconVideo, IconPhoto, IconBook, IconMovie,
  IconDeviceTv, IconPlaylist, IconCalendar, IconClock,
  IconRun, IconBolt, IconFlame, IconTrophy, IconTarget,
  IconSettings, IconMenu2, IconPlayerPlay
} from '@tabler/icons-react';
import { useAdminLists } from '../../../hooks/admin/useAdminLists.js';
import ListCreate from './ListCreate.jsx';
import './ContentLists.scss';

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
  const navigate = useNavigate();
  const { lists, loading, error, fetchLists, createList } = useAdminLists();
  const [createModalOpen, setCreateModalOpen] = useState(false);

  useEffect(() => {
    if (type) {
      fetchLists(type);
    }
  }, [type, fetchLists]);

  // Group lists by their group field
  const groupedLists = useMemo(() => {
    const groups = {};

    lists.forEach(list => {
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
  }, [lists]);

  const handleListClick = (list) => {
    navigate(`/admin/content/lists/${type}/${list.name}`);
  };

  const handleCreateList = async (name) => {
    await createList(type, name);
    setCreateModalOpen(false);
  };

  const typeLabel = TYPE_LABELS[type] || type;

  if (loading && lists.length === 0) {
    return (
      <Center h="60vh">
        <Loader size="lg" />
      </Center>
    );
  }

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

      {error && (
        <Alert icon={<IconAlertCircle size={16} />} color="red" title="Error">
          {error.message || 'Failed to load lists'}
        </Alert>
      )}

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
                onClick={() => handleListClick(list)}
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

      {lists.length === 0 && !loading && (
        <Center h="40vh">
          <Stack align="center">
            <IconList size={48} stroke={1} color="gray" />
            <Text c="dimmed">No {typeLabel.toLowerCase()} yet. Create one to get started.</Text>
          </Stack>
        </Center>
      )}

      <ListCreate
        opened={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreate={handleCreateList}
        loading={loading}
        typeLabel={typeLabel.slice(0, -1)}
      />
    </Stack>
  );
}

export default ListsIndex;
