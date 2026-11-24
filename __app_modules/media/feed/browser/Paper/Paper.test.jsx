import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { notifications } from '@mantine/notifications';
import Paper from './Paper.jsx';
import { deliverOutcome } from './paperModel.js';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: (...args) => apiMock(...args) }));
vi.mock('@mantine/notifications', () => ({ notifications: { show: vi.fn() } }));

const BASE = '/api/v1/newsreporter/office-paper';
const at = (h, m, day = 23) => new Date(2026, 10, day, h, m).toISOString();

const REPORTERS = [
  { id: 'world-cup', kind: 'report', title: 'World Cup', enabled: true },
  { id: 'office-paper', kind: 'edition', title: 'The Daylight Ledger', enabled: true },
];
const SUMMARIES = [
  { date: '2026-11-23', number: 142, status: 'composed', composedAt: at(5, 31), deliveredAt: at(8, 11), printer: 'office', costUsd: 0.041, leadHeadline: 'Senate passes the budget', missing: ['strava'] },
  { date: '2026-11-20', number: 141, status: 'composed', composedAt: at(5, 30, 20), deliveredAt: null, printer: null, costUsd: null, leadHeadline: 'Storm reaches the coast', missing: [] },
];
const DETAILS = {
  '2026-11-23': {
    date: '2026-11-23', number: 142, status: 'composed', composedAt: at(5, 31),
    inputs: { headlines: 214, missing: ['strava'] },
    stories: [
      { ids: ['h1', 'h2'], urls: ['https://www.bbc.com/news/budget', 'https://apnews.com/budget'], titles: ['Senate passes the budget', 'Budget clears the Senate'] },
      { ids: ['h3'], urls: ['https://arstechnica.com/chips'], titles: ['A new chip plant'] },
    ],
    deliveries: [{ at: at(8, 11), printer: 'office', trigger: 'ha' }],
  },
  '2026-11-20': {
    date: '2026-11-20', number: 141, status: 'composed', composedAt: at(5, 30, 20),
    inputs: { headlines: 180, missing: [] },
    stories: [{ ids: ['h9'], urls: ['https://ksl.com/storm'], titles: ['Storm reaches the coast'] }],
    deliveries: [],
  },
};

let routes;
function fakeApi(overrides = {}) {
  routes = {
    'GET /api/v1/newsreporter': () => REPORTERS,
    [`GET ${BASE}/editions?limit=30`]: () => SUMMARIES,
    [`GET ${BASE}/printers`]: () => ['office', 'upstairs'],
    ...overrides,
  };
  apiMock.mockImplementation(async (path, data, method = 'GET') => {
    const key = `${method} ${path}`;
    if (routes[key]) return routes[key](data);
    const detail = path.match(/\/editions\/(\d{4}-\d{2}-\d{2})$/);
    if (method === 'GET' && detail && path.startsWith(BASE)) {
      if (DETAILS[detail[1]]) return DETAILS[detail[1]];
      throw Object.assign(new Error('HTTP 404: Not Found'), { status: 404 });
    }
    throw new Error(`unfaked API call: ${key}`);
  });
}

const posts = () => apiMock.mock.calls.filter(([, , method]) => method === 'POST').map(([path, body]) => ({ path, body }));

function Where() {
  const location = useLocation();
  return <div data-testid="where">{location.pathname}{location.search}</div>;
}

function renderPaper(entry = '/feed/paper') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/feed/paper/:date?" element={<><Paper /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

const button = name => screen.getByRole('button', { name });

describe('Paper newsstand', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 23, 9, 0));
    apiMock.mockReset();
    notifications.show.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  test('says no paper is configured when no enabled edition reporter exists', async () => {
    fakeApi({
      'GET /api/v1/newsreporter': () => [
        REPORTERS[0],
        { id: 'old-paper', kind: 'edition', title: 'Retired', enabled: false },
      ],
    });
    renderPaper();
    expect(await screen.findByText('No paper is configured')).toBeInTheDocument();
    expect(apiMock.mock.calls.map(([path]) => path)).toEqual(['/api/v1/newsreporter']);
  });

  test("shows today's edition as the printed image with status, inputs, stories and back issues", async () => {
    fakeApi();
    renderPaper();

    const image = await screen.findByRole('img', { name: /The Daylight Ledger, No\. 142,/ });
    expect(image.getAttribute('src')).toBe(`${BASE}/editions/2026-11-23/image.png?v=${encodeURIComponent(SUMMARIES[0].composedAt)}`);
    expect(screen.getByRole('status')).toHaveTextContent('Printed 08:11 · office');
    expect(await screen.findByText('214 headlines · 2 stories · missing: strava')).toBeInTheDocument();

    const stories = screen.getByRole('region', { name: 'Stories in this edition' });
    const lead = within(stories).getByRole('link', { name: /Senate passes the budget/ });
    expect(lead).toHaveAttribute('href', 'https://www.bbc.com/news/budget');
    expect(lead).toHaveAttribute('target', '_blank');
    expect(lead).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(within(stories).getByRole('link', { name: /Budget clears the Senate/ })).toHaveAttribute('href', 'https://apnews.com/budget');
    expect(within(stories).getAllByRole('link')).toHaveLength(3);

    const issues = screen.getByRole('navigation', { name: 'Back issues' });
    const todayRow = within(issues).getByRole('link', { name: /No\. 142/ });
    expect(todayRow).toHaveAttribute('aria-current', 'page');
    expect(todayRow).toHaveTextContent('Senate passes the budget');
    expect(todayRow).toHaveTextContent('Printed · $0.04');
    expect(within(issues).getByRole('link', { name: /No\. 141/ })).toHaveTextContent('Not printed · cost unknown');

    expect(button('Print')).toBeEnabled();
    expect(button('Recompose')).toBeEnabled();
  });

  test('says no edition yet when today has none, and offers Compose', async () => {
    fakeApi({ [`GET ${BASE}/editions?limit=30`]: () => SUMMARIES.slice(1) });
    renderPaper();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('No edition yet'));
    expect(button('Compose')).toBeEnabled();
    expect(screen.queryByRole('img')).toBeNull();
    // Today's detail is never requested when the list has no row for it.
    expect(apiMock.mock.calls.some(([path]) => path.endsWith('/editions/2026-11-23'))).toBe(false);
  });

  test('Print delivers with force and reports the outcome in plain words', async () => {
    fakeApi({ [`POST ${BASE}/deliver`]: () => ({ status: 'printed' }) });
    renderPaper();
    await screen.findByRole('img');
    fireEvent.click(button('Print'));
    await waitFor(() => expect(notifications.show).toHaveBeenCalled());
    expect(posts()).toEqual([{ path: `${BASE}/deliver`, body: { force: true } }]);
    expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ title: 'Printed', message: 'The paper printed.' }));
  });

  test('a failed print says the printer did not take the job', async () => {
    fakeApi({ [`POST ${BASE}/deliver`]: () => ({ status: 'print_failed' }) });
    renderPaper();
    await screen.findByRole('img');
    fireEvent.click(button('Print'));
    await waitFor(() => expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({
      color: 'red', title: 'Print failed', message: expect.stringContaining('did not take the job'),
    })));
  });

  test('Print to… delivers to the chosen printer with force', async () => {
    fakeApi({ [`POST ${BASE}/deliver`]: () => ({ status: 'printed' }) });
    renderPaper();
    await screen.findByRole('img');
    await waitFor(() => expect(button('Print to…')).toBeEnabled());
    fireEvent.click(button('Print to…'));
    const select = screen.getByRole('combobox', { name: 'Printer' });
    expect(within(select).getAllByRole('option').map(option => option.textContent)).toEqual(['Choose a printer', 'office', 'upstairs']);
    fireEvent.change(select, { target: { value: 'upstairs' } });
    fireEvent.click(button('Print on upstairs'));
    await waitFor(() => expect(notifications.show).toHaveBeenCalled());
    expect(posts()).toEqual([{ path: `${BASE}/deliver`, body: { printer: 'upstairs', force: true } }]);
    expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: 'The paper printed on upstairs.' }));
  });

  test('Recompose posts compose, shows progress and disables every action until it answers', async () => {
    const composing = Promise.withResolvers();
    fakeApi({ [`POST ${BASE}/compose`]: () => composing.promise });
    renderPaper();
    await screen.findByRole('img');
    fireEvent.click(button('Recompose'));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Recomposing'));
    for (const name of ['Print', 'Print to…', 'Recompose', 'Preview']) expect(button(name)).toBeDisabled();
    expect(posts()).toEqual([{ path: `${BASE}/compose`, body: {} }]);

    const readsBefore = apiMock.mock.calls.length;
    await act(async () => composing.resolve({ status: 'composed', number: 142 }));
    await waitFor(() => expect(button('Recompose')).toBeEnabled());
    expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ title: 'Recomposed', message: expect.stringContaining('No. 142') }));
    // The list and the edition are read again so the new image shows.
    await waitFor(() => expect(apiMock.mock.calls.length).toBeGreaterThan(readsBefore));
  });

  test('Preview shows the dry-run image in place; Keep composes for real', async () => {
    fakeApi({
      [`POST ${BASE}/compose`]: body => (body.dryRun ? { layout: {}, png: 'iVBORw0KGgo=' } : { status: 'composed', number: 142 }),
    });
    renderPaper();
    await screen.findByRole('img', { name: /No\. 142/ });
    fireEvent.click(button('Preview'));

    const preview = await screen.findByRole('img', { name: /^Preview of The Daylight Ledger/ });
    expect(preview).toHaveAttribute('src', 'data:image/png;base64,iVBORw0KGgo=');
    expect(screen.queryByRole('button', { name: 'Print' })).toBeNull();
    fireEvent.click(button('Keep'));

    await waitFor(() => expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ title: 'Edition kept' })));
    expect(posts()).toEqual([
      { path: `${BASE}/compose`, body: { dryRun: true } },
      { path: `${BASE}/compose`, body: {} },
    ]);
    expect(await screen.findByRole('img', { name: /No\. 142/ })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /^Preview of/ })).toBeNull();
  });

  test('Discard drops the preview without composing', async () => {
    fakeApi({ [`POST ${BASE}/compose`]: () => ({ layout: {}, png: 'data:image/png;base64,AAAA' }) });
    renderPaper();
    await screen.findByRole('img', { name: /No\. 142/ });
    fireEvent.click(button('Preview'));
    expect(await screen.findByRole('img', { name: /^Preview of/ })).toHaveAttribute('src', 'data:image/png;base64,AAAA');
    fireEvent.click(button('Discard'));

    expect(screen.getByRole('img', { name: /No\. 142/ })).toBeInTheDocument();
    expect(button('Print')).toBeEnabled();
    expect(posts()).toEqual([{ path: `${BASE}/compose`, body: { dryRun: true } }]);
  });

  test('a back issue has its own URL, loads into the main panel and offers Reprint for that date', async () => {
    fakeApi({ [`POST ${BASE}/deliver`]: () => ({ status: 'printed' }) });
    renderPaper();
    await screen.findByRole('img', { name: /No\. 142/ });

    fireEvent.click(within(screen.getByRole('navigation', { name: 'Back issues' })).getByRole('link', { name: /No\. 141/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/feed/paper/2026-11-20');

    const image = await screen.findByRole('img', { name: /No\. 141/ });
    expect(image.getAttribute('src')).toContain(`${BASE}/editions/2026-11-20/image.png`);
    expect(screen.getByRole('status')).toHaveTextContent('Composed 05:30 · not printed');
    expect(screen.queryByRole('button', { name: 'Print' })).toBeNull();
    fireEvent.click(button('Reprint'));
    await waitFor(() => expect(posts()).toEqual([{ path: `${BASE}/deliver`, body: { date: '2026-11-20', force: true } }]));

    fireEvent.click(screen.getByRole('link', { name: 'Back to today' }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/feed\/paper$/);
  });

  test('a back-issue URL opened directly reads that edition, even outside the list', async () => {
    fakeApi({ [`GET ${BASE}/editions?limit=30`]: () => SUMMARIES.slice(0, 1) });
    renderPaper('/feed/paper/2026-11-20');
    expect(await screen.findByRole('img', { name: /No\. 141/ })).toBeInTheDocument();
    expect(screen.getByText('180 headlines · 1 story')).toBeInTheDocument();
    expect(button('Reprint')).toBeEnabled();
  });

  test('a back-issue URL with no edition says so', async () => {
    fakeApi();
    renderPaper('/feed/paper/2026-10-01');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('No edition for this date'));
    expect(screen.queryByRole('img')).toBeNull();
  });

  test('offers a picker when several papers are configured', async () => {
    fakeApi({
      'GET /api/v1/newsreporter': () => [...REPORTERS, { id: 'kids-paper', kind: 'edition', title: 'The Kid Gazette', enabled: true }],
      'GET /api/v1/newsreporter/kids-paper/editions?limit=30': () => [],
      'GET /api/v1/newsreporter/kids-paper/printers': () => ['office'],
    });
    renderPaper();
    await screen.findByRole('img', { name: /Daylight Ledger/ });
    const picker = screen.getByRole('combobox', { name: 'Paper' });
    fireEvent.change(picker, { target: { value: 'kids-paper' } });
    expect(screen.getByTestId('where')).toHaveTextContent('/feed/paper?paper=kids-paper');
    expect(await screen.findByRole('heading', { name: 'The Kid Gazette' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('No edition yet'));
  });
});

describe('deliverOutcome', () => {
  test.each([
    ['printed', 'Printed', 'The paper printed on office.'],
    ['already_delivered', 'Already printed', 'This edition already printed today, so nothing printed.'],
    ['expired', 'Too late to print', 'This edition is past its print window, so nothing printed.'],
    ['composed_then_printed', 'Composed and printed', 'There was no edition yet, so one was written and printed on office.'],
    ['print_failed', 'Print failed', 'The printer did not take the job on office. The edition stays unprinted; try again.'],
  ])('%s reads as plain words', (status, title, message) => {
    expect(deliverOutcome(status, 'office')).toMatchObject({ title, message });
  });
});
