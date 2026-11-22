import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// The stage rail (owner, 2026-11-22: "a process chevron interlocking rail that also serves as
// tabs"): Refine › Review › Approve say where the film stands from its data, and are the page's tabs.
const calls = [];
const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn(), child: () => log };
let payload;
vi.mock('../../../lib/logging/Logger.js', () => ({ default: () => log }));
vi.mock('../../../lib/hooks/useApiResource.js', () => ({ useApiResource: () => ({ data: payload, loading: false, error: null, reload: () => {}, refresh: async () => {} }), invalidateApiResources: vi.fn() }));
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: async (path, body, method) => { calls.push({ path, body, method }); return {}; } }));
vi.mock('../../../../../__app_modules/media/media/browser/playback.mjs', () => ({ default: () => <div /> }));
const { railStages, defaultStage } = await import('./railStages.js');
const { ReviewRail } = await import('./ReviewRail.jsx');
const { ContentFilterReview } = await import('./ContentFilterAdmin.jsx');
const { previewStore } = await import('../../../../../__app_modules/media/media/browser/content-filter/adminWorkspace.mjs');

const row = (id, label, o = {}) => ({ id, peekId: id.split(':')[1], members: [id.split(':')[1]], kind: 'words', group: 'profanity', label, modality: 'said', in: 10, out: 11, effect: 'mute', card: null, handFixed: false, unsure: [], reviewed: null, verdict: null, timing: 'refined', ...o });
const done = { verdict: { verdict: 'approve' }, reviewed: { by: 'p' } };
const film = (rows, extra = {}) => ({ title: 'F', certification: { level: 'machine' }, audit: { ok: true, fresh: true }, wordRulings: {}, rows, reviewed: 0, total: rows.length,
  job: null, status: { next: 'review' }, signOff: { ready: false, missing: ['2 parts have no verdict', 'The check has not passed'], parent: null }, ...extra });
const stagesOf = (o) => railStages({ data: film([row('cue:a', 'a')]), tally: { done: 0, total: 16 }, ...o }).map((s) => [s.key, s.state, s.text]);
const ui = (path = '/admin/content/filter/77') => <MantineProvider><MemoryRouter initialEntries={[path]}><Routes>
  <Route path="/admin/content/filter/:ratingKey/:rowId?" element={<ContentFilterReview />} /></Routes></MemoryRouter></MantineProvider>;
const tab = (name) => screen.getByRole('tab', { name: new RegExp(`^${name}`) });
const open = () => screen.getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true').getAttribute('data-stage');
const listed = () => [...document.querySelectorAll('.cf-review__list [data-row-id]')].map((n) => n.getAttribute('data-row-id'));

beforeEach(() => { calls.length = 0; vi.clearAllMocks(); });

describe('railStages: each stage says only what the data says', () => {
  it('parts still to refine: Refine is the stage in hand, Review and Approve wait and say why', () => {
    expect(stagesOf({ roughRefine: 16 })).toEqual([
      ['refine', 'current', '16 to refine'],
      ['review', 'waiting', '0 of 16 reviewed · refine first'],
      ['approve', 'waiting', 'Not yet: 2 parts have no verdict'],
    ]);
  });
  it('parts to refine and parts refine could not pin are both counted', () => {
    expect(stagesOf({ roughRefine: 15, roughLeft: 1 })[0]).toEqual(['refine', 'current', '15 to refine · 1 to check']);
  });
  it('a refine in progress shows the run\'s own words', () => {
    const job = { status: 'running', step: 'refine', steps: [{ name: 'refine', progress: { phase: 'measure', done: 10, total: 18 } }] };
    const s = railStages({ data: film([row('cue:a', 'a')], { job }), tally: { done: 0, total: 18 }, roughRefine: 8 });
    expect([s[0].state, s[0].text]).toEqual(['current', 'Refining 10 of 18']);
    expect(defaultStage(s)).toBe('refine');
  });
  it('a run that has stopped moving is stuck, in short on the rail and in full on hover', () => {
    const now = Date.parse('2026-11-22T12:00:00Z');
    const at = new Date(now - 45 * 60000).toISOString();
    const job = { status: 'running', step: 'refine', steps: [{ name: 'refine', startedAt: at, progress: { phase: 'measure', done: 10, total: 18, at } }] };
    const [refine, review] = railStages({ data: film([row('cue:a', 'a')], { job }), tally: { done: 0, total: 18 }, now });
    expect(refine).toMatchObject({ state: 'stuck', text: 'Stuck: no progress for 45 min' });
    expect(refine.title).toMatch(/Refining 10 of 18: no progress for 45 min\. It may be stuck/);
    expect(review.state).toBe('waiting');
    const queued = railStages({ data: film([row('cue:a', 'a')], { job: { status: 'queued' }, worker: { alive: false } }), tally: { done: 0, total: 18 }, now });
    expect(queued[0]).toMatchObject({ state: 'stuck', text: 'Filter worker not running' });
  });
  it('refine done with parts it could not pin: not "Done" but how many to check; Review is in hand', () => {
    expect(stagesOf({ roughLeft: 3 }).slice(0, 2)).toEqual([
      ['refine', 'complete', '3 to check by ear or eye'],
      ['review', 'current', '0 of 16 reviewed'],
    ]);
    const [refine] = railStages({ data: film([row('cue:a', 'a')]), tally: { done: 0, total: 16 }, roughLeft: 3 });
    expect(refine.check).toBe(3);
    expect(railStages({ data: film([row('cue:a', 'a')]), tally: { done: 0, total: 16 } })[0].check).toBeUndefined();
    expect(stagesOf({})[0]).toEqual(['refine', 'complete', 'Done']);
  });
  it('every part reviewed and the sign-off accepted: Approve is Ready; approved, it names who', () => {
    const ready = railStages({ data: film([row('cue:a', 'a', done)], { status: { next: 'approve' }, signOff: { ready: true, missing: [], parent: null } }), tally: { done: 16, total: 16 } });
    expect(ready.map((s) => [s.state, s.text])).toEqual([['complete', 'Done'], ['complete', '16 of 16 reviewed'], ['current', 'Ready']]);
    expect(defaultStage(ready)).toBe('approve');
    const approved = railStages({ data: film([row('cue:a', 'a', done)], { status: { next: 'done' }, signOff: { ready: true, missing: [], parent: { by: 'kc' } } }), tally: { done: 16, total: 16 } });
    expect(approved[2]).toMatchObject({ state: 'complete', text: 'Approved by kc' });
    expect(defaultStage(approved)).toBe('approve');
  });
  it('all reviewed but something else is missing: Approve is not ready, and says the first thing', () => {
    const s = railStages({ data: film([row('cue:a', 'a', done)], { signOff: { ready: false, missing: ['The check has not passed'], parent: null } }), tally: { done: 16, total: 16 } });
    expect(s[2]).toMatchObject({ state: 'waiting', text: 'Not yet: The check has not passed' });
    expect(defaultStage(s)).toBe('review');
  });
  it('a film with no parts yet: nothing claims to be reviewable', () => {
    const s = railStages({ data: film([], { status: { next: 'refine' }, signOff: { ready: false, missing: [], parent: null } }), tally: { done: 0, total: 0 } });
    expect(s.map((x) => [x.state, x.text])).toEqual([['current', 'Not refined yet'], ['waiting', 'Nothing until the film is refined'], ['waiting', 'Not yet']]);
    const checking = railStages({ data: film([], { status: { next: 'checking' } }), tally: { done: 0, total: 0 } });
    expect(checking[1]).toMatchObject({ state: 'waiting', text: 'Checking the result…' });
  });
  it('a film not matched to Plex cannot be refined: Refine waits and Review is in hand', () => {
    const s = railStages({ data: film([row('cue:a', 'a')], { match: 'unmatched' }), tally: { done: 0, total: 1 }, roughRefine: 1 });
    expect(s.slice(0, 2).map((x) => [x.state, x.text])).toEqual([['waiting', '1 to refine · not matched to Plex'], ['current', '0 of 1 reviewed']]);
    expect(defaultStage(s)).toBe('review');
  });
});

describe('ReviewRail: the stages are tabs', () => {
  const stages = railStages({ data: film([row('cue:a', 'a')]), tally: { done: 4, total: 16 }, roughLeft: 3 });
  const show = (props = {}) => render(<MantineProvider><ReviewRail stages={stages} plays={135} value="review" {...props} /></MantineProvider>);
  it('is a tablist of the three stages and Plays, one selected, each with its state', () => {
    show();
    expect(screen.getByRole('tablist', { name: 'Stages' })).toBeTruthy();
    expect(screen.getAllByRole('tab').map((t) => [t.getAttribute('data-stage'), t.getAttribute('aria-selected'), t.getAttribute('data-state')])).toEqual([
      ['refine', 'false', 'complete'], ['review', 'true', 'current'], ['approve', 'false', 'waiting'], ['plays', 'false', null]]);
    // Parts refine could not pin: an amber "!" and a count, never a plain green check.
    expect(within(tab('Refine')).getByText('!')).toBeTruthy();
    expect(tab('Refine').className).toContain('has-check');
    expect(tab('Refine').textContent).toMatch(/3 to check by ear or eye/);
    expect(tab('Review').textContent).toMatch(/4 of 16 reviewed/);
    expect(tab('Plays').textContent).toBe('Plays 135');
    // Only the open tab is in the Tab order (roving focus).
    expect(screen.getAllByRole('tab').map((t) => t.tabIndex)).toEqual([-1, 0, -1, -1]);
  });
  it('a click selects a tab; the open tab does not report again', () => {
    const onChange = vi.fn();
    show({ onChange });
    fireEvent.click(tab('Approve'));
    expect(onChange).toHaveBeenCalledWith('approve', 'click');
    fireEvent.click(tab('Review'));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
  it('arrow keys, Home and End move between the tabs and take focus along', () => {
    const onChange = vi.fn();
    show({ onChange });
    tab('Review').focus();
    fireEvent.keyDown(tab('Review'), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('approve', 'key');
    expect(document.activeElement).toBe(tab('Approve'));
    fireEvent.keyDown(tab('Review'), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('refine', 'key');
    fireEvent.keyDown(tab('Review'), { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('plays', 'key');
    fireEvent.keyDown(tab('Review'), { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith('refine', 'key');
  });
});

describe('the rail on the review page', () => {
  const rows = () => [
    row('cue:a', 'damn', { in: 5, timing: 'rough' }),
    row('cue:t', 'Billboard', { in: 8, kind: 'picture', modality: 'shown', effect: 'blur', timing: 'rough', unsure: ['refine-coarse-edges'] }),
    row('cue:b', 'heck', { in: 20 }),
    row('cue:k', 'stinky', { in: 50, acts: false, why: 'settings', effect: 'off', timing: 'rough' }),
  ];
  it('opens on the first stage still to do: Refine while parts are rough, with Refine all', () => {
    payload = film(rows());
    render(ui());
    expect(open()).toBe('refine');
    expect(tab('Refine').textContent).toMatch(/1 to refine/);
    expect(tab('Review').textContent).toMatch(/0 of 3 reviewed · refine first/);
    // The list is the parts on rough timing (tried or not), never the ones that play.
    expect(listed()).toEqual(['cue:a', 'cue:t']);
    expect(screen.getByRole('button', { name: /^Refine all 1/ })).toBeTruthy();
    expect(log.info).toHaveBeenCalledWith('content_filter.review.stage_tab', expect.objectContaining({ rk: '77', stage: 'refine', via: 'default' }));
    expect(screen.queryByText(/Refine first:/)).toBeNull();
  });
  it('opens on Review when refine has nothing left, and on Approve when every part has a verdict', () => {
    payload = film([row('cue:a', 'damn'), row('cue:b', 'heck', { in: 20 })]);
    const first = render(ui());
    expect(open()).toBe('review');
    expect(listed()).toEqual(['cue:a', 'cue:b']);
    first.unmount();
    payload = film([row('cue:a', 'damn', done)], { status: { next: 'approve' }, signOff: { ready: true, missing: [], parent: null } });
    render(ui());
    expect(open()).toBe('approve');
    expect(screen.getByRole('button', { name: 'Approve for family' })).toBeTruthy();
  });
  it('a permalink opens the tab its part is on', () => {
    payload = film(rows());
    render(ui('/admin/content/filter/77/cue%3Ab'));
    expect(open()).toBe('review');
    expect(document.querySelector('.cf-review__row.is-selected').getAttribute('data-row-id')).toBe('cue:b');
  });
  it('a tab sets the scope: the list, the cursor and the log follow', () => {
    payload = film(rows());
    render(ui());
    fireEvent.click(tab('Review'));
    expect(open()).toBe('review');
    expect(listed()).toEqual(['cue:a', 'cue:t', 'cue:b']);
    expect(screen.queryByRole('button', { name: /^Refine all/ })).toBeNull();
    expect(log.info).toHaveBeenCalledWith('content_filter.review.stage_tab', expect.objectContaining({ rk: '77', stage: 'review', from: 'refine', via: 'click', shown: 3 }));
    fireEvent.click(tab('Plays'));
    expect(listed()).toEqual(['cue:k']);
    // The part in hand was not among the playing parts, so the first of them is in hand now.
    expect(document.querySelector('.cf-review__row.is-selected').getAttribute('data-row-id')).toBe('cue:k');
    expect(log.info).toHaveBeenCalledWith('content_filter.review.stage_tab', expect.objectContaining({ stage: 'plays', from: 'review', shown: 1 }));
  });
  it('Approve shows what is missing in place of the part card, and part keys are off there', () => {
    payload = film(rows());
    render(ui());
    fireEvent.click(tab('Approve'));
    expect(screen.getByText('Not ready to approve yet')).toBeTruthy();
    expect(screen.getByText('2 parts have no verdict')).toBeTruthy();
    expect(screen.getByText('The check has not passed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve for family' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Approve/ })).toBeNull();
    fireEvent.keyDown(document.body, { key: 'a' });
    expect(calls).toHaveLength(0);
    // Picking a part goes back to the parts.
    fireEvent.click(screen.getByRole('button', { name: 'heck' }));
    expect(open()).toBe('review');
    expect(screen.getByRole('button', { name: /^Approve/ })).toBeTruthy();
  });
  it('Approve is not a dead end: Space still plays the film, and one button goes back to the parts without a verdict', () => {
    payload = film(rows());
    const toggle = vi.spyOn(previewStore, 'togglePlay').mockReturnValue('paused');
    render(ui());
    fireEvent.click(tab('Approve'));
    fireEvent.keyDown(document.body, { key: ' ' });
    expect(toggle).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(open()).toBe('approve');
    fireEvent.click(screen.getByRole('button', { name: /^Review the \d+ parts? without a verdict$/ }));
    expect(open()).toBe('review');
    expect(log.info).toHaveBeenCalledWith('content_filter.review.stage_tab', expect.objectContaining({ stage: 'review', from: 'approve', via: 'approve-panel' }));
    toggle.mockRestore();
  });
  it('the Refine tab shows no verdict buttons, and A there says where verdicts are given', async () => {
    payload = film(rows());
    render(ui());
    expect(open()).toBe('refine');
    expect(screen.queryByRole('button', { name: /^Approve/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Redo/ })).toBeNull();
    fireEvent.keyDown(document.body, { key: 'a' });
    expect(await screen.findByText('Verdicts are given on the Review tab.')).toBeTruthy();
    expect(calls).toHaveLength(0);
  });
  it('an approved film names who approved it and offers Withdraw', () => {
    payload = film([row('cue:a', 'damn', done)], { status: { next: 'done' }, signOff: { ready: true, missing: [], parent: { by: 'kc' } } });
    render(ui());
    expect(open()).toBe('approve');
    expect(tab('Approve').textContent).toMatch(/Approved by kc/);
    expect(screen.getByRole('button', { name: 'Withdraw approval' })).toBeTruthy();
  });
  it('with a tab focused the arrow keys move between tabs, not parts; Shift+R still refines', async () => {
    payload = film(rows());
    render(ui());
    tab('Refine').focus();
    fireEvent.keyDown(tab('Refine'), { key: 'ArrowRight' });
    expect(open()).toBe('review');
    expect(document.activeElement).toBe(tab('Review'));
    expect(log.info).toHaveBeenCalledWith('content_filter.review.stage_tab', expect.objectContaining({ stage: 'review', via: 'key' }));
    document.activeElement.blur();
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(open()).toBe('review');
    expect(document.querySelector('.cf-review__row.is-selected').getAttribute('data-row-id')).toBe('cue:t');
    fireEvent.keyDown(document.body, { key: 'R', shiftKey: true });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toEqual({ kind: 'send-back', cues: ['a'] });
  });
});
