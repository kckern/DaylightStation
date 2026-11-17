import { validateWorkDecisionReply, validateWorkFlowState } from '../domain/workDecisions.mjs';
import { workHash, workError } from '../domain/workState.mjs';
const denied = reason => ({
  handled: true,
  status: 'denied',
  reason
});
const labels = {
  complete: 'Complete task',
  reopen: 'Reopen task',
  transition: 'Move to review',
  create_task: 'Create task',
  update_task: 'Update task',
  delete_task: 'Delete task',
  create_container: 'Create project',
  rename_container: 'Rename project',
  archive_container: 'Archive project'
};
/** Prepared/uncertain deliveries never authorize writes; claims precede any command. */
export class WorkDecisions {
  #state;
  #commands;
  #context;
  #policy;
  #verify;
  #clock;
  #id;
  #tokens;
  #grants = new WeakMap();
  constructor({
    state,
    commands,
    context,
    resolvePolicy,
    verifyPrincipal,
    clock,
    nextId,
    tokens
  }) {
    if (!state?.read || !state?.transact || !commands?.execute || typeof resolvePolicy !== 'function' || typeof verifyPrincipal !== 'function' || typeof clock !== 'function' || typeof nextId !== 'function' || !tokens?.mint || !tokens?.hash) throw new TypeError('Work decision dependencies required');
    this.#state = state;
    this.#commands = commands;
    this.#context = context;
    this.#policy = resolvePolicy;
    this.#verify = verifyPrincipal;
    this.#clock = clock;
    this.#id = nextId;
    this.#tokens = tokens;
  }
  async #change(username, id, asOf, build) {
    for (let n = 0; n < 8; n++) {
      const state = await this.#state.read({
        username
      });
      if (!state.health.available) throw workError('WORK_STATE_UNAVAILABLE');
      const events = build(state);
      if (!events?.length) return {
        ...state,
        transactionApplied: false
      };
      try {
        const result = await this.#state.transact({
          username,
          id: 'decision:' + workHash([id, events]),
          expectedRevision: state.revision,
          events,
          asOf
        });
        return {
          ...(await this.#state.read({
            username
          })),
          transactionApplied: result.applied
        };
      } catch (error) {
        if (error.code !== 'STALE_WORK_REVISION') throw error;
      }
    }
    throw workError('STALE_WORK_REVISION');
  }
  async prepare({
    principal,
    commandId = null,
    flowState = null,
    asOf = this.#clock()
  }) {
    const p = this.#verify(principal);
    if (!p?.authored) throw workError('WORK_PRINCIPAL_REQUIRED');
    if (commandId === null === (flowState === null)) throw workError('INVALID_WORK_DECISION');
    const policy = this.#policy(p.username);
    if (!policy.enabled) throw workError('WORK_DISABLED');
    const state = await this.#state.read({
      username: p.username
    });
    if (!state.health.available) throw workError('WORK_STATE_UNAVAILABLE');
    let text,
      options,
      more = false;
    if (commandId) {
      const record = state.commands[commandId];
      if (!record || record.command.username !== p.username || record.status !== 'queued' || record.policyRevision !== policy.revision) throw workError('WORK_COMMAND_UNAVAILABLE');
      const cmd = record.command,
        domain = policy.domains[cmd.domainId],
        provider = policy.providers[domain.provider];
      let label = cmd.operation === 'transition' ? `Move to ${domain.transitions?.[cmd.payload.transition] ?? 'unavailable'}` : labels[cmd.operation];
      if (provider.type === 'clickup' && cmd.operation.endsWith('_container')) label = label.replace('project', 'List');
      const title = cmd.operation.startsWith('create_') ? cmd.payload.title : record.display?.title ?? record.intent.title ?? cmd.ref?.id;
      const destination = record.display?.destinationTitle ?? cmd.domainId;
      const changes = [...(cmd.operation === 'rename_container' || cmd.operation === 'update_task' && cmd.payload.title ? [`new name: “${cmd.payload.title}”`] : []), ...(cmd.payload.description !== undefined ? [`description: ${cmd.payload.description.slice(0, 500)}`] : []), ...(cmd.payload.dueDate ? [`due: ${cmd.payload.dueDate}`] : []), ...(cmd.operation === 'transition' ? [`status: ${domain.transitions?.[cmd.payload.transition] ?? 'unavailable'}`] : [])];
      text = `${label} “${title}” in ${destination}${changes.length ? '\n' + changes.join('\n') : ''}?`;
      options = [{
        text: label,
        action: 'confirm',
        value: null
      }, {
        text: 'Cancel',
        action: 'cancel',
        value: null
      }];
    } else {
      if (!validateWorkFlowState(flowState) || flowState.policyRevision !== policy.revision || typeof this.#context.renderFlow !== 'function') throw workError('INVALID_WORK_FLOW');
      const rendered = await this.#context.renderFlow({
        principal,
        flowState,
        asOf
      });
      text = rendered.text;
      options = rendered.options;
      more = rendered.more === true;
    }
    if (typeof text !== 'string' || !text || text.length > 3500 || !Array.isArray(options) || !options.length || options.length > 6 || options.filter(choice => choice.action === 'choose').length > 3) throw workError('INVALID_WORK_PAGE');
    const choices = [],
      rows = [];
    for (const option of options) {
      if (typeof option.text !== 'string' || !option.text || option.text.length > 128 || !['confirm', 'cancel', 'choose', 'next', 'back', 'none'].includes(option.action)) throw workError('INVALID_WORK_CHOICE');
      const minted = this.#tokens.mint();
      if (typeof minted.token !== 'string' || minted.token.length > 64 || !minted.hash) throw workError('INVALID_WORK_TOKEN');
      choices.push([{
        text: option.text,
        callback_data: minted.token
      }]);
      rows.push({
        text: option.text,
        action: option.action,
        value: structuredClone(option.value ?? null),
        tokenHash: minted.hash
      });
    }
    const decision = {
      id: 'decision.' + this.#id(),
      username: p.username,
      senderId: p.senderId,
      conversationId: p.conversationId,
      commandId,
      flowState: flowState ? structuredClone(flowState) : null,
      policyRevision: policy.revision,
      createdAt: asOf,
      expiresAt: asOf + 86400000,
      choices: rows,
      status: 'prepared',
      botMessageId: null,
      claimed: null,
      result: null
    };
    await this.#change(p.username, 'prepare:' + decision.id, asOf, () => [{
      type: 'decision.prepared',
      decision
    }]);
    return {
      decisionId: decision.id,
      text,
      choices,
      expiresAt: decision.expiresAt,
      more
    };
  }
  async recordDelivery({
    username,
    decisionId,
    botMessageId,
    asOf = this.#clock()
  }) {
    const messageId = String(botMessageId);
    if (!/^[1-9][0-9]*$/.test(messageId)) throw workError('INVALID_WORK_DELIVERY');
    await this.#change(username, 'deliver:' + decisionId, asOf, state => {
      const d = state.decisions[decisionId];
      if (!d) throw workError('WORK_DECISION_UNAVAILABLE');
      if (d.status === 'delivered' && d.botMessageId === messageId) return [];
      if (d.status !== 'prepared') throw workError('WORK_DECISION_UNAVAILABLE');
      return [{
        type: 'decision.delivered',
        decisionId,
        botMessageId: messageId,
        at: asOf
      }];
    });
  }
  async recordFailure({
    username,
    decisionId,
    uncertain = true,
    asOf = this.#clock()
  }) {
    await this.#change(username, 'failure:' + decisionId, asOf, state => {
      const d = state.decisions[decisionId];
      if (!d || ['claimed', 'resolved'].includes(d.status)) return [];
      return [{
        type: 'decision.failed',
        decisionId,
        uncertain: uncertain === true,
        at: asOf
      }];
    });
  }
  async verifyConfirmation({
    principal,
    command,
    confirmationId,
    asOf = this.#clock()
  }) {
    const p = this.#verify(principal),
      grant = p && this.#grants.get(principal);
    if (!grant || grant.decisionId !== confirmationId || grant.commandHash !== workHash(command)) return false;
    const state = await this.#state.read({
        username: p.username
      }),
      d = state.decisions[confirmationId];
    return state.health.available && d?.status === 'claimed' && d.commandId === command.id && d.claimed.tokenHash === grant.tokenHash && d.policyRevision === this.#policy(p.username).revision && asOf < d.expiresAt;
  }
  async reply({
    principal,
    token,
    botMessageId,
    asOf = this.#clock()
  }) {
    try {
      const p = this.#verify(principal),
        hash = this.#tokens.hash(token);
      if (!p || p.callbackData !== token || !hash) return denied('unverified_callback');
      const state = await this.#state.read({
        username: p.username
      });
      if (!state.health.available) return denied('state_unavailable');
      const decision = Object.values(state.decisions).find(d => d.choices.some(choice => choice.tokenHash === hash));
      const choice = validateWorkDecisionReply({
        decision,
        principal: p,
        tokenHash: hash,
        botMessageId,
        policyRevision: this.#policy(p.username).revision,
        asOf
      });
      if (choice.denied) return denied(choice.denied);
      if (decision.status === 'resolved') return {
        handled: true,
        status: 'already_applied',
        result: decision.result
      };
      if (decision.status === 'claimed') return {
        handled: true,
        status: 'uncertain',
        reason: 'decision_already_claimed'
      };
      const claimed = await this.#change(p.username, 'claim:' + decision.id, asOf, current => current.decisions[decision.id].status === 'delivered' ? [{
        type: 'decision.claimed',
        decisionId: decision.id,
        tokenHash: hash,
        at: asOf
      }] : []);
      if (!claimed.transactionApplied) return {
        handled: true,
        status: 'uncertain',
        reason: 'decision_already_claimed'
      };
      let result, page;
      if (choice.action === 'cancel' || choice.action === 'none') result = {
        status: 'cancelled'
      };else if (decision.commandId) {
        const command = claimed.commands[decision.commandId].command;
        this.#grants.set(principal, {
          decisionId: decision.id,
          commandHash: workHash(command),
          tokenHash: hash
        });
        const remote = await this.#commands.execute({
          principal,
          commandId: command.id,
          confirmationId: decision.id,
          asOf
        });
        result = {
          status: remote.outcome,
          result: remote
        };
      } else {
        if (typeof this.#context.applyFlowChoice !== 'function') result = {
          status: 'denied',
          reason: 'flow_unavailable'
        };else {
          const response = await this.#context.applyFlowChoice({
            principal,
            flowState: decision.flowState,
            choice,
            asOf
          });
          page = response?.page ?? null;
          result = {
            status: response?.status ?? 'selected',
            ...(page ? {
              decisionId: page.decisionId
            } : {})
          };
        }
      }
      await this.#change(p.username, 'resolve:' + decision.id, asOf, current => current.decisions[decision.id].status === 'claimed' ? [{
        type: 'decision.resolved',
        decisionId: decision.id,
        result,
        at: asOf
      }] : []);
      return {
        handled: true,
        ...result,
        ...(page ? {
          page
        } : {})
      };
    } catch {
      return {
        handled: true,
        status: 'uncertain',
        reason: 'decision_boundary_failed'
      };
    } finally {
      if (principal && typeof principal === 'object') this.#grants.delete(principal);
    }
  }
}
