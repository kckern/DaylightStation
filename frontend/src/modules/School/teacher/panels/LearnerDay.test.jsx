import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LearnerDay from './LearnerDay.jsx';

vi.mock('../teacherWorkspaceApi.js', () => ({ teacherWorkspaceApi: {
  session: vi.fn(async () => ({ ok: true, status: 200, data: {
    taxonomy: { lessonTitle: 'Illinois' },
    artifacts: [{ artifactId: 'legacy-sheet', kind: 'worksheet', availability: 'unavailable' }],
  } })),
} }));

afterEach(() => cleanup());

describe('LearnerDay issued records', () => {
  it('names a missing historical original instead of pretending nothing was issued', async () => {
    render(<LearnerDay sessions={[{ sessionId: 'ses_legacy', lessonTitle: 'Illinois' }]} />);
    await waitFor(() => expect(screen.getByText('Illinois worksheet')).toBeTruthy());
    expect(screen.getByText(/Original print was not archived/)).toBeTruthy();
    expect(screen.queryByText('No issued worksheet or result receipt is linked to this session.')).toBeNull();
  });
});
