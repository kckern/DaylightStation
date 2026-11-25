// frontend/src/lib/ui/ActionMenu.test.jsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider, Menu } from '@mantine/core';
import { DismissStackProvider } from './dismiss/DismissStackProvider.jsx';
import { AppView } from './AppFrame.jsx';
import { ActionMenu } from './ActionMenu.jsx';

function setup({ disabled = false, active = true, first = {} } = {}) {
  const ui = (a, d) => (
    <MantineProvider>
      <DismissStackProvider>
        <AppView active={a}>
          <button>before</button>
          <ActionMenu disabled={d} trigger={<button>More</button>}>
            <Menu.Item disabled={first.disabled}>First</Menu.Item>
            <Menu.Item>Second</Menu.Item>
          </ActionMenu>
          <button>after</button>
        </AppView>
      </DismissStackProvider>
    </MantineProvider>
  );
  const r = render(ui(active, disabled));
  return { ...r, again: (a, d) => r.rerender(ui(a, d)) };
}
const trigger = () => screen.getByRole('button', { name: 'More', hidden: true });

describe('ActionMenu', () => {
  it('opens on trigger click and focuses the first available action', async () => {
    setup({ first: { disabled: true } });
    fireEvent.click(trigger());
    const second = await screen.findByRole('menuitem', { name: 'Second' });
    await waitFor(() => expect(document.activeElement).toBe(second));
  });

  it('focuses the first action when it is enabled', async () => {
    setup();
    fireEvent.click(trigger());
    const first = await screen.findByRole('menuitem', { name: 'First' });
    await waitFor(() => expect(document.activeElement).toBe(first));
  });

  it('Escape closes the menu and returns focus to the trigger', async () => {
    setup();
    fireEvent.click(trigger());
    const first = await screen.findByRole('menuitem', { name: 'First' });
    await waitFor(() => expect(document.activeElement).toBe(first));
    fireEvent.keyDown(first, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: 'First' })).toBeNull());
    expect(document.activeElement).toBe(trigger());
  });

  it('Tab closes the menu and lands focus on the trigger, leaving the browser to move on', async () => {
    setup();
    fireEvent.click(trigger());
    const first = await screen.findByRole('menuitem', { name: 'First' });
    fireEvent.keyDown(first, { key: 'Tab' });
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: 'First' })).toBeNull());
    expect(document.activeElement).toBe(trigger());
  });

  it('a disabled menu never opens', () => {
    setup({ disabled: true });
    fireEvent.click(trigger());
    expect(screen.queryByRole('menuitem', { name: 'First' })).toBeNull();
  });

  it('an inactive AppView closes an open menu', async () => {
    const { again } = setup();
    fireEvent.click(trigger());
    await screen.findByRole('menuitem', { name: 'First' });
    again(false, false);
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: 'First', hidden: true })).toBeNull());
  });
});
