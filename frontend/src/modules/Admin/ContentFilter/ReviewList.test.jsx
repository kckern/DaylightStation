import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ReviewList, rowStatus, timecode } from './ReviewList.jsx';

const rows = [
  { id: 'cue:w1', peekId: 'w1', kind: 'words', group: 'profanity', label: 'damn', modality: 'said', in: 70.25, out: 70.6, effect: 'mute', card: null, handFixed: false, unsure: ['safe-window'], timing: 'safe-window', reviewed: null },
  { id: 'subject:subject-b1', peekId: 'subject-b1', kind: 'picture', group: 'sexual', label: 'Billboard', modality: 'shown', in: 50, out: 58, effect: 'blur', card: null, handFixed: true, unsure: [], timing: 'refined', reviewed: { by: 'p', at: 'x' }, verdict: { verdict: 'approve' } },
  { id: 'scene:sc1', peekId: 'sc1', kind: 'scenes', group: 'violence_blood_gore', label: 'Fight', modality: null, in: 100, out: 160, effect: 'skip-card', card: { text: 'They get away.', approved: true }, handFixed: false, unsure: [], timing: 'refined', reviewed: null },
  { id: 'cue:k1', peekId: 'k1', kind: 'picture', group: 'kissing', label: 'A couple kisses on the porch for a long while as the music swells.', modality: 'shown', in: 400, out: 404, effect: 'off', acts: false, why: 'settings', timing: 'rough', card: null, handFixed: false, unsure: [], reviewed: null },
];
const show = (props = {}) => render(<MantineProvider><ReviewList rows={rows} reviewed={1} total={3} audit={{ ok: true, fresh: true }} {...props} /></MantineProvider>);
const item = (label) => screen.getByText(label).closest('[data-row-id]');
const order = () => [...document.querySelectorAll('[data-row-id]')].map((n) => n.getAttribute('data-row-id'));

describe('ReviewList', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  it('lists the filtered parts in film order (the tabs and the count live in the rail)', () => {
    show();
    expect(order()).toEqual(['subject:subject-b1', 'cue:w1', 'scene:sc1']);
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByText('1 of 3 reviewed')).toBeNull();
  });
  it('"Needs a look first" keeps the audit\'s ranking', () => {
    render(<MantineProvider><ReviewList rows={rows} reviewed={1} total={3} audit={{ ok: true, fresh: true }}
      scope={{ show: 'filtered', kind: 'all', action: 'all', needs: false, group: null, order: 'attention' }} onScope={() => {}} /></MantineProvider>);
    expect(order()).toEqual(['cue:w1', 'subject:subject-b1', 'scene:sc1']);
  });
  it('the Plays tab lists the parts that play and says they need no verdict', () => {
    show({ scope: { stage: 'plays', show: 'plays', kind: 'all', action: 'all', needs: false, group: null, order: 'film' }, onScope: () => {} });
    expect(order()).toEqual(['cue:k1']);
    expect(screen.getByText(/Nothing here needs a verdict/)).toBeTruthy();
    expect(within(item(rows[3].label)).getByText('Plays')).toBeTruthy();
  });
  it('rows keep their whole label (no cut-off), with a glyph for where each stands', () => {
    show({ scope: { show: 'plays', kind: 'all', action: 'all', needs: false, group: null, order: 'film' }, onScope: () => {} });
    expect(screen.getByText(rows[3].label)).toBeTruthy();
    const glyphs = () => [...document.querySelectorAll('.cf-review__glyph')].map((n) => n.getAttribute('data-status'));
    expect(glyphs()).toEqual(['Plays']);
    // Icons are SVG, never text glyphs.
    expect(document.querySelector('.cf-review__glyph svg')).toBeTruthy();
    expect(document.querySelector('.cf-review__glyph').textContent).toBe('');
  });
  it('the part in hand opens to its span, reasons and card; others show a short line', () => {
    show({ selectedId: 'cue:w1' });
    const sel = item('damn');
    expect(within(sel).getByText(/1:10.2–1:10.6/)).toBeTruthy();
    expect(within(sel).getAllByText('Safe window').length).toBeGreaterThan(0);
    expect(within(item('Billboard')).queryByText(/0:50.0–0:58.0/)).toBeNull();
    expect(within(item('Billboard')).getByText('Approved')).toBeTruthy();
    expect(sel.querySelector('.cf-review__glyph').getAttribute('data-status')).toBe('To do');
    expect(within(sel).getByText('To do')).toBeTruthy();
    expect(item('Billboard').querySelector('.cf-review__glyph').getAttribute('data-status')).toBe('Approved');
  });
  it('clicking a row selects it (the page seeks)', () => {
    const onSelect = vi.fn();
    show({ onSelect });
    fireEvent.click(screen.getByRole('button', { name: 'damn' }));
    expect(onSelect).toHaveBeenCalledWith(rows[0]);
  });
  it('a row carries its effect, channel and timing as icons with their words; the icon key explains them', async () => {
    show();
    const names = (label) => [...item(label).querySelectorAll('[role="img"]')].map((n) => n.getAttribute('aria-label'));
    expect(names('damn')).toEqual(['Muted', 'Said', 'Safe window']);
    expect(names('Billboard')).toEqual(['Blurred', 'Shown', 'Refined']);
    expect(item('damn').querySelector('.cf-ico--fx').className).toContain('is-audio');
    expect(item('Billboard').querySelector('.cf-ico--fx').className).toContain('is-picture');
    expect(item('Fight').querySelector('.cf-ico--fx').className).toContain('is-skip');
    fireEvent.click(screen.getByRole('button', { name: 'Icon key' }));
    expect(await screen.findByText('Unsure after refine: check it')).toBeTruthy();
    expect(screen.getByText('Heard (a sound)')).toBeTruthy();
    expect(screen.getByText('Check: refine was unsure')).toBeTruthy();
    expect(screen.getByText('Bleeped (sound)')).toBeTruthy();
  });
  it('a rough part refine already tried is marked apart from one not refined yet', () => {
    show({ rows: [{ ...rows[0], timing: 'rough', unsure: [] }, { ...rows[1], timing: 'rough', unsure: ['refine-coarse-edges'], handFixed: false, verdict: null, reviewed: null }] });
    expect(within(item('damn')).getByRole('img', { name: 'Rough' })).toBeTruthy();
    expect(within(item('Billboard')).getByRole('img', { name: 'Rough after refine' })).toBeTruthy();
  });
  it('every row keeps a word beside its icon; a part refine could not pin reads Check in amber', () => {
    show({ rows: [{ ...rows[0], timing: 'safe-window', unsure: ['refine-giveup', 'safe-window'], verdict: null, reviewed: null }, rows[1], { ...rows[2], verdict: null, reviewed: null }] });
    const word = (label) => item(label).querySelector('.cf-review__status');
    expect(word('damn').textContent).toBe('Check');
    expect(word('damn').className).toContain('is-check');
    expect(word('Billboard').textContent).toBe('Approved');
    expect(['To do', 'Check', 'Approved', 'Let play', 'Redo', 'Plays']).toContain(word('Fight').textContent);
    // A word refine did not find is never shown as a plain safe window.
    expect(within(item('damn')).getByRole('img', { name: 'Word not found' }).className).toContain('is-unsure');
    expect(within(item('damn')).queryByRole('img', { name: 'Safe window' })).toBeNull();
  });
  it('times from an hour on read h:mm:ss.s', () => {
    expect(timecode(3797.04)).toBe('1:03:17.0');
    expect(timecode(70.26)).toBe('1:10.2');
  });
  it('"To do only" is not offered on Plays, where nothing is to do', () => {
    show({ scope: { stage: 'plays', show: 'plays', kind: 'all', action: 'all', needs: false, group: null, order: 'film' }, onScope: () => {} });
    expect(screen.queryByRole('checkbox', { name: 'To do only' })).toBeNull();
  });
  it('"To do only" hides parts with a verdict', () => {
    show();
    fireEvent.click(screen.getByRole('checkbox', { name: 'To do only' }));
    expect(screen.queryByText('Billboard')).toBeNull();
    expect(screen.getByText('damn')).toBeTruthy();
    expect(screen.getByText('Fight')).toBeTruthy();
  });
  it('rows being refined say so instead of their timing chip', () => {
    show({ refining: { 'cue:w1': 'Refining…' }, audit: { ok: true, fresh: false, running: false } });
    expect(within(item('damn')).getByText('Refining…')).toBeTruthy();
    expect(screen.getByText('Check out of date')).toBeTruthy();
  });
  it('says the check is running while it is not fresh', () => {
    show({ audit: { ok: true, fresh: false, running: true } });
    expect(screen.getByText('Checking…')).toBeTruthy();
  });
  it('follows a scope given by the page and reports its own changes', () => {
    const onScope = vi.fn();
    render(<MantineProvider><ReviewList rows={rows} scope={{ stage: 'review', show: 'filtered', kind: 'all', action: 'all', needs: false, group: null, order: 'film' }} onScope={onScope} audit={{ ok: true, fresh: true }} /></MantineProvider>);
    fireEvent.click(screen.getByRole('checkbox', { name: 'To do only' }));
    expect(onScope).toHaveBeenCalledWith(expect.objectContaining({ stage: 'review', needs: true }));
  });
  it('the Refine tab lists the filtered parts on rough timing and the ones in a refine, and says what refine does', () => {
    const rough = [{ ...rows[0], timing: 'rough', unsure: [] }, { ...rows[1], timing: 'rough', unsure: ['refine-coarse-edges'] }, rows[2], rows[3],
      { ...rows[2], id: 'scene:sc2', label: 'Chase', timing: 'rough', members: [] }];
    show({ rows: rough, refining: { 'scene:sc1': 'Refining…' }, scope: { stage: 'refine', show: 'filtered', kind: 'all', action: 'all', needs: true, group: null, order: 'film' }, onScope: () => {} });
    // Rough (tried or not) and the part in a refine; never a part that plays, never a true scene.
    expect(order()).toEqual(['subject:subject-b1', 'cue:w1', 'scene:sc1']);
    expect(screen.getByText(/Verdicts are given on the Review tab/)).toBeTruthy();
    expect(screen.getByText('Rough or unsure timing')).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'To do only' })).toBeNull();
  });
  it('the Refine tab with nothing rough says so', () => {
    show({ scope: { stage: 'refine', show: 'filtered', kind: 'all', action: 'all', needs: false, group: null, order: 'film' }, onScope: () => {} });
    expect(screen.getByText('Nothing is left to refine.')).toBeTruthy();
  });
});

describe('row status words (owner, 2026-11-21: the icons need a word)', () => {
  it('says where each part stands', () => {
    const r = (o) => ({ id: 'cue:a', kind: 'words', effect: 'mute', ...o });
    expect(rowStatus(r({}))).toMatchObject({ glyph: '·', word: 'To do' });
    expect(rowStatus(r({ verdict: { verdict: 'approve' } }))).toMatchObject({ glyph: '✓', word: 'Approved' });
    expect(rowStatus(r({ reviewed: { by: 'p' } }))).toMatchObject({ word: 'Approved' });
    expect(rowStatus(r({ verdict: { verdict: 'redo' } }))).toMatchObject({ glyph: '↻', word: 'Redo' });
    expect(rowStatus(r({ acts: false, effect: 'off', why: 'removed' }))).toMatchObject({ glyph: '×', word: 'Let play' });
    expect(rowStatus(r({ acts: false, effect: 'off', why: 'settings' }))).toMatchObject({ word: 'Plays' });
  });
  it('every row shows its word', () => {
    render(<MantineProvider><ReviewList rows={[{ id: 'cue:w9', peekId: 'w9', kind: 'words', group: 'profanity', label: 'heck', modality: 'said', in: 5, out: 6, effect: 'mute', card: null, handFixed: false, unsure: [], reviewed: null }]} reviewed={0} total={1} /></MantineProvider>);
    expect(screen.getByText('To do')).toBeTruthy();
  });
});

