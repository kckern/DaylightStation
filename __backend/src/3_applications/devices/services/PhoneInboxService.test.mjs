import { describe, it, expect, beforeEach } from 'vitest';
import { PhoneInboxService, PRESENCE_MS, ENTRY_TTL_MS, HEARTBEAT_MS, MAX_ENTRIES } from './PhoneInboxService.mjs';

function fakeTime() {
  let now = 1_000_000;
  const timers = [];
  return {
    clock: { now: () => now },
    scheduler: {
      after(ms, task) {
        const t = { at: now + ms, task, live: true };
        timers.push(t);
        return () => { t.live = false; };
      },
    },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const next = timers.filter((t) => t.live && t.at <= until).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        now = next.at;
        next.live = false;
        next.task();
      }
      now = until;
    },
  };
}

const env = (commandId, contentId = 'plex:1') => ({ commandId, command: 'queue', targetDevice: 'phone', params: { op: 'play-now', contentId } });

describe('PhoneInboxService', () => {
  let t; let inbox; let sent;
  beforeEach(() => {
    t = fakeTime();
    sent = [];
    inbox = new PhoneInboxService({ clock: t.clock, scheduler: t.scheduler, logger: {} });
    inbox.connect({ serves: (id) => id === 'phone', publish: (m) => sent.push(m) });
  });

  it('serves only the devices it is told to', () => {
    expect(inbox.serves('phone')).toBe(true);
    expect(inbox.serves('livingroom-tv')).toBe(false);
  });

  it('queues, replaces the same commandId, and hands each over once', () => {
    inbox.enqueue('phone', env('a', 'plex:1'));
    inbox.enqueue('phone', env('a', 'plex:2'));
    inbox.enqueue('phone', env('b'));
    const got = inbox.take('phone');
    expect(got.map((e) => [e.commandId, e.params.contentId])).toEqual([['a', 'plex:2'], ['b', 'plex:1']]);
    expect(inbox.take('phone')).toEqual([]);
  });

  it('drops what nobody collected within the TTL and keeps at most MAX_ENTRIES', () => {
    inbox.enqueue('phone', env('old'));
    t.advance(ENTRY_TTL_MS + 1);
    expect(inbox.take('phone')).toEqual([]);
    for (let i = 0; i < MAX_ENTRIES + 5; i++) inbox.enqueue('phone', env(`c${i}`));
    const got = inbox.take('phone');
    expect(got).toHaveLength(MAX_ENTRIES);
    expect(got[0].commandId).toBe('c5');
  });

  it('a poll answers at once when something waits, and is present for PRESENCE_MS after', async () => {
    expect(inbox.isPresent('phone')).toBe(false);
    inbox.enqueue('phone', env('a'));
    const got = await inbox.poll('phone', 25);
    expect(got.map((e) => e.commandId)).toEqual(['a']);
    expect(inbox.isPresent('phone')).toBe(true);
    t.advance(PRESENCE_MS + 1);
    expect(inbox.isPresent('phone')).toBe(false);
  });

  it('a held poll is woken by a command, is present while held, and beats its heartbeat', async () => {
    const pending = inbox.poll('phone', 25);
    expect(inbox.isPresent('phone')).toBe(true);
    t.advance(HEARTBEAT_MS * 2);
    const beats = sent.filter((m) => m.topic === 'device-state' && m.reason === 'heartbeat');
    expect(beats.length).toBe(3); // at the poll, then twice while held
    expect(beats[0].snapshot.state).toBe('idle');
    inbox.enqueue('phone', env('b'));
    expect((await pending).map((e) => e.commandId)).toEqual(['b']);
  });

  it('a held poll times out empty', async () => {
    const pending = inbox.poll('phone', 5);
    t.advance(5000);
    expect(await pending).toEqual([]);
  });

  it('an ack publishes device-ack, and its state a playing snapshot for the dispatch', () => {
    inbox.ack('phone', { commandId: 'a', ok: true, state: { contentId: 'plex:9', title: 'A book', playing: true } });
    const ack = sent.find((m) => m.topic === 'device-ack');
    expect(ack).toMatchObject({ deviceId: 'phone', commandId: 'a', ok: true });
    const state = sent.find((m) => m.topic === 'device-state');
    expect(state.snapshot).toMatchObject({
      sessionId: 'phone-a', state: 'playing', currentItem: { contentId: 'plex:9', title: 'A book' },
      meta: { ownerId: 'phone', playbackOwner: { ownerInstanceId: 'phone-inbox:phone' } },
    });
    expect(Number.isInteger(state.snapshot.meta.playbackOwner.playbackRevision)).toBe(true);
    // Later heartbeats carry the reported state.
    inbox.heartbeat('phone');
    expect(sent.at(-1).snapshot.currentItem.contentId).toBe('plex:9');
  });

  it('a failed ack carries its error and no state', () => {
    inbox.ack('phone', { commandId: 'x', ok: false, error: 'not audio' });
    expect(sent).toEqual([expect.objectContaining({ topic: 'device-ack', ok: false, error: 'not audio' })]);
  });

  it('requires a scheduler', () => {
    expect(() => new PhoneInboxService({})).toThrow(/scheduler/);
  });
});
