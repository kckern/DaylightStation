/**
 * learnerActions — what a school learner card DOES, keyed by the reader
 * location's `learner_action`.
 *
 * Layer: APPLICATION (3_applications/trigger). A registry, not a policy: it
 * knows the op names and nothing about School, so the trigger pipeline stays
 * free of a domain dependency and School registers itself at composition.
 *
 * AN UNREGISTERED OP IS A NAMED REFUSAL, NEVER A FALLBACK. If `reading-session`
 * has no handler yet, the tap must say so — not run `print-agenda` because it
 * happens to be the only learner action wired. A preschooler tapping their card
 * in the living room and hearing a printer start up two rooms away is worse than
 * nothing happening.
 *
 * Registration is strict for the same reason: a duplicate `register` is a
 * composition bug where two owners each believe they define an op, and
 * last-one-wins would hide it until a child tapped a card and got the other
 * one's behaviour.
 *
 * @module applications/trigger/learnerActions
 */
export function createLearnerActions({ logger = console } = {}) {
  const handlers = new Map();
  return {
    register(op, handler) {
      if (!op || typeof op !== 'string') throw new Error('learnerActions.register requires an op name');
      if (typeof handler !== 'function') throw new Error(`learnerActions.register('${op}') requires a function`);
      if (handlers.has(op)) throw new Error(`learnerActions: duplicate handler for '${op}'`);
      handlers.set(op, handler);
      logger.debug?.('trigger.learner.registered', { op });
    },
    has(op) { return handlers.has(op); },
    list() { return [...handlers.keys()]; },
    get(op) { return handlers.get(op) ?? null; },
  };
}

export default createLearnerActions;
