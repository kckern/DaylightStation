import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ReviewTimeline } from './ReviewTimeline.jsx';

const rows = [
  { id: 'cue:a', kind: 'words', label: 'damn', effect: 'mute', in: 10, out: 10.5, verdict: null, reviewed: null },
  { id: 'cue:b', kind: 'words', label: 'hell', effect: 'bleep', in: 500, out: 500.5, verdict: { verdict: 'redo' }, reviewed: { by: 'x' } },
  { id: 'subject:c', kind: 'picture', label: 'Billboard', effect: 'blur', in: 520, out: 530, verdict: null, reviewed: null },
  { id: 'scene:d', kind: 'scenes', label: 'Fight', effect: 'skip-card', in: 900, out: 960, verdict: null, reviewed: null },
];
const show = (props = {}) => render(<MantineProvider><ReviewTimeline rows={rows} selectedId={null} onSelect={() => {}} {...props} /></MantineProvider>);
const marks = (lane) => [...document.querySelectorAll(`[data-lane="${lane}"] [data-mark]`)].map((n) => n.getAttribute('data-mark'));
const mark = (lane, id) => document.querySelector(`[data-lane="${lane}"] [data-mark="${id}"]`);

describe('ReviewTimeline', () => {
  it('draws every row in scope on the full-film lane, colored by action', () => {
    show();
    expect(marks('film')).toEqual(['cue:a', 'cue:b', 'subject:c', 'scene:d']);
    expect(mark('film', 'cue:a').className).toContain('is-mute');
    expect(mark('film', 'cue:b').className).toContain('is-bleep');
    expect(mark('film', 'subject:c').className).toContain('is-blur');
    expect(mark('film', 'scene:d').className).toContain('is-skip');
  });
  it('highlights the cursor and flags redo marks', () => {
    show({ selectedId: 'cue:b' });
    expect(mark('film', 'cue:b').className).toContain('is-cursor');
    expect(mark('film', 'cue:b').className).toContain('is-redo');
    expect(mark('film', 'cue:a').className).not.toContain('is-cursor');
  });
  it('the window lane shows only rows near the cursor', () => {
    show({ selectedId: 'cue:b' });
    expect(marks('window')).toEqual(['cue:b', 'subject:c']);
  });
  it('clicking a mark moves the cursor to that row', () => {
    const onSelect = vi.fn(); show({ onSelect });
    fireEvent.click(mark('film', 'scene:d'));
    expect(onSelect).toHaveBeenCalledWith(rows[3]);
  });
  it('draws only the rows it is given (scope narrows it)', () => {
    show({ rows: rows.filter((r) => r.kind === 'words') });
    expect(marks('film')).toEqual(['cue:a', 'cue:b']);
  });
  it('says so when scope is empty', () => {
    show({ rows: [] }); expect(screen.getByText(/Nothing in this view/)).toBeTruthy();
  });
});
