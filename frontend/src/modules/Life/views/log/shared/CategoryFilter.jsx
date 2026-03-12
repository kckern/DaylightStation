import { Chip, Group } from '@mantine/core';

const CATEGORIES = [
  { value: 'health', label: 'Health' },
  { value: 'fitness', label: 'Fitness' },
  { value: 'calendar', label: 'Calendar' },
  { value: 'productivity', label: 'Productivity' },
  { value: 'social', label: 'Social' },
  { value: 'journal', label: 'Journal' },
  { value: 'finance', label: 'Finance' },
];

export function CategoryFilter({ selected = [], onChange }) {
  return (
    <Chip.Group multiple value={selected} onChange={onChange}>
      <Group gap="xs">
        {CATEGORIES.map(cat => (
          <Chip key={cat.value} value={cat.value} size="xs" variant="outline">
            {cat.label}
          </Chip>
        ))}
      </Group>
    </Chip.Group>
  );
}
