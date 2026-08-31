import { createSchoolRouter } from '#api/v1/routers/school.mjs';
import { createSchoolApiServices } from '#composition/modules/schoolApi.mjs';

/** Test composition mirroring the production School API service boundaries. */
export function schoolRouterTestOptions(legacy = {}) {
  return createSchoolApiServices(legacy);
}

export function createSchoolTestRouter(options = {}) {
  return createSchoolRouter(schoolRouterTestOptions(options));
}

export default schoolRouterTestOptions;
