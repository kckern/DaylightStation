import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import getLogger, { getConfig, configure } from '../lib/logging/Logger.js';

// The roster fetch never settles, so PianoRoutes stays in its loading branch and
// renders null. That keeps this test about one thing — the logging context the
// kiosk app establishes at mount — without dragging in MIDI, the router or the
// whole mode tree.
vi.mock('../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(() => new Promise(() => {})),
}));

import PianoApp from './PianoApp.jsx';

afterEach(() => {
  // The singleton logger config outlives a render, so put it back.
  configure({ context: { app: undefined, sessionLog: false } });
});

/**
 * The backend's sessionFile transport drops any event whose context lacks BOTH
 * `app` and `sessionLog` (sessionFile.mjs), so an untagged surface logs only to
 * stdout — which is exactly how the 2026-08-16 remount storm lost its evidence
 * when the container restarted. These tests hold the kiosk to the tagging that
 * makes its events land in a file.
 */
describe('PianoApp logging context', () => {
  it('configures the root logger so descendant loggers inherit session logging', () => {
    render(<PianoApp />);
    // Descendants create their loggers with getLogger().child({ component }) and
    // inherit whatever root context exists at that moment, so the root config is
    // what makes the kiosk's events durable.
    expect(getConfig().context).toMatchObject({ app: 'piano-kiosk', sessionLog: true });
  });

  it('files under piano-kiosk, never under piano (that app slug belongs to PianoVisualizer)', () => {
    render(<PianoApp />);
    // Asserted positively as well, so this cannot pass by the app being untagged.
    expect(getConfig().context.app).toBe('piano-kiosk');
    expect(getConfig().context.app).not.toBe('piano');
  });

  it('creates its own logger with a session-logged piano-kiosk context', () => {
    const root = getLogger();
    const origChild = root.child.bind(root);
    const ctxs = [];
    const spy = vi.spyOn(root, 'child').mockImplementation((ctx) => { ctxs.push(ctx); return origChild(ctx); });
    try {
      render(<PianoApp />);
      const sessionCtx = ctxs.find((c) => c && c.sessionLog);
      expect(sessionCtx, 'no getLogger().child() carried sessionLog').toBeTruthy();
      expect(sessionCtx).toMatchObject({ app: 'piano-kiosk', sessionLog: true });
    } finally {
      spy.mockRestore();
    }
  });

  it('stops claiming session logging once the kiosk unmounts', () => {
    const view = render(<PianoApp />);
    expect(getConfig().context.sessionLog).toBe(true);
    view.unmount();
    expect(getConfig().context.sessionLog).toBe(false);
  });
});
