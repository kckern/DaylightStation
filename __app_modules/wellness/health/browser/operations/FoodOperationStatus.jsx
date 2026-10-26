import { Button } from '@mantine/core';
import { BUCKETS } from "../today/mealBuckets.js";
import { CaptureProgress } from '../today/CaptureProgress.jsx';
import { normalizeFoodOperationResult } from './healthOperationResults.js';
import { useHealthOperations } from './HealthOperationsProvider.jsx';
export function FoodOperationStatus({ operation }) {
  const context = useHealthOperations();
  if (operation.phase === 'succeeded') {
    const destination = operation.normalizedResult?.destination;
    const movedDate = destination?.date && destination.date !== operation.date;
    const movedMeal = destination?.bucket && destination.bucket !== operation.bucket;
    const meal = BUCKETS.find(bucket => bucket.id === destination?.bucket)?.label || destination?.bucket;
    return movedDate || movedMeal ? <p role="status">Added to {movedMeal ? meal : ''}{movedDate ? ` ${destination.date}` : ''}
      <Button size="compact-xs" variant="subtle" onClick={() => context.store.discard(operation.id, { descendants: operation.resumable })}>Dismiss</Button></p> : null;
  }
  const acknowledged = operation.response && normalizeFoodOperationResult(operation, operation.response).outcome === 'committed';
  const text = (operation.kind === 'sentence' ? operation.request?.body?.content : operation.label) || 'Food';
  if (operation.error) return <div role="alert" className="health-row__error">
    <span>{text}: {operation.error}</span>
    {operation.response?.clarification?.choices?.map(choice => <Button key={choice.id} size="compact-xs" onClick={() => {
      const id = context.submitSentence({ text, date: operation.date, bucket: operation.bucket, clarification: choice.id });
      if (id) context.store.discard(operation.id, { descendants: operation.resumable });
    }}>{choice.label}</Button>)}
    {operation.phase !== 'conflict' && (!operation.response || acknowledged || operation.resumable) && <Button size="compact-xs" onClick={() => context.retry(operation.id).catch(() => {})}>{acknowledged ? 'Retry refresh' : 'Retry'}</Button>}
    {!acknowledged && <Button size="compact-xs" variant="subtle" onClick={() => context.store.discard(operation.id, { descendants: operation.resumable })}>Dismiss</Button>}
  </div>;
  return <CaptureProgress startedAt={operation.startedAt} label="Food analysis" text={text}/>;
}
