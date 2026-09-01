import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('../teacherWorkspaceApi.js', () => ({
  teacherWorkspaceApi: { session: vi.fn() },
}));
const { teacherWorkspaceApi } = await import('../teacherWorkspaceApi.js');
const SessionPaperRecord = (await import('./SessionPaperRecord.jsx')).default;

const DOC = {
  taxonomy: { lessonTitle: 'Illinois' },
  artifacts: [
    { artifactId: 'w1', kind: 'assignment', availability: 'regenerable', originalPdfUrl: '/w1.pdf', thumbnailUrl: '/w1.png' },
    { artifactId: 'r1', kind: 'result-receipt', availability: 'exact', originalUrl: '/r1.png' },
  ],
};

beforeEach(() => { teacherWorkspaceApi.session.mockReset(); });

describe('SessionPaperRecord', () => {
  it('fetches nothing until it is opened', () => {
    render(<SessionPaperRecord sessionId="ses_1" lessonTitle="Illinois" />);
    expect(teacherWorkspaceApi.session).not.toHaveBeenCalled();
  });

  it('fetches once on open and shows both paper records', async () => {
    teacherWorkspaceApi.session.mockResolvedValue({ ok: true, status: 200, data: DOC });
    render(<SessionPaperRecord sessionId="ses_1" lessonTitle="Illinois" />);
    fireEvent.click(screen.getByText('Paper record'));
    await waitFor(() => expect(screen.getByRole('link', { name: 'Open worksheet' })).toBeInTheDocument());
    // One control per destination: the thumbnail and the text link already
    // share a target, so a separate "Download" link pointing at the same URL
    // was pure redundancy (2026-08-25 review). Asserted here because the
    // issued-file card moved off TodayTab into this fold.
    expect(screen.queryByRole('link', { name: /^Download/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Open receipt' })).toBeInTheDocument();
    expect(screen.getByText(/current print layout/i)).toBeInTheDocument();
    expect(teacherWorkspaceApi.session).toHaveBeenCalledTimes(1);
  });

  it('says so plainly when the install has no artifact record', async () => {
    teacherWorkspaceApi.session.mockResolvedValue({ ok: false, status: 404, data: null });
    render(<SessionPaperRecord sessionId="ses_1" lessonTitle="Illinois" />);
    fireEvent.click(screen.getByText('Paper record'));
    await waitFor(() => expect(screen.getByText(/not kept on this install/i)).toBeInTheDocument());
  });
});
