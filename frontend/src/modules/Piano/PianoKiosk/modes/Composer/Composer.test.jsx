import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

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
