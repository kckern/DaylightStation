import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ReviewTimeline } from './ReviewTimeline.jsx';
import { previewStore } from '../../../../../__app_modules/media/media/browser/content-filter/adminWorkspace.mjs';

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

  // Owner, 2026-11-22: "anything on a timeline, you click it, it should go there".
  describe('a click anywhere on a lane goes there', () => {
    const BOX = { left: 0, top: 0, width: 960, height: 24, right: 960, bottom: 24, x: 0, y: 0, toJSON: () => ({}) };
    it('a click on empty track seeks the film to that time and keeps the part in hand', () => {
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(BOX);
      const seek = vi.spyOn(previewStore, 'seekTo').mockImplementation(() => {});
      const onSelect = vi.fn(); show({ onSelect });
      // The film lane spans 0–960 s over 960 px: x = 300 is 300 s, far from every mark.
      fireEvent.click(document.querySelector('[data-lane="film"] .cf-timeline__track'), { clientX: 300 });
      expect(seek).toHaveBeenCalledWith(300);
      expect(onSelect).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    });
    it('a click within 6 px of a mark takes that part', () => {
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(BOX);
      vi.spyOn(previewStore, 'seekTo').mockImplementation(() => {});
      const onSelect = vi.fn(); show({ onSelect });
      fireEvent.click(document.querySelector('[data-lane="film"] .cf-timeline__track'), { clientX: 504 });
      expect(onSelect).toHaveBeenCalledWith(rows[1]);
      vi.restoreAllMocks();
    });
    it('the window lane is named Near, its range in a tooltip, so its label never changes width', () => {
      show({ selectedId: 'cue:b' });
      const label = document.querySelector('[data-lane="window"] .cf-timeline__label');
      expect(label.textContent).toBe('Near');
      expect(label.getAttribute('title')).toMatch(/–/);
    });
    it('both lanes draw the playhead', () => {
      vi.spyOn(previewStore, 'currentTime').mockReturnValue(505);
      show({ selectedId: 'cue:b' });
      expect(document.querySelectorAll('.cf-timeline__playhead')).toHaveLength(2);
      vi.restoreAllMocks();
    });
  });
});


describe('the part menu on the timeline', () => {
  it('right-click a mark opens the part menu', () => {
    const onPartMenu = vi.fn(); const onSelect = vi.fn();
    show({ onPartMenu, onSelect });
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 40 });
    mark('film', 'subject:c').dispatchEvent(ev);
    expect(onPartMenu).toHaveBeenCalledWith(rows[2], { x: 120, y: 40 });
    expect(ev.defaultPrevented).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
