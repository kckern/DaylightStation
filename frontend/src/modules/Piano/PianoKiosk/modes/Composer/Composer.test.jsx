import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Mock the piano contexts + api so the mode renders headless.
vi.mock('../../PianoConfig.jsx', () => ({ usePianoKioskConfig: () => ({ config: { composer: {} } }) }));
vi.mock('../../PianoBreadcrumbContext.jsx', () => ({ usePianoBreadcrumbBar: () => ({ setCrumbs: vi.fn() }) }));
vi.mock('./useCompositionsApi.js', () => ({ useCompositionsApi: () => ({ list: vi.fn().mockResolvedValue([]), get: vi.fn(), create: vi.fn(), save: vi.fn() }) }));
// Real active-user hook (grepped from Studio.jsx / Studio.test.jsx): usePianoUser()
// from PianoUserContext.jsx returns { currentUser }, not { userId }.
vi.mock('../../PianoUserContext.jsx', () => ({ usePianoUser: () => ({ currentUser: 'kc' }) }));

import { Composer } from './Composer.jsx';

describe('Composer mode', () => {
  it('mounts to the gallery view', async () => {
    render(<Composer />);
    await waitFor(() => expect(screen.getByRole('button', { name: /new song/i })).toBeInTheDocument());
  });
});
