import { describe, it, expect, beforeEach } from 'vitest';
import { PhoneInboxService, INSTALL_FRESH_MS, REDELIVER_MS } from './PhoneInboxService.mjs';

// The right install, every time (ops:docs/superpowers/plans/2026-11-26-phone-downloads-hardening.md §H).
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
const play = (commandId) => ({ commandId, command: 'queue', targetDevice: 'phone', params: { op: 'play-now', contentId: 'plex:1' } });

function memoryStore() {
  const files = new Map();
  return { files, load: (id) => (files.has(id) ? JSON.parse(files.get(id)) : null), save: (id, data) => files.set(id, JSON.stringify(data)) };
}

describe('PhoneInboxService: installs, auth and durable keeps', () => {
  let t; let store; let inbox;
  const make = () => {
    const i = new PhoneInboxService({ clock: t.clock, scheduler: t.scheduler, logger: {} });
    i.connect({ serves: (id) => id === 'phone', publish: () => {}, store, authorize: (id, token) => (id === 'phone' && token === 'right') });
    return i;
  };
  beforeEach(() => { t = fakeTime(); store = memoryStore(); inbox = make(); });

  it('authorizes only the device token, and never without a checker', () => {
    expect(inbox.authorize('phone', 'Bearer right')).toEqual({ ok: true });
    expect(inbox.authorize('phone', 'Bearer wrong').ok).toBe(false);
    expect(inbox.authorize('phone', undefined)).toEqual({ ok: false, reason: 'no_token' });
    expect(inbox.authorize('phone', 'right').ok).toBe(false);
    const bare = new PhoneInboxService({ clock: t.clock, scheduler: t.scheduler, logger: {} });
    expect(bare.authorize('phone', 'Bearer right')).toEqual({ ok: false, reason: 'no_authority' });
  });

  it('a command for one install never reaches another', async () => {
    await inbox.poll('phone', 0, { installId: A, model: 'SM-S921U' });
    await inbox.poll('phone', 0, { installId: B, model: 'sdk_gphone64' });
    inbox.enqueue('phone', { ...play('for-a'), installId: A });
    expect(await inbox.poll('phone', 0, { installId: B })).toEqual([]);
    expect((await inbox.poll('phone', 0, { installId: A })).map((e) => e.commandId)).toEqual(['for-a']);
  });

  it('an unaddressed command is stamped for the install that polled last', async () => {
    await inbox.poll('phone', 0, { installId: B });
    t.advance(1000);
    await inbox.poll('phone', 0, { installId: A });
    inbox.enqueue('phone', play('web-play'));
    expect(await inbox.poll('phone', 0, { installId: B })).toEqual([]);
    const got = await inbox.poll('phone', 0, { installId: A });
    expect(got.map((e) => [e.commandId, e.installId])).toEqual([['web-play', A]]);
  });

  it('with no fresh install, an unaddressed command still waits for the phone seen last', async () => {
    await inbox.poll('phone', 0, { installId: B });
    t.advance(1000);
    await inbox.poll('phone', 0, { installId: A });
    t.advance(INSTALL_FRESH_MS + 1);
    inbox.enqueue('phone', play('late'));
    // B polling first (an emulator, a stale install) must not take A's command.
    expect(await inbox.poll('phone', 0, { installId: B })).toEqual([]);
    expect((await inbox.poll('phone', 0, { installId: A })).map((e) => e.commandId)).toEqual(['late']);
  });

  it("a held poll woken by another install's command keeps holding", async () => {
    await inbox.poll('phone', 0, { installId: A });
    const held = inbox.poll('phone', 10, { installId: B });
    inbox.enqueue('phone', { ...play('for-a'), installId: A });
    t.advance(10_000);
    expect(await held).toEqual([]);
  });

  it('keeps are durable: they survive a restart and go only when acked', async () => {
    await inbox.poll('phone', 0, { installId: A, model: 'SM-S921U' });
    const env = inbox.queueKeep('phone', { command: 'keep', contentId: 'plex:9', title: 'A book' });
    expect(env.installId).toBe(A);
    // Backend restart: a new service reads the store.
    inbox = make();
    const first = await inbox.poll('phone', 0, { installId: A });
    expect(first.map((e) => [e.command, e.params.contentId])).toEqual([['keep', 'plex:9']]);
    // Handed over and not acked: not again at once, again after REDELIVER_MS.
    expect(await inbox.poll('phone', 0, { installId: A })).toEqual([]);
    t.advance(REDELIVER_MS + 1);
    expect((await inbox.poll('phone', 0, { installId: A })).length).toBe(1);
    inbox.ack('phone', { commandId: env.commandId, ok: true });
    t.advance(REDELIVER_MS + 1);
    expect(await inbox.poll('phone', 0, { installId: A })).toEqual([]);
    inbox = make();
    expect(inbox.keeps('phone').waiting).toEqual([]);
  });

  it('a keep has no TTL: the phone away for a day still gets it', async () => {
    await inbox.poll('phone', 0, { installId: A });
    inbox.queueKeep('phone', { command: 'keep', contentId: 'plex:9' });
    t.advance(24 * 3600 * 1000);
    expect((await inbox.poll('phone', 0, { installId: A })).map((e) => e.command)).toEqual(['keep']);
  });

  it('a newer ask replaces a waiting one for the same content and install', async () => {
    await inbox.poll('phone', 0, { installId: A });
    inbox.queueKeep('phone', { command: 'keep', contentId: 'plex:9' });
    inbox.queueKeep('phone', { command: 'unkeep', contentId: 'plex:9' });
    expect(inbox.keeps('phone').waiting.map((w) => w.command)).toEqual(['unkeep']);
  });

  it('a poll whose caller left puts a durable keep back without duplicating it', async () => {
    await inbox.poll('phone', 0, { installId: A });
    inbox.queueKeep('phone', { command: 'keep', contentId: 'plex:9' });
    const got = await inbox.poll('phone', 0, { installId: A });
    inbox.putBack('phone', got);
    const again = await inbox.poll('phone', 0, { installId: A });
    expect(again.length).toBe(1);
    expect(inbox.keeps('phone').waiting.length).toBe(1);
  });

  it('the phone reports what it keeps; the web sees installs, kept items and what waits', async () => {
    await inbox.poll('phone', 0, { installId: B, model: 'sdk_gphone64' });
    t.advance(1000);
    await inbox.poll('phone', 0, { installId: A, model: 'SM-S921U' });
    inbox.reportKeeps('phone', { installId: A, items: [
      { contentId: 'plex:9', title: 'A book', state: 'downloading', done: 3, total: 12, bytes: 1000 },
      { contentId: 'plex:8', state: 'failed', reason: 'Gone from the library', done: 0, total: 1 },
      { contentId: 'plex:7', state: 'bogus' },
    ] });
    inbox.queueKeep('phone', { command: 'keep', contentId: 'plex:5', title: 'Next' });
    const view = inbox.keeps('phone');
    expect(view.installs.map((i) => [i.model, i.current, i.live])).toEqual([['SM-S921U', true, true], ['sdk_gphone64', false, true]]);
    expect(view.kept[A].items.map((i) => [i.contentId, i.state])).toEqual([['plex:9', 'downloading'], ['plex:8', 'failed']]);
    expect(view.waiting.map((w) => [w.contentId, w.installId])).toEqual([['plex:5', A]]);
    expect(() => inbox.reportKeeps('phone', { installId: 'short', items: [] })).toThrow();
  });
});
