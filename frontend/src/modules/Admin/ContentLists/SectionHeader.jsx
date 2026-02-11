import React, { useState } from 'react';
import {
  Group, Text, ActionIcon, Badge, Collapse, TextInput, Menu
} from '@mantine/core';
import {
  IconChevronDown, IconChevronRight, IconSettings,
  IconTrash, IconDotsVertical, IconGripVertical,
  IconArrowsShuffle, IconSortAscending,
  IconArrowUp, IconArrowDown
} from '@tabler/icons-react';

function SectionHeader({
  section,
  sectionIndex,
  collapsed,
  onToggleCollapse,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
  itemCount,
  dragHandleProps
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(section.title || '');

  const handleTitleSave = () => {
    setEditingTitle(false);
    if (titleValue !== (section.title || '')) {
      onUpdate(sectionIndex, { title: titleValue || undefined });
    }
  };

  const isAnonymous = !section.title;

  // Don't render header for the sole anonymous section in single-section lists
  if (isAnonymous && isFirst && isLast) return null;

  return (
    <Group
      className="section-header"
      justify="space-between"
      px="xs"
      py={6}
      style={{ borderBottom: '1px solid var(--mantine-color-dark-4)' }}
    >
      <Group gap="xs">
        <div {...(dragHandleProps || {})} style={{ cursor: 'grab' }}>
          <IconGripVertical size={14} stroke={1.5} color="gray" />
        </div>
        <ActionIcon variant="subtle" size="xs" onClick={() => onToggleCollapse(sectionIndex)}>
          {collapsed ? <IconChevronRight size={14} /> : <IconChevronDown size={14} />}
        </ActionIcon>
        {editingTitle ? (
          <TextInput
            size="xs"
            value={titleValue}
            onChange={(e) => setTitleValue(e.target.value)}
            onBlur={handleTitleSave}
            onKeyDown={(e) => e.key === 'Enter' && handleTitleSave()}
            autoFocus
            style={{ width: 200 }}
          />
        ) : (
          <Text
            size="sm"
            fw={600}
            c={isAnonymous ? 'dimmed' : undefined}
            onClick={() => setEditingTitle(true)}
            style={{ cursor: 'pointer' }}
          >
            {section.title || `Section ${sectionIndex + 1}`}
          </Text>
        )}
        <Badge size="xs" variant="light" color="gray">{itemCount}</Badge>
        {section.shuffle && <Badge size="xs" variant="light" color="violet">shuffle</Badge>}
        {section.limit && <Badge size="xs" variant="light" color="teal">limit: {section.limit}</Badge>}
        {section.fixed_order && <Badge size="xs" variant="light" color="blue">fixed</Badge>}
        {section.days && <Badge size="xs" variant="light" color="orange">{section.days}</Badge>}
      </Group>
      <Menu position="bottom-end">
        <Menu.Target>
          <ActionIcon variant="subtle" size="xs">
            <IconDotsVertical size={14} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item leftSection={<IconSettings size={14} />} onClick={() => onUpdate(sectionIndex, null)}>
            Section Settings
          </Menu.Item>
          {!isFirst && (
            <Menu.Item leftSection={<IconArrowUp size={14} />} onClick={() => onMoveUp(sectionIndex)}>
              Move Up
            </Menu.Item>
          )}
          {!isLast && (
            <Menu.Item leftSection={<IconArrowDown size={14} />} onClick={() => onMoveDown(sectionIndex)}>
              Move Down
            </Menu.Item>
          )}
          <Menu.Divider />
          <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={() => onDelete(sectionIndex)}>
            Delete Section
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Group>
  );
}

export default SectionHeader;
