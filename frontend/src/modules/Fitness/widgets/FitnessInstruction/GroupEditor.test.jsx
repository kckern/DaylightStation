import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
import GroupEditor from './GroupEditor.jsx';
import { groupKind, groupLabel, GROUP_LABELS } from './groupKindModel.js';
// The domain's own derivation, imported so the two cannot drift: the frontend copy
// exists because no build alias resolves `backend/src` at RUNTIME, but test code runs
// under Node where the path does resolve.
import { groupKind as domainGroupKind } from '../../../../../../backend/src/2_domains/fitness/workout/workout.mjs';

vi.mock('@/lib/api.mjs', () => ({
  DaylightMediaPath: (p) => `https://kiosk.test/${String(p).replace(/^\/|\/$/g, '')}`,
  DaylightAPI: async () => ({}),
  DaylightAPIText: async () => '',
  DaylightImagePath: (k) => `https://kiosk.test/api/v1/static/img/${k}`,
  DaylightStatusCheck: async () => 200,
  DaylightHostPath: () => 'https://kiosk.test',
  ContentDisplayUrl: () => '',
  normalizeImageUrl: (u) => u,
  DaylightWebsocketSubscribe: () => () => {},
  DaylightWebsocketUnsubscribe: () => () => {}
}));

/**
 * Members are deliberately DISTINGUISHABLE — different names, different slugs, and
 * different field values. A fixture of look-alike rows lets a broken index (edit the
 * wrong row, move the wrong row) pass every assertion.
 */
const member = (over = {}) => ({
  key: over.slug ?? 'k',
  slug: 'push-up',
  name: 'Push Up',
  image: 'media/library/exercise/assets/pushup.gif',
  sets: 3,
  mode: 'reps',
  reps: 10,
  seconds: 30,
  loadLb: 0,
  restSeconds: 60,
  ...over
});

const PUSH = member({ slug: 'push-up', name: 'Push Up', sets: 3, reps: 10 });
const ROW = member({ slug: 'barbell-row', name: 'Barbell Row', sets: 4, reps: 8, loadLb: 95, image: null });
const SQUAT = member({ slug: 'barbell-squat', name: 'Barbell Squat', sets: 5, reps: 5, loadLb: 135 });

const handlers = () => ({
  onMoveGroup: vi.fn(),
  onRemoveGroup: vi.fn(),
  onMerge: vi.fn(),
  onSplit: vi.fn(),
  onRounds: vi.fn(),
  onMoveMember: vi.fn(),
  onRemoveMember: vi.fn(),
  onPatchMember: vi.fn()
});

/**
 * Queries are bound to THIS render's container, not to document.body: several tests
 * mount two editors to compare them, and body-scoped queries would then see both and
 * throw "found multiple elements" instead of testing either.
 */
function mount({ group, index = 0, total = 1, unknownSlugs = null } = {}) {
  const h = handlers();
  const view = render(
    <GroupEditor group={group} index={index} total={total} unknownSlugs={unknownSlugs} {...h} />
  );
  return { ...view, ...within(view.container), h };
}

const single = { key: 'g1', rounds: 1, exercises: [PUSH] };
const pair = { key: 'g2', rounds: 3, exercises: [PUSH, ROW] };
const trio = { key: 'g3', rounds: 2, exercises: [PUSH, ROW, SQUAT] };

// ─────────────────────────────────────────────────────────────────────────────
describe('groupKind — derived from size, never authored', () => {
  it('is straight sets for one exercise', () => {
    expect(groupKind({ exercises: [PUSH] })).toBe('sets');
  });

  it('is a superset for exactly two', () => {
    expect(groupKind({ exercises: [PUSH, ROW] })).toBe('superset');
  });

  it('is a circuit from three up', () => {
    expect(groupKind({ exercises: [PUSH, ROW, SQUAT] })).toBe('circuit');
    expect(groupKind({ exercises: [PUSH, ROW, SQUAT, PUSH] })).toBe('circuit');
  });

  it('is straight sets for an empty or malformed group rather than a fourth kind', () => {
    expect(groupKind({ exercises: [] })).toBe('sets');
    expect(groupKind({})).toBe('sets');
    expect(groupKind(null)).toBe('sets');
  });

  it('agrees with the domain at every size from 0 to 5', () => {
    // The 2/3 boundary is the one that matters: a superset mislabelled "circuit"
    // (or the reverse) is a label the runner then repeats at the rack.
    for (let n = 0; n <= 5; n += 1) {
      const group = { exercises: Array.from({ length: n }, () => PUSH) };
      expect(groupKind(group)).toBe(domainGroupKind(group));
    }
  });

  it('labels each kind for display', () => {
    expect(groupLabel(single)).toBe('Straight sets');
    expect(groupLabel(pair)).toBe('Superset');
    expect(groupLabel(trio)).toBe('Circuit');
    expect(GROUP_LABELS).toEqual({ sets: 'Straight sets', superset: 'Superset', circuit: 'Circuit' });
  });
});

describe('GroupEditor — which knob is shown', () => {
  it('a straight-sets group shows per-exercise Sets and no group Rounds', () => {
    const view = mount({ group: single });
    expect(view.getByTestId('workout-group-0-ex-0-sets-value').textContent).toBe('3');
    expect(view.queryByTestId('workout-group-0-rounds')).toBeNull();
    expect(view.getByTestId('workout-group-0-kind').textContent).toBe('Straight sets');
  });

  it('a superset shows group Rounds and no per-exercise Sets', () => {
    const view = mount({ group: pair, total: 1 });
    expect(view.getByTestId('workout-group-0-rounds-value').textContent).toBe('3');
    expect(view.queryByTestId('workout-group-0-ex-0-sets')).toBeNull();
    expect(view.queryByTestId('workout-group-0-ex-1-sets')).toBeNull();
    expect(view.getByTestId('workout-group-0-kind').textContent).toBe('Superset');
  });

  it('a circuit shows group Rounds and is labelled circuit', () => {
    const view = mount({ group: trio });
    expect(view.getByTestId('workout-group-0-rounds-value').textContent).toBe('2');
    expect(view.getByTestId('workout-group-0-kind').textContent).toBe('Circuit');
    expect(view.getByTestId('workout-group-0').getAttribute('data-kind')).toBe('circuit');
  });
});

describe('GroupEditor — rows', () => {
  it('renders each member in plan order with its own name and slug', () => {
    const view = mount({ group: trio });
    expect(view.getByTestId('workout-group-0-ex-0').getAttribute('data-slug')).toBe('push-up');
    expect(view.getByTestId('workout-group-0-ex-1').getAttribute('data-slug')).toBe('barbell-row');
    expect(view.getByTestId('workout-group-0-ex-2').getAttribute('data-slug')).toBe('barbell-squat');
    expect(view.getByTestId('workout-group-0-ex-2-name').textContent).toContain('Barbell Squat');
  });

  it('runs the image through DaylightMediaPath, and falls back when there is none', () => {
    const view = mount({ group: pair });
    expect(view.getByTestId('workout-group-0-ex-0-image').getAttribute('src'))
      .toBe('https://kiosk.test/media/library/exercise/assets/pushup.gif');
    // ROW carries no image.
    expect(view.queryByTestId('workout-group-0-ex-1-image')).toBeNull();
  });

  it('shows each row its own field values, not the first row\'s', () => {
    const view = mount({ group: trio });
    expect(view.getByTestId('workout-group-0-ex-0-reps-value').textContent).toBe('10');
    expect(view.getByTestId('workout-group-0-ex-1-reps-value').textContent).toBe('8');
    expect(view.getByTestId('workout-group-0-ex-2-reps-value').textContent).toBe('5');
    expect(view.getByTestId('workout-group-0-ex-0-load-value').textContent).toBe('—');
    expect(view.getByTestId('workout-group-0-ex-1-load-value').textContent).toBe('95 lb');
    expect(view.getByTestId('workout-group-0-ex-2-load-value').textContent).toBe('135 lb');
  });

  it('shows a timed member seconds instead of reps', () => {
    const timed = { key: 'g', rounds: 1, exercises: [member({ slug: 'plank', name: 'Plank', mode: 'time', seconds: 45 })] };
    const view = mount({ group: timed });
    expect(view.getByTestId('workout-group-0-ex-0-seconds-value').textContent).toBe('45s');
    expect(view.queryByTestId('workout-group-0-ex-0-reps')).toBeNull();
    expect(view.getByTestId('workout-group-0-ex-0-mode-toggle').textContent).toBe('Time');
  });

  it('renders rest as None at zero', () => {
    const view = mount({ group: { key: 'g', rounds: 1, exercises: [member({ restSeconds: 0 })] } });
    expect(view.getByTestId('workout-group-0-ex-0-rest-value').textContent).toBe('None');
  });
});

describe('GroupEditor — edits report the row they came from', () => {
  it('a stepper increment patches THAT member with the next value', () => {
    const view = mount({ group: trio });
    fireEvent.pointerDown(view.getByTestId('workout-group-0-ex-1-reps-inc'));
    expect(view.h.onPatchMember).toHaveBeenCalledWith(0, 1, { reps: 9 });
  });

  it('a stepper decrement steps down by the field\'s step size', () => {
    const view = mount({ group: trio });
    fireEvent.pointerDown(view.getByTestId('workout-group-0-ex-2-load-dec'));
    expect(view.h.onPatchMember).toHaveBeenCalledWith(0, 2, { loadLb: 130 });
    fireEvent.pointerDown(view.getByTestId('workout-group-0-ex-2-rest-dec'));
    expect(view.h.onPatchMember).toHaveBeenCalledWith(0, 2, { restSeconds: 45 });
  });

  it('clamps at the floor and disables the target there', () => {
    const view = mount({ group: { key: 'g', rounds: 1, exercises: [member({ loadLb: 0, restSeconds: 0 })] } });
    const dec = view.getByTestId('workout-group-0-ex-0-load-dec');
    expect(dec.getAttribute('data-disabled')).toBe('true');
    fireEvent.pointerDown(dec);
    expect(view.h.onPatchMember).not.toHaveBeenCalled();
  });

  it('the target toggle flips reps to time and back', () => {
    const view = mount({ group: single });
    fireEvent.pointerDown(view.getByTestId('workout-group-0-ex-0-mode-toggle'));
    expect(view.h.onPatchMember).toHaveBeenCalledWith(0, 0, { mode: 'time' });

    const timed = mount({ group: { key: 'g', rounds: 1, exercises: [member({ mode: 'time' })] } });
    fireEvent.pointerDown(timed.getByTestId('workout-group-0-ex-0-mode-toggle'));
    expect(timed.h.onPatchMember).toHaveBeenCalledWith(0, 0, { mode: 'reps' });
  });

  it('rounds reports the group index and the new value', () => {
    const view = mount({ group: pair, index: 2, total: 4 });
    fireEvent.pointerDown(view.getByTestId('workout-group-2-rounds-inc'));
    expect(view.h.onRounds).toHaveBeenCalledWith(2, 4);
  });
});

describe('GroupEditor — reorder and remove targets', () => {
  it('moves a member up with a negative delta and down with a positive one', () => {
    const view = mount({ group: trio });
    fireEvent.pointerDown(view.getByTestId('workout-group-0-ex-1-up'));
    expect(view.h.onMoveMember).toHaveBeenCalledWith(0, 1, -1);
    fireEvent.pointerDown(view.getByTestId('workout-group-0-ex-1-down'));
    expect(view.h.onMoveMember).toHaveBeenCalledWith(0, 1, 1);
  });

  it('disables the move targets at the ends of the member list', () => {
    const view = mount({ group: trio });
    expect(view.getByTestId('workout-group-0-ex-0-up').getAttribute('data-disabled')).toBe('true');
    expect(view.getByTestId('workout-group-0-ex-0-down').getAttribute('data-disabled')).toBe('false');
    expect(view.getByTestId('workout-group-0-ex-2-down').getAttribute('data-disabled')).toBe('true');
    fireEvent.pointerDown(view.getByTestId('workout-group-0-ex-0-up'));
    expect(view.h.onMoveMember).not.toHaveBeenCalled();
  });

  it('moves the group itself, reporting its own index', () => {
    const view = mount({ group: single, index: 1, total: 3 });
    fireEvent.pointerDown(view.getByTestId('workout-group-1-up'));
    expect(view.h.onMoveGroup).toHaveBeenCalledWith(1, -1);
    fireEvent.pointerDown(view.getByTestId('workout-group-1-down'));
    expect(view.h.onMoveGroup).toHaveBeenCalledWith(1, 1);
  });

  it('disables group up at the top and group down at the bottom', () => {
    const first = mount({ group: single, index: 0, total: 3 });
    expect(first.getByTestId('workout-group-0-up').getAttribute('data-disabled')).toBe('true');
    expect(first.getByTestId('workout-group-0-down').getAttribute('data-disabled')).toBe('false');

    const last = mount({ group: single, index: 2, total: 3 });
    expect(last.getByTestId('workout-group-2-down').getAttribute('data-disabled')).toBe('true');
    expect(last.getByTestId('workout-group-2-up').getAttribute('data-disabled')).toBe('false');
  });

  it('removes a member by row, and the group by its own control', () => {
    const view = mount({ group: trio });
    fireEvent.pointerDown(view.getByTestId('workout-group-0-ex-2-remove'));
    expect(view.h.onRemoveMember).toHaveBeenCalledWith(0, 2);
    fireEvent.pointerDown(view.getByTestId('workout-group-0-remove'));
    expect(view.h.onRemoveGroup).toHaveBeenCalledWith(0);
  });

  it('offers merge only when a next group exists, and split only for a multi group', () => {
    const lastSingle = mount({ group: single, index: 1, total: 2 });
    expect(lastSingle.getByTestId('workout-group-1-merge').getAttribute('data-disabled')).toBe('true');
    expect(lastSingle.getByTestId('workout-group-1-split').getAttribute('data-disabled')).toBe('true');

    const firstSingle = mount({ group: single, index: 0, total: 2 });
    expect(firstSingle.getByTestId('workout-group-0-merge').getAttribute('data-disabled')).toBe('false');
    fireEvent.pointerDown(firstSingle.getByTestId('workout-group-0-merge'));
    expect(firstSingle.h.onMerge).toHaveBeenCalledWith(0);

    const superset = mount({ group: pair, index: 0, total: 1 });
    expect(superset.getByTestId('workout-group-0-split').getAttribute('data-disabled')).toBe('false');
    fireEvent.pointerDown(superset.getByTestId('workout-group-0-split'));
    expect(superset.h.onSplit).toHaveBeenCalledWith(0);
  });
});

describe('GroupEditor — rejected slugs', () => {
  it('flags only the rows the server named', () => {
    const view = mount({ group: trio, unknownSlugs: new Set(['barbell-row']) });
    expect(view.getByTestId('workout-group-0-ex-1').className).toContain('group-editor__member--unknown');
    expect(view.getByTestId('workout-group-0-ex-1-name').textContent).toContain('not in library');
    expect(view.getByTestId('workout-group-0-ex-0').className).not.toContain('--unknown');
    expect(view.getByTestId('workout-group-0-ex-2-name').textContent).not.toContain('not in library');
  });
});

describe('GroupEditor — touchscreen interaction contract', () => {
  it('does nothing on a bare click (targets are onPointerDown, not onClick)', () => {
    const view = mount({ group: trio, index: 1, total: 3 });
    fireEvent.click(view.getByTestId('workout-group-1-up'));
    fireEvent.click(view.getByTestId('workout-group-1-ex-0-reps-inc'));
    fireEvent.click(view.getByTestId('workout-group-1-remove'));
    expect(view.h.onMoveGroup).not.toHaveBeenCalled();
    expect(view.h.onPatchMember).not.toHaveBeenCalled();
    expect(view.h.onRemoveGroup).not.toHaveBeenCalled();
  });

  it('activates on Enter and on Space', () => {
    const view = mount({ group: trio, index: 0, total: 2 });
    fireEvent.keyDown(view.getByTestId('workout-group-0-down'), { key: 'Enter' });
    expect(view.h.onMoveGroup).toHaveBeenCalledWith(0, 1);
    fireEvent.keyDown(view.getByTestId('workout-group-0-ex-0-reps-inc'), { key: ' ' });
    expect(view.h.onPatchMember).toHaveBeenCalledWith(0, 0, { reps: 11 });
  });

  it('keeps a disabled target inert under the keyboard too', () => {
    const view = mount({ group: trio, index: 0, total: 1 });
    fireEvent.keyDown(view.getByTestId('workout-group-0-up'), { key: 'Enter' });
    expect(view.h.onMoveGroup).not.toHaveBeenCalled();
  });

  it('exposes every control as a labelled button for the keyboard', () => {
    const view = mount({ group: pair, index: 0, total: 2 });
    expect(view.getByTestId('workout-group-0-ex-0-up').getAttribute('role')).toBe('button');
    expect(view.getByTestId('workout-group-0-ex-0-up').getAttribute('aria-label'))
      .toBe('Move Push Up earlier in this group');
    // Disabled controls leave the tab order rather than trapping a focus ring on a
    // target that does nothing.
    expect(view.getByTestId('workout-group-0-ex-0-up').getAttribute('tabindex')).toBe('-1');
    expect(view.getByTestId('workout-group-0-ex-1-up').getAttribute('tabindex')).toBe('0');
  });
});
