import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  SimpleGrid, Card, Text, Badge, Group, Button,
  Center, Loader, Alert, Stack, Title
} from '@mantine/core';
import { IconPlus, IconFolder, IconAlertCircle } from '@tabler/icons-react';
import { useAdminLists } from '../../../hooks/admin/useAdminLists.js';
import ListsFolderCreate from './ListsFolderCreate.jsx';
import './ContentLists.scss';

function ListsIndex() {
  const navigate = useNavigate();
  const { folders, loading, error, fetchFolders, createFolder } = useAdminLists();
  const [createModalOpen, setCreateModalOpen] = useState(false);

  useEffect(() => {
    fetchFolders();
  }, [fetchFolders]);

  const handleFolderClick = (folder) => {
    navigate(`/admin/content/lists/${folder.name}`);
  };

  const handleCreateFolder = async (name) => {
    await createFolder(name);
    setCreateModalOpen(false);
  };

  if (loading && folders.length === 0) {
    return (
      <Center h="60vh">
        <Loader size="lg" />
      </Center>
    );
  }

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={2}>Content Lists</Title>
        <Button
          leftSection={<IconPlus size={16} />}
          onClick={() => setCreateModalOpen(true)}
        >
          New Folder
        </Button>
      </Group>

      {error && (
        <Alert icon={<IconAlertCircle size={16} />} color="red" title="Error">
          {error.message || 'Failed to load folders'}
        </Alert>
      )}

      <SimpleGrid cols={{ base: 1, sm: 2, md: 3, lg: 4 }} spacing="md">
        {folders.map(folder => (
          <Card
            key={folder.name}
            shadow="sm"
            padding="lg"
            radius="md"
            withBorder
            className="folder-card"
            onClick={() => handleFolderClick(folder)}
          >
            <Group justify="space-between">
              <Group gap="xs">
                <IconFolder size={24} stroke={1.5} />
                <Text fw={500} tt="capitalize">
                  {folder.name.replace(/-/g, ' ')}
                </Text>
              </Group>
              <Badge color="blue" variant="light">
                {folder.count}
              </Badge>
            </Group>
          </Card>
        ))}
      </SimpleGrid>

      {folders.length === 0 && !loading && (
        <Center h="40vh">
          <Stack align="center">
            <IconFolder size={48} stroke={1} color="gray" />
            <Text c="dimmed">No folders yet. Create one to get started.</Text>
          </Stack>
        </Center>
      )}

      <ListsFolderCreate
        opened={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreate={handleCreateFolder}
        loading={loading}
      />
    </Stack>
  );
}

export default ListsIndex;
