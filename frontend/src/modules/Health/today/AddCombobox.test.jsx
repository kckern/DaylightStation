import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => apiMock(...a) }));

import { AddCombobox } from './AddCombobox.jsx';

function r(ui) { return render(<MantineProvider>{ui}</MantineProvider>); }

const SUGGEST = { items: [
  { id: 'a', name: 'Chicken breast', favorite: true, nutrients: { calories: 231 } },
  { id: 'b', name: 'Chicken thigh', favorite: false, nutrients: { calories: 280 } },
] };

describe('AddCombobox', () => {
  beforeEach(() => { apiMock.mockReset(); });

  it('typing fetches suggestions; favorites are marked', async () => {
    apiMock.mockResolvedValue(SUGGEST);
    r(<AddCombobox bucketId="afternoon" onDone={() => {}} onCancel={() => {}} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'chick' } });
    // The combobox now also fetches on MOUNT (Task 9.2), and this mock answers
    // every path with the same payload — so waiting on the rendered row would
    // pass on the mount response alone. Wait for the QUERY request itself.
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(expect.stringContaining('suggest?q=chick')));
    await waitFor(() => expect(screen.getByText('Chicken breast')).toBeTruthy());
    expect(screen.getByText('Chicken breast').closest('.health-suggest__item--fav')).toBeTruthy();
  });

  it('picking a suggestion quick-adds with the bucket IN THE QUICKADD and calls onDone', async () => {
    apiMock.mockImplementation(async (path, body) => {
      if (path.includes('suggest')) return SUGGEST;
      // Real quickadd envelope — uuid lives at item.uuid, never top-level.
      if (path.includes('quickadd')) return { logged: true, item: { uuid: 'row-1' } };
      return {};
    });
    const onDone = vi.fn();
    r(<AddCombobox bucketId="afternoon" onDone={onDone} onCancel={() => {}} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'chick' } });
    await waitFor(() => screen.getByText('Chicken breast'));
    fireEvent.click(screen.getByText('Chicken breast'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const quickaddCall = apiMock.mock.calls.find(([p]) => p.includes('quickadd'));
    expect(quickaddCall[1]).toEqual({ catalogEntryId: 'a', mealTime: 'afternoon' });
  });

  // Task 9.2. The retired PUT was doing two things beyond moving the row, and
  // BOTH were checked against the code before it was deleted: it stamped
  // settled/settledBy (the generic update path ratifies by default) — quickAdd
  // now writes that stamp itself — and it cascaded a group's mealTime to its
  // children, which a `kind:'item'` quick-add with no children never had.
  // Asserting the ABSENCE by counting the quickadd calls would not express it;
  // this asserts no request of any kind touches the nutrilist item endpoint.
  it('makes NO follow-up PUT to the nutrilist row — one request, not two', async () => {
    apiMock.mockImplementation(async (path) => {
      if (path.includes('suggest')) return SUGGEST;
      if (path.includes('quickadd')) return { logged: true, item: { uuid: 'row-1' } };
      return {};
    });
    const onDone = vi.fn();
    r(<AddCombobox bucketId="afternoon" onDone={onDone} onCancel={() => {}} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'chick' } });
    await waitFor(() => screen.getByText('Chicken breast'));
    fireEvent.click(screen.getByText('Chicken breast'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(apiMock.mock.calls.filter(([p]) => p.includes('nutrilist'))).toEqual([]);
    expect(apiMock.mock.calls.filter(([, , method]) => method === 'PUT')).toEqual([]);
  });

  it('free sentence with no pick submits to the NL pipeline and, on commit, just calls onDone (no review phase)', async () => {
    // POST /nutrition/input now commits immediately — { committed: true, ... } —
    // the rows are already logged (unsettled). There is no review card to show;
    // the caller's onDone() triggers the day reload that surfaces them.
    apiMock.mockImplementation(async (path) => {
      if (path.includes('suggest')) return { items: [] };
      if (path.includes('nutrition/input')) return { committed: true, count: 1 };
      return {};
    });
    const onDone = vi.fn();
    r(<AddCombobox bucketId="morning" onDone={onDone} onCancel={() => {}} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '2 eggs and toast' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const inputCall = apiMock.mock.calls.find(([p]) => p.includes('nutrition/input'));
    expect(inputCall[1]).toMatchObject({ type: 'text', content: '2 eggs and toast' });
    // No review card of any kind — no Undo/Accept/Done affordance rendered here.
    expect(screen.queryByRole('button', { name: /undo/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /accept/i })).toBeNull();
  });

  it('a failed sentence submit preserves the typed text and shows the error (input never lost)', async () => {
    apiMock.mockImplementation(async (path) => {
      if (path.includes('suggest')) return { items: [] };
      if (path.includes('nutrition/input')) throw new Error('network down');
      return {};
    });
    const onDone = vi.fn();
    r(<AddCombobox bucketId="morning" onDone={onDone} onCancel={() => {}} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '2 eggs and toast' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText(/network down/)).toBeTruthy());
    expect(input.value).toBe('2 eggs and toast');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('a slow older suggest response cannot overwrite a newer one (stale-response guard)', async () => {
    const older = { items: [{ id: 'x', name: 'OLD RESULT', nutrients: {} }] };
    const newer = { items: [{ id: 'y', name: 'NEW RESULT', nutrients: {} }] };
    let resolveOlder, resolveNewer;
    const olderPromise = new Promise((res) => { resolveOlder = res; });
    const newerPromise = new Promise((res) => { resolveNewer = res; });
    apiMock.mockImplementation((path) => {
      if (path.endsWith('q=c')) return olderPromise;
      if (path.endsWith('q=ch')) return newerPromise;
      return Promise.resolve({ items: [] });
    });

    r(<AddCombobox bucketId="afternoon" onDone={() => {}} onCancel={() => {}} />);
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: 'c' } });
    // Real debounce delay — let the first ('c') request fire and stay in flight.
    await new Promise((res) => setTimeout(res, 300));

    fireEvent.change(input, { target: { value: 'ch' } });
    // Let the second ('ch') request fire and stay in flight too.
    await new Promise((res) => setTimeout(res, 300));

    // Newer resolves first (fast); older resolves later (slow) — the guard must
    // keep the newer results and ignore the stale older response.
    resolveNewer(newer);
    await waitFor(() => expect(screen.getByText('NEW RESULT')).toBeTruthy());

    resolveOlder(older);
    await new Promise((res) => setTimeout(res, 50));

    expect(screen.queryByText('OLD RESULT')).toBeFalsy();
    expect(screen.getByText('NEW RESULT')).toBeTruthy();
  }, 8000);
});

// ── Task 9.2: the list is there before the first keystroke (PRD U8.1/F8.1) ──
describe('AddCombobox — zero-keystroke suggestions', () => {
  beforeEach(() => { apiMock.mockReset(); });

  const OPEN = { items: [
    { id: 'oat', name: 'Oatmeal', favorite: false, icon: 'oatmeal', nutrients: { calories: 150 } },
    { id: 'egg', name: 'Fried Eggs', favorite: false, icon: null, nutrients: { calories: 200 } },
  ] };

  it('asks for THIS bucket\'s regulars on mount, with no text typed', async () => {
    apiMock.mockResolvedValue(OPEN);
    r(<AddCombobox bucketId="morning" onDone={() => {}} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByText('Oatmeal')).toBeTruthy());
    expect(screen.getByText('Fried Eggs')).toBeTruthy();
    const [path] = apiMock.mock.calls[0];
    expect(path).toContain('catalog/suggest?');
    expect(path).toContain('bucket=morning');
    expect(path).not.toContain('q=');
  });

  it('keeps the opening list SHORT — the burst of icon requests it triggers is unprompted', async () => {
    apiMock.mockResolvedValue(OPEN);
    r(<AddCombobox bucketId="morning" onDone={() => {}} onCancel={() => {}} />);
    await waitFor(() => expect(apiMock).toHaveBeenCalled());
    expect(apiMock.mock.calls[0][0]).toContain('limit=8');
  });

  it('draws exactly one icon request per suggestion that HAS an icon, and none for one that does not', async () => {
    apiMock.mockResolvedValue(OPEN);
    const { container } = r(<AddCombobox bucketId="morning" onDone={() => {}} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByText('Oatmeal')).toBeTruthy());
    const imgs = [...container.querySelectorAll('.health-suggest__list img')];
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute('src')).toBe('/api/v1/health/nutrition/icons/oatmeal');
  });

  it('the neutral sentinel is not a picture — it draws no icon and no request', async () => {
    apiMock.mockResolvedValue({ items: [
      { id: 'x', name: 'Something', icon: 'default', nutrients: { calories: 10 } },
    ] });
    const { container } = r(<AddCombobox bucketId="morning" onDone={() => {}} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByText('Something')).toBeTruthy());
    expect(container.querySelectorAll('.health-suggest__list img')).toHaveLength(0);
  });

  it('a broken icon retires that slug — the row keeps its name and kcal, and no image is left behind', async () => {
    apiMock.mockResolvedValue(OPEN);
    const { container } = r(<AddCombobox bucketId="morning" onDone={() => {}} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByText('Oatmeal')).toBeTruthy());
    fireEvent.error(container.querySelector('.health-suggest__icon'));
    await waitFor(() => expect(container.querySelectorAll('.health-suggest__list img')).toHaveLength(0));
    expect(screen.getByText('Oatmeal')).toBeTruthy();
    expect(screen.getByText('150')).toBeTruthy();
  });

  it('typing switches to the query path, and clearing the text goes back to the bucket list', async () => {
    apiMock.mockImplementation(async (path) => (path.includes('q=') ? SUGGEST : OPEN));
    r(<AddCombobox bucketId="morning" onDone={() => {}} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByText('Oatmeal')).toBeTruthy());

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'chick' } });
    await waitFor(() => expect(screen.getByText('Chicken breast')).toBeTruthy());
    expect(screen.queryByText('Oatmeal')).toBeNull();
    expect(apiMock.mock.calls.some(([p]) => p.includes('q=chick') && !p.includes('bucket='))).toBe(true);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
    await waitFor(() => expect(screen.getByText('Oatmeal')).toBeTruthy());
  });

  it('picking straight off the opening list logs it into that bucket with no typing at all', async () => {
    apiMock.mockImplementation(async (path) => {
      if (path.includes('quickadd')) return { logged: true, item: { uuid: 'row-9' } };
      return OPEN;
    });
    const onDone = vi.fn();
    r(<AddCombobox bucketId="morning" onDone={onDone} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByText('Oatmeal')).toBeTruthy());
    fireEvent.click(screen.getByText('Oatmeal'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [path, body, method] = apiMock.mock.calls.find(([p]) => p.includes('quickadd'));
    expect(body).toEqual({ catalogEntryId: 'oat', mealTime: 'morning' });
    expect(method).toBe('POST');
  });

  it('with no bucket (a caller that has none) it still opens, bucket-blind', async () => {
    apiMock.mockResolvedValue(OPEN);
    r(<AddCombobox onDone={() => {}} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByText('Oatmeal')).toBeTruthy());
    expect(apiMock.mock.calls[0][0]).not.toContain('bucket=');
  });
});

describe('AddCombobox — meal-level suggestions (PRD F8.2 / F6.4)', () => {
  const MIXED = { items: [
    { id: 'a', type: 'food', name: 'Chicken breast', favorite: true, nutrients: { calories: 231 } },
    { id: 't1', type: 'template', name: 'Morning smoothie', itemCount: 3, variantCount: 2, nutrients: { calories: 260 } },
    { id: 'b', type: 'food', name: 'Chicken thigh', favorite: false, nutrients: { calories: 280 } },
  ] };

  beforeEach(() => { apiMock.mockReset(); });

  it('renders a template with a NON-COLOUR cue — its item count — beside the kcal', async () => {
    apiMock.mockResolvedValue(MIXED);
    r(<AddCombobox bucketId="morning" onDone={() => {}} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByText('Morning smoothie')).toBeTruthy());
    expect(screen.getByText('3 items')).toBeTruthy();
    expect(screen.getByText('260')).toBeTruthy();
  });

  it('picking a template hands it to the picker instead of quick-adding it', async () => {
    apiMock.mockResolvedValue(MIXED);
    const onTemplate = vi.fn();
    const onDone = vi.fn();
    r(<AddCombobox bucketId="morning" onDone={onDone} onCancel={() => {}} onTemplate={onTemplate} />);
    await waitFor(() => screen.getByText('Morning smoothie'));
    fireEvent.click(screen.getByText('Morning smoothie'));
    await waitFor(() => expect(onTemplate).toHaveBeenCalledWith(expect.objectContaining({ id: 't1', type: 'template' })));
    // A quick-add would log ONE arrangement of the meal with no variant step —
    // the thing PRD F6.1 says instantiating must not do.
    expect(apiMock.mock.calls.some(([p]) => p.includes('quickadd'))).toBe(false);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('picking a FOOD in the same list still quick-adds', async () => {
    apiMock.mockImplementation(async (path) => {
      if (path.includes('suggest')) return MIXED;
      return { logged: true, item: { uuid: 'row-1' } };
    });
    const onTemplate = vi.fn();
    const onDone = vi.fn();
    r(<AddCombobox bucketId="morning" onDone={onDone} onCancel={() => {}} onTemplate={onTemplate} />);
    await waitFor(() => screen.getByText('Chicken thigh'));
    fireEvent.click(screen.getByText('Chicken thigh'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(apiMock.mock.calls.some(([p]) => p.includes('quickadd'))).toBe(true);
    expect(onTemplate).not.toHaveBeenCalled();
  });

  it('the footer affordance opens the one meals surface', async () => {
    apiMock.mockResolvedValue({ items: [] });
    const onMeals = vi.fn();
    r(<AddCombobox bucketId="morning" onDone={() => {}} onCancel={() => {}} onMeals={onMeals} />);
    const button = await screen.findByText(/Meals & templates/);
    fireEvent.click(button);
    expect(onMeals).toHaveBeenCalled();
  });
})
