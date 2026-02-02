import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  SimpleGrid, Card, Text, Badge, Group, Button,
  Center, Loader, Alert, Stack, Title
} from '@mantine/core';
import { IconPlus, IconList, IconAlertCircle } from '@tabler/icons-react';
import { useAdminLists } from '../../../hooks/admin/useAdminLists.js';
import ListCreate from './ListCreate.jsx';
import './ContentLists.scss';

// Type display names
const TYPE_LABELS = {
  menus: 'Menus',
  watchlists: 'Watchlists',
  programs: 'Programs'
};

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
      <Group justify="space-between">
        <Title order={2}>{typeLabel}</Title>
        <Button
          leftSection={<IconPlus size={16} />}
          onClick={() => setCreateModalOpen(true)}
          data-testid="new-list-button"
        >
          New {typeLabel.slice(0, -1)}
        </Button>
      </Group>

      {error && (
        <Alert icon={<IconAlertCircle size={16} />} color="red" title="Error">
          {error.message || 'Failed to load lists'}
        </Alert>
      )}

      <SimpleGrid cols={{ base: 1, sm: 2, md: 3, lg: 4 }} spacing="md">
        {lists.map(list => (
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
            <Group justify="space-between">
              <Group gap="xs">
                <IconList size={24} stroke={1.5} />
                <Text fw={500} tt="capitalize">
                  {list.name.replace(/-/g, ' ')}
                </Text>
              </Group>
              <Badge color="blue" variant="light">
                {list.count}
              </Badge>
            </Group>
          </Card>
        ))}
      </SimpleGrid>

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
