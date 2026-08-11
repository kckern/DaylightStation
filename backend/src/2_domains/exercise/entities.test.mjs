import { describe, it, expect } from 'vitest';
import {
  makeExercise,
  makeMuscle,
  makeMuscleGroup,
  makeEquipment,
  exerciseMatchesFilter,
} from './entities.mjs';

describe('makeExercise', () => {
  it('normalizes a raw index record', () => {
    const ex = makeExercise({
      slug: 'push-up', name: 'Push-Up', image: 'assets/a.gif',
      targetMuscles: ['pectorals'], equipment: ['body-weight'],
      groups: ['chest'], instructions: ['Step one.'],
    });
    expect(ex.slug).toBe('push-up');
    expect(ex.instructions).toEqual(['Step one.']);
  });

  it('defaults missing collections to empty arrays, never undefined', () => {
    const ex = makeExercise({ slug: 'x', name: 'X' });
    expect(ex.targetMuscles).toEqual([]);
    expect(ex.equipment).toEqual([]);
    expect(ex.instructions).toEqual([]);
  });

  it('defaults missing scalars to null and name to the slug', () => {
    const ex = makeExercise({ slug: 'x' });
    expect(ex.name).toBe('x');
    expect(ex.image).toBeNull();
    expect(ex.description).toBeNull();
    expect(ex.video).toBeNull();
  });

  it('is frozen, arrays included, so consumers cannot mutate shared corpus state', () => {
    const ex = makeExercise({ slug: 'x', name: 'X', groups: ['chest'] });
    expect(Object.isFrozen(ex)).toBe(true);
    expect(() => { ex.name = 'Y'; }).toThrow(TypeError);
    expect(() => ex.groups.push('back')).toThrow(TypeError);
  });

  it('copies input arrays rather than aliasing the raw record', () => {
    const raw = { slug: 'x', name: 'X', groups: ['chest'] };
    const ex = makeExercise(raw);
    raw.groups.push('back');
    expect(ex.groups).toEqual(['chest']);
  });

  it('drops blank and non-scalar list members', () => {
    const ex = makeExercise({ slug: 'x', targetMuscles: [' pectorals ', '', null, {}] });
    expect(ex.targetMuscles).toEqual(['pectorals']);
  });

  it('tolerates a missing record without throwing', () => {
    const ex = makeExercise();
    expect(ex.slug).toBe('');
    expect(ex.groups).toEqual([]);
  });
});

describe('exerciseMatchesFilter', () => {
  const ex = makeExercise({
    slug: 'push-up', name: 'Push-Up', groups: ['chest'],
    targetMuscles: ['pectorals'], equipment: ['body-weight'],
  });

  it('matches an empty filter', () => {
    expect(exerciseMatchesFilter(ex, {})).toBe(true);
  });

  it('matches when no filter is supplied at all', () => {
    expect(exerciseMatchesFilter(ex)).toBe(true);
  });

  it('filters by group, muscle, and equipment', () => {
    expect(exerciseMatchesFilter(ex, { group: 'chest' })).toBe(true);
    expect(exerciseMatchesFilter(ex, { group: 'back' })).toBe(false);
    expect(exerciseMatchesFilter(ex, { muscle: 'pectorals' })).toBe(true);
    expect(exerciseMatchesFilter(ex, { equipment: 'barbell' })).toBe(false);
  });

  it('matches a case-insensitive name substring', () => {
    expect(exerciseMatchesFilter(ex, { q: 'push' })).toBe(true);
    expect(exerciseMatchesFilter(ex, { q: 'PUSH' })).toBe(true);
    expect(exerciseMatchesFilter(ex, { q: 'squat' })).toBe(false);
  });

  it('ANDs multiple filter terms', () => {
    expect(exerciseMatchesFilter(ex, { group: 'chest', equipment: 'barbell' })).toBe(false);
  });

  it('never lets the targetGroups hint decide group membership', () => {
    const hinted = makeExercise({
      slug: 'crunch', name: 'Crunch', groups: ['chest'], targetGroups: ['back'],
    });
    expect(hinted.targetGroups).toEqual(['back']);
    expect(exerciseMatchesFilter(hinted, { group: 'back' })).toBe(false);
    expect(exerciseMatchesFilter(hinted, { group: 'chest' })).toBe(true);
  });

  it('treats blank filter terms as absent', () => {
    expect(exerciseMatchesFilter(ex, { group: '', muscle: null, q: '   ' })).toBe(true);
  });

  it('ignores separator differences between the query and the name', () => {
    expect(exerciseMatchesFilter(ex, { q: 'push up' })).toBe(true);
    expect(exerciseMatchesFilter(ex, { q: '  Push-Up  ' })).toBe(true);
  });

  it('matches the slug too, so a record with no name is still findable', () => {
    const unnamed = makeExercise({ slug: 'barbell-squat' });
    expect(exerciseMatchesFilter(unnamed, { q: 'squat' })).toBe(true);
  });

  it('does not search description or instructions', () => {
    const wordy = makeExercise({
      slug: 'plank', name: 'Plank',
      description: 'A squat-adjacent hold.', instructions: ['Squat down first.'],
    });
    expect(exerciseMatchesFilter(wordy, { q: 'squat' })).toBe(false);
  });

  it('compares slug terms case-insensitively', () => {
    expect(exerciseMatchesFilter(ex, { group: 'Chest' })).toBe(true);
    expect(exerciseMatchesFilter(ex, { equipment: ' body-weight ' })).toBe(true);
  });
});

describe('makeMuscle', () => {
  it('normalizes a raw muscle record', () => {
    const m = makeMuscle({
      slug: 'pectorals', name: 'Pectorals', group: 'chest',
      description: 'Chest muscle.', fullDescription: 'A longer reader passage.',
      image: 'assets/p.png',
    });
    expect(m.slug).toBe('pectorals');
    expect(m.group).toBe('chest');
    expect(m.fullDescription).toBe('A longer reader passage.');
    expect(m.image).toBe('assets/p.png');
  });

  it('defaults an unresolved group and description to null, and is frozen', () => {
    const m = makeMuscle({ slug: 'abs' });
    expect(m.name).toBe('abs');
    expect(m.group).toBeNull();
    expect(m.declaredGroup).toBeNull();
    expect(m.fullDescription).toBeNull();
    expect(Object.isFrozen(m)).toBe(true);
  });

  it('preserves a declared group that could not be resolved', () => {
    const m = makeMuscle({ slug: 'abs', declaredGroup: 'core' });
    expect(m.group).toBeNull();
    expect(m.declaredGroup).toBe('core');
  });
});

describe('makeMuscleGroup', () => {
  it('normalizes a raw muscle-group record', () => {
    const g = makeMuscleGroup({ slug: 'chest', name: 'Chest', muscles: ['pectorals'] });
    expect(g.slug).toBe('chest');
    expect(g.muscles).toEqual(['pectorals']);
  });

  it('defaults missing collections to empty arrays and is frozen', () => {
    const g = makeMuscleGroup({ slug: 'back' });
    expect(g.name).toBe('back');
    expect(g.muscles).toEqual([]);
    expect(g.description).toBeNull();
    expect(Object.isFrozen(g)).toBe(true);
    expect(() => g.muscles.push('lats')).toThrow(TypeError);
  });
});

describe('makeEquipment', () => {
  it('normalizes a raw equipment record', () => {
    const e = makeEquipment({ id: '7', slug: 'barbell', name: 'Barbell', description: 'A bar.' });
    expect(e).toEqual({ id: '7', slug: 'barbell', name: 'Barbell', description: 'A bar.' });
  });

  it('defaults a missing name to the slug and is frozen', () => {
    const e = makeEquipment({ slug: 'body-weight' });
    expect(e.name).toBe('body-weight');
    expect(e.description).toBeNull();
    expect(Object.isFrozen(e)).toBe(true);
  });
});
