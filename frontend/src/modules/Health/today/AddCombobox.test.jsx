import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => apiMock(...a) }));

import { AddCombobox } from './AddCombobox.jsx';
import { resetApiResourceCache, primeApiResource } from '../../../lib/hooks/useApiResource.js';
import { shortlistPath } from '../healthResources.js';
import { noteVisibleRows, resetAddFlow } from './addFlow.js';

// The shortlist is cached module-wide; no case may inherit another's.
beforeEach(() => resetApiResourceCache());

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
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'chick' } });
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
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'chick' } });
    await waitFor(() => screen.getByText('Chicken breast'));
    fireEvent.click(screen.getByText('Chicken breast'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const quickaddCall = apiMock.mock.calls.find(([p]) => p.includes('quickadd'));
    expect(quickaddCall[1]).toEqual({ catalogEntryId: 'a', mealTime: 'afternoon', operationId: expect.any(String) });
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
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'chick' } });
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
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: '2 eggs and toast' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const inputCall = apiMock.mock.calls.find(([p]) => p.includes('nutrition/input'));
    expect(inputCall[1]).toMatchObject({ type: 'text', content: '2 eggs and toast', operationId: expect.any(String) });
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
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: '2 eggs and toast' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText(/network down/)).toBeTruthy());
    expect(input.value).toBe('2 eggs and toast');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('a sentence holds a pending "Adding" row until its parsed rows are on the day', async () => {
    resetAddFlow();
    apiMock.mockImplementation(async (path) => {
      if (path.includes('suggest')) return { items: [] };
      if (path.includes('nutrition/input')) return { committed: true, entryIds: ['n1', 'n2'] };
      return {};
    });
    const release = vi.fn();
    const onSentencePending = vi.fn(() => release);
    const onDone = vi.fn();
    r(<AddCombobox bucketId="morning" onDone={onDone} onCancel={() => {}} onSentencePending={onSentencePending} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: ' 2 eggs and toast ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSentencePending).toHaveBeenCalledWith('2 eggs and toast');
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(release).not.toHaveBeenCalled();
    act(() => noteVisibleRows([{ uuid: 'n1' }, { uuid: 'n2' }]));
    await waitFor(() => expect(release).toHaveBeenCalledTimes(1));
  });

  it('a failed sentence releases its pending row at once', async () => {
    apiMock.mockImplementation(async (path) => {
      if (path.includes('suggest')) return { items: [] };
      if (path.includes('nutrition/input')) throw new Error('network down');
      return {};
    });
    const release = vi.fn();
    r(<AddCombobox bucketId="morning" onDone={() => {}} onCancel={() => {}} onSentencePending={() => release} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'soup' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText(/network down/)).toBeTruthy());
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('a slow older suggest response cannot overwrite a newer one (stale-response guard)', async () => {
    const older = { items: [{ id: 'x', name: 'OLD RESULT', nutrients: {} }] };
    const newer = { items: [{ id: 'y', name: 'NEW RESULT', nutrients: {} }] };
    let resolveOlder, resolveNewer;
    const olderPromise = new Promise((res) => { resolveOlder = res; });
    const newerPromise = new Promise((res) => { resolveNewer = res; });
    apiMock.mockImplementation((path) => {
      if (new URL(path, 'http://fixture').searchParams.get('q') === 'c') return olderPromise;
      if (new URL(path, 'http://fixture').searchParams.get('q') === 'ch') return newerPromise;
      return Promise.resolve({ items: [] });
    });

    r(<AddCombobox bucketId="afternoon" onDone={() => {}} onCancel={() => {}} />);
    const input = screen.getByRole('combobox');

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

  it('asks for a bounded opening list (16 compact rows, prefetched with the day)', async () => {
    apiMock.mockResolvedValue(OPEN);
    r(<AddCombobox bucketId="morning" onDone={() => {}} onCancel={() => {}} />);
    await waitFor(() => expect(apiMock).toHaveBeenCalled());
    expect(apiMock.mock.calls[0][0]).toContain('limit=16');
  });

  it('draws exactly one icon request per suggestion that HAS an icon, and none for one that does not', async () => {
    apiMock.mockResolvedValue(OPEN);
    const { container } = r(<AddCombobox bucketId="morning" onDone={() => {}} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByText('Oatmeal')).toBeTruthy());
    const imgs = [...container.querySelectorAll('.health-suggest__list img')];
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute('src')).toBe('/api/v1/health/nutrition/icons/oatmeal');
    expect(container.querySelectorAll('.health-suggest__icon svg')).toHaveLength(2);
  });

  it('the neutral sentinel is not a picture — it draws no icon and no request', async () => {
    apiMock.mockResolvedValue({ items: [
      { id: 'x', name: 'Something', icon: 'default', nutrients: { calories: 10 } },
    ] });
    const { container } = r(<AddCombobox bucketId="morning" onDone={() => {}} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByText('Something')).toBeTruthy());
    expect(container.querySelectorAll('.health-suggest__list img')).toHaveLength(0);
    expect(container.querySelector('.health-suggest__icon svg')).toBeTruthy();
  });

  it('a broken icon retires that slug — the row keeps its name and kcal, and no image is left behind', async () => {
    apiMock.mockResolvedValue(OPEN);
    const { container } = r(<AddCombobox bucketId="morning" onDone={() => {}} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByText('Oatmeal')).toBeTruthy());
    fireEvent.error(container.querySelector('.health-suggest__icon img'));
    await waitFor(() => expect(container.querySelectorAll('.health-suggest__list img')).toHaveLength(0));
    expect(screen.getByText('Oatmeal')).toBeTruthy();
    expect(screen.getByText('150 kcal')).toBeTruthy();
  });

  it('typing switches to the query path, and clearing the text goes back to the bucket list', async () => {
    apiMock.mockImplementation(async (path) => (path.includes('q=') ? SUGGEST : OPEN));
    r(<AddCombobox bucketId="morning" onDone={() => {}} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByText('Oatmeal')).toBeTruthy());

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'chick' } });
    await waitFor(() => expect(screen.getByText('Chicken breast')).toBeTruthy());
    expect(screen.queryByText('Oatmeal')).toBeNull();
    expect(apiMock.mock.calls.some(([p]) => p.includes('q=chick') && p.includes('bucket=morning'))).toBe(true);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
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
    expect(body).toEqual({ catalogEntryId: 'oat', mealTime: 'morning', operationId: expect.any(String) });
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
    expect(screen.getByText('260 kcal')).toBeTruthy();
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

describe('AddCombobox inline', () => {
  beforeEach(() => { apiMock.mockReset(); });
  const inline = (props = {}) => r(<AddCombobox inline bucketId="evening" label="Dinner" date="2026-09-21"
    onDone={() => {}} {...props} />);

  it('is labelled for its meal and fetches nothing until focused', async () => {
    apiMock.mockResolvedValue(SUGGEST);
    inline();
    const input = screen.getByRole('combobox', { name: 'Add to Dinner' });
    expect(input.getAttribute('placeholder')).toBe('Add to Dinner…');
    expect(apiMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.focus(input);
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(expect.stringContaining('bucket=evening&limit=16')));
    expect(await screen.findByText('Chicken breast')).toBeTruthy();
  });

  it('a prefetched shortlist paints the moment the row is focused', async () => {
    primeApiResource(shortlistPath('evening'), SUGGEST);
    apiMock.mockReturnValue(new Promise(() => {})); // the refresh never lands
    inline();
    fireEvent.focus(screen.getByRole('combobox', { name: 'Add to Dinner' }));
    expect(screen.getByText('Chicken breast')).toBeTruthy();
    expect(apiMock).toHaveBeenCalledWith(shortlistPath('evening'));
  });

  it('Enter on free text parses into this meal and day, then clears and stays focused', async () => {
    let commit;
    apiMock.mockImplementation((path) => path.includes('suggest') ? Promise.resolve({ items: [] })
      : new Promise(res => { commit = res; }));
    const onDone = vi.fn();
    inline({ onDone });
    const input = screen.getByRole('combobox', { name: 'Add to Dinner' });
    input.focus();
    fireEvent.change(input, { target: { value: 'two eggs' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // While parsing the field is read-only, never disabled: disabling a
    // focused input blurs it, which closes a phone keyboard between adds.
    await waitFor(() => expect(input.getAttribute('aria-busy')).toBe('true'));
    expect(input.disabled).toBe(false);
    expect(input.readOnly).toBe(true);
    expect(document.activeElement).toBe(input);
    commit({ committed: true });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(document.activeElement).toBe(input);
    expect(input.readOnly).toBe(false);
    expect(apiMock).toHaveBeenCalledWith('api/v1/health/nutrition/input',
      expect.objectContaining({ type: 'text', content: 'two eggs', bucket: 'evening', date: '2026-09-21' }), 'POST');
    expect(input.value).toBe('');
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it('logging the same food twice sends two distinct operation ids', async () => {
    const ids = [];
    apiMock.mockImplementation(async (path, body) => {
      if (path.includes('suggest')) return SUGGEST;
      ids.push(body.operationId); return { logged: true, item: { uuid: `r${ids.length}` } };
    });
    inline();
    const input = screen.getByRole('combobox', { name: 'Add to Dinner' });
    fireEvent.focus(input);
    fireEvent.click(await screen.findByText('Chicken breast'));
    await waitFor(() => expect(ids).toHaveLength(1));
    fireEvent.focus(input);
    fireEvent.click(await screen.findByText('Chicken breast'));
    await waitFor(() => expect(ids).toHaveLength(2));
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('Escape clears the text first, then blurs', () => {
    apiMock.mockResolvedValue({ items: [] });
    inline();
    const input = screen.getByRole('combobox', { name: 'Add to Dinner' });
    input.focus();
    fireEvent.change(input, { target: { value: 'oat' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(document.activeElement).not.toBe(input);
  });

  it('a failed parse keeps the text, shows the error and keeps focus; Escape clears both', async () => {
    apiMock.mockImplementation(async (path) => { if (path.includes('suggest')) return { items: [] }; throw new Error('Parser down'); });
    inline();
    const input = screen.getByRole('combobox', { name: 'Add to Dinner' });
    input.focus();
    fireEvent.change(input, { target: { value: 'soup' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText('Parser down')).toBeTruthy();
    expect(input.value).toBe('soup');
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('');
    expect(screen.queryByText('Parser down')).toBeNull();
  });

  // A browser moves focus on mousedown unless it is prevented. fireEvent
  // returns false when a handler called preventDefault, so this presses the
  // way a real pointer does: focus follows only if nothing stopped it.
  const press = (el) => { if (fireEvent.mouseDown(el)) el.focus(); fireEvent.mouseUp(el); fireEvent.click(el); };

  it('"Manage saved foods" on an empty focused row can be pressed', async () => {
    apiMock.mockResolvedValue({ items: [] });
    const onManageFoods = vi.fn();
    inline({ onManageFoods });
    const input = screen.getByRole('combobox', { name: 'Add to Dinner' });
    expect(screen.queryByText(/Manage saved foods/)).toBeNull();
    input.focus();
    press(await screen.findByText(/Manage saved foods/));
    expect(onManageFoods).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(input);
  });

  it('Tab from the input onto "Manage saved foods" keeps the link mounted', async () => {
    apiMock.mockResolvedValue({ items: [] });
    const onManageFoods = vi.fn();
    inline({ onManageFoods });
    const input = screen.getByRole('combobox', { name: 'Add to Dinner' });
    input.focus();
    const link = (await screen.findByText(/Manage saved foods/)).closest('button');
    act(() => link.focus()); // what Tab does: focus moves with relatedTarget = the link
    expect(document.activeElement).toBe(link);
    expect(link.isConnected).toBe(true);
    fireEvent.click(link);
    expect(onManageFoods).toHaveBeenCalledTimes(1);
  });

  it('leaving the row closes its list but keeps the text; returning reopens it', async () => {
    apiMock.mockResolvedValue(SUGGEST);
    inline();
    const input = screen.getByRole('combobox', { name: 'Add to Dinner' });
    input.focus();
    fireEvent.change(input, { target: { value: 'chick' } });
    await screen.findByRole('listbox');
    expect(input.getAttribute('aria-controls')).toBeTruthy();
    act(() => input.blur());
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(input.getAttribute('aria-controls')).toBeNull();
    expect(input.value).toBe('chick');
    input.focus();
    expect(await screen.findByRole('listbox')).toBeTruthy();
  });

  it('an empty row forgets its highlight on blur; refocus repaints the cached shortlist, not stale search results', async () => {
    apiMock.mockImplementation(async path => path.includes('q=') ? { items: [{ id: 'z', name: 'Zucchini', nutrients: { calories: 20 } }] } : SUGGEST);
    inline();
    const input = screen.getByRole('combobox', { name: 'Add to Dinner' });
    input.focus();
    await screen.findByText('Chicken breast');
    fireEvent.change(input, { target: { value: 'zu' } });
    await screen.findByText('Zucchini');
    fireEvent.change(input, { target: { value: '' } });
    await screen.findByText('Chicken breast');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBeTruthy();
    act(() => input.blur());
    apiMock.mockImplementation(() => new Promise(() => {}));
    act(() => input.focus());
    // Reopened: the shortlist paints at once from cache, no highlight, no search leftovers.
    expect(screen.getByText('Chicken breast')).toBeTruthy();
    expect(screen.queryByText('Zucchini')).toBeNull();
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
  });

  it('a focusRequest change focuses the input', () => {
    apiMock.mockResolvedValue({ items: [] });
    const { rerender } = inline({ focusRequest: 0 });
    rerender(<MantineProvider><AddCombobox inline bucketId="evening" label="Dinner" onDone={() => {}} focusRequest={1} /></MantineProvider>);
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Add to Dinner' }));
  });
});
