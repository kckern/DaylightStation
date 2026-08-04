import { validateLearningAction } from '#domains/school/catalog/index.mjs';

/**
 * Bind authored scan-action IDs to device-specific opaque tokens immediately
 * before family compilation. Catalog/publication reads stay mutation-free;
 * the immutable artifact receives no server-side target or policy fields.
 */
export class HydrateSchoolCalcActions {
  #content; #issuer;

  constructor({ content, issuer } = {}) {
    if (!content || typeof content.getLearningAction !== 'function' || !issuer || typeof issuer.issue !== 'function') {
      throw new Error('HydrateSchoolCalcActions requires content and an action-token issuer');
    }
    this.#content = content;
    this.#issuer = issuer;
  }

  async execute({ deviceId, bundle } = {}) {
    if (typeof deviceId !== 'string' || !deviceId || bundle?.schema !== 'school.learning-lesson/v1') {
      throw new Error('SchoolCalc action hydration requires a deviceId and lesson bundle');
    }
    const hydrated = structuredClone(bundle);
    const bindings = [];
    for (const module of hydrated.lesson.modules) {
      if (module.type !== 'lecture_notes') continue;
      for (const block of module.document?.blocks ?? []) {
        if (block.type !== 'scan_action') continue;
        // eslint-disable-next-line no-await-in-loop
        const raw = await this.#content.getLearningAction(block.actionId);
        if (!raw) throw new Error(`SchoolCalc action '${block.actionId}' was not found during hydration`);
        const validation = validateLearningAction(raw);
        if (validation.errors.length) {
          throw new Error(`SchoolCalc action '${block.actionId}' is invalid during hydration: ${validation.errors.join('; ')}`);
        }
        const action = validation.action;
        if (action.actionId !== block.actionId || !action.enabled) {
          throw new Error(`SchoolCalc action '${block.actionId}' changed or was disabled before compilation`);
        }
        const binding = Object.freeze({
          deviceId,
          address: hydrated.address,
          actionId: block.actionId,
          tokenVersion: action.tokenVersion,
        });
        // Registration is idempotent and happens before bytes are persisted.
        // eslint-disable-next-line no-await-in-loop
        const issued = await this.#issuer.issue(binding);
        block.token = issued.token;
        bindings.push(Object.freeze({ ...binding, token: issued.token, status: issued.status }));
      }
    }
    return Object.freeze({ bundle: hydrated, bindings: Object.freeze(bindings) });
  }
}

export default HydrateSchoolCalcActions;
