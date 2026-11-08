import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { previewStore } from '../../content-filter/preview/previewStore.js';
import { ReviewList } from './ReviewList.jsx';

const rows = [
  { id: 'cue:w1', peekId: 'w1', kind: 'words', group: 'profanity', label: 'damn', modality: 'said', in: 70.25, out: 70.6, effect: 'mute', card: null, handFixed: false, unsure: ['safe-window'], reviewed: null },
  { id: 'subject:subject-b1', peekId: 'subject-b1', kind: 'picture', group: 'sexual', label: 'Billboard', modality: 'shown', in: 50, out: 58, effect: 'blur', card: null, handFixed: true, unsure: [], reviewed: { by: 'p', at: 'x' } },
  { id: 'scene:sc1', peekId: 'sc1', kind: 'scenes', group: 'violence_blood_gore', label: 'Fight', modality: null, in: 100, out: 160, effect: 'skip-card', card: { text: 'They get away.', approved: true }, handFixed: false, unsure: [], reviewed: null },
];
const show = (props = {}) => render(<MantineProvider><ReviewList rows={rows} reviewed={1} total={3} audit={{ ok: true, fresh: true }} {...props} /></MantineProvider>);
const item = (label) => screen.getByText(label).closest('[data-row-id]');

describe('ReviewList', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  it('renders rows as given (unsure first) with reason, hand-fixed, card and reviewed marks', () => {
    show();
    expect([...document.querySelectorAll('[data-row-id]')].map((n) => n.getAttribute('data-row-id'))).toEqual(['cue:w1', 'subject:subject-b1', 'scene:sc1']);
    expect(within(item('damn')).getByText('Safe window')).toBeTruthy();
    expect(within(item('damn')).getByText('1:10.2–1:10.6')).toBeTruthy();
    expect(within(item('Billboard')).getByText('hand-fixed')).toBeTruthy();
    expect(within(item('Billboard')).getByLabelText('Reviewed')).toBeTruthy();
    expect(within(item('Fight')).getByText(/They get away\./)).toBeTruthy();
    expect(screen.getByText('1 of 3 reviewed')).toBeTruthy();
  });
  it('"Play with effect" jumps to the row; "Play without" peeks the subject', () => {
    const jump = vi.spyOn(previewStore, 'jumpToCue'); const peek = vi.spyOn(previewStore, 'peek');
    show();
    fireEvent.click(within(item('damn')).getByRole('button', { name: 'Play with effect' }));
    expect(jump).toHaveBeenCalledWith({ in: 70.25 });
    fireEvent.click(within(item('Billboard')).getByRole('button', { name: 'Play without' }));
    expect(peek).toHaveBeenCalledWith('subject-b1');
  });
  it('kind and "needs review" filters narrow the rows', () => {
    show();
    fireEvent.click(screen.getByRole('radio', { name: 'Scenes' }));
    expect(screen.queryByText('damn')).toBeNull();
    expect(screen.getByText('Fight')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'All' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Needs review' }));
    expect(screen.queryByText('Billboard')).toBeNull();
    expect(screen.getByText('damn')).toBeTruthy();
    expect(screen.getByText('Fight')).toBeTruthy();
  });
  it('says the audit is running while it is not fresh', () => {
    show({ audit: { ok: true, fresh: false } });
    expect(screen.getByText('Audit running…')).toBeTruthy();
  });
});
