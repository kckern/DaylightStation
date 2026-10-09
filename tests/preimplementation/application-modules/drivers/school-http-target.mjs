/** Fixed test-only target selection; candidate never loads a legacy constructor. */
import fs from 'node:fs';
const root = new URL('../../../../', import.meta.url);
export async function loadSchoolHttpTarget(environment = process.env) {
  const target = environment.PRE_TARGET ?? 'baseline';
  if (!['baseline', 'candidate'].includes(target)) throw new Error('UNKNOWN_SCHOOL_HTTP_TARGET');
  if (target === 'candidate' && !environment.PRE_BASELINE_EVIDENCE) throw new Error('SCHOOL_HTTP_BASELINE_EVIDENCE_REQUIRED');
  const server = target === 'baseline' ? 'backend/src/' : 'modules/school/server/';
  const paths = {
    router: server + (target === 'baseline' ? '4_api/v1/routers/' : 'api/') + 'school.mjs',
    lifecycle: server + (target === 'baseline' ? '4_api/v1/routers/' : 'api/') + 'schoolLifecycle.mjs',
    composition: server + (target === 'baseline' ? '5_composition/modules/' : 'composition/') + 'schoolApi.mjs',
    errors: server + (target === 'baseline' ? '2_domains/school/' : 'domain/') + 'errors.mjs',
    gate: server + (target === 'baseline' ? '3_applications/school/' : 'application/') + 'GrownUpGate.mjs',
    assignments: server + (target === 'baseline' ? '3_applications/school/' : 'application/') + 'usecases/SetAssignments.mjs',
    agenda: server + (target === 'baseline' ? '3_applications/school/' : 'application/') + 'services/SchoolLifecycleAgendaResource.mjs',
    middleware: 'backend/src/0_system/http/middleware/index.mjs',
    coreErrors: 'backend/src/2_domains/core/errors/index.mjs',
  };
  for (const file of Object.values(paths)) if (!fs.existsSync(new URL(file, root))) throw new Error('SCHOOL_HTTP_TARGET_MISSING: ' + target + ':' + file);
  const loaded = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([key, file]) => [key, await import(new URL(file, root))])));
  return { target, paths, ...loaded.router, ...loaded.lifecycle, ...loaded.composition,
    ...loaded.errors, ...loaded.gate, ...loaded.assignments, ...loaded.agenda,
    errorHandlerMiddleware: loaded.middleware.errorHandlerMiddleware, coreErrors: loaded.coreErrors };
}
