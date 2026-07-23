import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import getLogger, { getRecentEvents } from '../../../../../lib/logging/Logger.js';

// Mock the piano contexts + api so the mode renders headless.
vi.mock('../../PianoConfig.jsx', () => ({ usePianoKioskConfig: () => ({ config: { composer: {} } }) }));
vi.mock('../../PianoBreadcrumbContext.jsx', () => ({ usePianoBreadcrumbBar: () => ({ setCrumbs: vi.fn() }) }));
vi.mock('./useCompositionsApi.js', () => ({ useCompositionsApi: () => ({ list: vi.fn().mockResolvedValue([]), get: vi.fn(), create: vi.fn(), save: vi.fn() }) }));
// Real active-user hook (grepped from Studio.jsx / Studio.test.jsx): usePianoUser()
// from PianoUserContext.jsx returns { currentUser }, not { userId }.
vi.mock('../../PianoUserContext.jsx', () => ({ usePianoUser: () => ({ currentUser: 'kc' }) }));
// EditorSurface pulls in the OSMD renderer + MIDI context; stub both so the mode
// mounts in happy-dom without engraving.
vi.mock('../../PianoMidiContext.jsx', () => ({ usePianoMidi: () => ({ subscribe: () => () => {} }) }));
vi.mock('../../../../MusicNotation/renderers/MusicXmlRenderer.jsx', () => ({
  MusicXmlRenderer: ({ children }) => <div data-testid="renderer">{children}</div>,
}));

import { Composer } from './Composer.jsx';

describe('Composer mode', () => {
  it('leads with a blank-staff editor (not a gallery gate)', async () => {
    render(<Composer />);
    // Editor surface + its "Songs" nav are present immediately; the gallery's
    // "New song" is NOT (we did not have to pass through a gallery to compose).
    await waitFor(() => expect(document.querySelector('.composer-editor')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /your songs/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new song/i })).not.toBeInTheDocument();
  });

  it('opens the gallery when "Songs" is tapped', async () => {
    render(<Composer />);
    await waitFor(() => expect(screen.getByRole('button', { name: /your songs/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /your songs/i }));
    // Gallery view: "New song" is how you get back to a blank staff.
    await waitFor(() => expect(screen.getByRole('button', { name: /new song/i })).toBeInTheDocument());
  });

  // The bottom bar is gone (Task 11B): four chrome strips on an 8" tablet, one
  // of them spending ~70px on two buttons. Both of its controls moved into the
  // editor toolbar, so nothing outside the editor renders mode chrome now.
  it('renders no bottom bar — its controls live in the editor toolbar', async () => {
    const { container } = render(<Composer />);
    await waitFor(() => expect(container.querySelector('.composer-editor')).toBeInTheDocument());
    expect(container.querySelector('.composer-bar')).toBeNull();
    expect(container.querySelector('.composer-toolbar')).toContainElement(screen.getByRole('button', { name: /your songs/i }));
  });

  // Task 4: the mode logger routes composer telemetry to a persisted session
  // log. Spy on getLogger().child() (the REAL logger, not mocked) to capture the
  // context the mode logger is created with — it must carry app + sessionLog so
  // the backend sessionFile transport files its events under piano-composer.
  it('creates its mode logger with a session-logged piano-composer context', async () => {
    const root = getLogger();
    const origChild = root.child.bind(root);
    const ctxs = [];
    const spy = vi.spyOn(root, 'child').mockImplementation((ctx) => { ctxs.push(ctx); return origChild(ctx); });
    try {
      render(<Composer />);
      await waitFor(() => expect(document.querySelector('.composer-editor')).toBeInTheDocument());
      // Some getLogger().child() call must carry sessionLog routing…
      const sessionCtx = ctxs.find((c) => c && c.sessionLog);
      expect(sessionCtx, 'no getLogger().child() carried sessionLog').toBeTruthy();
      // …and it is the composer mode logger, tagged for the piano-composer app.
      expect(sessionCtx).toMatchObject({ app: 'piano-composer', sessionLog: true });
      expect(sessionCtx.component).toBe('composer');
    } finally {
      spy.mockRestore();
    }
  });

  // A session-log.start fires for the piano-composer app on mount, so the
  // backend opens a session file to receive the mode's events.
  it('opens a piano-composer session on mount', async () => {
    const before = getRecentEvents(500).filter(
      (e) => e.event === 'session-log.start' && e.context?.app === 'piano-composer'
    ).length;
    render(<Composer />);
    await waitFor(() => expect(document.querySelector('.composer-editor')).toBeInTheDocument());
    const after = getRecentEvents(500).filter(
      (e) => e.event === 'session-log.start' && e.context?.app === 'piano-composer'
    ).length;
    expect(after).toBeGreaterThan(before);
  });

  // Round trip: editor → gallery → back to a fresh blank staff. With the bar
  // deleted the GALLERY is the only holder of the new-song path, so this is the
  // test that proves it is not stranded.
  it('round-trips editor → gallery → a fresh draft', async () => {
    const { container } = render(<Composer />);
    await waitFor(() => expect(screen.getByRole('button', { name: /your songs/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /your songs/i }));
    await waitFor(() => expect(container.querySelector('.composer-gallery')).toBeInTheDocument());
    expect(container.querySelector('.composer-editor')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /new song/i }));
    await waitFor(() => expect(container.querySelector('.composer-editor')).toBeInTheDocument());
    expect(container.querySelector('.composer-gallery')).toBeNull();
  });
});
