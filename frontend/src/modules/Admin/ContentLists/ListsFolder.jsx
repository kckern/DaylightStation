import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Stack, Group, Title, Button, TextInput, Center, Loader, Alert,
  ActionIcon, Menu
} from '@mantine/core';
import {
  IconPlus, IconSearch, IconArrowLeft, IconAlertCircle,
  IconTrash, IconDotsVertical
} from '@tabler/icons-react';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, arrayMove
} from '@dnd-kit/sortable';
import { useAdminLists } from '../../../hooks/admin/useAdminLists.js';
import ListsItemRow from './ListsItemRow.jsx';
import ListsItemEditor from './ListsItemEditor.jsx';
import './ContentLists.scss';

function ListsFolder() {
  const { folder } = useParams();
  const navigate = useNavigate();
  const {
    items, loading, error,
    fetchItems, addItem, updateItem, deleteItem, reorderItems, toggleItemActive,
    deleteFolder
  } = useAdminLists();

  const [searchQuery, setSearchQuery] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor)
  );

  useEffect(() => {
    if (folder) {
      fetchItems(folder);
    }
  }, [folder, fetchItems]);

  const filteredItems = useMemo(() => {
    if (!searchQuery) return items;
    const query = searchQuery.toLowerCase();
    return items.filter(item =>
      item.label?.toLowerCase().includes(query) ||
      item.input?.toLowerCase().includes(query)
    );
  }, [items, searchQuery]);

  const handleDragEnd = async (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex(i => i.index === active.id);
    const newIndex = items.findIndex(i => i.index === over.id);

    const reordered = arrayMove(items, oldIndex, newIndex);
    await reorderItems(reordered);
  };

  const handleAddItem = () => {
    setEditingItem(null);
    setEditorOpen(true);
  };

  const handleEditItem = (item) => {
    setEditingItem(item);
    setEditorOpen(true);
  };

  const handleSaveItem = async (itemData) => {
    if (editingItem) {
      await updateItem(editingItem.index, itemData);
    } else {
      await addItem(itemData);
    }
    setEditorOpen(false);
    setEditingItem(null);
  };

  const handleDeleteFolder = async () => {
    if (window.confirm(`Delete folder "${folder}"? This cannot be undone.`)) {
      await deleteFolder(folder);
      navigate('/admin/content/lists');
    }
  };

  if (loading && items.length === 0) {
    return (
      <Center h="60vh">
        <Loader size="lg" />
      </Center>
    );
  }

  const folderTitle = folder.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  return (
    <Stack gap="md" className="lists-folder">
      <Group justify="space-between">
        <Group>
          <ActionIcon variant="subtle" onClick={() => navigate('/admin/content/lists')}>
            <IconArrowLeft size={20} />
          </ActionIcon>
          <Title order={2}>{folderTitle}</Title>
        </Group>
        <Group>
          <TextInput
            placeholder="Search items..."
            leftSection={<IconSearch size={16} />}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: 200 }}
          />
          <Button leftSection={<IconPlus size={16} />} onClick={handleAddItem}>
            Add Item
          </Button>
          <Menu position="bottom-end">
            <Menu.Target>
              <ActionIcon variant="subtle">
                <IconDotsVertical size={20} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                color="red"
                leftSection={<IconTrash size={16} />}
                onClick={handleDeleteFolder}
              >
                Delete Folder
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>

      {error && (
        <Alert icon={<IconAlertCircle size={16} />} color="red" title="Error">
          {error.message || 'Failed to load items'}
        </Alert>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={filteredItems.map(i => i.index)}
          strategy={verticalListSortingStrategy}
        >
          {filteredItems.map(item => (
            <ListsItemRow
              key={item.index}
              item={item}
              onEdit={() => handleEditItem(item)}
              onDelete={() => deleteItem(item.index)}
              onToggleActive={() => toggleItemActive(item.index)}
            />
          ))}
        </SortableContext>
      </DndContext>

      {filteredItems.length === 0 && !loading && (
        <Center h="40vh">
          <Stack align="center">
            <IconSearch size={48} stroke={1} color="gray" />
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
        loading={loading}
      />
    </Stack>
  );
}

export default ListsFolder;
