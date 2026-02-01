import React from 'react';
import { Group, Text, Badge, Switch, ActionIcon, Menu, Avatar } from '@mantine/core';
import { IconGripVertical, IconEdit, IconTrash, IconCopy, IconDotsVertical } from '@tabler/icons-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

function ListsItemRow({ item, onEdit, onDelete, onToggleActive }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.index
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="item-row">
      <div className="drag-handle" {...attributes} {...listeners}>
        <IconGripVertical size={20} />
      </div>

      <Avatar
        src={item.image}
        size={48}
        radius="sm"
        className="item-thumbnail"
      >
        {item.label?.[0]}
      </Avatar>

      <div className="item-info">
        <Text className="item-label">{item.label}</Text>
        <Text className="item-input">{item.input}</Text>
      </div>

      <Badge color={item.action === 'Play' ? 'blue' : 'gray'} variant="light">
        {item.action || 'Play'}
      </Badge>

      <Switch
        checked={item.active !== false}
        onChange={onToggleActive}
        size="sm"
      />

      <Menu position="bottom-end">
        <Menu.Target>
          <ActionIcon variant="subtle">
            <IconDotsVertical size={16} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item leftSection={<IconEdit size={16} />} onClick={onEdit}>
            Edit
          </Menu.Item>
          <Menu.Item leftSection={<IconCopy size={16} />}>
            Duplicate
          </Menu.Item>
          <Menu.Divider />
          <Menu.Item color="red" leftSection={<IconTrash size={16} />} onClick={onDelete}>
            Delete
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </div>
  );
}

export default ListsItemRow;
