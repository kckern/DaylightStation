import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Table, Button, ActionIcon, TextInput, NumberInput, Select, Switch, Text, Stack, Group } from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';

/**
 * CrudTable - A reusable editable table for arrays of objects.
 *
 * Used by equipment, devices, members, retailers, device mappings,
 * music playlists, and many more admin sections.
 *
 * Props:
 * - items: Array of objects to display/edit
 * - onChange: (newItems: Array) => void — fires on every cell edit
 * - columns: Array of column definitions
 *     { key, label, type, placeholder?, width?, options? }
 *     type: 'text' | 'number' | 'select' | 'switch' | 'readonly'
 *     options (for select): [{ value, label }]
 * - createDefaults: Object — default values for new rows
 * - addLabel: String — label for the add button (default "Add Item")
 * - confirmDelete: Boolean — if true, requires two clicks to delete
 * - emptyMessage: String — message when items is empty
 */
function CrudTable({
  items = [],
  onChange,
  columns = [],
  createDefaults = {},
  addLabel = 'Add Item',
  confirmDelete = false,
  emptyMessage = 'No items.',
}) {
  // Track the row itself so a caller reorder cannot transfer confirmation to
  // another item at the same index.
  const [pendingDeleteItem, setPendingDeleteItem] = useState(null);
  const pendingDeleteRef = useRef(null);

  // Click-away listener to reset pending delete
  useEffect(() => {
    if (pendingDeleteItem === null) return;
    if (!items.includes(pendingDeleteItem)) {
      setPendingDeleteItem(null);
      return;
    }

    const handleClickAway = (e) => {
      // If the click is not on the pending delete button, reset
      if (pendingDeleteRef.current && !pendingDeleteRef.current.contains(e.target)) {
        setPendingDeleteIndex(null);
      }
    };

    // Use a slight delay so the current click event doesn't immediately trigger
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickAway);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickAway);
    };
  }, [items, pendingDeleteItem]);

  const handleCellChange = useCallback((rowIndex, key, value) => {
    const updated = items.map((item, i) => {
      if (i !== rowIndex) return item;
      return { ...item, [key]: value };
    });
    onChange(updated);
  }, [items, onChange]);

  const handleDelete = useCallback((item) => {
    if (confirmDelete && pendingDeleteItem !== item) {
      setPendingDeleteItem(item);
      return;
    }
    setPendingDeleteItem(null);
    const rowIndex = items.indexOf(item);
    if (rowIndex < 0) return;
    const updated = items.filter((_, i) => i !== rowIndex);
    onChange(updated);
  }, [items, onChange, confirmDelete, pendingDeleteItem]);

  const handleAdd = useCallback(() => {
    const newItem = { ...createDefaults };
    onChange([...items, newItem]);
  }, [items, onChange, createDefaults]);

  const renderCell = (item, column, rowIndex) => {
    const value = item[column.key];

    switch (column.type) {
      case 'text':
        return (
          <TextInput
            size="xs"
            value={value ?? ''}
            placeholder={column.placeholder || ''}
            onChange={(e) => handleCellChange(rowIndex, column.key, e.currentTarget.value)}
            style={column.width ? { width: column.width } : undefined}
          />
        );

      case 'number':
        return (
          <NumberInput
            size="xs"
            hideControls
            value={value ?? ''}
            placeholder={column.placeholder || ''}
            onChange={(val) => handleCellChange(rowIndex, column.key, val)}
            style={column.width ? { width: column.width } : undefined}
          />
        );

      case 'select':
        return (
          <Select
            size="xs"
            value={value ?? null}
            data={column.options || []}
            placeholder={column.placeholder || ''}
            onChange={(val) => handleCellChange(rowIndex, column.key, val)}
            style={column.width ? { width: column.width } : undefined}
            allowDeselect={false}
          />
        );

      case 'switch':
        return (
          <Switch
            size="sm"
            checked={!!value}
            onChange={(e) => handleCellChange(rowIndex, column.key, e.currentTarget.checked)}
          />
        );

      case 'readonly':
        return (
          <Text size="sm" c="dimmed">
            {value ?? ''}
          </Text>
        );

      default:
        return (
          <Text size="sm">{value ?? ''}</Text>
        );
    }
  };

  // Empty state
  if (items.length === 0) {
    return (
      <Stack gap="md">
        <Text size="sm" c="dimmed" ta="center" py="xl">
          {emptyMessage}
        </Text>
        <Group justify="flex-start">
          <Button
            variant="light"
            size="xs"
            leftSection={<IconPlus size={14} />}
            onClick={handleAdd}
          >
            {addLabel}
          </Button>
        </Group>
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      <Table striped highlightOnHover withTableBorder>
        <Table.Thead>
          <Table.Tr>
            {columns.map((col) => (
              <Table.Th key={col.key} style={col.width ? { width: col.width } : undefined}>
                {col.label}
              </Table.Th>
            ))}
            <Table.Th style={{ width: 40 }} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {items.map((item, rowIndex) => {
            const isPendingDelete = confirmDelete && pendingDeleteItem === item;

            return (
              <Table.Tr key={rowIndex}>
                {columns.map((col) => (
                  <Table.Td key={col.key} style={col.width ? { width: col.width } : undefined}>
                    {renderCell(item, col, rowIndex)}
                  </Table.Td>
                ))}
                <Table.Td style={{ width: 40 }}>
                  <div ref={isPendingDelete ? pendingDeleteRef : undefined}>
                    <ActionIcon
                      variant={isPendingDelete ? 'filled' : 'subtle'}
                      color={isPendingDelete ? 'red' : 'gray'}
                      size="sm"
                      onClick={() => handleDelete(item)}
                      title={isPendingDelete ? 'Click again to confirm delete' : 'Delete row'}
                    >
                      <IconTrash size={14} />
                    </ActionIcon>
                  </div>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>

      <Group justify="flex-start">
        <Button
          variant="light"
          size="xs"
          leftSection={<IconPlus size={14} />}
          onClick={handleAdd}
        >
          {addLabel}
        </Button>
      </Group>
    </Stack>
  );
}

export default CrudTable;
