import { Badge, Tooltip } from '@mantine/core';

function confidenceColor(confidence) {
  if (confidence >= 0.8) return 'green';
  if (confidence >= 0.5) return 'yellow';
  return 'red';
}

export function BeliefConfidenceChip({ belief }) {
  const { id, confidence, effectiveConfidence, state, foundational } = belief;
  const displayConf = effectiveConfidence ?? confidence;
  const pct = Math.round(displayConf * 100);

  return (
    <Tooltip label={`${id}: ${state} (raw: ${Math.round(confidence * 100)}%)`}>
      <Badge
        color={confidenceColor(displayConf)}
        variant={foundational ? 'filled' : 'light'}
        size="lg"
      >
        {pct}%
      </Badge>
    </Tooltip>
  );
}
