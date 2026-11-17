// Runs ONLY the gallery capture script (capture.gallery.jsx), which the gate's
// default *.test.* include never collects: it writes snapshot files, it is a
// tool, not a test.
import base from '../../../_infrastructure/config/vitest.config.mjs';
export default { ...base, test: { ...base.test, include: ['tests/_fixtures/school/style-gallery/capture.gallery.jsx'] } };
