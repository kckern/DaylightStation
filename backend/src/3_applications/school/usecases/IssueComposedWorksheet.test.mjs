import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { YamlWorkSessionDatastore } from '#adapters/persistence/yaml/YamlWorkSessionDatastore.mjs';
import { IssueComposedWorksheet } from './IssueComposedWorksheet.mjs';

const bank = (id) => ({
  schema: 'school.question-bank/v2', id, title: id,
  items: Array.from({ length: 6 }, (_, index) => ({
    id: `${id}-q${index + 1}`, type: 'multiple_choice', prompt: `Question ${index + 1}?`,
    answer: 'Correct', decoys: ['One', 'Two', 'Three', 'Four', 'Five'], levels: ['lower', 'upper'],
    source: { page: '12' },
  })),
});

function fakeSessions(entries = [['s-one', 'one'], ['s-two', 'two']]) {
  const events = new Map();
  for (const [sessionId, unitId] of entries) {
    events.set(sessionId, [{ type: 'created', at: '2026-08-21T08:00:00.000Z', sessionId, learnerId: 'milo', unitId, seq: 1 }]);
  }
  return {
    events,
    async readEvents(id) { return events.get(id) ?? []; },
    async appendEvent(id, event) { events.get(id).push(event); },
  };
}

describe('IssueComposedWorksheet', () => {
  it('issues two immutable lesson instances into one persisted, section-owned OMR allocation', async () => {
    const sessions = fakeSessions();
    const instances = new Map();
    const published = new Map();
    const cards = new Map();
    const issuedArtifacts = { put: vi.fn(async (artifact) => ({ manifest: artifact, bytes: artifact.bytes })) };
    const teacherGate = { assert: vi.fn() };
    const printer = { jobs: [], async printPdf(bytes, options) { this.jobs.push({ bytes, options }); return { ok: true }; } };
    const curriculum = {
      async getUnit(id) { return { unitId: id, title: `Lesson ${id}`, subject: 'science', courseId: 'chemistry', bank: `bank-${id}`, passing: { percent: 80 } }; },
    };
    const publish = { async execute({ source }) { const rev = 'abcdef123'; published.set(`${source.id}@${rev}`, { ...source, rev }); return { id: source.id, rev }; } };
    const allocations = {
      async findReusableCard() { return null; },
      async findByCard(cardId) { return cards.get(cardId) ?? []; },
      async release() {},
    };
    const render = {
      async execute({ document, context }) {
        const cardId = '1234567';
        const sections = context.sectionAttribution.map((section, index) => ({
          ...section, rowRange: { start: index * 6 + 1, end: index * 6 + 6 },
        }));
        const record = { cardId, recordId: 'rec-1', sections };
        cards.set(cardId, [record]);
        return { bytes: Buffer.from('%PDF test'), pageCount: 1, duplex: true, allocation: { cardId, recordId: 'rec-1', rowRange: { start: 1, end: 12 } } };
      },
    };
    const useCase = new IssueComposedWorksheet({
      curriculum, sessions,
      assignments: { async get() { return { courses: [{ courseId: 'chemistry', profile: 'lower', enrollment: { enrollmentId: 'enr-1' } }] }; } },
      worksheetInstances: {
        async findBySession(id) { return [...instances.values()].find((entry) => entry.sessionId === id) ?? null; },
        async put(instance) { instances.set(instance.id, instance); return instance; },
      },
      bankReader: { getBank(id) { return bank(id); } },
      printDocuments: { async getPublished(id, rev) { return published.get(`${id}@${rev}`) ?? null; } },
      renderPrintDocument: render, allocationStore: allocations, printer, publishPrintDocument: publish, issuedArtifacts,
      teacherGate, clock: () => new Date('2026-08-21T09:00:00.000Z'), logger: { info() {} },
    });

    const result = await useCase.execute({ sessionIds: ['s-one', 's-two'], issuedBy: 'kckern', pin: '2468' });

    expect(result.parts).toHaveLength(1);
    expect(printer.jobs).toHaveLength(1);
    expect(teacherGate.assert).toHaveBeenCalledWith({
      userId: 'kckern', pin: '2468', action: 'worksheet.compose', context: { sessionIds: ['s-one', 's-two'] },
    });
    expect(instances.size).toBe(2);
    expect(issuedArtifacts.put).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'worksheet-composition', sessionIds: ['s-one', 's-two'],
      allocation: { cardId: '1234567', recordId: 'rec-1', rowRange: { start: 1, end: 12 } },
    }));
    expect([...instances.values()].map((instance) => instance.omr.rowRange)).toEqual([
      { start: 1, end: 6 }, { start: 7, end: 12 },
    ]);
    expect(sessions.events.get('s-one').at(-1)).toMatchObject({ type: 'issued', confirmed: true });
    expect(sessions.events.get('s-two').at(-1)).toMatchObject({ type: 'issued', confirmed: true });
  });

  it('splits a teacher selection at the physical 50-row OMR-card boundary', async () => {
    const entries = Array.from({ length: 9 }, (_, index) => [`s-${index + 1}`, `lesson-${index + 1}`]);
    const sessions = fakeSessions(entries);
    const instances = new Map();
    const published = new Map();
    const records = new Map();
    const printer = { jobs: [], async printPdf(bytes) { this.jobs.push(bytes); return { ok: true }; } };
    let cardN = 0;
    const useCase = new IssueComposedWorksheet({
      curriculum: {
        async getUnit(id) {
          return { unitId: id, title: id, subject: 'science', courseId: 'chemistry', bank: `bank-${id}`, passing: { percent: 80 } };
        },
      },
      sessions,
      assignments: { async get() { return { courses: [{ courseId: 'chemistry', profile: 'lower', enrollment: { enrollmentId: 'enr-1' } }] }; } },
      worksheetInstances: {
        async findBySession(id) { return [...instances.values()].find((entry) => entry.sessionId === id) ?? null; },
        async put(instance) { instances.set(instance.id, instance); return instance; },
      },
      bankReader: { getBank(id) { return bank(id); } },
      printDocuments: { async getPublished(id, rev) { return published.get(`${id}@${rev}`) ?? null; } },
      publishPrintDocument: {
        async execute({ source }) { const rev = 'abcdef123'; published.set(`${source.id}@${rev}`, { ...source, rev }); return { id: source.id, rev }; },
      },
      allocationStore: {
        async findReusableCard() { return null; },
        async findByCard(id) { return records.get(id) ?? []; },
        async release() {},
      },
      renderPrintDocument: {
        async execute({ context }) {
          const cardId = `123456${++cardN}`;
          let start = 1;
          const sections = context.sectionAttribution.map((section) => {
            const end = start + 5;
            const owned = { ...section, rowRange: { start, end } };
            start = end + 1;
            return owned;
          });
          const recordId = `rec-${cardN}`;
          records.set(cardId, [{ cardId, recordId, sections }]);
          return {
            bytes: Buffer.from('%PDF test'), pageCount: 1,
            allocation: { cardId, recordId, rowRange: { start: 1, end: start - 1 } },
          };
        },
      },
      printer, clock: () => new Date('2026-08-21T09:00:00.000Z'), logger: { info() {} },
    });

    const result = await useCase.execute({ sessionIds: entries.map(([sessionId]) => sessionId) });

    expect(result.parts).toHaveLength(2);
    expect(result.parts.map((part) => part.sessionIds.length)).toEqual([8, 1]);
    expect(printer.jobs).toHaveLength(2);
    expect([...instances.values()]).toHaveLength(9);
  });
});

/**
 * The composed-issue event type used to be picked from `section.created` — "did
 * this call mint a worksheet instance?" — which is not the same question as "what
 * state is the session in?". The two disagree the moment a print fails after the
 * instance was persisted, or a session was already issued a sheet on its own.
 * Only the REAL datastore refuses the resulting illegal event, so these run
 * against it.
 */
describe('IssueComposedWorksheet against the real work-session datastore', () => {
  const realSessions = () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'school-composed-'));
    return new YamlWorkSessionDatastore({
      configService: { getDataDir: () => tmp, getHouseholdPath: (rel) => path.join(tmp, rel) },
      logger: { info() {}, warn() {}, error() {} },
    });
  };

  const open = async (sessions, sessionId, unitId, extra = []) => {
    await sessions.appendEvent(sessionId, { type: 'created', at: '2026-08-21T08:00:00.000Z', sessionId, learnerId: 'milo', unitId });
    for (const event of extra) {
      // eslint-disable-next-line no-await-in-loop
      await sessions.appendEvent(sessionId, { ...event, sessionId });
    }
  };

  const build = ({ sessions, printer, instances = new Map(), released = [] }) => {
    const publishedDocs = new Map();
    const cards = new Map();
    let cardN = 0;
    const useCase = new IssueComposedWorksheet({
      curriculum: {
        async getUnit(id) {
          return { unitId: id, title: `Lesson ${id}`, subject: 'science', courseId: 'chemistry', bank: `bank-${id}`, passing: { percent: 80 } };
        },
      },
      sessions,
      assignments: { async get() { return { courses: [{ courseId: 'chemistry', profile: 'lower', enrollment: { enrollmentId: 'enr-1' } }] }; } },
      worksheetInstances: {
        async findBySession(id) { return [...instances.values()].find((entry) => entry.sessionId === id) ?? null; },
        async put(instance) { instances.set(instance.id, instance); return instance; },
      },
      bankReader: { getBank(id) { return bank(id); } },
      printDocuments: { async getPublished(id, rev) { return publishedDocs.get(`${id}@${rev}`) ?? null; } },
      publishPrintDocument: {
        async execute({ source }) { const rev = 'abcdef123'; publishedDocs.set(`${source.id}@${rev}`, { ...source, rev }); return { id: source.id, rev }; },
      },
      allocationStore: {
        async findReusableCard() { return null; },
        async findByCard(id) { return cards.get(id) ?? []; },
        async release(args) { released.push(args); },
      },
      renderPrintDocument: {
        async execute({ context }) {
          const cardId = `123456${(cardN += 1)}`;
          let start = 1;
          const sections = context.sectionAttribution.map((section) => {
            const end = start + 5;
            const owned = { ...section, rowRange: { start, end } };
            start = end + 1;
            return owned;
          });
          const recordId = `rec-${cardN}`;
          cards.set(cardId, [{ cardId, recordId, sections }]);
          return { bytes: Buffer.from('%PDF test'), pageCount: 1, allocation: { cardId, recordId, rowRange: { start: 1, end: start - 1 } } };
        },
      },
      printer, clock: () => new Date('2026-08-21T09:00:00.000Z'), logger: { info() {}, warn() {} },
    });
    return { useCase, instances, released };
  };

  const typesOf = async (sessions, sessionId) => (await sessions.readEvents(sessionId)).map((event) => event.type);

  it('retries cleanly after a printer failure — the second pass still records issued, not reprinted', async () => {
    const sessions = realSessions();
    await open(sessions, 's-one', 'one');
    await open(sessions, 's-two', 'two');
    let attempts = 0;
    const printer = {
      jobs: [],
      async printPdf(bytes) {
        attempts += 1;
        if (attempts === 1) throw new Error('printer jammed');
        this.jobs.push(bytes);
        return { ok: true };
      },
    };
    const { useCase } = build({ sessions, printer });

    await expect(useCase.execute({ sessionIds: ['s-one', 's-two'] })).rejects.toThrow(/printer jammed/);
    expect(await typesOf(sessions, 's-one')).toEqual(['created']);
    expect(await typesOf(sessions, 's-two')).toEqual(['created']);

    await expect(useCase.execute({ sessionIds: ['s-one', 's-two'] })).resolves.toMatchObject({ learnerId: 'milo' });
    expect(printer.jobs).toHaveLength(1);
    expect(await typesOf(sessions, 's-one')).toEqual(['created', 'issued']);
    expect(await typesOf(sessions, 's-two')).toEqual(['created', 'issued']);
  });

  it('records the right event per section in a mixed batch of fresh and already-issued sessions', async () => {
    const sessions = realSessions();
    await open(sessions, 's-fresh', 'one');
    await open(sessions, 's-already', 'two', [{ type: 'issued', at: '2026-08-21T08:30:00.000Z', artifactId: 'solo-art' }]);
    const printer = { jobs: [], async printPdf(bytes) { this.jobs.push(bytes); return { ok: true }; } };
    const { useCase } = build({ sessions, printer });

    await expect(useCase.execute({ sessionIds: ['s-fresh', 's-already'] })).resolves.toMatchObject({ learnerId: 'milo' });

    expect(printer.jobs).toHaveLength(1);
    expect(await typesOf(sessions, 's-fresh')).toEqual(['created', 'issued']);
    expect(await typesOf(sessions, 's-already')).toEqual(['created', 'issued', 'reprinted']);
  });

  it('refuses the whole batch before printing when any session cannot take the event', async () => {
    const sessions = realSessions();
    await open(sessions, 's-ok', 'one');
    await open(sessions, 's-gone', 'two', [
      { type: 'issued', at: '2026-08-21T08:30:00.000Z', artifactId: 'solo-art' },
      { type: 'submitted', at: '2026-08-21T08:45:00.000Z', transport: 'paper' },
    ]);
    const printer = { jobs: [], async printPdf(bytes) { this.jobs.push(bytes); return { ok: true }; } };
    const { useCase, instances } = build({ sessions, printer });

    await expect(useCase.execute({ sessionIds: ['s-ok', 's-gone'] })).rejects.toThrow();

    // All-or-nothing: no paper, and no session half-recorded.
    expect(printer.jobs).toHaveLength(0);
    expect(instances.size).toBe(0);
    expect(await typesOf(sessions, 's-ok')).toEqual(['created']);
    expect(await typesOf(sessions, 's-gone')).toEqual(['created', 'issued', 'submitted']);
  });
});
