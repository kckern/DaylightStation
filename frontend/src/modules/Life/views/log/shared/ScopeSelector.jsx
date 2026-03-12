import { SegmentedControl } from '@mantine/core';

const SCOPES = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'season', label: 'Season' },
  { value: 'year', label: 'Year' },
  { value: 'decade', label: 'Decade' },
];

export function ScopeSelector({ value, onChange }) {
  return (
    <SegmentedControl
      data={SCOPES}
      value={value}
      onChange={onChange}
      size="sm"
    />
  );
}
