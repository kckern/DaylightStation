import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { describe, expect, test, vi } from 'vitest';
import { DismissStackProvider } from '@/lib/ui/dismiss/DismissStackProvider.jsx';
import { useDismissLayer } from '@/lib/ui/dismiss/useDismissLayer.js';
import DetailModal from "./DetailModal.jsx";

vi.mock("./DetailView.jsx", () => ({
  default: ({ renderDialog }) => renderDialog(<><button>First action</button><button>Last action</button></>),
}));

describe('DetailModal', () => {
  test('contains Tab and handles Escape without a dismiss provider', async () => {
    const onBack = vi.fn();
    render(<DetailModal item={{ title: 'Story detail' }} sections={[]} onBack={onBack} />);

    const dialog = screen.getByRole('dialog', { name: 'Story detail' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    const first = screen.getByRole('button', { name: 'First action' });
    const last = screen.getByRole('button', { name: 'Last action' });
    await waitFor(() => expect(first).toHaveFocus());
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(first).toHaveFocus();

    fireEvent.keyDown(first, { key: 'Escape' });
    expect(onBack).toHaveBeenCalledOnce();
  });

  test('gives Escape to a newer portal and uses the current Back action without refocusing', async () => {
    const originalBack = vi.fn();
    const currentBack = vi.fn();
    const dismissPortal = vi.fn();
    const composition = (onBack, showPortal) => (
      <DismissStackProvider>
        <DetailModal item={{ title: 'Story detail' }} sections={[]} onBack={onBack} />
        {showPortal && <PortalLayer onClose={dismissPortal} />}
      </DismissStackProvider>
    );
    const { rerender } = render(composition(originalBack, false));
    const first = screen.getByRole('button', { name: 'First action' });
    await waitFor(() => expect(first).toHaveFocus());
    const last = screen.getByRole('button', { name: 'Last action' });
    last.focus();
    rerender(composition(currentBack, false));
    expect(last).toHaveFocus();

    rerender(composition(currentBack, true));
    const portal = screen.getByRole('button', { name: 'Portal action' });
    portal.focus();
    fireEvent.keyDown(portal, { key: 'Escape' });
    await waitFor(() => expect(dismissPortal).toHaveBeenCalledOnce());
    expect(currentBack).not.toHaveBeenCalled();

    rerender(composition(currentBack, false));
    last.focus();
    fireEvent.keyDown(last, { key: 'Escape' });
    await waitFor(() => expect(currentBack).toHaveBeenCalledOnce());
    expect(originalBack).not.toHaveBeenCalled();
  });
});

function PortalLayer({ onClose }) {
  useDismissLayer(true, onClose);
  return createPortal(<button>Portal action</button>, document.body);
}
