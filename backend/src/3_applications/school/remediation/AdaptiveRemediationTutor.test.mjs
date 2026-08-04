import { describe, expect, it, vi } from 'vitest';
import { CreateAdaptiveRemediationOffer } from './CreateAdaptiveRemediationOffer.mjs';
import { AdaptiveRemediationTutor } from './AdaptiveRemediationTutor.mjs';

const instant = '2026-08-02T12:00:00.000Z';
const access = { surface: 'schoolcalc', endpointId: 'DEVICE01' };
const source = {
  kind: 'assessment', ...access,
  externalId: 'DEVICE01:9', recordDigest: 'result-digest',
  artifactId: 'artifact-1', lessonId: 'rates', moduleId: 'quiz-1',
};
const lesson = { lessonId: 'rates', title: 'Rates', objectives: ['Find unit rates.'] };
const module = {
  moduleId: 'quiz-1', type: 'quiz', title: 'Rate check',
  remediation: {
    launch: 'offer',
    trigger: { scoreBelowPercent: 70, minimumIncorrect: 1 },
    mastery: { targetPercent: 80, minimumChecksPerConcept: 2 },
    limits: { maxTurns: 6, maxMinutes: 20 },
    interaction: { responseMode: 'choice', maxChoices: 5 },
  },
};
const bank = {
  id: 'rate-bank', title: 'Rates', audience: 'assigned',
  concepts: [{ conceptId: 'unit-rate', title: 'Unit rate', description: 'Compare a quantity to one unit.' }],
  items: [{
    id: 'q1', type: 'multiple_choice', prompt: '12 miles in 3 hours?',
    choices: ['3', '4'], answer: '4', concepts: ['unit-rate'],
  }],
};

class MemorySessions {
  sessions = new Map();
  actions = new Map();

  async createOffer(session) {
    const existing = this.sessions.get(session.sessionId);
    if (existing) return { status: 'existing', session: structuredClone(existing) };
    this.sessions.set(session.sessionId, structuredClone(session));
    return { status: 'created', session: structuredClone(session) };
  }

  async getSession(sessionId) { return structuredClone(this.sessions.get(sessionId) ?? null); }
  async listAvailable({ surface, endpointId, learnerIds = [] }) {
    return [...this.sessions.values()].filter((session) => (
      session.source.surface === surface && session.source.endpointId === endpointId
      && (learnerIds.length === 0 || learnerIds.includes(session.learnerId))
      && ['offered', 'active'].includes(session.status)
    )).map((session) => structuredClone(session));
  }

  async claimAction(claim) {
    const session = this.sessions.get(claim.sessionId);
    if (!session) return { status: 'missing', session: null };
    const key = `${claim.sessionId}:${claim.clientSequence}`;
    const prior = this.actions.get(key);
    if (prior) {
      if (prior.payloadDigest !== claim.payloadDigest) return { status: 'conflict', session: structuredClone(session) };
      if (prior.status === 'complete') return { status: 'duplicate', session: structuredClone(session), response: structuredClone(prior.response) };
      return { status: 'resume', session: structuredClone(session), action: structuredClone(prior) };
    }
    if (claim.clientSequence !== session.nextClientSequence) return { status: 'out_of_order', session: structuredClone(session) };
    const action = { ...structuredClone(claim), status: 'processing' };
    this.actions.set(key, action);
    return { status: 'new', session: structuredClone(session), action: structuredClone(action) };
  }

  async completeAction({ sessionId, clientSequence, session, response }) {
    this.sessions.set(sessionId, structuredClone(session));
    const key = `${sessionId}:${clientSequence}`;
    this.actions.set(key, { ...this.actions.get(key), status: 'complete', response: structuredClone(response) });
    return structuredClone(response);
  }

  async failAction() {}
}

async function harness() {
  const sessions = new MemorySessions();
  const offers = new CreateAdaptiveRemediationOffer({
    sessions, sessionIdFactory: () => 'rem_ABC123', clock: () => new Date(instant),
  });
  const offer = await offers.execute({
    learnerId: 'learner-a', source, lesson, module, bank,
    responses: [{ itemId: 'q1', given: '3' }],
  });
  let turn = 0;
  const aiGateway = {
    isConfigured: () => true,
    chatWithJson: vi.fn(async (messages) => {
      turn += 1;
      return {
        conceptId: 'unit-rate',
        body: turn === 1
          ? 'Divide the total by the number of equal units.'
          : 'That choice mixed up total and rate. Divide again.',
        prompt: turn === 1 ? '15 miles in 3 hours?' : '24 pages in 4 days?',
        choices: [{ id: 'A', label: turn === 1 ? '3' : '6' }, { id: 'B', label: turn === 1 ? '5' : '8' }],
        correctChoiceId: turn === 1 ? 'B' : 'A',
        rationale: turn === 1 ? '15 divided by 3 is 5.' : '24 divided by 4 is 6.',
        _promptHadPriorWrong: messages[1].content.includes('"correct":false'),
      };
    }),
  };
  const tutor = new AdaptiveRemediationTutor({
    sessions, aiGateway, turnIdFactory: ({ serverSequence }) => `turn-${serverSequence}`,
    clock: () => new Date(instant),
  });
  return { sessions, offer, tutor, aiGateway };
}

describe('adaptive remediation application flow', () => {
  it('creates an authoritative failed-assessment offer without calling AI', async () => {
    const { offer, aiGateway } = await harness();
    expect(offer).toMatchObject({
      status: 'offered', assessment: { scorePercent: 0, weakConceptIds: ['unit-rate'] },
      offer: { status: 'offered', launch: 'offer' },
    });
    expect(offer.offer.source).not.toHaveProperty('tutorContext');
    expect(aiGateway.chatWithJson).not.toHaveBeenCalled();
  });

  it('maps A-E choices to F1-F5, adapts after a wrong answer, and resumes by cursor', async () => {
    const { tutor, aiGateway } = await harness();
    const started = await tutor.act({
      sessionId: 'rem_ABC123', access, clientSequence: 0,
      lastServerSequence: 0, action: 'start',
    });
    expect(started.session.turns[0]).toMatchObject({
      turnId: 'turn-1', choices: [{ id: 'A', functionKey: 'F1' }, { id: 'B', functionKey: 'F2' }],
    });
    expect(started.session.turns[0]).not.toHaveProperty('correctChoiceId');

    const duplicate = await tutor.act({
      sessionId: 'rem_ABC123', access, clientSequence: 0,
      lastServerSequence: 0, action: 'start',
    });
    expect(duplicate).toEqual(started);
    expect(aiGateway.chatWithJson).toHaveBeenCalledTimes(1);

    const adapted = await tutor.act({
      sessionId: 'rem_ABC123', access, clientSequence: 1,
      lastServerSequence: 1, action: 'choice', turnId: 'turn-1', choiceId: 'A',
    });
    expect(adapted.answer).toMatchObject({ correct: false, conceptId: 'unit-rate' });
    expect(adapted.session.turns.at(-1)).toMatchObject({ turnId: 'turn-2', serverSequence: 2 });
    expect(aiGateway.chatWithJson.mock.calls[1][0][1].content).toContain('"correct":false');

    const resumed = await tutor.get({
      sessionId: 'rem_ABC123', access, afterServerSequence: 1,
    });
    expect(resumed.turns.map(({ serverSequence }) => serverSequence)).toEqual([2]);
    expect(resumed.cursor).toEqual({
      requestedAfter: 1,
      latestServerSequence: 2,
      deliveredThrough: 2,
      hasMore: false,
      nextClientSequence: 2,
    });
    expect(resumed.transport).toEqual({ heartbeatRequired: true, reconnectable: true });
  });

  it('pages transcript delivery without changing the authoritative cursor', async () => {
    const { tutor } = await harness();
    await tutor.act({
      sessionId: 'rem_ABC123', access, clientSequence: 0,
      lastServerSequence: 0, action: 'start',
    });
    await tutor.act({
      sessionId: 'rem_ABC123', access, clientSequence: 1,
      lastServerSequence: 1, action: 'choice', turnId: 'turn-1', choiceId: 'A',
    });
    const page = await tutor.get({
      sessionId: 'rem_ABC123', access, afterServerSequence: 0,
      maxTurns: 1,
    });
    expect(page.turns.map(({ serverSequence }) => serverSequence)).toEqual([1]);
    expect(page.cursor).toMatchObject({
      requestedAfter: 0, deliveredThrough: 1, latestServerSequence: 2, hasMore: true,
    });
  });

  it('rejects sequence reuse with different bytes before another model call', async () => {
    const { tutor, aiGateway } = await harness();
    await tutor.act({
      sessionId: 'rem_ABC123', access, clientSequence: 0,
      lastServerSequence: 0, action: 'start',
    });
    await tutor.act({
      sessionId: 'rem_ABC123', access, clientSequence: 1,
      lastServerSequence: 1, action: 'choice', turnId: 'turn-1', choiceId: 'A',
    });
    await expect(tutor.act({
      sessionId: 'rem_ABC123', access, clientSequence: 1,
      lastServerSequence: 1, action: 'choice', turnId: 'turn-1', choiceId: 'B',
    })).rejects.toMatchObject({ code: 'REMEDIATION_ACTION_CONFLICT' });
    expect(aiGateway.chatWithJson).toHaveBeenCalledTimes(2);
  });

  it('lets the learner request an explanation without recording a wrong answer', async () => {
    const { tutor, sessions } = await harness();
    await tutor.act({
      sessionId: 'rem_ABC123', access, clientSequence: 0,
      lastServerSequence: 0, action: 'start',
    });
    const response = await tutor.act({
      sessionId: 'rem_ABC123', access, clientSequence: 1,
      lastServerSequence: 1, action: 'explain', turnId: 'turn-1',
    });
    expect(response.control).toMatchObject({ control: 'explain', conceptId: 'unit-rate' });
    expect(response).not.toHaveProperty('answer');
    expect((await sessions.getSession('rem_ABC123')).concepts[0]).toMatchObject({
      checksCorrect: 0, checksTotal: 0,
    });
    expect(response.session.turns.at(-1)).toMatchObject({ turnId: 'turn-2' });
  });

  it('retries a repeated model turn and persists only the fresh candidate', async () => {
    const { tutor, aiGateway } = await harness();
    await tutor.act({
      sessionId: 'rem_ABC123', access, clientSequence: 0,
      lastServerSequence: 0, action: 'start',
    });
    aiGateway.chatWithJson
      .mockResolvedValueOnce({
        conceptId: 'unit-rate', body: 'Divide the total by the number of equal units.',
        prompt: '15 miles in 3 hours?',
        choices: [{ id: 'A', label: '3' }, { id: 'B', label: '5' }],
        correctChoiceId: 'B', rationale: '15 divided by 3 is 5.',
      })
      .mockResolvedValueOnce({
        conceptId: 'unit-rate', body: 'Use a table to compare each quantity with one unit.',
        prompt: '28 pages in 4 days?',
        choices: [{ id: 'A', label: '6' }, { id: 'B', label: '7' }],
        correctChoiceId: 'B', rationale: '28 divided by 4 is 7.',
      });
    const response = await tutor.act({
      sessionId: 'rem_ABC123', access, clientSequence: 1,
      lastServerSequence: 1, action: 'choice', turnId: 'turn-1', choiceId: 'A',
    });
    expect(response.session.turns.at(-1).prompt).toBe('28 pages in 4 days?');
    expect(aiGateway.chatWithJson).toHaveBeenCalledTimes(3);
    expect(aiGateway.chatWithJson.mock.calls.at(-1)[0][1].content).toContain('Previous candidate was rejected');
  });
});
