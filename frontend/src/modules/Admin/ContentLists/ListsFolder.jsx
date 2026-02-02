import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Stack, Group, Title, TextInput, Center, Loader, Alert,
  ActionIcon, Menu, Text, SegmentedControl, Box
} from '@mantine/core';
import {
  IconSearch, IconArrowLeft, IconAlertCircle,
  IconTrash, IconDotsVertical, IconList, IconLayoutGrid
} from '@tabler/icons-react';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, arrayMove
} from '@dnd-kit/sortable';
import { useAdminLists } from '../../../hooks/admin/useAdminLists.js';
import ListsItemRow, { EmptyItemRow, InsertRowButton } from './ListsItemRow.jsx';
import ListsItemEditor from './ListsItemEditor.jsx';
import './ContentLists.scss';

// Type display names (singular)
const TYPE_LABELS = {
  menus: 'Menu',
  watchlists: 'Watchlist',
  programs: 'Program'
};

function ListsFolder() {
  const { type, name: listName } = useParams();
  const navigate = useNavigate();
  const {
    items, loading, error,
    fetchItems, addItem, updateItem, deleteItem, reorderItems, toggleItemActive,
    deleteList
  } = useAdminLists();

  const [searchQuery, setSearchQuery] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [viewMode, setViewMode] = useState('flat'); // 'flat' or 'grouped'

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor)
  );

  useEffect(() => {
    if (type && listName) {
      fetchItems(type, listName);
    }
  }, [type, listName, fetchItems]);

  // Get unique groups from items
  const existingGroups = useMemo(() => {
    const groups = new Set();
    items.forEach(item => {
      if (item.group) groups.add(item.group);
    });
    return Array.from(groups).sort();
  }, [items]);

  // Filter items by search query
  const filteredItems = useMemo(() => {
    if (!searchQuery) return items;
    const query = searchQuery.toLowerCase();
    return items.filter(item =>
      item.label?.toLowerCase().includes(query) ||
      item.input?.toLowerCase().includes(query) ||
      item.group?.toLowerCase().includes(query)
    );
  }, [items, searchQuery]);

  // Group items by group field
  const groupedItems = useMemo(() => {
    if (viewMode === 'flat') return null;

    const groups = {};
    const ungrouped = [];

    filteredItems.forEach(item => {
      if (item.group) {
        if (!groups[item.group]) {
          groups[item.group] = [];
        }
        groups[item.group].push(item);
      } else {
        ungrouped.push(item);
      }
    });

    // Sort groups alphabetically
    const sortedGroups = Object.keys(groups).sort();

    return { groups, sortedGroups, ungrouped };
  }, [filteredItems, viewMode]);

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

  const handleDeleteList = async () => {
    const typeLabel = TYPE_LABELS[type] || type;
    if (window.confirm(`Delete ${typeLabel.toLowerCase()} "${listName}"? This cannot be undone.`)) {
      await deleteList(type, listName);
      navigate(`/admin/content/lists/${type}`);
    }
  };

  if (loading && items.length === 0) {
    return (
      <Center h="60vh">
        <Loader size="lg" />
      </Center>
    );
  }

  const listTitle = listName.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const typeLabel = TYPE_LABELS[type] || type;
  const hasGroups = existingGroups.length > 0;

  const handleInlineUpdate = async (index, updates) => {
    await updateItem(index, updates);
  };

  const handleDuplicateItem = async (item) => {
    const newItem = {
      label: `${item.label} (copy)`,
      input: item.input,
      action: item.action,
      active: item.active,
      group: item.group
    };
    await addItem(newItem);
  };

  // Insert item at a specific position
  const handleInsertAt = async (atIndex) => {
    const newItem = {
      label: `Item ${items.length + 1}`,
      action: 'Play',
      input: '',
      active: true
    };
    const result = await addItem(newItem);
    // After adding, reorder to move the new item to the desired position
    if (result && items.length > 0) {
      const newIndex = result.index;
      if (newIndex !== atIndex) {
        // Create new order with the item moved to atIndex
        const newOrder = [...items.map(i => i.index)];
        newOrder.push(newIndex);
        // Remove from end and insert at desired position
        newOrder.pop();
        newOrder.splice(atIndex, 0, newIndex);
        await reorderItems(newOrder);
      }
    }
  };

  const renderItems = (itemsToRender, showInsertButtons = true) => (
    <Box className="items-container">
      <SortableContext
        items={itemsToRender.map(i => i.index)}
        strategy={verticalListSortingStrategy}
      >
        {itemsToRender.map((item, idx) => (
          <React.Fragment key={item.index}>
            {showInsertButtons && idx === 0 && (
              <InsertRowButton onInsert={() => handleInsertAt(0)} />
            )}
            <ListsItemRow
              item={item}
              onUpdate={(updates) => handleInlineUpdate(item.index, updates)}
              onDelete={() => deleteItem(item.index)}
              onToggleActive={() => toggleItemActive(item.index)}
              onDuplicate={() => handleDuplicateItem(item)}
            />
            {showInsertButtons && (
              <InsertRowButton onInsert={() => handleInsertAt(idx + 1)} />
            )}
          </React.Fragment>
        ))}
      </SortableContext>
      <EmptyItemRow onAdd={handleAddItem} nextIndex={items.length} />
    </Box>
  );

  return (
    <Stack gap="md" className="lists-view">
      <Group justify="space-between">
        <Group>
          <ActionIcon variant="subtle" onClick={() => navigate(`/admin/content/lists/${type}`)}>
            <IconArrowLeft size={20} />
          </ActionIcon>
          <Title order={2}>{listTitle}</Title>
        </Group>
        <Group>
          {hasGroups && (
            <SegmentedControl
              size="xs"
              value={viewMode}
              onChange={setViewMode}
              data={[
                { value: 'flat', label: <IconList size={16} /> },
                { value: 'grouped', label: <IconLayoutGrid size={16} /> }
              ]}
            />
          )}
          <TextInput
            placeholder="Search items..."
            leftSection={<IconSearch size={16} />}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: 200 }}
          />
          <Menu position="bottom-end">
            <Menu.Target>
              <ActionIcon variant="subtle" data-testid="list-menu-button">
                <IconDotsVertical size={20} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                color="red"
                leftSection={<IconTrash size={16} />}
                onClick={handleDeleteList}
              >
                Delete {typeLabel}
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

      {/* Table header */}
      {filteredItems.length > 0 && (
        <div className="table-header">
          <div className="col-active"></div>
          <div className="col-drag"></div>
          <div className="col-index"><Text size="xs" fw={600} c="dimmed">#</Text></div>
          <div className="col-label"><Text size="xs" fw={600} c="dimmed">Label</Text></div>
          <div className="col-action"><Text size="xs" fw={600} c="dimmed">Action</Text></div>
          <div className="col-input"><Text size="xs" fw={600} c="dimmed">Input</Text></div>
          <div className="col-menu"></div>
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        {viewMode === 'grouped' && groupedItems ? (
          <Stack gap="lg">
            {groupedItems.sortedGroups.map(groupName => (
              <Box key={groupName} className="item-group">
                <Text size="sm" fw={600} c="dimmed" tt="uppercase" mb="xs" className="group-header">
                  {groupName}
                </Text>
                {renderItems(groupedItems.groups[groupName])}
              </Box>
            ))}
            {groupedItems.ungrouped.length > 0 && (
              <Box className="item-group">
                <Text size="sm" fw={600} c="dimmed" tt="uppercase" mb="xs" className="group-header">
                  Ungrouped
                </Text>
                {renderItems(groupedItems.ungrouped)}
              </Box>
            )}
          </Stack>
        ) : (
          renderItems(filteredItems)
        )}
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
        existingGroups={existingGroups}
      />
    </Stack>
  );
}

export default ListsFolder;
