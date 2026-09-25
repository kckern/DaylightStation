import { useEffect, useMemo } from 'react';
import { Stack } from '@mantine/core';
import getLogger from '../../../lib/logging/Logger.js';
import { useCleanup } from '../cleanup/CleanupQuestions.jsx';
import { CleanupHistory } from './CleanupHistory.jsx';

/**
 * /health/auditor: what the nutrition auditor did, why, and what it cost.
 * One cleanup status poll is shared by every section on the page.
 */
export function AuditorPage() {
  const logger = useMemo(() => getLogger().child({ component: 'health-auditor' }), []);
  const resource = useCleanup();
  useEffect(() => { logger.info('health-auditor.mounted', {}); }, [logger]);
  return <Stack gap="md" className="health-auditor">
    {/* Slots, in page order: AuditorHeader, RunTimeline, SpendPanel, AuditorConfig. */}
    <CleanupHistory resource={resource} />
  </Stack>;
}

export default AuditorPage;
