import { ValidationError } from '#domains/core/errors/index.mjs';

const DEFAULT_PARAMETERS = Object.freeze({ requestRetention: 0.9, maximumIntervalDays: 36500, enableShortTerm: true, learningSteps: ['1m', '10m'], relearningSteps: ['10m'] });
const SAFE_KEYS = new Set(['requestRetention', 'maximumIntervalDays', 'enableShortTerm', 'learningSteps', 'relearningSteps']);

/** Resolve only server-owned scheduler policy sources into one card snapshot. */
export class FlashcardSchedulerPolicyResolver {
  #config; #assignments; #catalog;
  constructor({ configService, assignments, catalog = null } = {}) {
    if (!configService?.getHouseholdAppConfig || !configService?.getUserProfile) throw new Error('FlashcardSchedulerPolicyResolver requires configService');
    if (!assignments?.get) throw new Error('FlashcardSchedulerPolicyResolver requires assignments');
    this.#config = configService; this.#assignments = assignments; this.#catalog = catalog;
  }
  async resolveLaunch({ userId, deck, learning = null, requireAssignment = false } = {}) {
    const assignment = await this.#assignments.get(userId);
    const enrollment = (assignment?.programs ?? []).find((row) => row?.programId === 'flashcards' && (row.deckId ?? row.corpusId) === deck.id) ?? null;
    let bundle = null; let module = null;
    if (learning) {
      if (!this.#catalog?.lesson) throw new ValidationError('Catalog flashcard launch is unavailable');
      bundle = await this.#catalog.lesson({ learnerId: userId, ...learningAddress(learning) });
      module = bundle.lesson?.modules?.find((row) => row.moduleId === learning.moduleId && row.type === 'flashcards') ?? null;
      if (!module || module.deck?.id !== deck.id) throw new ValidationError('Catalog flashcard launch does not match this deck');
    }
    if (requireAssignment && !enrollment && !bundle) throw new ValidationError('This graded flashcard Test is available only to assigned learners');
    const household = this.#config.getHouseholdAppConfig(null, 'school')?.flashcards?.scheduler ?? {};
    const layers = [
      { source: 'household', value: household },
      ...catalogLayers(bundle, module),
      { source: 'deck', value: deck.scheduler ?? {} },
      { source: 'assignment', value: enrollment?.policy?.scheduler ?? {} },
      { source: 'learner', value: this.#config.getUserProfile(userId)?.apps?.school?.flashcards?.scheduler ?? {} },
    ];
    return {
      enrollment, catalog: bundle ? learningAddress(learning) : null, layers, profiles: normalizeProfiles(household),
      studyPolicy: { ...(module?.policy ?? {}), ...(enrollment?.policy ?? {}) },
    };
  }
  resolveCard({ card, launch }) {
    let selected = launch.profiles.defaultProfile;
    let parameters = { ...launch.profiles.byId[selected].parameters };
    const applied = [];
    for (const layer of launch.layers) {
      const value = schedulerBlock(layer.value);
      if (!value) continue;
      if (value.profileId) { selected = profile(launch.profiles, value.profileId).id; parameters = { ...profile(launch.profiles, selected).parameters }; }
      Object.assign(parameters, safeOverrides(value.overrides, `${layer.source}.scheduler.overrides`));
      applied.push(layer.source);
    }
    const conceptBlocks = launch.layers.flatMap((layer) => (card?.concepts ?? []).map((conceptId) => ({ source: `${layer.source}.concepts.${conceptId}`, value: schedulerBlock(layer.value)?.concepts?.[conceptId] })).filter(({ value }) => value));
    const profileSelections = conceptBlocks.filter(({ value }) => value.profileId);
    if (new Set(profileSelections.map(({ value }) => value.profileId)).size > 1) throw new ValidationError(`flashcard '${card.cardId}' has conflicting concept scheduler profiles`);
    const seen = new Map();
    for (const { source, value } of conceptBlocks) {
      if (value.profileId) { selected = profile(launch.profiles, value.profileId).id; parameters = { ...profile(launch.profiles, selected).parameters }; }
      for (const [key, val] of Object.entries(safeOverrides(value.overrides, `${source}.overrides`))) {
        if (seen.has(key) && seen.get(key) !== JSON.stringify(val)) throw new ValidationError(`flashcard '${card.cardId}' has conflicting concept scheduler override '${key}'`);
        seen.set(key, JSON.stringify(val)); parameters[key] = val;
      }
      applied.push(source);
    }
    return Object.freeze({ id: selected, revision: revision(selected, parameters), parameters: Object.freeze(parameters), sources: Object.freeze(applied) });
  }
}

function learningAddress(raw) {
  const result = {};
  for (const field of ['catalogId', 'subjectId', 'courseId', 'unitId', 'lessonId']) {
    if (typeof raw?.[field] !== 'string' || !raw[field]) throw new ValidationError(`flashcard learning.${field} is required`);
    result[field] = raw[field];
  }
  return result;
}
function catalogLayers(bundle, module) {
  if (!bundle) return [];
  return [
    { source: 'catalog', value: bundle.context?.catalog?.scheduler ?? {} }, { source: 'subject', value: bundle.context?.subject?.scheduler ?? {} },
    { source: 'course', value: bundle.context?.course?.scheduler ?? {} }, { source: 'unit', value: bundle.context?.unit?.scheduler ?? {} },
    { source: 'lesson', value: bundle.lesson?.scheduler ?? {} },
    { source: 'module', value: module?.scheduler ?? {} },
  ];
}
function schedulerBlock(raw) { return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null; }
function normalizeProfiles(raw) {
  const profiles = raw?.profiles && typeof raw.profiles === 'object' && !Array.isArray(raw.profiles) ? raw.profiles : {};
  const byId = { default: { id: 'default', parameters: DEFAULT_PARAMETERS } };
  for (const [id, value] of Object.entries(profiles)) byId[id] = { id, parameters: normalizeParameters(value?.parameters ?? value) };
  const defaultProfile = raw?.defaultProfile ?? 'default';
  if (!byId[defaultProfile]) throw new ValidationError(`unknown flashcard scheduler profile '${defaultProfile}'`);
  return { defaultProfile, byId };
}
function profile(profiles, id) {
  if (!profiles.byId[id]) throw new ValidationError(`unknown flashcard scheduler profile '${id}'`);
  return profiles.byId[id];
}
function normalizeParameters(raw) { return { ...DEFAULT_PARAMETERS, ...safeOverrides(raw, 'scheduler profile', { allowWeights: true }) }; }
function safeOverrides(raw, path, { allowWeights = false } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'weights') {
      if (!allowWeights) throw new ValidationError(`${path}.weights is allowed only in a named scheduler profile`);
      if (!Array.isArray(value) || value.length !== 21 || value.some((n) => !Number.isFinite(n))) throw new ValidationError(`${path}.weights must contain 21 finite values`);
      result.weights = [...value]; continue;
    }
    if (!SAFE_KEYS.has(key)) continue;
    if (key === 'requestRetention' && (!Number.isFinite(value) || value <= 0 || value > 1)) throw new ValidationError(`${path}.requestRetention must be > 0 and <= 1`);
    if (key === 'maximumIntervalDays' && (!Number.isInteger(value) || value < 1)) throw new ValidationError(`${path}.maximumIntervalDays must be a positive integer`);
    if (key === 'enableShortTerm' && typeof value !== 'boolean') throw new ValidationError(`${path}.enableShortTerm must be boolean`);
    if (['learningSteps', 'relearningSteps'].includes(key) && (!Array.isArray(value) || value.some((step) => typeof step !== 'string' || !/^\d+[mhd]$/.test(step)))) throw new ValidationError(`${path}.${key} must contain FSRS duration steps`);
    result[key] = Array.isArray(value) ? [...value] : value;
  }
  return result;
}
function revision(id, parameters) { return `${id}:${JSON.stringify(parameters)}`; }
export default FlashcardSchedulerPolicyResolver;
