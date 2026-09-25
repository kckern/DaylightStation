import { Table, Text } from '@mantine/core';

const keyOf = row => row.uuid || row.id;
const FIELDS = ['name', 'label', 'kind', 'parentId', 'icon', 'photoRef', 'foodId', 'date', 'mealTime', 'amount', 'unit', 'grams', 'calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium', 'cholesterol'];

/** A change value as text; "—" when absent. */
export const changeValue = value => (value == null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value));

/**
 * The `{ id, name, field, from, to }` rows a repair made. A repair history
 * record has `{ before, after }` row arrays; an auditor outcome carries the
 * rows ready-made as `changes` (with `changesOmitted` past its limit).
 */
export function changeRows(record) {
  if (Array.isArray(record?.changes)) return record.changes;
  const rows = [];
  for (const after of record?.after || []) {
    const before = record.before?.find(row => keyOf(row) === keyOf(after));
    for (const field of FIELDS) if (JSON.stringify(before?.[field]) !== JSON.stringify(after[field])) {
      rows.push({ id: keyOf(after), name: after.name || after.label || keyOf(after), field, from: before?.[field], to: after[field] });
    }
  }
  return rows;
}

/**
 * Field-by-field before/after table for one repair: a history record
 * (`{ before, after }`) or an auditor outcome (`{ changes, changesOmitted? }`).
 * Shared by the repair details sheet and the auditor's run detail.
 */
export function RepairChanges({ record }) {
  const rows = changeRows(record);
  const omitted = record?.changesOmitted || 0;
  return <>
    <Table.ScrollContainer minWidth={400}><Table><Table.Thead><Table.Tr><Table.Th>Field</Table.Th><Table.Th>Before</Table.Th><Table.Th>After</Table.Th></Table.Tr></Table.Thead><Table.Tbody>
      {rows.map((row, i) => <Table.Tr key={`${row.id}:${row.field}:${i}`}><Table.Td>{row.name || row.id} · {row.field}</Table.Td>
        <Table.Td>{changeValue(row.from)}</Table.Td><Table.Td>{changeValue(row.to)}</Table.Td></Table.Tr>)}
    </Table.Tbody></Table></Table.ScrollContainer>
    {omitted ? <Text size="xs" c="dimmed">and {omitted} more</Text> : null}
  </>;
}

export default RepairChanges;
