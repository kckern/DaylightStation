// Prod E2E config: run against the deployed container on the app port.
// No dev `webServer` (we test the running prod container, not a dev server).
// Point tests at prod with TEST_FRONTEND_URL=http://localhost:3111.
import base from './playwright.config.mjs';

export default {
  ...base,
  webServer: undefined,
};
