import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { YamlWorkSessionDatastore } from '#adapters/persistence/yaml/YamlWorkSessionDatastore.mjs';
import { IWorkSessionRepository } from '#apps/school/ports/IWorkSessionRepository.mjs';
import { reduceSession } from '#domains/school/sessions/sessionEvents.mjs';

const DAY = '2026-07-27';
const AT = `${DAY}T10:00:00.000Z`;
const SID = 'ses_abc123';

let tmp, ds;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'school-sessions-'));
  ds = new YamlWorkSessionDatastore({ configService: { getDataDir: () => tmp, getHouseholdPath: (rel) => `${tmp}/${rel}` } });
});

const sessionsRoot = () => path.join(tmp, 'apps', 'school', 'sessions');
const eventsFile = (sessionId, day = DAY) => path.join(sessionsRoot(), day, sessionId, 'events.yml');
const created = (over = {}) => ({ type: 'created', at: AT, sessionId: SID, learnerId: 'kid1', unitId: 'u1', ...over });
const issued = (over = {}) => ({ type: 'issued', at: AT, sessionId: SID, artifactId: 'doc_1', ...over });

describe('construction', () => {
  it('extends its port (decision D7)', () => {
    expect(ds).toBeInstanceOf(IWorkSessionRepository);
  });

  it('requires a configService', () => {
    expect(() => new YamlWorkSessionDatastore({})).toThrow(/configService/);
    expect(() => new YamlWorkSessionDatastore()).toThrow(/configService/);
  });
});

describe('appendEvent', () => {
  it('writes the spec §5.1 path, bucketed by the first event\'s day', async () => {
    await ds.appendEvent(SID, created());
    expect(fs.existsSync(eventsFile(SID))).toBe(true);
  });

  it('stamps seq 1 on the first event and increments from there', async () => {
    expect((await ds.appendEvent(SID, created())).seq).toBe(1);
    expect((await ds.appendEvent(SID, issued())).seq).toBe(2);
    expect(await ds.nextSeq(SID)).toBe(3);
  });

  it('re-stamps a caller-supplied seq — the log is authoritative, not the caller', async () => {
    await ds.appendEvent(SID, created());
    const stored = await ds.appendEvent(SID, { ...issued(), seq: 99 });
    expect(stored.seq).toBe(2);
  });

  it('stamps the sessionId so a mislabelled event cannot land in the wrong log', async () => {
    const stored = await ds.appendEvent(SID, { ...created(), sessionId: 'ses_elsewhere' });
    expect(stored.sessionId).toBe(SID);
  });

  it('keeps appending to the original day after midnight — a session is one folder', async () => {
    await ds.appendEvent(SID, created());
    await ds.appendEvent(SID, { ...issued(), at: '2026-07-28T01:00:00.000Z' });
    expect(fs.existsSync(eventsFile(SID, '2026-07-28'))).toBe(false);
    expect(await ds.readEvents(SID)).toHaveLength(2);
  });

  it('rejects a session id that could escape the sessions root', async () => {
    await expect(ds.appendEvent('../../escape', created())).rejects.toThrow(/sessionId/);
    await expect(ds.appendEvent('a/b', created())).rejects.toThrow(/sessionId/);
    await expect(ds.appendEvent('', created())).rejects.toThrow(/sessionId/);
  });

  it('rejects an event with no usable timestamp rather than filing it under a guess', async () => {
    await expect(ds.appendEvent(SID, { ...created(), at: 'whenever' })).rejects.toThrow(/at/);
  });

  it('rejects a non-object event', async () => {
    await expect(ds.appendEvent(SID, null)).rejects.toThrow(/event/);
  });

  /**
   * The concurrency guard. Twenty scans, print callbacks and grade writes can
   * land on one session in the same tick; a read-modify-write without a queue
   * loses all but the last. A lost append here is a lost piece of a child's work
   * record, which is exactly what an append-only log exists to prevent.
   */
  it('lands all 20 concurrent appends with unique sequential seqs', async () => {
    await ds.appendEvent(SID, created());
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => ds.appendEvent(SID, { ...issued(), artifactId: `doc_${i}` })),
    );

    const seqs = results.map((e) => e.seq).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => i + 2));
    expect(new Set(seqs).size).toBe(20);

    const stored = await ds.readEvents(SID);
    expect(stored).toHaveLength(21);
    expect(stored.map((e) => e.seq)).toEqual(Array.from({ length: 21 }, (_, i) => i + 1));
    // Every artifact made it — nothing was clobbered by an interleaved write.
    expect(new Set(stored.map((e) => e.artifactId).filter(Boolean)).size).toBe(20);
  });

  it('serialises concurrent appends across different sessions too', async () => {
    await Promise.all(['ses_a', 'ses_b', 'ses_c'].flatMap((sid) => [
      ds.appendEvent(sid, { ...created(), sessionId: sid }),
      ds.appendEvent(sid, { ...issued(), sessionId: sid }),
    ]));
    for (const sid of ['ses_a', 'ses_b', 'ses_c']) {
      expect((await ds.readEvents(sid)).map((e) => e.seq)).toEqual([1, 2]);
    }
  });
});

describe('readEvents', () => {
  it('returns [] for a session that does not exist', async () => {
    expect(await ds.readEvents('ses_nope')).toEqual([]);
  });

  it('returns [] for an unsafe session id instead of resolving a path', async () => {
    expect(await ds.readEvents('../../etc')).toEqual([]);
    expect(await ds.readEvents(null)).toEqual([]);
  });

  it('returns events in seq order even if the file was re-ordered on disk', async () => {
    await ds.appendEvent(SID, created());
    await ds.appendEvent(SID, issued());
    const file = eventsFile(SID);
    const list = JSON.parse(JSON.stringify(await ds.readEvents(SID))).reverse();
    fs.writeFileSync(file, JSON.stringify(list));
    expect((await ds.readEvents(SID)).map((e) => e.seq)).toEqual([1, 2]);
  });

  it('reduces to the derived state the domain expects', async () => {
    await ds.appendEvent(SID, created());
    await ds.appendEvent(SID, issued());
    const state = reduceSession(await ds.readEvents(SID));
    expect(state.errors).toEqual([]);
    expect(state.state).toBe('issued');
    expect(state.learnerId).toBe('kid1');
  });
});

describe('malformed logs isolate to themselves', () => {
  it('a corrupt session reads empty while its neighbours still read', async () => {
    await ds.appendEvent('ses_good', { ...created(), sessionId: 'ses_good' });
    await ds.appendEvent('ses_bad', { ...created(), sessionId: 'ses_bad' });
    fs.writeFileSync(eventsFile('ses_bad'), 'this: [is: not: valid: yaml\n  - {{{\n');

    expect(await ds.readEvents('ses_bad')).toEqual([]);
    expect(await ds.readEvents('ses_good')).toHaveLength(1);
  });

  it('a session file holding a mapping instead of a list reads empty', async () => {
    await ds.appendEvent(SID, created());
    fs.writeFileSync(eventsFile(SID), 'state: issued\n');
    expect(await ds.readEvents(SID)).toEqual([]);
  });

  it('a corrupt day index does not hide the other days\' open sessions', async () => {
    await ds.appendEvent('ses_old', { ...created(), sessionId: 'ses_old', at: '2026-07-20T09:00:00.000Z' });
    await ds.appendEvent('ses_new', { ...created(), sessionId: 'ses_new' });
    fs.writeFileSync(path.join(sessionsRoot(), '2026-07-20', 'index.yml'), '{{ broken\n');

    const open = await ds.listOpenForLearner('kid1');
    expect(open.map((s) => s.sessionId)).toEqual(['ses_new']);
  });

  it('a stray non-day directory under the sessions root is ignored', async () => {
    await ds.appendEvent(SID, created());
    fs.mkdirSync(path.join(sessionsRoot(), '.DS_Store_dir'), { recursive: true });
    fs.writeFileSync(path.join(sessionsRoot(), 'README.md'), 'notes');
    expect((await ds.listOpenForLearner('kid1')).map((s) => s.sessionId)).toEqual([SID]);
  });
});

describe('listOpenForLearner', () => {
  const openIds = async (learnerId) => (await ds.listOpenForLearner(learnerId)).map((s) => s.sessionId);

  it('lists a learner\'s open sessions with their derived state', async () => {
    await ds.appendEvent(SID, created());
    await ds.appendEvent(SID, issued());
    expect(await ds.listOpenForLearner('kid1')).toEqual([
      { sessionId: SID, learnerId: 'kid1', unitId: 'u1', state: 'issued', day: DAY, updatedAt: AT },
    ]);
  });

  it('excludes other learners', async () => {
    await ds.appendEvent('ses_a', { ...created(), sessionId: 'ses_a', learnerId: 'kid1' });
    await ds.appendEvent('ses_b', { ...created(), sessionId: 'ses_b', learnerId: 'kid2' });
    expect(await openIds('kid1')).toEqual(['ses_a']);
    expect(await openIds('kid2')).toEqual(['ses_b']);
  });

  it.each(['rewarded', 'remediation_opened'])('closes the session on %s', async (terminal) => {
    await ds.appendEvent(SID, created());
    await ds.appendEvent(SID, issued());
    await ds.appendEvent(SID, { type: 'submitted', at: AT, sessionId: SID, transport: 'paper' });
    await ds.appendEvent(SID, { type: 'graded', at: AT, sessionId: SID, attemptIds: ['att_1'], percent: 90 });
    await ds.appendEvent(SID, { type: 'outcome_recorded', at: AT, sessionId: SID, outcomeId: `out:${SID}`, result: 'passed' });
    expect(await openIds('kid1')).toEqual([SID]);

    await ds.appendEvent(SID, {
      type: terminal, at: AT, sessionId: SID, txnId: 't1', newSessionId: 'ses_next', variant: 1,
    });
    expect(await openIds('kid1')).toEqual([]);
  });

  it('closes the session on abandoned', async () => {
    await ds.appendEvent(SID, created());
    await ds.appendEvent(SID, issued());
    expect(await openIds('kid1')).toEqual([SID]);
    await ds.appendEvent(SID, { type: 'abandoned', at: AT, sessionId: SID, reason: 'lost the paper' });
    expect(await openIds('kid1')).toEqual([]);
  });

  it('leaves the session open when an appended event is not a legal transition', async () => {
    // The store is dumb: legality is the reducer's word, and a rejected event
    // must not close a session that is still really in progress.
    await ds.appendEvent(SID, created());
    await ds.appendEvent(SID, issued());
    await ds.appendEvent(SID, { type: 'rewarded', at: AT, sessionId: SID, txnId: 't1' });
    expect(await openIds('kid1')).toEqual([SID]);
    expect(reduceSession(await ds.readEvents(SID)).errors)
      .toContain('event[seq=3]: illegal transition issued -> rewarded');
  });

  it('follows a reassignment — the work moves to the new learner', async () => {
    await ds.appendEvent(SID, created());
    await ds.appendEvent(SID, {
      type: 'reassigned', at: AT, sessionId: SID, fromLearnerId: 'kid1', toLearnerId: 'kid2',
    });
    expect(await openIds('kid1')).toEqual([]);
    expect(await openIds('kid2')).toEqual([SID]);
  });

  it('spans days, most recent first', async () => {
    await ds.appendEvent('ses_old', { ...created(), sessionId: 'ses_old', at: '2026-07-20T09:00:00.000Z' });
    await ds.appendEvent('ses_new', { ...created(), sessionId: 'ses_new' });
    expect(await openIds('kid1')).toEqual(['ses_new', 'ses_old']);
  });

  it('returns [] when nothing has ever been written', async () => {
    expect(await ds.listOpenForLearner('kid1')).toEqual([]);
  });

  it('returns [] for a missing learner id rather than everything', async () => {
    await ds.appendEvent(SID, created());
    expect(await ds.listOpenForLearner(null)).toEqual([]);
    expect(await ds.listOpenForLearner('')).toEqual([]);
  });
});

describe('listForLearner', () => {
  it('projects gradedPercent from the session state', async () => {
    await ds.appendEvent(SID, created());
    await ds.appendEvent(SID, issued());
    await ds.appendEvent(SID, { type: 'submitted', at: AT, sessionId: SID, transport: 'paper' });
    await ds.appendEvent(SID, { type: 'graded', at: AT, sessionId: SID, attemptIds: ['att_1'], percent: 85 });
    await ds.appendEvent(SID, { type: 'outcome_recorded', at: AT, sessionId: SID, outcomeId: `out:${SID}`, result: 'passed' });
    await ds.appendEvent(SID, { type: 'rewarded', at: AT, sessionId: SID, txnId: 'txn_1' });

    const facts = await ds.listForLearner('kid1');
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      sessionId: SID,
      learnerId: 'kid1',
      unitId: 'u1',
      state: 'rewarded',
      terminal: true,
      outcome: { result: 'passed' },
      gradedPercent: 85,
    });
  });

  it('projects gradedPercent as null when no graded event exists', async () => {
    await ds.appendEvent(SID, created());
    await ds.appendEvent(SID, issued());

    const facts = await ds.listForLearner('kid1');
    expect(facts).toHaveLength(1);
    expect(facts[0].gradedPercent).toBe(null);
  });

  it('recomputes gradedPercent for pre-upgrade rows (missing gradedPercent key)', async () => {
    // Build a complete graded session through the real datastore
    await ds.appendEvent(SID, created());
    await ds.appendEvent(SID, issued());
    await ds.appendEvent(SID, { type: 'submitted', at: AT, sessionId: SID, transport: 'paper' });
    await ds.appendEvent(SID, { type: 'graded', at: AT, sessionId: SID, attemptIds: ['att_1'], percent: 85 });
    await ds.appendEvent(SID, { type: 'outcome_recorded', at: AT, sessionId: SID, outcomeId: `out:${SID}`, result: 'passed' });
    await ds.appendEvent(SID, { type: 'rewarded', at: AT, sessionId: SID, txnId: 'txn_1' });

    // Simulate a pre-upgrade index row by stripping the gradedPercent key
    const indexPath = path.join(sessionsRoot(), DAY, 'index.yml');
    const raw = yaml.load(fs.readFileSync(indexPath, 'utf8'));
    const upgradeRow = { ...raw[SID] };
    delete upgradeRow.gradedPercent; // Strip the key to simulate pre-upgrade
    raw[SID] = upgradeRow;
    fs.writeFileSync(indexPath, yaml.dump(raw, { indent: 2, lineWidth: -1, noRefs: true }), 'utf8');

    // Clear any cache to force a fresh read
    ds = new YamlWorkSessionDatastore({ configService: { getDataDir: () => tmp, getHouseholdPath: (rel) => `${tmp}/${rel}` } });

    // listForLearner should still report gradedPercent: 85 by recomputing from events
    const facts = await ds.listForLearner('kid1');
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      sessionId: SID,
      gradedPercent: 85,
    });
  });
});

describe('nextSeq', () => {
  it('is 1 for an unknown session', async () => {
    expect(await ds.nextSeq('ses_nope')).toBe(1);
  });

  it('is one past the highest stored seq, not the count', async () => {
    await ds.appendEvent(SID, created());
    const list = await ds.readEvents(SID);
    fs.writeFileSync(eventsFile(SID), JSON.stringify([{ ...list[0], seq: 12 }]));
    expect(await ds.nextSeq(SID)).toBe(13);
  });
});
