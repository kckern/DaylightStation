import { createSchoolPrintScanConsumer as createWorkflow } from '#apps/school/workflows/SchoolPrintScanConsumer.mjs';
import { EventBusSchoolRealtimeAdapter } from '#adapters/eventbus/EventBusSchoolRealtimeAdapter.mjs';

/** Composition compatibility seam: turn the shared bus into School facts. */
export function createSchoolPrintScanConsumer({ eventBus = null, realtime = null, ...deps } = {}) {
  if (!realtime && !eventBus?.subscribe) throw new Error('createSchoolPrintScanConsumer: eventBus with subscribe required');
  if (!realtime && !eventBus?.broadcast) throw new Error('createSchoolPrintScanConsumer: eventBus with broadcast required');
  const gateway = realtime ?? (eventBus ? new EventBusSchoolRealtimeAdapter({ eventBus }) : null);
  return createWorkflow({ ...deps, realtime: gateway });
}

export default createSchoolPrintScanConsumer;
