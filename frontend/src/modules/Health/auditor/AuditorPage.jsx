import { useEffect, useMemo, useState } from 'react';
import { Stack } from '@mantine/core';
import getLogger from '../../../lib/logging/Logger.js';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { cleanupPath, useCleanup } from '../cleanup/CleanupQuestions.jsx';
import { AuditorHeader } from './AuditorHeader.jsx';
import { RunTimeline } from './RunTimeline.jsx';
import { CleanupHistory } from './CleanupHistory.jsx';

/**
 * /health/auditor: what the nutrition auditor did, why, and what it cost.
 * One cleanup status poll is shared by every section on the page.
 */
export function AuditorPage() {
  const logger = useMemo(() => getLogger().child({ component: 'health-auditor' }), []);
  const resource = useCleanup();
  const spend = useApiResource(`${cleanupPath}/spend?days=30`, { swr: true });
  const [selected, setSelected] = useState(null);
  useEffect(() => { logger.info('health-auditor.mounted', {}); }, [logger]);
  const open = run => { logger.debug('health-auditor.run-open', run); setSelected(run); };
  return <Stack gap="md" className="health-auditor">
    <AuditorHeader resource={resource} spend={spend} />
    <RunTimeline onOpen={open} />
    {/* SpendPanel slot (spend by day, trigger and model). */}
    {null}
    {/* AuditorConfig slot (settings, triggers, permissions). */}
    {null}
    <CleanupHistory resource={resource} />
  </Stack>;
}

export default AuditorPage;
