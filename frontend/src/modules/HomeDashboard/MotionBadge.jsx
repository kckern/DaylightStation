import { Badge } from '@mantine/core';
import './MotionBadge.scss';

export default function MotionBadge({ motion }) {
  if (!motion) return null;
  if (!motion.available) {
    return (
      <Badge color="gray" variant="light" className="motion-badge motion-badge--unavailable">
        —
      </Badge>
    );
  }
  if (motion.state === 'motion') {
    return (
      <Badge color="red" className="motion-badge motion-badge--active">
        Motion now
      </Badge>
    );
  }
  const ago = motion.lastChangedIso ? formatAgo(motion.lastChangedIso) : '';
  return (
    <Badge color="green" variant="light" className="motion-badge motion-badge--clear">
      Clear {ago && `· ${ago}`}
    </Badge>
  );
}

function formatAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diffMs / 60_000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}
