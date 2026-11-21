import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import CrudTable from './CrudTable.jsx';

describe('CrudTable pending delete ownership', () => {
  it('clears delete confirmation on click-away without deleting a row', async () => {
    const rows = [{ id: 'first', name: 'First' }];
    const onChange = vi.fn();
    render(
      <MantineProvider>
        <CrudTable items={rows} columns={[{ key: 'name', label: 'Name', type: 'text' }]}
          onChange={onChange} confirmDelete />
      </MantineProvider>,
    );

    const deleteButton = within(screen.getByRole('row', { name: /First/ })).getByRole('button');
    fireEvent.click(deleteButton);
    expect(deleteButton).toHaveAttribute('title', 'Click again to confirm delete');
    await act(async () => new Promise(resolve => setTimeout(resolve, 0)));

    fireEvent.mouseDown(document.body);
    expect(deleteButton).toHaveAttribute('title', 'Delete row');
    fireEvent.click(deleteButton);

    expect(deleteButton).toHaveAttribute('title', 'Click again to confirm delete');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('retires confirmation when the caller removes its pending row', () => {
    const rows = [{ id: 'first', name: 'First' }, { id: 'second', name: 'Second' }];
    const onChange = vi.fn();
    const view = render(
      <MantineProvider>
        <CrudTable items={rows} columns={[{ key: 'name', label: 'Name', type: 'text' }]}
          onChange={onChange} confirmDelete />
      </MantineProvider>,
    );
    fireEvent.click(within(screen.getByRole('row', { name: /First/ })).getByRole('button'));

    view.rerender(
      <MantineProvider>
        <CrudTable items={[rows[1]]} columns={[{ key: 'name', label: 'Name', type: 'text' }]}
          onChange={onChange} confirmDelete />
      </MantineProvider>,
    );
    view.rerender(
      <MantineProvider>
        <CrudTable items={rows} columns={[{ key: 'name', label: 'Name', type: 'text' }]}
          onChange={onChange} confirmDelete />
      </MantineProvider>,
    );

    expect(within(screen.getByRole('row', { name: /First/ })).getByRole('button'))
      .toHaveAttribute('title', 'Delete row');
  });

  it('keeps delete confirmation with the same row after the caller reorders items', () => {
    const rows = [{ id: 'first', name: 'First' }, { id: 'second', name: 'Second' }];
    const onChange = vi.fn();
    const view = render(
      <MantineProvider>
        <CrudTable items={rows} columns={[{ key: 'name', label: 'Name', type: 'text' }]}
          onChange={onChange} confirmDelete />
      </MantineProvider>,
    );

    const firstRow = screen.getByRole('row', { name: /First/ });
    fireEvent.click(within(firstRow).getByRole('button'));
    expect(within(firstRow).getByRole('button')).toHaveAttribute('title', 'Click again to confirm delete');

    view.rerender(
      <MantineProvider>
        <CrudTable items={[rows[1], rows[0]]} columns={[{ key: 'name', label: 'Name', type: 'text' }]}
          onChange={onChange} confirmDelete />
      </MantineProvider>,
    );

    const secondRow = screen.getByRole('row', { name: /Second/ });
    expect(within(secondRow).getByRole('button')).toHaveAttribute('title', 'Delete row');
    const firstRowAfterReorder = screen.getByRole('row', { name: /First/ });
    expect(within(firstRowAfterReorder).getByRole('button')).toHaveAttribute('title', 'Click again to confirm delete');
    fireEvent.click(within(firstRowAfterReorder).getByRole('button'));
    expect(onChange).toHaveBeenCalledWith([rows[1]]);
  });
});
