import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import PanelFrame from './PanelFrame.jsx';

describe('PanelFrame', () => {
  it('default: children render only on ok', () => {
    const { rerender } = render(<PanelFrame title="Things" state="ok"><p>content</p></PanelFrame>);
    expect(screen.getByText('content')).toBeTruthy();
    rerender(<PanelFrame title="Things" state="error" retry={() => {}}><p>content</p></PanelFrame>);
    expect(screen.queryByText('content')).toBeNull();
    expect(screen.getByText(/Couldn’t load Things/)).toBeTruthy();
  });

  it('alwaysRender: the form survives error and empty states, chrome above it', () => {
    const { rerender } = render(<PanelFrame title="Things" state="error" retry={() => {}} alwaysRender><p>form</p></PanelFrame>);
    expect(screen.getByText('form')).toBeTruthy();
    expect(screen.getByText(/Couldn’t load Things/)).toBeTruthy();
    rerender(<PanelFrame title="Things" state="empty" alwaysRender emptyCopy="never shown"><p>form</p></PanelFrame>);
    expect(screen.getByText('form')).toBeTruthy();
    expect(screen.queryByText('never shown')).toBeNull();
    rerender(<PanelFrame title="Things" state="loading" alwaysRender><p>form</p></PanelFrame>);
    expect(screen.queryByText('form')).toBeNull();
  });
});
