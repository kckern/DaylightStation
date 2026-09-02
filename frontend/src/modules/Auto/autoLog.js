// frontend/src/modules/Auto/autoLog.js
//
// Category facade over the DS structured logger for the Auto app — the same
// facade shape every panel already imports (debug/info/warn/error), now built
// on the shared createAppLogger('auto') rather than a bespoke lazy-init copy.
// Superset-compatible: createAppLogger also exposes sampled()/child(), which
// no caller here uses yet, but nothing breaks by their being present.

import { createAppLogger } from '@/lib/ui/createAppLogger.js';

export const autoLog = createAppLogger('auto');

export default autoLog;
