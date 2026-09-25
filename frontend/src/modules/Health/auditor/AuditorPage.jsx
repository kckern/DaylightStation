import { useEffect, useMemo, useState } from 'react';
import { Stack } from '@mantine/core';
import getLogger from '../../../lib/logging/Logger.js';
import { invalidateApiResources } from '../../../lib/hooks/useApiResource.js';
import { useAuditorSpend } from './useAuditorSpend.js';
import { cleanupPath, useCleanup } from '../cleanup/CleanupQuestions.jsx';
import { AuditorHeader } from './AuditorHeader.jsx';
import { RunTimeline } from './RunTimeline.jsx';
import { CleanupHistory } from './CleanupHistory.jsx';
import { RunDetail } from './RunDetail.jsx';
import { SpendPanel } from './SpendPanel.jsx';
import { AuditorConfig } from './AuditorConfig.jsx';
import { SettingsLog } from './SettingsLog.jsx';

/**
 * /health/auditor: what the nutrition auditor did, why, and what it cost.
 * One cleanup status poll is shared by every section on the page.
 */
export function AuditorPage() {
  const logger = useMemo(() => getLogger().child({ component: 'health-auditor' }), []);
  const resource = useCleanup();
  const spend = useAuditorSpend(resource);
  const [selected, setSelected] = useState(null);
  useEffect(() => { logger.info('health-auditor.mounted', {}); }, [logger]);
  const open = run => { logger.debug('health-auditor.run-open', run); setSelected(run); };
  return <Stack gap="md" className="health-auditor">
    <AuditorHeader resource={resource} spend={spend} />
    <RunTimeline onOpen={open} />
    <SpendPanel spend={spend} capUsd={resource.data ? (resource.data.settings?.dailyCapUsd ?? null) : undefined} />
    <AuditorConfig resource={resource} spend={spend} />
    <SettingsLog />
    <CleanupHistory resource={resource} />
    {selected ? <RunDetail run={selected} onClose={() => setSelected(null)} onUndone={() => { resource.reload(); invalidateApiResources(path => path.startsWith(`${cleanupPath}/history`)); }} /> : null}
  </Stack>;
}

export default AuditorPage;
