import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
vi.mock('@/lib/api.mjs', () => ({ DaylightMediaPath: (p) => p }));
import AudienceRow, { audienceLabel } from './AudienceRow.jsx';

const P = (id, extra = {}) => ({ id, name: id.replace('rider-', 'Rider ').toUpperCase(), role: 'rider', guest: false, ...extra });

describe('AudienceRow', () => {
  it('shows nothing without people', () => {
    expect(render(<AudienceRow audience={null} deviceId="d" />).container.innerHTML).toBe('');
    expect(render(<AudienceRow audience={{ activity: 'workout', people: [] }} deviceId="d" />).container.innerHTML).toBe('');
  });
  it('caps avatars at four and lets the label carry the count (no second "+N" count)', () => {
    const people = ['a', 'b', 'c', 'd', 'e', 'f'].map((x) => P(`rider-${x}`));
    const { getByTestId } = render(<AudienceRow audience={{ activity: 'workout', people }} deviceId="garage-tv" />);
    const row = getByTestId('fleet-audience-garage-tv');
    expect(row.querySelectorAll('img')).toHaveLength(4);
    expect(row.textContent).not.toContain('+2');
    expect(row.textContent).toContain('RIDER A & 5 others');
  });
  it('labels guests "Guest", with the generic avatar, and skips people without an id', () => {
    const { getByTestId } = render(<AudienceRow audience={{ activity: 'workout', people: [P('guest-1', { guest: true, name: null }), { name: 'broken' }] }} deviceId="d" />);
    const row = getByTestId('fleet-audience-d');
    expect(row.querySelectorAll('img')).toHaveLength(1);
    expect(row.querySelector('img').getAttribute('src')).toBe('/static/img/users/user');
    expect(row.textContent).toContain('Guest');
  });
  it('labels', () => {
    expect(audienceLabel([P('rider-a')])).toBe('RIDER A');
    expect(audienceLabel([P('rider-a'), P('rider-b')])).toBe('RIDER A & 1 other');
  });
});
