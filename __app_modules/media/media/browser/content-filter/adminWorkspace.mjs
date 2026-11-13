/**
 * Public entry for the Admin content-filter workspace (frontend/src/modules/Admin/ContentFilter):
 * the preview store the review page drives the Player through, and the effect words the preview
 * uses, so Admin and the preview name effects alike.
 */
export { previewStore } from './preview/previewStore.js';
export { effectChip, effectWord } from './preview/effectKinds.js';
// One stage vocabulary for server and Admin (order is ascending readiness).
export { STAGES, STAGE_LABELS } from '../../server/domain/content-filter/filmStage.mjs';
export { NEXT_ACTIONS } from '../../server/domain/content-filter/filmStatus.mjs';
