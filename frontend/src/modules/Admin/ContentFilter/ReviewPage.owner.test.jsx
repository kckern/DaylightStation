import { describe, it, expect, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useEffect } from 'react';
import { setToken } from '../../../lib/auth.js';

const payload = {
  title: 'Owner film', certification: { level: 'machine' }, audit: { ok: true, fresh: true, failures: [] },
  rows: [], reviewed: 0, total: 0, job: null, signOff: { ready: false, missing: [], parent: null },
};
const mounts = [];
vi.mock('../../../lib/hooks/useApiResource.js', () => ({
  useApiResource: () => {
    // One mount of the review reader is one HTTP read in the real hook.
    useEffect(() => { mounts.push('read'); }, []);
    return { data: payload, loading: false, error: null, reload: () => {} };
  },
}));
vi.mock('../../../../../__app_modules/media/media/browser/playback.mjs', () => ({ default: () => <div /> }));
const { ContentFilterReview } = await import('./ContentFilterAdmin.jsx');

describe('Content filter review owner change', () => {
  it('does not remount (and so re-read) the review a second time when the browser credential changes', () => {
    localStorage.removeItem('ds_token');
    render(<MantineProvider><MemoryRouter initialEntries={['/admin/content/filter/77']}><Routes>
      <Route path="/admin/content/filter/:ratingKey" element={<ContentFilterReview />} /></Routes></MemoryRouter></MantineProvider>);
    expect(mounts).toHaveLength(1);
    act(() => { setToken('replacement-token'); });
    // The Admin session boundary owns remounting on a session change; the page adds none of its own.
    expect(mounts).toHaveLength(1);
  });
});
