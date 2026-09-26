import { Stack, Text, Table } from '@mantine/core';
import { SectionCard, LoadingState, ErrorState } from '../../../lib/ui';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { unavailableError } from '../healthResources.js';

export const artworkQueuePath = 'api/v1/health/nutrition/artwork-queue';

const KIND_LABELS = { 'icon-missing': 'No icon', 'icon-failed': 'Icon failed', 'photo-failed': 'Photo failed' };
const when = iso => (iso ? new Date(iso).toLocaleString() : '—');
const RESOLUTION_LABELS = { name: 'closest icon by name', ai: 'nearest icon (AI)', reviewed: 'reviewed icon', exact: 'exact icon',
  pin: 'pinned icon', catalog: 'catalog icon', photo: 'product photo', 'upc-photo': 'photo fetched again',
  'asset-ok': 'artwork renders', expanded: 'queued per food', 'nothing-to-fix': 'already fixed' };
const nameOf = item => item.name || item.icon || item.photoRef || item.key;

/**
 * Health > Settings: food whose icon or photo could not be shown. Every item is
 * retried with a growing wait until it is fixed; nothing here is ever dropped.
 */
export function ArtworkQueue() {
  const queue = useApiResource(artworkQueuePath, { swr: true });
  const open = Array.isArray(queue.data?.open) ? queue.data.open : [];
  const resolved = Array.isArray(queue.data?.recentlyResolved) ? queue.data.recentlyResolved.slice(0, 5) : [];
  return <SectionCard title="Artwork queue"><Stack gap="sm">
    <Text size="sm">Food whose icon or photo could not be shown. Each one gets the nearest existing icon, or its product photo, and is retried until it is fixed.</Text>
    {unavailableError(queue) ? <ErrorState error={queue.error} onRetry={queue.reload} label="Artwork queue" /> : null}
    {!queue.data && queue.loading ? <LoadingState label="Artwork queue" /> : null}
    {queue.data && !open.length ? <Text size="sm" c="dimmed">Nothing waiting — every food has artwork.</Text> : null}
    {open.length ? <Table.ScrollContainer minWidth={480}><Table>
      <Table.Thead><Table.Tr><Table.Th>Food</Table.Th><Table.Th>Problem</Table.Th><Table.Th>Attempts</Table.Th><Table.Th>Next attempt</Table.Th><Table.Th>Last error</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>{open.map(item => <Table.Tr key={item.key}>
        <Table.Td>{nameOf(item)}</Table.Td><Table.Td>{KIND_LABELS[item.kind] || item.kind}</Table.Td>
        <Table.Td>{item.attempts ?? 0}</Table.Td><Table.Td>{when(item.nextAttemptAt)}</Table.Td><Table.Td>{item.lastError || '—'}</Table.Td>
      </Table.Tr>)}</Table.Tbody>
    </Table></Table.ScrollContainer> : null}
    {resolved.length ? <details><summary>Recently fixed ({resolved.length})</summary>
      {resolved.map(item => <Text size="sm" key={item.key}>{nameOf(item)} · {RESOLUTION_LABELS[item.resolution?.via] || item.resolution?.via || 'fixed'}
        {item.resolution?.icon ? ` (${item.resolution.icon})` : ''} · {when(item.resolvedAt)}</Text>)}
    </details> : null}
  </Stack></SectionCard>;
}

export default ArtworkQueue;
