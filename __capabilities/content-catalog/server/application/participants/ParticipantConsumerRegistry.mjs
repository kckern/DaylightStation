const actions = ['open','play','queue','display'];
const validId = v => typeof v === 'string' && v.trim() === v && v.length > 0 && v.length <= 256;
function fail(message) { const error = new Error(message); error.code = 'invalid_participant_registration'; throw error; }
function matchKey(m) { return JSON.stringify(m.kind === 'app' ? [m.action,m.kind,m.appId] : [m.action,m.kind,m.source,m.capability]); }
// Different capabilities of one source can occur on the same item.
function overlaps(a,b) { return a.action === b.action && a.kind === b.kind && (a.kind === 'app' ? a.appId === b.appId : a.source === b.source); }
function validateMatcher(m) {
  if (!m || !actions.includes(m.action)) fail('Invalid action matcher');
  const keys = m.kind === 'app' ? ['action','kind','appId'] : m.kind === 'content' ? ['action','kind','source','capability'] : [];
  if (!keys.length || Object.keys(m).length !== keys.length || keys.some(k => !validId(m[k]))) fail('Invalid target matcher');
}
/** @typedef {import('./ParticipantPorts.mjs').IParticipantConsumer} IParticipantConsumer */
export class ParticipantConsumerRegistry {
  #versions = new Map(); #matchers = new Map();
  register({consumer, authorizeDirectAccess} = {}) {
    if (!consumer || !validId(consumer.id) || !Number.isSafeInteger(consumer.version) || consumer.version < 1 || !Array.isArray(consumer.targets) || !consumer.targets.length || ['describe','prepareSetup','begin'].some(k => typeof consumer[k] !== 'function')) fail('Invalid consumer');
    if (authorizeDirectAccess !== undefined && typeof authorizeDirectAccess !== 'function') fail('Invalid direct authorization');
    if ((typeof consumer.findResumable === 'function') !== (typeof consumer.resume === 'function')) fail('Resume methods must be paired');
    for (const optional of ['findResumable','resume','retainPrepared','resolveDefaultContext','remapParticipantKeys']) if (consumer[optional] !== undefined && typeof consumer[optional] !== 'function') fail(`Invalid ${optional}`);
    const versionKey = JSON.stringify([consumer.id,consumer.version]);
    if (this.#versions.has(versionKey)) fail('Duplicate consumer version');
    const entries = consumer.targets.map(m => { validateMatcher(m); return [matchKey(m),{...m}]; });
    const matchers = entries.map(([,m]) => m);
    if (matchers.some((m,i) => matchers.slice(0,i).some(other => overlaps(m,other)) || [...this.#matchers.values()].some(({matcher}) => overlaps(m,matcher)))) fail('Overlapping participant matcher');
    const registration = {consumer, authorizeDirectAccess};
    this.#versions.set(versionKey,registration);
    for (const [key,matcher] of entries) this.#matchers.set(key,{...registration,matcher});
    return consumer;
  }
  get({id,version} = {}) { return this.#versions.get(JSON.stringify([id,version]))?.consumer ?? null; }
  /** Returns the registered consumer only when the resolved server target independently declares it. */
  resolve({action,target} = {}) {
    if (!actions.includes(action) || !target || typeof target !== 'object') return null;
    const matches = [...this.#matchers.values()].filter(({matcher:m}) => m.action === action && m.kind === target.kind && (m.kind === 'app' ? m.appId === target.appId : m.source === target.source && Object.hasOwn(target.capabilities ?? {},m.capability)));
    if (matches.length > 1) fail('Ambiguous target capabilities');
    if (target.kind === 'content') {
      for (const [capability, descriptor] of Object.entries(target.capabilities ?? {})) {
        if ((capability !== action && descriptor?.action !== action) || !Object.hasOwn(descriptor ?? {}, 'participantConsumer')) continue;
        const declaration = descriptor.participantConsumer;
        const match = matches.find(entry => entry.matcher.capability === capability);
        if ((descriptor.action !== undefined && descriptor.action !== action) || !declaration || !match || declaration.id !== match.consumer.id || declaration.version !== match.consumer.version) fail('Declared consumer does not match target action');
      }
    }
    if (!matches.length) {
      // An app's declaration can cover a different action on the same app.
      // Content declarations are action-specific capabilities, not ambient item state.
      const declaration = target.kind === 'app' ? target.participantConsumer : undefined;
      if (declaration !== undefined) {
        if (!declaration || typeof declaration !== 'object') fail('Invalid declared consumer');
        const installed = this.get(declaration);
        if (!installed) fail('Declared consumer is unavailable');
        const sibling = installed.targets.some(m => m.kind === target.kind && m.action !== action && (m.kind === 'app' ? m.appId === target.appId : m.source === target.source));
        if (!sibling) fail('Declared consumer does not match target action');
      }
      return null;
    }
    const {consumer,matcher} = matches[0];
    const declaration = matcher.kind === 'app' ? target.participantConsumer : target.capabilities[matcher.capability]?.participantConsumer;
    if (declaration === undefined) return null;
    if (!declaration || declaration.id !== consumer.id || declaration.version !== consumer.version) fail('Stale declared consumer');
    return consumer;
  }
  describe(input) { const consumer = this.resolve(input); return consumer ? consumer.describe(input.target) : null; }
  directAccess({id,version} = {}) { return this.#versions.get(JSON.stringify([id,version]))?.authorizeDirectAccess ?? null; }
  remapActivitySettings({consumer,settings,participantKeyMap}) {
    const registered = this.get(consumer);
    if (!registered || typeof registered.remapParticipantKeys !== 'function') fail('Consumer settings remapper unavailable');
    return registered.remapParticipantKeys({settings:structuredClone(settings),keyMap:structuredClone(participantKeyMap)});
  }
}
