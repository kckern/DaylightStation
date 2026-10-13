import { createSchoolRouter } from "../../../__app_modules/learning/school/server/api/school.mjs";
import { createSchoolApiServices } from "../../../__app_modules/learning/school/server/composition/schoolApi.mjs";

/** Test composition mirroring the production School API service boundaries. */
export function schoolRouterTestOptions(legacy = {}) {
  return createSchoolApiServices(legacy);
}

export function createSchoolTestRouter(options = {}) {
  return createSchoolRouter(schoolRouterTestOptions(options));
}

export default schoolRouterTestOptions;
