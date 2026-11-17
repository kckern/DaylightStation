import { IWorkCompanion } from '../application/ports/IWorkCompanion.mjs';
/** Request-local presentation and transport acknowledgement only. */
export class WorkCompanionAdapter extends IWorkCompanion {
  #runtime;
  #send;
  #clock;
  constructor({
    runtime,
    send,
    clock = Date.now
  }) {
    super();
    if (!runtime?.conversation || !runtime?.decisions || !runtime?.principal) throw new TypeError('Work runtime required');
    this.#runtime = runtime;
    this.#send = send;
    this.#clock = clock;
  }
  capturePrincipal(input) {
    return this.#runtime.conversation.capturePrincipal(input);
  }
  sourceForEntry(input) {
    return this.#runtime.conversation.sourceForEntry(input);
  }
  onEntrySaved(input) {
    return this.#runtime.conversation.onEntrySaved(input);
  }
  async #deliver({
    principal,
    page,
    responseContext
  }) {
    const p = this.#runtime.principal.verify(principal);
    if (!p) throw new Error('WORK_PRINCIPAL_REQUIRED');
    if (!page) {
      const text = 'No current work is available in this flow.';
      if (responseContext) await responseContext.sendMessage(text, {
        parseMode: null
      });else await this.#send({
        username: p.username,
        text,
        choices: [],
        parseMode: null
      });
      return {
        handled: true,
        status: 'empty'
      };
    }
    try {
      const receipt = responseContext ? await responseContext.sendMessage(page.text, {
        choices: page.choices,
        inline: true,
        parseMode: null
      }) : await this.#send({
        username: p.username,
        text: page.text,
        choices: page.choices,
        parseMode: null
      });
      if (!receipt?.messageId) throw new Error('WORK_DELIVERY_UNACKNOWLEDGED');
      await this.#runtime.decisions.recordDelivery({
        username: p.username,
        decisionId: page.decisionId,
        botMessageId: String(receipt.messageId),
        asOf: this.#clock()
      });
      return {
        handled: true,
        status: 'sent',
        messageId: String(receipt.messageId)
      };
    } catch (error) {
      try {
        await this.#runtime.decisions.recordFailure({
          username: p.username,
          decisionId: page.decisionId,
          uncertain: true,
          asOf: this.#clock()
        });
      } catch {}
      throw error;
    }
  }
  async open({
    principal,
    flow,
    responseContext
  }) {
    if (!this.#runtime.principal.verify(principal)) throw new Error('WORK_PRINCIPAL_REQUIRED');
    const page = await this.#runtime.conversation.open({
      principal,
      flow,
      asOf: this.#clock()
    });
    return this.#deliver({
      principal,
      page,
      responseContext
    });
  }
  async handleCallback({
    principal,
    callbackData,
    botMessageId,
    responseContext
  }) {
    if (!callbackData?.startsWith('w1:')) return {
      handled: false
    };
    const result = await this.#runtime.conversation.handleCallback({
      principal,
      callbackData,
      botMessageId,
      asOf: this.#clock()
    });
    if (result.page) {
      const delivery = await this.#deliver({
        principal,
        page: result.page,
        responseContext
      });
      return {
        ...result,
        page: undefined,
        delivery
      };
    }
    const p = this.#runtime.principal.verify(principal);
    if (p) {
      const text = {
        applied: 'The change is confirmed.',
        already_applied: 'This choice was already processed.',
        cancelled: 'Cancelled.',
        conflict: 'That item changed. Open Work to review its current state.',
        denied: 'That choice is stale or unavailable. Open Work to refresh.',
        uncertain: 'I could not verify the change. Open Work to reconcile it.'
      }[result.status];
      if (text) {
        if (responseContext) await responseContext.sendMessage(text, {
          parseMode: null
        });else await this.#send({
          username: p.username,
          text,
          choices: [],
          parseMode: null
        });
      }
    }
    return result;
  }
}
