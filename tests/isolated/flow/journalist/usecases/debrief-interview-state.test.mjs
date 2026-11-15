import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { YamlConversationStateDatastore } from '../../../../../__backend/src/1_adapters/messaging/YamlConversationStateDatastore.mjs';
import { SendMorningDebrief } from '../../../../../__app_modules/personal/journalist/server/application/usecases/SendMorningDebrief.mjs';
import { InitiateDebriefInterview } from '../../../../../__app_modules/personal/journalist/server/application/usecases/InitiateDebriefInterview.mjs';
import { HandleDebriefResponse } from '../../../../../__app_modules/personal/journalist/server/application/usecases/HandleDebriefResponse.mjs';

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('morning debrief to interview state continuity', () => {
  it.each([
    { openDetails: false, interviewMessage: 'message-2' },
    { openDetails: true, interviewMessage: 'message-3' },
  ])('retains the delivered debrief after starting an interview (details opened: $openDetails)', async ({ openDetails, interviewMessage }) => {
    const root = mkdtempSync(path.join(tmpdir(), 'journalist-state-'));
    roots.push(root);
    const conversationId = 'telegram:sample';
    const logger = { debug() {}, info() {}, warn() {}, error() {} };
    const stateStore = new YamlConversationStateDatastore({
      botName: 'journalist',
      dataService: { user: { resolveDir: (relative, username) => path.join(root, username, relative) } },
      userResolver: { resolveUser: () => 'sample' },
      logger,
    });
    const delivered = [];
    const messagingGateway = {
      async sendMessage(_conversationId, text) {
        delivered.push(text);
        return { messageId: `message-${delivered.length}` };
      },
    };
    const debrief = {
      success: true,
      date: '2026-11-14',
      summary: 'A library visit and a completed application.',
      categories: [{ key: 'events', icon: '📆', name: 'Events' }],
      questions: { events: ['Did the application receive a reply?'] },
      summaries: [{ source: 'events', text: 'A library visit.' }],
      lifelog: { _meta: { sources: ['events'] }, summaries: [] },
    };
    const debriefRepository = {
      async appendDebrief() {},
      async getRecentDebriefs() { return [debrief]; },
    };
    const deps = { messagingGateway, conversationStateStore: stateStore, debriefRepository, logger };
    const sent = await new SendMorningDebrief(deps).execute({ conversationId, debrief });
    expect(sent.success).toBe(true);
    if (openDetails) {
      await new HandleDebriefResponse(deps).execute({ conversationId, text: '📊 Details' });
    }

    let aiCalls = 0;
    const interview = await new InitiateDebriefInterview({
      ...deps,
      aiGateway: { async chat() { return aiCalls++ % 2 === 0 ? 'What happened at the library?' : '["Borrowed a book", "Returned a book"]'; } },
    }).execute({ conversationId });
    expect(interview.success).toBe(true);

    const state = await stateStore.get(conversationId);
    expect(state.messageId).toBe('message-1');
    expect(state.debrief.questions).toEqual({ events: ['Did the application receive a reply?'] });
    expect(state.flowState.debrief.date).toBe('2026-11-14');
    expect(state.flowState.lastMessageId).toBe(interviewMessage);
    expect(state.subFlow).toBe('interview');

    const answer = await new HandleDebriefResponse(deps).execute({ conversationId, text: '💬 Ask' });
    expect(answer.handled).toBe(true);
    expect(answer.fallback).not.toBe(true);
    expect(delivered.at(-1)).toContain('Did the application receive a reply?');
  });
});
