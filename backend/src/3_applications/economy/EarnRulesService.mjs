/**
 * The household's earn rules: read them, and change them as numbered,
 * archived revisions. Every write is stamped with who made it and when, so a
 * week's preview (which records the revision it priced at) can always be
 * explained later. Authorization is the caller's job — each surface (teacher
 * console, admin, CLI) gates its own route and passes the verified actor.
 */
import { DEFAULT_RULESET, RULE_KINDS, validateRuleset, withUserOverride } from '#domains/economy/earnings/index.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';

export class EarnRulesService {
  #store;
  #clock;
  #logger;
  // Read-modify-write, one at a time: two edits in flight must each build on
  // the other, not both read revision N and both write N+1.
  #chain = Promise.resolve();

  /**
   * @param {object} deps
   * @param {import('./ports/IEarnRulesStore.mjs').IEarnRulesStore} deps.store
   * @param {() => Date} deps.clock
   * @param {object} [deps.logger]
   */
  constructor({ store, clock, logger = console }) {
    if (!store) throw new Error('EarnRulesService requires store');
    if (typeof clock !== 'function') throw new Error('EarnRulesService requires clock');
    this.#store = store;
    this.#clock = clock;
    this.#logger = logger;
  }

  /** The rules in force: the stored document, or the built-in default (revision 0). */
  async get() {
    const doc = await this.#store.read();
    return validateRuleset(doc ?? DEFAULT_RULESET);
  }

  /** The rules in force plus the vocabulary an editor needs (the rule kinds). */
  async describe() {
    return { ruleset: await this.get(), kinds: [...RULE_KINDS] };
  }

  async history() {
    return this.#store.history();
  }

  /**
   * Set or clear one learner's rates.
   * @param {{learnerId: string, patch: object, actorId: string}} args
   */
  async setUserOverride({ learnerId, patch, actorId }) {
    this.#requireActor(actorId);
    return this.#serialize(async () => {
      const current = await this.get();
      return this.#commit(current, withUserOverride(current, learnerId, patch ?? {}), actorId, { learnerId });
    });
  }

  /**
   * Replace the household rules. Learner overrides are kept unless the new
   * document names its own `users`; a kept override naming a removed rule is
   * refused by validation, so a rule cannot vanish under someone's rates.
   */
  async replace({ doc, actorId }) {
    this.#requireActor(actorId);
    return this.#serialize(async () => {
      const current = await this.get();
      const next = validateRuleset({ ...doc, users: doc?.users ?? current.users });
      return this.#commit(current, next, actorId, { rules: next.rules.length });
    });
  }

  #serialize(task) {
    const run = this.#chain.then(task);
    this.#chain = run.catch(() => {});
    return run;
  }

  #requireActor(actorId) {
    if (typeof actorId !== 'string' || !actorId) {
      throw new ValidationError('an actor is required to change earn rules', { code: 'ACTOR_REQUIRED', field: 'actorId' });
    }
  }

  async #commit(current, next, actorId, context) {
    const doc = {
      ...next,
      revision: current.revision + 1,
      revisedAt: this.#clock().toISOString(),
      revisedBy: actorId,
    };
    await this.#store.write(doc, { previous: current });
    this.#logger.info?.('economy.earn-rules.revised', { revision: doc.revision, revisedBy: actorId, ...context });
    return doc;
  }
}

export default EarnRulesService;
