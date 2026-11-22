import React from 'react';
import { MantineProvider } from '@mantine/core';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DndContext } from '@dnd-kit/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ListsItemRow from './ListsItemRow.jsx';
import { registerItemParams, __resetItemParams } from './itemParams/registry.js';
import { swapContentPayloads } from './listConstants.js';

const fixture = vi.hoisted(() => ({ appOpen: [] }));
vi.mock('../../../../frontend/src/lib/api.mjs', async original => ({
  ...await original(), DaylightAPI: vi.fn(async () => ({})),
}));
vi.mock('../../../../frontend/src/modules/AppContainer/AppContainer.jsx', () => ({
  default: ({ open }) => { fixture.appOpen.push(open); return <div data-testid="app-preview" />; },
}));

function StubEditor({ value, onChange }) {
  return (
    <label>
      Rounds
      <input
        aria-label="Rounds"
        value={value.rounds ?? ''}
        onChange={e => onChange({ ...value, rounds: Number(e.target.value) })}
      />
    </label>
  );
}

const stubType = {
  id: 'stub-game',
  label: 'Stub Game',
  matches: input => input.startsWith('app:stub-game'),
  summary: params => (params.rounds ? `${params.rounds} rounds` : 'Defaults'),
  Editor: StubEditor,
};

beforeEach(() => {
  __resetItemParams();
  registerItemParams(stubType);
  fixture.appOpen = [];
});

function renderRow(item, { onUpdate = vi.fn(async () => ({ ok: true })) } = {}) {
  const row = { index: 0, label: 'Game night', action: 'Open', ...item };
  render(
    <MantineProvider env="test">
      <MemoryRouter>
        <DndContext>
          <ListsItemRow
            item={row}
            onUpdate={onUpdate}
            onDelete={vi.fn()}
            onToggleActive={vi.fn()}
            onDuplicate={vi.fn()}
            onEdit={vi.fn()}
            onMoveItem={vi.fn()}
            sectionIndex={0}
            sectionCount={1}
            sections={[{ title: 'Rows', items: [row] }]}
            itemCount={1}
          />
        </DndContext>
      </MemoryRouter>
    </MantineProvider>,
  );
  return { onUpdate };
}

const gear = () => screen.queryByRole('button', { name: /^Parameters for/ });

async function openMenu() {
  fireEvent.click(screen.getByTestId('row-menu-0-0'));
  await screen.findByRole('menuitem', { name: 'More Info' });
}

describe('rows without a parameter type', () => {
  it('renders no gear and no Parameters menu entry', async () => {
    renderRow({ input: 'plex:12345', action: 'Play', label: 'A show' });
    expect(gear()).toBeNull();
    await openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Parameters…' })).toBeNull();
  });
});

describe('rows with a parameter type', () => {
  it('shows a dimmed gear named with the summary when no params are set', () => {
    renderRow({ input: 'app:stub-game' });
    const button = gear();
    expect(button).toHaveAccessibleName('Parameters for Game night: Defaults');
    expect(button).toHaveAttribute('data-params-set', 'false');
  });

  it('shows a normal gear when params are set', () => {
    renderRow({ input: 'app:stub-game', params: { rounds: 3 } });
    const button = gear();
    expect(button).toHaveAccessibleName('Parameters for Game night: 3 rounds');
    expect(button).toHaveAttribute('data-params-set', 'true');
  });

  it('opens the modal, and Save sends the edited params', async () => {
    const { onUpdate } = renderRow({ input: 'app:stub-game', params: { rounds: 3 } });
    fireEvent.click(gear());
    const dialog = await screen.findByRole('dialog', { name: 'Stub Game · Game night' });
    fireEvent.change(within(dialog).getByLabelText('Rounds'), { target: { value: '5' } });
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Save' })); });
    expect(onUpdate).toHaveBeenCalledWith({ params: { rounds: 5 } });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Clear sends params:null', async () => {
    const { onUpdate } = renderRow({ input: 'app:stub-game', params: { rounds: 3 } });
    fireEvent.click(gear());
    const dialog = await screen.findByRole('dialog');
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Clear' })); });
    expect(onUpdate).toHaveBeenCalledWith({ params: null });
  });

  it('hides Clear when the item has no params, and Cancel sends nothing', async () => {
    const { onUpdate } = renderRow({ input: 'app:stub-game' });
    fireEvent.click(gear());
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('button', { name: 'Clear' })).toBeNull();
    fireEvent.change(within(dialog).getByLabelText('Rounds'), { target: { value: '2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('keeps the modal open and shows the error when the save fails', async () => {
    const onUpdate = vi.fn(async () => ({ ok: false, error: new Error('disk full') }));
    renderRow({ input: 'app:stub-game' }, { onUpdate });
    fireEvent.click(gear());
    const dialog = await screen.findByRole('dialog');
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Save' })); });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('disk full');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('keeps the modal open and shows the error when onUpdate throws', async () => {
    const onUpdate = vi.fn(async () => { throw new Error('network down'); });
    renderRow({ input: 'app:stub-game' }, { onUpdate });
    fireEvent.click(gear());
    const dialog = await screen.findByRole('dialog');
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Save' })); });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('network down');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('says another change is saving when the folder refuses the write', async () => {
    const onUpdate = vi.fn(async () => ({ ok: false }));
    renderRow({ input: 'app:stub-game' }, { onUpdate });
    fireEvent.click(gear());
    const dialog = await screen.findByRole('dialog');
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Save' })); });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Another change is still saving — try again');
  });

  it('Save with an empty draft sends an empty object, not null', async () => {
    const { onUpdate } = renderRow({ input: 'app:stub-game' });
    fireEvent.click(gear());
    const dialog = await screen.findByRole('dialog');
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Save' })); });
    expect(onUpdate).toHaveBeenCalledWith({ params: {} });
  });

  it('offers Parameters… in the row menu between More Info and Duplicate', async () => {
    renderRow({ input: 'app:stub-game' });
    await openMenu();
    const names = screen.getAllByRole('menuitem').map(el => el.textContent.trim());
    expect(names.slice(0, 3)).toEqual(['More Info', 'Parameters…', 'Duplicate']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Parameters…' }));
    expect(await screen.findByRole('dialog', { name: 'Stub Game · Game night' })).toBeInTheDocument();
  });
});

describe('app preview', () => {
  it('passes params to the app when the item has them', async () => {
    renderRow({ input: 'app:stub-game/fhe', params: { rounds: 3 } });
    fireEvent.click(screen.getByTitle('Preview app'));
    await screen.findByTestId('app-preview');
    expect(fixture.appOpen.at(-1)).toEqual({ app: 'stub-game/fhe', params: { rounds: 3 } });
  });

  it('passes the plain string when the item has no params', async () => {
    renderRow({ input: 'app:stub-game/fhe' });
    fireEvent.click(screen.getByTitle('Preview app'));
    await screen.findByTestId('app-preview');
    expect(fixture.appOpen.at(-1)).toBe('stub-game/fhe');
  });
});

describe('content swap', () => {
  it('moves params with the content, and clears them on the row that loses them', () => {
    const withParams = { input: 'app:stub-game', action: 'Open', params: { rounds: 3 }, label: 'A' };
    const without = { input: 'plex:1', action: 'Play', label: 'B' };
    const { updatesForA, updatesForB } = swapContentPayloads(withParams, without);
    expect(updatesForA.params).toBeNull();
    expect(updatesForB.params).toEqual({ rounds: 3 });
  });
});
