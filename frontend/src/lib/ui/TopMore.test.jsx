import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider, Menu, UnstyledButton } from '@mantine/core';
import { TopMoreList, TopMoreMenu } from './TopMore.jsx';
import { ActionMenu } from './ActionMenu.jsx';
import { DismissStackProvider } from './dismiss/DismissStackProvider.jsx';

const items = Array.from({ length: 7 }, (_, i) => ({ id: `i${i}`, label: `Item ${i}` }));
const wrap = (ui) => render(<MantineProvider><DismissStackProvider>{ui}</DismissStackProvider></MantineProvider>);

function List(props) {
  return (
    <ul data-testid="list">
      <TopMoreList items={items} n={3} moreAs="li" testId="rows"
        renderItem={(item) => <li key={item.id}><UnstyledButton data-testid={`row-${item.id}`}>{item.label}</UnstyledButton></li>}
        {...props} />
    </ul>
  );
}

describe('TopMoreList', () => {
  it('shows the top n and a More with the hidden count', () => {
    wrap(<List />);
    expect(screen.getAllByRole('button', { name: /^Item/ })).toHaveLength(3);
    expect(screen.getByTestId('rows-more')).toHaveTextContent('More (4)');
  });

  it('More expands in place, reports the counts and focuses the first newly shown item', async () => {
    const onExpand = vi.fn();
    wrap(<List onExpand={onExpand} />);
    fireEvent.click(screen.getByTestId('rows-more'));
    expect(screen.getAllByRole('button', { name: /^Item/ })).toHaveLength(7);
    expect(screen.queryByTestId('rows-more')).toBeNull();
    expect(onExpand).toHaveBeenCalledWith({ shown: 3, hidden: 4 });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('row-i3')));
  });

  it('keeps the active item in the top part', () => {
    wrap(<List keepIds={['i5']} />);
    expect(screen.getByTestId('row-i5')).toBeInTheDocument();
    expect(screen.getByTestId('rows-more')).toHaveTextContent('More (3)');
  });

  it('stays expanded while the surface stays open, and collapses when it reopens', () => {
    const { rerender, unmount } = wrap(<List />);
    fireEvent.click(screen.getByTestId('rows-more'));
    rerender(<MantineProvider><DismissStackProvider><List n={3} /></DismissStackProvider></MantineProvider>);
    expect(screen.getAllByRole('button', { name: /^Item/ })).toHaveLength(7);
    unmount();
    wrap(<List />);
    expect(screen.getAllByRole('button', { name: /^Item/ })).toHaveLength(3);
  });

  it('More is a real button: keyboard activation expands', () => {
    wrap(<List />);
    const more = screen.getByTestId('rows-more');
    expect(more.tagName).toBe('BUTTON');
    more.focus();
    fireEvent.click(more); // Enter/Space on a native button fire click
    expect(screen.getAllByRole('button', { name: /^Item/ })).toHaveLength(7);
  });
});

describe('TopMoreMenu', () => {
  it('opens the rest inside the menu and focuses the first of them', async () => {
    const onExpand = vi.fn();
    wrap(
      <ActionMenu trigger={<UnstyledButton>Open</UnstyledButton>}>
        <TopMoreMenu items={items} n={3} testId="menu" onExpand={onExpand}
          renderItem={(item) => <Menu.Item key={item.id} data-testid={`mi-${item.id}`}>{item.label}</Menu.Item>} />
      </ActionMenu>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findAllByRole('menuitem', { name: /^Item/ })).toHaveLength(3);
    fireEvent.click(screen.getByTestId('menu-more'));
    expect(screen.getAllByRole('menuitem', { name: /^Item/ })).toHaveLength(7);
    expect(onExpand).toHaveBeenCalledWith({ shown: 3, hidden: 4 });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('mi-i3')));
  });
});

describe('TopMoreList stability', () => {
  it('a row once shown stays shown when it stops being kept', () => {
    const { rerender } = wrap(<List keepIds={['i5']} />);
    expect(screen.getByTestId('row-i5')).toBeInTheDocument();
    rerender(<MantineProvider><DismissStackProvider><List keepIds={[]} /></DismissStackProvider></MantineProvider>);
    expect(screen.getByTestId('row-i5')).toBeInTheDocument();
  });
});

describe('TopMoreList stable={false} (streamed, re-ranked lists such as search)', () => {
  it('shows exactly the current top n after the list re-ranks', () => {
    const { rerender } = wrap(<List stable={false} />);
    const reranked = [...items].reverse();
    rerender(<MantineProvider><DismissStackProvider><List stable={false} items={reranked} /></DismissStackProvider></MantineProvider>);
    expect(screen.getAllByRole('button', { name: /^Item/ }).map((el) => el.textContent)).toEqual(['Item 6', 'Item 5', 'Item 4']);
  });
});
