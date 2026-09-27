// The Shield's countdown film (frontend/public/arcade-film.html) is a static page:
// it cannot import the shared event names, so this pins it to them and drives it
// with the message shapes the backend announcer really sends.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { ARCADE_SESSION_EVENTS } from '@shared-contracts/media/topics.mjs';

const FILM = fs.readFileSync(path.resolve(__dirname, '../../../public/arcade-film.html'), 'utf8');

function mountFilm() {
  const sent = [];
  class FakeSocket {
    constructor() { this.readyState = 1; setTimeout(() => this.onopen?.(), 0); }
    send(data) { sent.push(JSON.parse(data)); }
    close() {}
  }
  const dom = new JSDOM(FILM, {
    url: 'https://daylight.test/arcade-film.html?device=livingroom-tv',
    runScripts: 'dangerously',
    beforeParse(window) {
      window.WebSocket = FakeSocket;
      // Share vitest's fake clock with the page, so time can be advanced.
      for (const k of ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']) window[k] = globalThis[k];
    },
  });
  const { window } = dom;
  const $ = (id) => window.document.getElementById(id);
  const logs = () => sent.filter((m) => m.topic === 'logging').flatMap((m) => m.events);
  return { window, film: window.__arcadeFilm, $, sent, logs };
}

const progress = (over = {}) => ({
  event: ARCADE_SESSION_EVENTS.PROGRESS, sessionId: 's1', deviceId: 'livingroom-tv',
  playedMs: 125_000, state: 'playing', system: 'gb', systemLabel: 'Game Boy', displayName: 'Test Player',
  placement: { zone: 'bottom', toast: [0.3458, 0.7907, 0.2406, 0.0713], orientation: 'wide' },
  overlay: { fields: ['player', 'system_label', 'timer'] },
  ...over,
});

describe('arcade-film contract', () => {
  let env;
  beforeEach(() => { vi.useFakeTimers({ now: Date.UTC(2026, 8, 26, 20) }); env = mountFilm(); });
  afterEach(() => { env.window.close(); vi.useRealTimers(); });

  it('names every event the backend sends', () => {
    for (const name of Object.values(ARCADE_SESSION_EVENTS)) expect(FILM).toContain(`'${name}'`);
  });

  it('shows a count-up of time played for a real started message', () => {
    env.film.handle(progress({ event: ARCADE_SESSION_EVENTS.STARTED }));
    expect(env.$('banner').classList.contains('show')).toBe(true);
    expect(env.$('clock').textContent).toBe('02:05');
    expect(env.$('label').textContent).toBe('played');
  });

  it('counts up between messages while playing', () => {
    env.film.handle(progress());
    vi.advanceTimersByTime(3000);
    expect(env.$('clock').textContent).toBe('02:08');
  });

  it('holds still while paused instead of counting up and snapping back', () => {
    env.film.handle(progress({ state: 'paused' }));
    vi.advanceTimersByTime(9000);
    expect(env.$('clock').textContent).toBe('02:05');
    expect(env.$('label').textContent).toBe('paused');
  });

  it('never extrapolates past the drift cap when the backend goes quiet', () => {
    env.film.handle(progress());
    vi.advanceTimersByTime(40_000);
    expect(env.$('clock').textContent).toBe('02:30');
  });

  it('does not let heartbeats keep a silent session looking fresh', () => {
    env.film.handle(progress());
    for (let i = 0; i < 10; i++) { vi.advanceTimersByTime(6000); env.film.handle({ type: 'heartbeat' }); }
    expect(env.window.document.body.classList.contains('stale')).toBe(true);
  });

  it('resumes ticking after it recovers from stale', () => {
    env.film.handle(progress());
    vi.advanceTimersByTime(50_000);
    env.film.handle(progress({ playedMs: 200_000 }));
    vi.advanceTimersByTime(2000);
    expect(env.window.document.body.classList.contains('stale')).toBe(false);
    expect(env.$('clock').textContent).toBe('03:22');
  });

  it('keeps the timer visible even when the overlay config lists no fields', () => {
    env.film.handle(progress({ overlay: { fields: [] } }));
    expect(env.window.document.querySelector('.timer').classList.contains('hide-field')).toBe(false);
  });

  it('puts an unplaced system in a corner pill, not a full-width bar over the game', () => {
    env.film.handle(progress({ placement: null, system: 'psx' }));
    const banner = env.$('banner');
    const width = env.window.screen.width || env.window.innerWidth;
    expect(parseFloat(banner.style.left)).toBeCloseTo(0.88 * width, 1);
    expect(banner.classList.contains('stacked')).toBe(true);
  });

  it('shows hours once a session passes an hour', () => {
    env.film.handle(progress({ playedMs: 3_725_000, state: 'paused' }));
    expect(env.$('clock').textContent).toBe('1:02:05');
  });

  it('clears on ended and still accepts the legacy play.session names', () => {
    env.film.handle(progress({ event: 'play.session.started' }));
    expect(env.$('banner').classList.contains('show')).toBe(true);
    env.film.handle({ event: ARCADE_SESSION_EVENTS.ENDED, sessionId: 's1', deviceId: 'livingroom-tv' });
    expect(env.$('banner').classList.contains('show')).toBe(false);
  });

  it('ships what it showed to the log store over its socket', async () => {
    await vi.advanceTimersByTimeAsync(1);
    env.film.handle(progress());
    const events = env.logs().map((e) => e.event);
    expect(events).toContain('arcade.film.loaded');
    expect(events).toContain('arcade.film.subscribed');
    const shown = env.logs().find((e) => e.event === 'arcade.film.shown');
    expect(shown.data).toMatchObject({ sessionId: 's1', clock: '02:05', label: 'played', state: 'playing' });
    expect(shown.context).toMatchObject({ app: 'arcade-film', deviceId: 'livingroom-tv' });
  });
});
