import { createSchoolRouter } from "../../../modules/school/server/api/school.mjs";
import { createSchoolApiServices } from "../../../modules/school/server/composition/schoolApi.mjs";

/** Test composition mirroring the production School API service boundaries. */
export function schoolRouterTestOptions(legacy = {}) {
  return createSchoolApiServices(legacy);
}

export function createSchoolTestRouter(options = {}) {
  return createSchoolRouter(schoolRouterTestOptions(options));
}

export default schoolRouterTestOptions;
