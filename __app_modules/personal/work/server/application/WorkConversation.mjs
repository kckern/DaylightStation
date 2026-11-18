import { matchWorkIntent } from '../domain/workIntent.mjs';
import { keyOf } from '../domain/workModel.mjs';
import { workHash, workError } from '../domain/workState.mjs';
/** Verified saved journal input and explicit Work flows; never scans old backlog on boot. */
export class WorkConversation {
  #state;
  #context;
  #commands;
  #decisions;
  #principal;
  #evidence;
  #extractor;
  #policy;
  #scheduler;
  #clock;
  #deliver;
  #logger;
  #timers = new Map();
  #principals = new Map();
  #drains = new Map();
  #closed = false;
  constructor({
    state,
    context,
    commands,
    decisions,
    principalAuthority,
    evidence,
    intentExtractor,
    resolvePolicy,
    scheduler,
    clock,
    deliver = null,
    logger
  }) {
    if (!state?.read || !state?.transact || !context?.execute || !commands?.propose || !decisions?.prepare || !principalAuthority?.verify || !evidence?.readByRefs || !evidence?.readForMessage || !intentExtractor?.extract || !scheduler?.after || typeof resolvePolicy !== 'function' || typeof clock !== 'function') throw new TypeError('Work conversation dependencies required');
    this.#state = state;
    this.#context = context;
    this.#commands = commands;
    this.#decisions = decisions;
    this.#principal = principalAuthority;
    this.#evidence = evidence;
    this.#extractor = intentExtractor;
    this.#policy = resolvePolicy;
    this.#scheduler = scheduler;
    this.#clock = clock;
    this.#deliver = deliver;
    this.#logger = logger;
  }
  capturePrincipal(input) {
    return this.#closed ? null : this.#principal.capturePrincipal(input);
  }
  sourceForEntry({
    principal,
    chatId,
    messageId,
    senderId
  }) {
    const p = !this.#closed && this.#principal.verify(principal);
    if (!p || !p.authored || !['text', 'voice'].includes(p.kind) || p.conversationId !== chatId || p.messageId !== String(messageId) || p.senderId !== String(senderId)) return null;
    return {
      platform: 'telegram',
      conversationId: chatId,
      messageId: p.messageId,
      senderId: p.senderId,
      replyToMessageId: p.replyToMessageId ?? null,
      verified: true,
      ...(p.edited ? {
        edited: true,
        editDate: p.editDate,
        updateId: p.updateId
      } : {})
    };
  }
  async #change(username, id, asOf, build) {
    for (let n = 0; n < 8; n++) {
      if (this.#closed) throw workError('WORK_CLOSED');
      const state = await this.#state.read({
        username
      });
      if (!state.health.available) throw workError('WORK_STATE_UNAVAILABLE');
      const events = build(state);
      if (!events?.length) return state;
      try {
        await this.#state.transact({
          username,
          id: 'source:' + workHash([id, events]),
          expectedRevision: state.revision,
          events,
          asOf
        });
        return await this.#state.read({
          username
        });
      } catch (error) {
        if (error.code !== 'STALE_WORK_REVISION') throw error;
      }
    }
    throw workError('STALE_WORK_REVISION');
  }
  async verifySource({
    principal,
    intent,
    command,
    asOf = this.#clock()
  }) {
    const p = !this.#closed && this.#principal.verify(principal);
    if (!p?.authored || !this.#policy(p.username).enabled) return false;
    const receipt = command?.sourceReceipt ?? intent?.sourceReceipt,
      state = await this.#state.read({
        username: p.username
      }),
      source = state.sources?.[receipt];
    if (!state.health.available || !source?.valid || source.username !== p.username || source.senderId !== p.senderId || source.conversationId !== p.conversationId || source.authRevision !== p.sourceRevision || asOf - source.observedAt > 86400000) return false;
    if (source.kind === 'interactive') return intent?.mode !== 'auto';
    if (intent?.mode === 'auto' && (p.kind !== 'text' || p.edited || p.receiptId !== source.principalReceipt || !(source.observations ?? []).some(o => keyOf(o.ref) === keyOf(intent.ref) && o.version === intent.expectedVersion && o.occurrenceId === (intent.expectedOccurrenceId ?? null)))) return false;
    if (intent?.mode === 'auto' && typeof intent.title === 'string') {
      const later = Object.values(state.sources).filter(row => row.kind === 'journal' && row.valid && row.conversationId === source.conversationId && (row.ordinal ?? 0) > (source.ordinal ?? 0));
      if (later.length) {
        const rows = await this.#evidence.readByRefs({
          username: p.username,
          refs: later.map(row => row.ref)
        });
        if (later.some(row => row.replyToMessageId === source.messageId)) return false;
        if (rows.some(row => row.content.toLowerCase().includes(intent.title.toLowerCase()) || /\b(?:actually|correction|retract|didn.t|haven.t|not yet|was wrong|never mind)\b/i.test(row.content) && (row.replyToMessageId === source.messageId || row.at - source.at <= 15 * 60000))) return false;
      }
    }
    const rows = await this.#evidence.readByRefs({
      username: p.username,
      refs: [source.ref]
    });
    return rows.length === 1 && (intent?.mode !== 'auto' || intent.statement === rows[0].content) && rows[0].verified && !rows[0].previewOnly && rows[0].sourceHash === source.sourceHash && rows[0].senderId === p.senderId && rows[0].conversationId === p.conversationId;
  }
  async onEntrySaved({
    principal,
    message,
    asOf = this.#clock()
  }) {
    const p = !this.#closed && this.#principal.verify(principal);
    if (!p?.authored || !['text', 'voice'].includes(p.kind) || !this.#policy(p.username).enabled) return {
      handled: false
    };
    const row = await this.#evidence.readForMessage({
      username: p.username,
      conversationId: p.conversationId,
      messageId: p.messageId,
      revision: message.source?.revision ?? null
    });
    if (!row?.verified || row.previewOnly || row.senderId !== p.senderId || row.conversationId !== p.conversationId || row.messageId !== p.messageId || row.content !== (message.content ?? message.text) || row.at > asOf || !p.edited && asOf - row.at > 86400000) return {
      handled: false
    };
    const explicit = /^(?:please\s+)?(?:add|create|rename|delete|archive|reopen|mark|update)\b/i.test(row.content.trim()) && /\b(?:task|project|todo|to-do|list|done|complete)\b/i.test(row.content);
    const atEntry = await this.#context.execute({
      username: p.username,
      asOf
    });
    const observations = atEntry.coverage.complete ? atEntry.items.filter(item => row.content.toLowerCase().includes(item.title.toLowerCase())).map(item => ({
      ref: item.ref,
      version: item.version,
      occurrenceId: item.due?.occurrenceId ?? null
    })) : [];
    const id = 'source.' + workHash([p.username, row.ref, row.sourceHash]);
    const source = {
      id,
      username: p.username,
      kind: 'journal',
      ref: row.ref,
      sourceHash: row.sourceHash,
      observations,
      senderId: p.senderId,
      conversationId: p.conversationId,
      messageId: p.messageId,
      authRevision: p.sourceRevision,
      principalReceipt: p.receiptId,
      replyToMessageId: p.replyToMessageId ?? null,
      at: row.at,
      observedAt: asOf,
      deadline: explicit ? asOf : asOf + 900000,
      edited: p.edited === true,
      valid: true,
      status: 'pending',
      intents: []
    };
    const state = await this.#change(p.username, id, asOf, current => current.sources?.[id] ? [] : [{
      type: 'source.observed',
      source
    }]);
    if (state.sources[id].status !== 'pending') return {
      handled: true,
      scheduled: false,
      pendingDecision: null,
      activity: null
    };
    const affected = Object.values(state.commands).filter(record => record.status === 'applied' && record.reconciliationNeeded && record.command.operation === 'complete' && state.sources[record.command.sourceReceipt]?.kind === 'journal' && state.sources[record.command.sourceReceipt].conversationId === p.conversationId && state.sources[record.command.sourceReceipt].messageId === p.messageId);
    if (p.edited && affected.length === 1 && !affected[0].recurring) {
      const record = affected[0],
        item = await this.#context.getItem?.({
          username: p.username,
          ref: record.command.ref,
          asOf
        });
      if (item?.status?.category === 'done') {
        await this.#mark(p.username, id, 'processed', [], asOf, 'correction_offered');
        const flowState = {
          flowType: 'correction',
          offerId: record.command.id,
          step: 'review',
          selectionRefs: [item.ref],
          pageCursor: 0,
          expectedVersion: item.version,
          policyRevision: this.#policy(p.username).revision,
          sourceReceipt: id
        };
        const page = await this.#decisions.prepare({
          principal,
          flowState,
          asOf
        });
        let ackHandled = false;
        if (this.#deliver) {
          try {
            await this.#deliver({
              principal,
              page
            });
            ackHandled = true;
          } catch {
            this.#logger?.warn?.('work.correction.delivery-pending');
          }
        }
        return {
          handled: true,
          scheduled: false,
          pendingDecision: page,
          activity: null,
          suppressFollowUp: true,
          ackHandled
        };
      }
    }
    this.#principals.set(id, principal);
    if (explicit) {
      const processed = await this.#drain(p.username);
      return {
        handled: true,
        scheduled: false,
        pendingDecision: null,
        activity: null,
        suppressFollowUp: true,
        ackHandled: processed?.delivered === true
      };
    }
    this.#schedule(p.username);
    return {
      handled: true,
      scheduled: true,
      pendingDecision: null,
      activity: null
    };
  }
  #schedule(username) {
    this.#timers.get(username)?.();
    if (this.#closed) return;
    const cancel = this.#scheduler.after(900000, () => {
      this.#timers.delete(username);
      return this.#drain(username);
    });
    this.#timers.set(username, cancel);
  }
  async restore({
    username
  }) {
    if (this.#closed) return;
    const state = await this.#state.read({
      username
    });
    for (const source of Object.values(state.sources ?? {}).filter(row => row.status === 'pending')) await this.#mark(username, source.id, 'deferred', [], this.#clock(), 'authenticated_reply_required');
  }
  async #mark(username, id, status, intents, asOf, reason = null) {
    return this.#change(username, 'interpret:' + id, asOf, state => state.sources[id]?.valid ? [{
      type: 'source.interpreted',
      sourceId: id,
      status,
      intents,
      reason,
      at: asOf
    }] : []);
  }
  #drain(username) {
    const run = (this.#drains.get(username) ?? Promise.resolve()).then(() => this.#process(username));
    const tail = run.catch(() => {});
    this.#drains.set(username, tail);
    void tail.finally(() => {
      if (this.#drains.get(username) === tail) this.#drains.delete(username);
    });
    return run;
  }
  async #process(username) {
    if (this.#closed) return;
    let delivered = false;
    const state = await this.#state.read({
      username
    });
    for (const source of Object.values(state.sources ?? {}).filter(row => row.valid && row.status === 'pending' && row.deadline <= this.#clock())) {
      const p = this.#principals.get(source.id),
        asOf = this.#clock();
      try {
        if (!p || !(await this.verifySource({
          principal: p,
          intent: {
            sourceReceipt: source.id
          },
          asOf
        }))) {
          await this.#mark(username, source.id, 'deferred', [], asOf, 'source_unavailable');
          continue;
        }
        const rows = await this.#evidence.readByRefs({
            username,
            refs: [source.ref]
          }),
          entry = {
            ...rows[0],
            username
          };
        const context = await this.#context.execute({
          username,
          asOf
        });
        if (!context.coverage.complete) {
          await this.#mark(username, source.id, 'deferred', [], asOf, 'coverage_unavailable');
          continue;
        }
        const extracted = await this.#extractor.extract({
          entry,
          context,
          asOf
        });
        if (this.#closed || !(await this.verifySource({
          principal: p,
          intent: {
            sourceReceipt: source.id
          },
          asOf: this.#clock()
        }))) continue;
        const intents = (extracted.intents ?? []).slice(0, 5).map((raw, index) => ({
          ...raw,
          id: 'intent.' + workHash([source.id, index, raw])
        }));
        await this.#mark(username, source.id, extracted.deferred ? 'deferred' : 'processed', intents, asOf, extracted.deferred ? 'budget_exhausted' : null);
        if (extracted.deferred) continue;
        for (const raw of intents) {
          const intent = {
            ...raw,
            username,
            statement: entry.content,
            sourceReceipt: source.id,
            verified: true,
            current: true,
            authored: true,
            edited: source.edited
          };
          const candidates = raw.operation === 'reopen' ? (await this.#candidates(p, source, raw, 'match')).map(row => row.item) : raw.operation.endsWith('_container') ? context.containers : context.items;
          const matched = matchWorkIntent({
            intent,
            items: candidates,
            links: context.links,
            policy: this.#policy(username)
          });
          if (matched.mode === 'none') continue;
          if (matched.mode === 'auto' && matched.matches.length === 1) {
            await this.#submit(p, source, raw, matched.matches[0], asOf, true);
            continue;
          }
          const page = await this.#page(p, source, raw, 0, asOf);
          if (page && this.#deliver && !this.#closed) {
            await this.#deliver({
              principal: p,
              page
            });
            delivered = true;
          }
        }
      } catch (error) {
        if (!this.#closed) {
          try {
            await this.#mark(username, source.id, 'deferred', [], this.#clock(), error.code ?? 'work_unavailable');
          } catch {}
          this.#logger?.warn?.('work.entry.deferred', {
            reason: error.code ?? 'work_unavailable'
          });
        }
      } finally {
        this.#principals.delete(source.id);
      }
    }
    return {
      delivered
    };
  }
  #domains(policy, ref, domainId) {
    return Object.entries(policy.domains).filter(([id, d]) => {
      const p = policy.providers[d.provider];
      return (domainId == null || id === domainId) && p.type === ref.provider && p.accountId === ref.accountId;
    });
  }
  async #candidates(principal, source, intent, flowType) {
    const policy = this.#policy(principal.username),
      context = await this.#context.execute({
        username: principal.username,
        asOf: this.#clock()
      });
    if (!context.coverage.complete) throw workError('WORK_CONTEXT_UNAVAILABLE');
    const choices = [];
    if (['create_task', 'create_container'].includes(intent?.operation ?? flowType)) {
      const operation = intent?.operation ?? flowType;
      for (const [domainId, domain] of Object.entries(policy.domains)) {
        if (intent?.domainId != null && intent.domainId !== domainId) continue;
        const provider = policy.providers[domain.provider],
          id = operation === 'create_task' ? domain.containerId : domain.creationParentId;
        if (!id) continue;
        const ref = {
            provider: provider.type,
            accountId: provider.accountId,
            kind: 'container',
            id
          },
          item = await this.#context.getItem?.({
            username: principal.username,
            ref,
            asOf: this.#clock()
          });
        if (item) {
          const assignees = operation === 'create_task' && domain.assigneeIds?.length ? domain.assigneeIds : [null];
          for (const assigneeId of assignees) choices.push({
            item,
            domainId,
            assigneeId
          });
        }
      }
    } else {
      let rows = intent?.operation?.endsWith('_container') ? context.containers : context.items;
      if (intent?.operation === 'reopen') {
        const state = await this.#state.read({
          username: principal.username
        });
        const refs = [...rows.map(row => row.ref), ...(context.events ?? []).filter(e => e.type === 'completed').map(e => e.ref), ...Object.values(state.commands).filter(r => r.status === 'applied' && r.command.operation === 'complete').map(r => r.command.ref)];
        rows = [];
        const seen = new Set();
        for (const ref of refs) {
          if (!ref || seen.has(keyOf(ref))) continue;
          seen.add(keyOf(ref));
          const live = await this.#context.getItem?.({
            username: principal.username,
            ref,
            asOf: this.#clock()
          });
          if (live?.status?.category === 'done') rows.push(live);
        }
      }
      for (let item of rows) {
        if (item.ref.kind === 'container') {
          item = await this.#context.getItem?.({
            username: principal.username,
            ref: item.ref,
            asOf: this.#clock()
          });
          if (!item) continue;
        }
        if (intent && item.title.toLowerCase() !== intent.title.toLowerCase()) continue;
        for (const [domainId, domain] of this.#domains(policy, item.ref, intent?.domainId)) {
          const scoped = item.ref.kind === 'container' ? item.ref.id === domain.containerId : item.containerRef?.id === domain.containerId;
          const role = flowType === 'tasks' ? 'tasks' : flowType === 'projects' ? 'projects' : null;
          if (scoped && (!role || domain.role === role)) choices.push({
            item,
            domainId
          });
        }
      }
    }
    return choices.sort((a, b) => (keyOf(a.item.ref) + a.domainId).localeCompare(keyOf(b.item.ref) + b.domainId));
  }
  async #page(principal, source, intent, cursor, asOf, flowType = 'match') {
    const candidates = await this.#candidates(principal, source, intent, flowType);
    if (!candidates.length) return null;
    const page = candidates.slice(cursor, cursor + 3),
      flowState = {
        flowType,
        offerId: intent?.id ?? source.id,
        step: 'select',
        selectionRefs: page.map(row => row.item.ref),
        pageCursor: cursor,
        expectedVersion: null,
        policyRevision: this.#policy(principal.username).revision,
        sourceReceipt: source.id
      };
    return this.#decisions.prepare({
      principal,
      flowState,
      asOf
    });
  }
  async renderFlow({
    principal,
    flowState,
    asOf = this.#clock()
  }) {
    const p = this.#principal.verify(principal);
    if (!p || !(await this.verifySource({
      principal,
      intent: {
        sourceReceipt: flowState.sourceReceipt
      },
      asOf
    }))) throw workError('WORK_SOURCE_REQUIRED');
    const state = await this.#state.read({
        username: p.username
      }),
      source = state.sources[flowState.sourceReceipt],
      intent = source.intents.find(row => row.id === flowState.offerId) ?? null;
    if (flowState.flowType === 'correction') {
      const record = state.commands[flowState.offerId],
        item = record && (await this.#context.getItem?.({
          username: p.username,
          ref: record.command.ref,
          asOf
        }));
      if (!record?.reconciliationNeeded || !item || record.recurring || item.version !== flowState.expectedVersion) throw workError('WORK_CORRECTION_CHANGED');
      return {
        text: `The previous journal version completed “${item.title}”. Review reopening it in ${record.command.domainId}?`,
        options: [{
          text: 'Reopen task',
          action: 'choose',
          value: {
            ref: item.ref,
            domainId: record.command.domainId,
            expectedVersion: item.version,
            operation: 'reopen'
          }
        }, {
          text: 'Cancel',
          action: 'none',
          value: null
        }],
        more: false
      };
    }
    const candidates = await this.#candidates(p, source, intent, flowState.flowType),
      page = candidates.slice(flowState.pageCursor, flowState.pageCursor + 3),
      more = candidates.length > flowState.pageCursor + 3;
    const options = page.map(({
      item,
      domainId,
      assigneeId
    }) => ({
      text: 'This one',
      action: 'choose',
      value: {
        ref: item.ref,
        domainId,
        expectedVersion: item.version,
        assigneeId: assigneeId ?? null
      }
    }));
    if (more) options.push({
      text: 'Next',
      action: 'next',
      value: flowState.pageCursor + 3
    });
    if (flowState.pageCursor > 0) options.push({
      text: 'Back',
      action: 'back',
      value: Math.max(0, flowState.pageCursor - 3)
    });
    options.push({
      text: 'None',
      action: 'none',
      value: null
    });
    return {
      text: 'Choose work:\n' + page.map(({
        item,
        domainId,
        assigneeId
      }, index) => `${index + 1}. ${item.title} (${domainId})${assigneeId ? ' — assigned to ' + assigneeId : ''}`).join('\n'),
      options,
      more
    };
  }
  async #submit(principal, source, raw, item, asOf, automatic = false, domainId = raw.domainId) {
    const policy = this.#policy(principal.username);
    const domains = this.#domains(policy, item.ref, domainId).filter(([, d]) => item.ref.kind === 'container' ? item.ref.id === d.containerId || item.ref.id === d.creationParentId : item.containerRef?.id === d.containerId);
    if (domains.length !== 1) return {
      status: 'denied',
      reason: 'ambiguous_domain'
    };
    domainId = domains[0][0];
    const domain = domains[0][1];
    let operation = raw.operation,
      payload = {};
    if (operation === 'progress') {
      if (!domain.transitions?.code_checked_in) return {
        status: 'progress'
      };
      operation = 'transition';
      payload = {
        transition: 'code_checked_in'
      };
    }
    if (operation === 'create_task') payload = {
      title: raw.title,
      containerId: domain.containerId,
      ...(raw.description ? {
        description: raw.description
      } : {}),
      ...(raw.dueDate ? {
        dueDate: raw.dueDate
      } : {})
    };
    if (operation === 'create_task' && domain.assigneeIds?.length) {
      const assigneeId = raw.assigneeId ?? (domain.assigneeIds.length === 1 ? domain.assigneeIds[0] : null);
      if (!domain.assigneeIds.includes(assigneeId)) return {
        status: 'denied',
        reason: 'assignee_selection_required'
      };
      const binding = policy.providers[domain.provider];
      payload = {
        ...payload,
        ...(binding.type === 'todoist' ? {
          assigneeId
        } : {
          assigneeIds: [assigneeId]
        })
      };
    }
    if (operation === 'create_container') payload = {
      title: raw.title,
      parentId: domain.creationParentId
    };
    if (operation === 'update_task') payload = {
      ...(raw.newTitle ? {
        title: raw.newTitle
      } : {}),
      ...(raw.description ? {
        description: raw.description
      } : {}),
      ...(raw.dueDate ? {
        dueDate: raw.dueDate
      } : {})
    };
    if (operation === 'rename_container') payload = {
      title: raw.newTitle
    };
    const rows = source.kind === 'journal' ? await this.#evidence.readByRefs({
      username: principal.username,
      refs: [source.ref]
    }) : [];
    const statement = rows[0]?.content ?? raw.quote ?? '';
    const observation = automatic ? (source.observations ?? []).find(o => keyOf(o.ref) === keyOf(item.ref)) : null;
    if (automatic && (!observation || observation.version !== item.version)) return {
      status: 'denied',
      reason: 'source_observation_changed'
    };
    const proposed = await this.#commands.propose({
      principal,
      intent: {
        domainId,
        operation,
        ref: operation.startsWith('create_') ? null : item.ref,
        payload,
        sourceReceipt: source.id,
        statement,
        title: item.title,
        expectedVersion: observation?.version ?? item.version,
        expectedOccurrenceId: observation?.occurrenceId ?? item.due?.occurrenceId ?? null,
        mode: automatic ? 'auto' : 'manual'
      },
      asOf
    });
    if (!proposed.requiresConfirmation && automatic) {
      const result = await this.#commands.execute({
        principal,
        commandId: proposed.command.id,
        asOf
      });
      return {
        status: result.outcome,
        result
      };
    }
    const page = await this.#decisions.prepare({
      principal,
      commandId: proposed.command.id,
      asOf
    });
    if (automatic && this.#deliver && !this.#closed) await this.#deliver({
      principal,
      page
    });
    return {
      status: 'confirmation',
      page
    };
  }
  async applyFlowChoice({
    principal,
    flowState,
    choice,
    asOf = this.#clock()
  }) {
    const p = this.#principal.verify(principal);
    if (!p || !(await this.verifySource({
      principal,
      intent: {
        sourceReceipt: flowState.sourceReceipt
      },
      asOf
    }))) return {
      status: 'denied',
      reason: 'source_revoked'
    };
    const state = await this.#state.read({
        username: p.username
      }),
      source = state.sources[flowState.sourceReceipt],
      intent = source.intents.find(row => row.id === flowState.offerId) ?? null;
    if (flowState.flowType === 'correction') {
      const record = state.commands[flowState.offerId],
        item = record && (await this.#context.getItem?.({
          username: p.username,
          ref: record.command.ref,
          asOf
        }));
      if (choice.action !== 'choose' || choice.value?.operation !== 'reopen' || !record?.reconciliationNeeded || record.recurring || !item || keyOf(item.ref) !== keyOf(choice.value.ref) || item.version !== choice.value.expectedVersion) return {
        status: 'denied',
        reason: 'correction_changed'
      };
      return this.#submit(principal, source, {
        operation: 'reopen',
        title: item.title,
        quote: '',
        domainId: record.command.domainId
      }, item, asOf, false, record.command.domainId);
    }
    if (['next', 'back'].includes(choice.action)) {
      const page = await this.#page(principal, source, intent, choice.value, asOf, flowState.flowType);
      return {
        status: 'page',
        page
      };
    }
    if (choice.action !== 'choose') return {
      status: 'cancelled'
    };
    const candidates = await this.#candidates(principal, source, intent, flowState.flowType),
      selected = candidates.find(row => row.domainId === choice.value?.domainId && (row.assigneeId ?? null) === (choice.value?.assigneeId ?? null) && keyOf(row.item.ref) === keyOf(choice.value.ref));
    if (!selected || selected.item.version !== choice.value.expectedVersion) return {
      status: 'denied',
      reason: 'selection_changed'
    };
    const live = await this.#context.getItem?.({
      username: p.username,
      ref: selected.item.ref,
      asOf
    });
    if (!live || live.version !== choice.value.expectedVersion) return {
      status: 'denied',
      reason: 'selection_changed'
    };
    const raw = intent ?? {
      operation: flowState.flowType === 'projects' ? 'progress' : 'complete',
      title: selected.item.title,
      quote: ''
    };
    return this.#submit(principal, source, {
      ...raw,
      assigneeId: selected.assigneeId ?? null
    }, selected.item, asOf, false, selected.domainId);
  }
  async open({
    principal,
    flow = 'tasks',
    asOf = this.#clock()
  }) {
    const p = !this.#closed && this.#principal.verify(principal);
    if (!p?.authored || !['tasks', 'projects', 'create_task', 'create_container'].includes(flow)) throw workError('WORK_PRINCIPAL_REQUIRED');
    if (['create_task', 'create_container'].includes(flow)) return {
      decisionId: null,
      text: `Send “Create ${flow === 'create_task' ? 'task' : 'project'} <title>” with the title you want. Then choose and confirm its configured destination.`,
      choices: [],
      more: false
    };
    const source = {
      id: 'source.' + workHash([p.username, p.receiptId, 'interactive']),
      username: p.username,
      kind: 'interactive',
      ref: null,
      sourceHash: null,
      senderId: p.senderId,
      conversationId: p.conversationId,
      messageId: p.messageId,
      authRevision: p.sourceRevision,
      principalReceipt: p.receiptId,
      at: asOf,
      observedAt: asOf,
      deadline: asOf,
      edited: false,
      valid: true,
      status: 'processed',
      intents: []
    };
    await this.#change(p.username, source.id, asOf, state => state.sources?.[source.id] ? [] : [{
      type: 'source.observed',
      source
    }]);
    return this.#page(principal, source, null, 0, asOf, flow);
  }
  handleCallback({
    principal,
    callbackData,
    botMessageId,
    asOf = this.#clock()
  }) {
    if (!callbackData?.startsWith('w1:')) return Promise.resolve({
      handled: false
    });
    const p = !this.#closed && this.#principal.verify(principal);
    if (!p || p.callbackData !== callbackData) return Promise.resolve({
      handled: true,
      status: 'denied',
      reason: 'unverified_callback'
    });
    return this.#decisions.reply({
      principal,
      token: callbackData,
      botMessageId,
      asOf
    });
  }
  async dispose() {
    this.#closed = true;
    for (const cancel of this.#timers.values()) cancel();
    this.#timers.clear();
    this.#principals.clear();
  }
}
