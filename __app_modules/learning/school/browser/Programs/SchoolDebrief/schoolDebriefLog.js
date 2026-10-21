/**
 * Structured log facade for the debrief program (pattern: Feed/Scroll/feedLog.js,
 * CardLadder/cardLadderLog.js). Every event carries the input source.
 */
import getLogger from "../../../../../../frontend/src/lib/logging/Logger.js";
import { currentInput } from "../shared/inputVia.js";

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'school-debrief' });
  return _logger;
}
function emit(event, data, level = 'info') {
  const payload = typeof data === 'object' && data !== null ? { ...data } : {};
  if (!('input' in payload)) payload.input = currentInput();
  logger()[level](`school.debrief.ui.${event}`, payload);
}
export const schoolDebriefLog = {
  mounted: (d) => emit('mounted', d),
  unmounted: (d) => emit('unmounted', d),
  stepEnter: (d) => emit('step.enter', d, 'debug'),
  takeStart: (d) => emit('take.start', d, 'debug'),
  takeKept: (d) => emit('take.kept', d),
  takeRefused: (d) => emit('take.refused', d, 'warn'),
  submit: (d) => emit('submit', d),
  stall: (d) => emit('stall', d),
  resume: (d) => emit('resume', d),
  apiRejected: (d) => emit('api.rejected', d, 'warn'),
  apiFailed: (d) => emit('api.failed', d, 'error'),
  error: (d) => emit('error', d, 'error'),
};
export default schoolDebriefLog;
