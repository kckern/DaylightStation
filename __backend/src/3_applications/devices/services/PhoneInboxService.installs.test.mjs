import { describe, it, expect, beforeEach } from 'vitest';
import {
  PhoneInboxService, INSTALL_FRESH_MS, INSTALL_GONE_MS, REDELIVER_MS, LOAD_RETRY_MS, POLL_PERSIST_MS,
} from './PhoneInboxService.mjs';

// ops:docs/superpowers/plans/2026-11-26-phone-downloads-hardening.md §H and
// ops:docs/superpowers/specs/2026-11-26-phone-downloads-lifecycle.md §2, §3.2, §3.8.
function fakeTime() {
  let now = 5_000_000;
  const timers = [];
  return {
    clock: { now: () => now },
    scheduler: { after(ms, task) { const t = { at: now + ms, task, live: true }; timers.push(t); return () => { t.live = false; }; } },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const next = timers.filter((x) => x.live && x.at <= until).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        now = next.at; next.live = false; next.task();
      }
      now = until;
    },
  };
}

const A = 'install-aaaa-1111';
const B = 'install-bbbb-2222';
const C = 'install-cccc-3333';
const play = (commandId) => ({ commandId, command: 'queue', targetDevice: 'phone', params: { op: 'play-now', contentId: 'plex:1' } });

function memoryStore() {
  const files = new Map();
  const store = {
    files, saves: 0, failSaves: false, loadError: null, quarantined: 0,
    load: (id) => { if (store.loadError) throw store.loadError; return files.has(id) ? JSON.parse(files.get(id)) : null; },
    save: async (id, data) => { if (store.failSaves) throw new Error('disk full'); store.saves++; files.set(id, JSON.stringify(data)); },
    quarantine: () => { store.quarantined++; },
  };
  return store;
}

describe('PhoneInboxService: installs, auth and durable keeps', () => {
  let t; let store; let inbox; let logs; let allowNoToken;
  const make = () => {
    const i = new PhoneInboxService({
      clock: t.clock, scheduler: t.scheduler,
      logger: { info: (e) => logs.push(e), warn: (e) => logs.push(e), error: (e) => logs.push(e), sampled: (e) => logs.push(e) },
    });
    i.connect({
      serves: (id) => id === 'phone', publish: () => {}, store,
      authorize: (id, token) => (id === 'phone' && token === 'right' ? true : 'wrong_token'),
      allowUnauthenticated: () => allowNoToken,
    });
    return i;
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));
  beforeEach(() => { t = fakeTime(); store = memoryStore(); logs = []; allowNoToken = false; inbox = make(); });

  describe('auth', () => {
    it('checks a token that is present; refuses none unless the transition allows it', () => {
      expect(inbox.authorize('phone', 'Bearer right')).toEqual({ ok: true });
      expect(inbox.authorize('phone', 'Bearer wrong')).toEqual({ ok: false, reason: 'wrong_token' });
      expect(inbox.authorize('phone', undefined)).toEqual({ ok: false, reason: 'no_token' });
      allowNoToken = true;
      expect(inbox.authorize('phone', undefined)).toEqual({ ok: true, unauthenticated: true });
      expect(logs).toContain('phone-inbox.unauthenticated');
      // A present but wrong token is refused even during the transition.
      expect(inbox.authorize('phone', 'Bearer wrong').ok).toBe(false);
    });
  });

  describe('Play on', () => {
    it('a command for one install never reaches another', async () => {
      await inbox.poll('phone', 0, { installId: A, model: 'SM-S921U' });
      await inbox.poll('phone', 0, { installId: B, model: 'sdk_gphone64' });
      inbox.enqueue('phone', { ...play('for-a'), installId: A });
      expect(await inbox.poll('phone', 0, { installId: B })).toEqual([]);
      expect((await inbox.poll('phone', 0, { installId: A })).map((e) => e.commandId)).toEqual(['for-a']);
    });

    it('with one live install an unaddressed play is for it; with two it is refused (choose a phone)', async () => {
      await inbox.poll('phone', 0, { installId: A, model: 'SM-S921U' });
      expect(inbox.enqueue('phone', play('one')).installId).toBe(A);
      await inbox.poll('phone', 0, { installId: B, model: 'sdk_gphone64' });
      expect(() => inbox.enqueue('phone', play('two'))).toThrow(expect.objectContaining({ code: 'CHOOSE_PHONE' }));
      expect(inbox.liveInstalls('phone').map((i) => i.model).sort()).toEqual(['SM-S921U', 'sdk_gphone64']);
    });

    it('with no live install it waits for the phone seen last; another install polling first cannot take it', async () => {
      await inbox.poll('phone', 0, { installId: B });
      t.advance(1000);
      await inbox.poll('phone', 0, { installId: A });
      t.advance(INSTALL_FRESH_MS + 1);
      inbox.enqueue('phone', play('late'));
      expect(await inbox.poll('phone', 0, { installId: B })).toEqual([]);
      expect((await inbox.poll('phone', 0, { installId: A })).map((e) => e.commandId)).toEqual(['late']);
    });

    it('a newer poll from the same install answers its older held poll empty', async () => {
      await inbox.poll('phone', 0, { installId: A });
      const older = inbox.poll('phone', 25, { installId: A });
      const newer = inbox.poll('phone', 25, { installId: A });
      expect(await older).toEqual([]);
      inbox.enqueue('phone', play('p'));
      expect((await newer).map((e) => e.commandId)).toEqual(['p']);
      expect(logs).toContain('phone-inbox.poll.superseded');
    });

    it('a held poll woken by another install’s command keeps holding', async () => {
      await inbox.poll('phone', 0, { installId: A });
      const held = inbox.poll('phone', 10, { installId: B });
      inbox.enqueue('phone', { ...play('for-a'), installId: A });
      t.advance(10_000);
      expect(await held).toEqual([]);
    });

    it('a play no one collected can be taken back (not delivered, never late)', async () => {
      await inbox.poll('phone', 0, { installId: A });
      inbox.enqueue('phone', play('slow'));
      expect(inbox.cancel('phone', 'slow')).toBe(true);
      expect(await inbox.poll('phone', 0, { installId: A })).toEqual([]);
      expect(inbox.cancel('phone', 'slow')).toBe(false);
    });
  });

  describe('background checks (the app closed)', () => {
    it('collect a waiting keep, but leave the phone neither present nor live', async () => {
      await inbox.poll('phone', 0, { installId: A, model: 'SM-S921U' });
      t.advance(INSTALL_FRESH_MS + 60_000);
      expect(inbox.isPresent('phone')).toBe(false);
      const env = await inbox.queueKeep('phone', { command: 'keep', contentId: 'plex:9', title: 'A book' });
      const got = await inbox.poll('phone', 0, { installId: A, background: true });
      expect(got.map((e) => e.commandId)).toEqual([env.commandId]);
      expect(inbox.isPresent('phone')).toBe(false);
      expect(inbox.liveInstalls('phone')).toEqual([]);
      expect(inbox.keeps('phone').installs[0]).toMatchObject({ installId: A, live: false });
    });

    it('a listening poll makes it present and live again', async () => {
      await inbox.poll('phone', 0, { installId: A, background: true });
      expect(inbox.isPresent('phone')).toBe(false);
      await inbox.poll('phone', 0, { installId: A });
      expect(inbox.isPresent('phone')).toBe(true);
      expect(inbox.liveInstalls('phone').map((i) => i.installId)).toEqual([A]);
    });
  });

  describe('keeps', () => {
    it('are durable: survive a restart and go only when acked; then read "received" until reported', async () => {
      await inbox.poll('phone', 0, { installId: A, model: 'SM-S921U' });
      const env = await inbox.queueKeep('phone', { command: 'keep', contentId: 'plex:9', title: 'A book' });
      expect(env.installId).toBe(A);
      inbox = make();
      const first = await inbox.poll('phone', 0, { installId: A });
      expect(first.map((e) => [e.command, e.params.contentId, e.params.title])).toEqual([['keep', 'plex:9', 'A book']]);
      expect(await inbox.poll('phone', 0, { installId: A })).toEqual([]);
      t.advance(REDELIVER_MS + 1);
      expect((await inbox.poll('phone', 0, { installId: A })).length).toBe(1);
      inbox.ack('phone', { commandId: env.commandId, ok: true });
      let view = inbox.keeps('phone');
      expect(view.waiting).toEqual([]);
      expect(view.received.map((r) => r.contentId)).toEqual(['plex:9']);
      await inbox.reportKeeps('phone', { installId: A, freeBytes: 15e9, limitBytes: 4e9, items: [{ contentId: 'plex:9', state: 'checking' }] });
      view = inbox.keeps('phone');
      expect(view.received).toEqual([]);
      expect(view.kept[A]).toMatchObject({ freeBytes: 15e9, limitBytes: 4e9 });
    });

    it('a refusal stays visible with the phone’s reason until asked again', async () => {
      await inbox.poll('phone', 0, { installId: A });
      const env = await inbox.queueKeep('phone', { command: 'keep', contentId: 'plex:9' });
      inbox.ack('phone', { commandId: env.commandId, ok: false, error: 'Needs 1.2 GB more room' });
      expect(inbox.keeps('phone').refused).toEqual([expect.objectContaining({ contentId: 'plex:9', reason: 'Needs 1.2 GB more room' })]);
      await inbox.queueKeep('phone', { command: 'keep', contentId: 'plex:9' });
      expect(inbox.keeps('phone').refused).toEqual([]);
    });

    it('has no TTL', async () => {
      await inbox.poll('phone', 0, { installId: A });
      await inbox.queueKeep('phone', { command: 'keep', contentId: 'plex:9' });
      t.advance(24 * 3600 * 1000);
      expect((await inbox.poll('phone', 0, { installId: A })).map((e) => e.command)).toEqual(['keep']);
    });

    it('with no live install waits unaddressed; the first install to poll claims it', async () => {
      const env = await inbox.queueKeep('phone', { command: 'keep', contentId: 'plex:9' });
      expect(env.installId).toBeUndefined();
      const got = await inbox.poll('phone', 0, { installId: C, model: 'new phone' });
      expect(got.map((e) => [e.commandId, e.installId])).toEqual([[env.commandId, C]]);
      expect(inbox.keeps('phone').waiting[0].installId).toBe(C);
    });

    it('two live installs and none named: choose a phone', async () => {
      await inbox.poll('phone', 0, { installId: A });
      await inbox.poll('phone', 0, { installId: B });
      await expect(inbox.queueKeep('phone', { command: 'keep', contentId: 'plex:9' })).rejects.toMatchObject({ code: 'CHOOSE_PHONE' });
      expect((await inbox.queueKeep('phone', { command: 'keep', contentId: 'plex:9', installId: B })).installId).toBe(B);
    });

    it('a new install takes over what waited for installs no longer live', async () => {
      await inbox.poll('phone', 0, { installId: A });
      const env = await inbox.queueKeep('phone', { command: 'keep', contentId: 'plex:9' });
      t.advance(INSTALL_FRESH_MS + 1);
      const got = await inbox.poll('phone', 0, { installId: C, model: 'reinstalled' });
      expect(got.map((e) => [e.commandId, e.installId])).toEqual([[env.commandId, C]]);
    });

    it('an evicted install’s keeps go with it', async () => {
      await inbox.poll('phone', 0, { installId: A });
      await inbox.queueKeep('phone', { command: 'keep', contentId: 'plex:9', installId: A });
      await inbox.reportKeeps('phone', { installId: A, items: [{ contentId: 'plex:8', state: 'ready' }] });
      for (let i = 0; i < 8; i++) { t.advance(1000); await inbox.poll('phone', 0, { installId: `install-other-${i}0000` }); }
      const view = inbox.keeps('phone');
      expect(view.installs.find((i) => i.installId === A)).toBeUndefined();
      expect(view.kept[A]).toBeUndefined();
      expect(view.waiting.filter((w) => w.installId === A)).toEqual([]);
    });

    it('can be cancelled before it is handed over; after, cancelling asks for a removal', async () => {
      await inbox.poll('phone', 0, { installId: A });
      const one = await inbox.queueKeep('phone', { command: 'keep', contentId: 'plex:9', installId: A });
      expect(await inbox.cancelKeep('phone', one.commandId)).toEqual({ cancelled: true });
      expect(inbox.keeps('phone').waiting).toEqual([]);
      const two = await inbox.queueKeep('phone', { command: 'keep', contentId: 'plex:9', installId: A });
      await inbox.poll('phone', 0, { installId: A });
      const after = await inbox.cancelKeep('phone', two.commandId);
      expect(after).toMatchObject({ cancelled: false, removing: true });
      expect(inbox.keeps('phone').waiting.map((w) => w.command)).toEqual(['unkeep']);
      expect(await inbox.cancelKeep('phone', 'nope')).toBeNull();
    });

    it('takes every lifecycle state and the spec fields; drops unknown ones', async () => {
      await inbox.poll('phone', 0, { installId: A });
      const states = ['asked', 'checking', 'needs-room', 'queued', 'waiting-wifi', 'waiting-home', 'waiting-storage', 'downloading', 'paused', 'partly-ready', 'ready', 'updating', 'removing', 'not-available', 'damaged'];
      await inbox.reportKeeps('phone', { installId: A, items: [
        ...states.map((state, i) => ({ contentId: `plex:${i}`, state })),
        { contentId: 'plex:x', state: 'bogus' },
        { contentId: 'plex:n', state: 'needs-room', neededBytes: 1.2e9, totalBytes: 2e9, failed: 1, reason: 'r', finished: true },
      ] });
      const items = inbox.keeps('phone').kept[A].items;
      expect(items.map((i) => i.state)).toEqual([...states, 'needs-room']);
      expect(items.at(-1)).toMatchObject({ neededBytes: 1.2e9, totalBytes: 2e9, failed: 1, reason: 'r', finished: true });
    });

    it('keeps the auto flag of an item kept automatically while listening, and nothing else as auto', async () => {
      await inbox.poll('phone', 0, { installId: A });
      await inbox.reportKeeps('phone', { installId: A, items: [
        { contentId: 'plex:a', state: 'ready', auto: true },
        { contentId: 'plex:m', state: 'ready' },
        { contentId: 'plex:s', state: 'ready', auto: 'yes' },
      ] });
      const items = inbox.keeps('phone').kept[A].items;
      expect(items[0]).toMatchObject({ contentId: 'plex:a', auto: true });
      expect(items[1].auto).toBeUndefined();
      expect(items[2].auto).toBeUndefined();
    });

    it('keeps a unit\'s group (spec §3.11), cleaned, and drops a group that is not one', async () => {
      await inbox.poll('phone', 0, { installId: A });
      await inbox.reportKeeps('phone', { installId: A, items: [
        { contentId: 'plex:10', state: 'ready', group: { id: 'plex:100', title: 'William Shakespeare', kind: 'author', follow: true, removeFinished: true, extra: 'x' } },
        { contentId: 'plex:11', state: 'downloading', group: { id: 'plex:100', title: 'William Shakespeare', kind: 'author', follow: 'yes' } },
        { contentId: 'plex:12', state: 'ready', group: { id: 'not an id', kind: 'author' } },
        { contentId: 'plex:13', state: 'ready', group: { id: 'plex:200', kind: 'band' } },
        { contentId: 'plex:14', state: 'ready', group: 'plex:100' },
        { contentId: 'plex:15', state: 'ready', group: { id: 'plex:300', kind: 'artist', title: 'x'.repeat(300) } },
      ] });
      const items = inbox.keeps('phone').kept[A].items;
      expect(items[0].group).toEqual({ id: 'plex:100', title: 'William Shakespeare', kind: 'author', follow: true, removeFinished: true });
      expect(items[1].group).toEqual({ id: 'plex:100', title: 'William Shakespeare', kind: 'author', follow: false, removeFinished: false });
      expect(items[2].group).toBeUndefined();
      expect(items[3].group).toBeUndefined();
      expect(items[4].group).toBeUndefined();
      expect(items[5].group.title).toHaveLength(200);
    });

    it('shows an install as gone after 30 days', async () => {
      await inbox.poll('phone', 0, { installId: A });
      t.advance(INSTALL_GONE_MS + 1);
      expect(inbox.keeps('phone').installs[0]).toMatchObject({ installId: A, live: false, gone: true });
    });
  });

  describe('the store', () => {
    it('an unreadable file is never read as empty: read-only, no saves, keeps refused, retried later', async () => {
      store.files.set('phone', JSON.stringify({ installs: [{ installId: A, model: 'SM-S921U', lastPollAt: 1 }] }));
      store.loadError = Object.assign(new Error('EACCES'), { code: 'EACCES' });
      await inbox.poll('phone', 0, { installId: B });
      await flush();
      expect(store.saves).toBe(0);
      await expect(inbox.queueKeep('phone', { command: 'keep', contentId: 'plex:9' })).rejects.toMatchObject({ code: 'STORE_UNAVAILABLE' });
      expect(inbox.keeps('phone').storeUnavailable).toBe(true);
      expect(JSON.parse(store.files.get('phone')).installs[0].installId).toBe(A);
      // Readable again: what was stored and what this run saw are both kept.
      store.loadError = null;
      t.advance(LOAD_RETRY_MS + 1);
      await inbox.queueKeep('phone', { command: 'keep', contentId: 'plex:9', installId: B });
      const saved = JSON.parse(store.files.get('phone'));
      expect(saved.installs.map((i) => i.installId).sort()).toEqual([A, B]);
    });

    it('a damaged file is quarantined', async () => {
      store.loadError = Object.assign(new Error('bad yaml'), { name: 'YAMLException' });
      inbox.keeps('phone');
      expect(store.quarantined).toBe(1);
    });

    it('a keep that could not be written is an error, and nothing is queued', async () => {
      await inbox.poll('phone', 0, { installId: A });
      await flush();
      store.failSaves = true;
      await expect(inbox.queueKeep('phone', { command: 'keep', contentId: 'plex:9' })).rejects.toMatchObject({ code: 'STORE_UNAVAILABLE' });
      expect(inbox.keeps('phone').waiting).toEqual([]);
    });

    it('polls do not rewrite the file; an unchanged report is not written again', async () => {
      await inbox.poll('phone', 0, { installId: A });
      await flush();
      const afterFirst = store.saves;
      for (let i = 0; i < 20; i++) { t.advance(25_000); await inbox.poll('phone', 0, { installId: A }); }
      await flush();
      expect(store.saves).toBe(afterFirst);
      t.advance(POLL_PERSIST_MS + 1);
      await inbox.poll('phone', 0, { installId: A });
      await flush();
      expect(store.saves).toBe(afterFirst + 1);
      const report = { installId: A, items: [{ contentId: 'plex:9', state: 'ready', bytes: 5 }] };
      await inbox.reportKeeps('phone', report);
      const n = store.saves;
      await inbox.reportKeeps('phone', report);
      expect(store.saves).toBe(n);
    });
  });
});
