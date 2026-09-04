import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => apiMock(...a) }));

import { DismissStackProvider } from '@/lib/ui';
import { TemplatePicker } from './TemplatePicker.jsx';

function r(ui) {
  return render(<MantineProvider><DismissStackProvider>{ui}</DismissStackProvider></MantineProvider>);
}

const component = (name, calories, role = 'core') => ({ name, role, calories, protein: 0, carbs: 0, fat: 0 });

const SMOOTHIE = {
  id: 't1', name: 'Morning smoothie', icon: null, status: 'active', source: 'manual', useCount: 4,
  components: [
    component('Chia seeds', 60), component('Protein drink', 160), component('Greens powder', 40),
    component('Blueberries', 80, 'variant'), component('Mango', 100, 'variant'),
  ],
};
const FLAT = {
  id: 't2', name: 'Protein breakfast', icon: null, status: 'active', source: 'manual',
  components: [component('Eggs', 140), component('Toast', 180)],
};
const PROPOSAL = {
  id: 'p1', name: 'Morning oatmeal', status: 'proposed', source: 'curated', occurrences: 9,
  proposalKey: 'chia|oats', components: [component('Oats', 150), component('Coffee', 5)],
};

const respondWith = (templates) => {
  apiMock.mockImplementation(async (path) => (
    path.includes('nutrition/templates?') ? { templates } : { ok: true }
  ));
};

beforeEach(() => {
  apiMock.mockReset();
  respondWith([SMOOTHIE, FLAT]);
});

describe('TemplatePicker', () => {
  it('lists templates with their CORE item count and core kcal', async () => {
    r(<TemplatePicker open onClose={() => {}} onLogged={() => {}} bucketId="morning" />);
    await waitFor(() => expect(screen.getByText('Morning smoothie')).toBeTruthy());
    // 3 core items, 60 + 160 + 40 — the variants are offers, not logged food.
    expect(screen.getByText('3 items · 260 kcal')).toBeTruthy();
  });

  it('asks for proposals in the same request, and shows them above the templates', async () => {
    respondWith([PROPOSAL, SMOOTHIE]);
    r(<TemplatePicker open onClose={() => {}} onLogged={() => {}} bucketId="morning" />);
    await waitFor(() => expect(screen.getByText('Morning oatmeal')).toBeTruthy());
    expect(apiMock.mock.calls[0][0]).toContain('includeProposed=1');
    expect(screen.getByText('Suggested')).toBeTruthy();
    expect(screen.getByText('2 items · logged 9×')).toBeTruthy();
  });

  it('Keep approves a proposal and No thanks dismisses it', async () => {
    respondWith([PROPOSAL]);
    r(<TemplatePicker open onClose={() => {}} onLogged={() => {}} bucketId="morning" />);
    await waitFor(() => screen.getByText('Keep'));
    fireEvent.click(screen.getByText('Keep'));
    await waitFor(() => expect(apiMock.mock.calls.some(([p]) => p.endsWith('/p1/approve'))).toBe(true));
    fireEvent.click(screen.getByText('No thanks'));
    await waitFor(() => expect(apiMock.mock.calls.some(([p]) => p.endsWith('/p1/dismiss'))).toBe(true));
  });

  it('a template with variants opens the toggles; the core count is stated and cores are never listed as choices', async () => {
    r(<TemplatePicker open onClose={() => {}} onLogged={() => {}} bucketId="morning" />);
    await waitFor(() => screen.getByText('Morning smoothie'));
    fireEvent.click(screen.getByText('Morning smoothie'));
    await waitFor(() => expect(screen.getByText(/3 always included/)).toBeTruthy());
    const toggles = screen.getAllByRole('switch');
    expect(toggles.map((t) => t.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('Blueberries'), expect.stringContaining('Mango')]),
    );
    expect(toggles).toHaveLength(2);
    expect(screen.queryByRole('switch', { name: /Chia/ })).toBeNull();
    // Nothing is logged by opening it.
    expect(apiMock.mock.calls.some(([p]) => p.includes('/instantiate'))).toBe(false);
  });

  it('toggling a variant adds its calories to the Log button and sends it with the request', async () => {
    const onLogged = vi.fn();
    r(<TemplatePicker open onClose={() => {}} onLogged={onLogged} bucketId="morning" />);
    await waitFor(() => screen.getByText('Morning smoothie'));
    fireEvent.click(screen.getByText('Morning smoothie'));
    await waitFor(() => screen.getByText('Log 260 kcal'));

    const mango = screen.getAllByRole('switch').find((t) => t.textContent.includes('Mango'));
    expect(mango.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(mango);
    await waitFor(() => expect(screen.getByText('Log 360 kcal')).toBeTruthy());
    expect(screen.getAllByRole('switch').find((t) => t.textContent.includes('Mango')).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByText('Log 360 kcal'));
    await waitFor(() => expect(onLogged).toHaveBeenCalled());
    const call = apiMock.mock.calls.find(([p]) => p.includes('/t1/instantiate'));
    expect(call[1]).toEqual({ mealTime: 'morning', variantNames: ['Mango'] });
    expect(call[2]).toBe('POST');
  });

  it('un-toggling a variant takes it back off the request', async () => {
    r(<TemplatePicker open onClose={() => {}} onLogged={() => {}} bucketId="evening" />);
    await waitFor(() => screen.getByText('Morning smoothie'));
    fireEvent.click(screen.getByText('Morning smoothie'));
    const mango = () => screen.getAllByRole('switch').find((t) => t.textContent.includes('Mango'));
    await waitFor(() => mango());
    fireEvent.click(mango());
    fireEvent.click(mango());
    fireEvent.click(screen.getByText('Log 260 kcal'));
    await waitFor(() => expect(apiMock.mock.calls.some(([p]) => p.includes('/instantiate'))).toBe(true));
    const call = apiMock.mock.calls.find(([p]) => p.includes('/instantiate'));
    expect(call[1]).toEqual({ mealTime: 'evening', variantNames: [] });
  });

  it('surfaces a failed log instead of closing over it', async () => {
    const onLogged = vi.fn();
    apiMock.mockImplementation(async (path) => {
      if (path.includes('nutrition/templates?')) return { templates: [FLAT] };
      throw new Error('nope');
    });
    r(<TemplatePicker open onClose={() => {}} onLogged={onLogged} bucketId="morning" />);
    await waitFor(() => screen.getByText('Protein breakfast'));
    fireEvent.click(screen.getByText('Protein breakfast'));
    await waitFor(() => expect(screen.getByText('nope')).toBeTruthy());
    expect(onLogged).not.toHaveBeenCalled();
  });

  it('shows an empty state when there is nothing saved yet', async () => {
    respondWith([]);
    r(<TemplatePicker open onClose={() => {}} onLogged={() => {}} bucketId="morning" />);
    await waitFor(() => expect(screen.getByText('No meals or templates yet')).toBeTruthy());
  });

  it('fetches nothing while closed', () => {
    r(<TemplatePicker open={false} onClose={() => {}} onLogged={() => {}} bucketId="morning" />);
    expect(apiMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// PARITY with the retired `SavedMealsSheet`.
//
// A planned deletion is a hypothesis, not an instruction (process finding 5.4):
// two of the three deletions planned in Phase 5 would have removed live
// behaviour. So before the sheet was deleted, this block DROVE BOTH COMPONENTS
// side by side over the same meal — the saved meal, and the template
// `cli/migrate-saved-meals-to-templates.mjs` turns it into — and asserted every
// observable the sheet had against the picker. All five passed (Task 10.4);
// the sheet was deleted in the same commit and these are the picker halves,
// kept so a regression that would have broken parity still fails.
//
// The sheet's WRITE paths were checked too, because a surface can be replaced
// and still strand the things that fed it: `TodayView`'s "Save as meal" and
// `EntryEditSheet`'s "Save as meal" both wrote saved meals, which nothing would
// list any more. Both now write templates, pinned in their own test files.
// Copy-day-to-today still uses the meals endpoints as ephemeral transport
// (create → log → delete), which nothing ever lists.
// ---------------------------------------------------------------------------
describe('parity: the picker does everything SavedMealsSheet did', () => {
  // What the migration produces from the sheet's saved meal
  // ({ name: 'Protein breakfast', items: [Eggs 140, Toast 180] }).
  const MIGRATED = FLAT;

  const drivePicker = async () => {
    apiMock.mockReset();
    respondWith([MIGRATED]);
    const onLogged = vi.fn();
    const view = r(<TemplatePicker open onClose={() => {}} onLogged={onLogged} bucketId="morning" />);
    await waitFor(() => within(view.baseElement).getByText('Protein breakfast'));
    return { view, onLogged };
  };

  it('1. lists the meal by name', async () => {
    const picker = await drivePicker();
    expect(within(picker.view.baseElement).getByText('Protein breakfast')).toBeTruthy();
  });

  it('2. states the item count and the total kcal — the sheet\'s "2 items · 320 kcal"', async () => {
    const picker = await drivePicker();
    expect(within(picker.view.baseElement).getByText(/2 items · 320 kcal/)).toBeTruthy();
  });

  it('3. logs into the LAUNCH bucket on ONE tap and calls onLogged — no variant step when nothing rotates', async () => {
    const picker = await drivePicker();
    fireEvent.click(within(picker.view.baseElement).getByText('Protein breakfast'));
    await waitFor(() => expect(picker.onLogged).toHaveBeenCalled());
    const call = apiMock.mock.calls.find(([p]) => p.includes('/t2/instantiate'));
    expect(call[1].mealTime).toBe('morning');
    expect(call[2]).toBe('POST');
  });

  it('4. fetches only while open', () => {
    apiMock.mockReset();
    r(<TemplatePicker open={false} onClose={() => {}} onLogged={() => {}} bucketId="morning" />);
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('5. shows an empty state rather than a blank sheet', async () => {
    apiMock.mockReset();
    respondWith([]);
    const picker = r(<TemplatePicker open onClose={() => {}} onLogged={() => {}} bucketId="morning" />);
    await waitFor(() => expect(within(picker.baseElement).getByText('No meals or templates yet')).toBeTruthy());
  });

  it('6. surfaces a failed log, which the sheet only wrote to the console', async () => {
    apiMock.mockReset();
    apiMock.mockImplementation(async (path) => {
      if (path.includes('nutrition/templates?')) return { templates: [MIGRATED] };
      throw new Error('nope');
    });
    const onLogged = vi.fn();
    const picker = r(<TemplatePicker open onClose={() => {}} onLogged={onLogged} bucketId="morning" />);
    await waitFor(() => within(picker.baseElement).getByText('Protein breakfast'));
    fireEvent.click(within(picker.baseElement).getByText('Protein breakfast'));
    await waitFor(() => expect(within(picker.baseElement).getByText('nope')).toBeTruthy());
    expect(onLogged).not.toHaveBeenCalled();
  });
});
