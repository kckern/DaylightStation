import { presentationAction } from '../../presentation/scenes/contracts.mjs';

const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const record = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Authority-safe state handed to an optional presentation renderer. */
export function gamingPresentationProjection({ experienceId, sessionId, revision, scene, model = {} }) {
  if (!ID.test(String(experienceId || ''))) throw new Error('Gaming presentation experienceId is invalid');
  if (!ID.test(String(sessionId || ''))) throw new Error('Gaming presentation sessionId is invalid');
  if (!Number.isInteger(revision) || revision < 0) throw new Error('Gaming presentation revision is invalid');
  if (!record(scene) || !ID.test(String(scene.id || ''))) throw new Error('Gaming presentation scene is invalid');
  if (!record(model)) throw new Error('Gaming presentation model must be an object');
  return Object.freeze({
    schema: 'gaming-presentation/v1', experience_id: experienceId, session_id: sessionId, revision,
    scene: structuredClone(scene), model: structuredClone(model),
  });
}

/** Renderer input travels back as a semantic action; it never mutates game state directly. */
export function gamingPresentationIntent(action, options = {}) {
  return Object.freeze({ schema: 'gaming-presentation-intent/v1', ...presentationAction(action, options) });
}
