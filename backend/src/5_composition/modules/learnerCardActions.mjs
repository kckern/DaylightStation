import {
  makePrintAgendaHandler as makePrintAgendaWorkflow,
  makeReadingSessionHandler as makeReadingSessionWorkflow,
  makeReadingTimeoutHandler,
} from '#apps/school/workflows/LearnerCardActions.mjs';
import { EventBusSchoolRealtimeAdapter } from '#adapters/eventbus/EventBusSchoolRealtimeAdapter.mjs';

const gatewayFor = ({ realtime, eventBus }) => realtime
  ?? (eventBus ? new EventBusSchoolRealtimeAdapter({ eventBus }) : null);

export function makePrintAgendaHandler(deps = {}) {
  return makePrintAgendaWorkflow({ ...deps, realtime: gatewayFor(deps) });
}

export function makeReadingSessionHandler(deps = {}) {
  return makeReadingSessionWorkflow({ ...deps, realtime: gatewayFor(deps) });
}

export { makeReadingTimeoutHandler };
export default { makePrintAgendaHandler, makeReadingSessionHandler, makeReadingTimeoutHandler };
