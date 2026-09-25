import { Table } from '@mantine/core';

const keyOf = row => row.uuid || row.id;
const FIELDS = ['name', 'label', 'kind', 'parentId', 'icon', 'photoRef', 'foodId', 'date', 'mealTime', 'amount', 'unit', 'grams', 'calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium', 'cholesterol'];

/**
 * Field-by-field before/after table for one repair record (`{ before, after }`
 * row arrays). Shared by the repair details sheet and the auditor's run detail.
 */
export function RepairChanges({ record }) {
  const rows = [];
  for (const after of record.after || []) {
    const before = record.before?.find(row => keyOf(row) === keyOf(after));
    for (const field of FIELDS) if (JSON.stringify(before?.[field]) !== JSON.stringify(after[field])) rows.push(
      <Table.Tr key={`${keyOf(after)}:${field}`}><Table.Td>{after.name || after.label || keyOf(after)} · {field}</Table.Td>
        <Table.Td>{String(before?.[field] ?? '—')}</Table.Td><Table.Td>{String(after[field] ?? '—')}</Table.Td></Table.Tr>);
  }
  return <Table.ScrollContainer minWidth={400}><Table><Table.Thead><Table.Tr><Table.Th>Field</Table.Th><Table.Th>Before</Table.Th><Table.Th>After</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{rows}</Table.Tbody></Table></Table.ScrollContainer>;
}

export default RepairChanges;
