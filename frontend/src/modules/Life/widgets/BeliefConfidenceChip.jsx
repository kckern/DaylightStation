import { Badge, Tooltip } from '@mantine/core';
import { beliefConfidenceColor } from '../theme/semantics.js';

export function BeliefConfidenceChip({ belief }) {
  const { id, confidence, effectiveConfidence, state, foundational } = belief;
  const displayConf = effectiveConfidence ?? confidence;
  const pct = Math.round(displayConf * 100);

  return (
    <Tooltip label={`${id}: ${state} (raw: ${Math.round(confidence * 100)}%)`}>
      <Badge
        color={beliefConfidenceColor(displayConf)}
        variant={foundational ? 'filled' : 'light'}
        size="lg"
      >
        {pct}%
      </Badge>
    </Tooltip>
  );
}
