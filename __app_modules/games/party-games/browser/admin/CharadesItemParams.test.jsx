import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor, cleanup } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const directory = { people: [], loading: false, error: null, createGuest: vi.fn() };
vi.mock('./usePeopleDirectory.js', () => ({ default: () => directory }));

const { default: CharadesItemParams } = await import('./CharadesItemParams.jsx');

const user = (id, name, extra = {}) => ({ person: { kind: 'user', id }, display: { name, avatar: null }, active: true, ...extra });
const guest = (id, name, extra = {}) => ({ person: { kind: 'guest', id }, display: { name, avatar: null }, active: true, ...extra });

beforeEach(() => {
  directory.people = [
    user('learner-a', 'Person A'),
    user('learner-b', 'Person B'),
    guest('guest_1111', 'Visitor One'),
    guest('guest_2222', 'Visitor Two'),
    guest('guest_old', 'Visitor Gone', { active: false }),
  ];
  directory.createGuest = vi.fn();
});
afterEach(cleanup);

function renderEditor(value) {
  const onChange = vi.fn();
  const view = render(<MantineProvider><CharadesItemParams value={value} onChange={onChange} /></MantineProvider>);
  return { onChange, ...view };
}

const openAdd = () => {
  const input = screen.getByPlaceholderText('Add person…');
  fireEvent.click(input);
  return screen.getByRole('listbox');
};

it('renders every selected person as a pill with a photo derived from the id, guests and unknown ids included', () => {
  const ids = ['learner-a', 'guest_1111', 'ghost-9f3c'];
  const { container } = renderEditor({ participants: ids });
  const imgs = [...container.querySelectorAll('img')].map(img => img.getAttribute('src'));
  expect(imgs).toHaveLength(ids.length);
  for (const id of ids) expect(imgs.some(src => src.endsWith(`/static/img/users/${id}`))).toBe(true);
  expect(container.textContent).not.toMatch(/\bPA\b|\bVO\b/);
  expect(screen.getByLabelText('Remove Person A')).toBeTruthy();
  expect(screen.getByLabelText('Remove Visitor One')).toBeTruthy();
});

it('offers only unselected active people from one combobox, household first', () => {
  const { onChange } = renderEditor({ participants: ['learner-a'] });
  expect(screen.queryByRole('button', { name: /^Add /i })).toBeNull();
  // Mantine keeps a closed dropdown mounted under display:none; role queries skip hidden nodes.
  expect(screen.queryByRole('option', { name: 'Visitor Two' })).toBeNull();
  expect(screen.queryByRole('listbox')).toBeNull();
  const list = openAdd();
  const names = within(list).getAllByRole('option').map(o => o.textContent);
  expect(names).toEqual(['Person B', 'Visitor One', 'Visitor Two', 'New guest…']);
  fireEvent.click(within(list).getByRole('option', { name: 'Visitor One' }));
  expect(onChange).toHaveBeenLastCalledWith({ participants: ['learner-a', 'guest_1111'] });
});

it('removing a person drops them from participants and clue modes', () => {
  const value = { autostart: true, participants: ['learner-a', 'learner-b'], clue_modes: { 'learner-a': 'reader', 'learner-b': 'image' } };
  const { onChange } = renderEditor(value);
  fireEvent.click(screen.getByLabelText('Remove Person A'));
  expect(onChange).toHaveBeenLastCalledWith({ autostart: true, participants: ['learner-b'], clue_modes: { 'learner-b': 'image' } });
  expect(value.participants).toEqual(['learner-a', 'learner-b']);
});

it('sets a clue mode and drops Text keys and an empty map', () => {
  const { onChange, rerender } = renderEditor({ participants: ['learner-a'] });
  fireEvent.change(screen.getByLabelText('Person A clue mode'), { target: { value: 'reader' } });
  expect(onChange).toHaveBeenLastCalledWith({ participants: ['learner-a'], clue_modes: { 'learner-a': 'reader' } });
  rerender(<MantineProvider><CharadesItemParams value={{ participants: ['learner-a'], clue_modes: { 'learner-a': 'reader' } }} onChange={onChange} /></MantineProvider>);
  fireEvent.change(screen.getByLabelText('Person A clue mode'), { target: { value: 'text' } });
  expect(onChange).toHaveBeenLastCalledWith({ participants: ['learner-a'] });
});

it('shows an unknown id as "Unknown person" and never renders ids', () => {
  const { container, onChange } = renderEditor({ participants: ['learner-a', 'guest_1111', 'ghost-9f3c'], clue_modes: { 'ghost-9f3c': 'image' } });
  expect(screen.getAllByText('Unknown person').length).toBeGreaterThan(0);
  for (const id of ['learner-a', 'guest_1111', 'ghost-9f3c']) expect(container.textContent).not.toContain(id);
  for (const el of container.querySelectorAll('[aria-label]')) expect(el.getAttribute('aria-label')).not.toMatch(/learner-a|guest_1111|ghost-9f3c/);
  fireEvent.click(screen.getByLabelText('Remove Unknown person'));
  expect(onChange).toHaveBeenLastCalledWith({ participants: ['learner-a', 'guest_1111'] });
});

it('creates a named guest from "New guest…" and selects them', async () => {
  directory.createGuest = vi.fn(async name => guest('guest_new', name));
  const { onChange } = renderEditor({ participants: ['learner-a'] });
  expect(screen.queryByLabelText('Name')).toBeNull();
  fireEvent.click(within(openAdd()).getByRole('option', { name: 'New guest…' }));
  const name = await screen.findByLabelText('Name');
  fireEvent.change(name, { target: { value: 'Cousin Visitor' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ participants: ['learner-a', 'guest_new'] }));
  expect(directory.createGuest).toHaveBeenCalledWith('Cousin Visitor');
});

it('uses no bare native select', () => {
  const { container } = renderEditor({ participants: ['learner-a', 'guest_1111'] });
  expect(container.querySelectorAll('select:not(.mantine-NativeSelect-input)').length).toBe(0);
});

it('toggles autostart', () => {
  const { onChange } = renderEditor(undefined);
  fireEvent.click(screen.getByLabelText('Start automatically'));
  expect(onChange).toHaveBeenLastCalledWith({ autostart: true });
});
