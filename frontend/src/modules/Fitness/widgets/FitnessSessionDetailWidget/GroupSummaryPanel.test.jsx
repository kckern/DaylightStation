import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import GroupSummaryPanel from './GroupSummaryPanel.jsx';

describe('GroupSummaryPanel', () => {
  const riders = [{ id: 'milo', name: 'Milo' }, { id: 'alan', name: 'Alan' }, { id: 'felix', name: 'Felix' }];

  it('renders a rider chip (avatar + name) per participant', () => {
    const { getByText, container } = render(<GroupSummaryPanel riders={riders} segmentCount={6} sessionId="group:1" />);
    riders.forEach((r) => expect(getByText(r.name)).toBeTruthy());
    expect(container.querySelectorAll('.session-detail__summary-rider').length).toBe(3);
  });

  it('shows the sandwiched-blocks footer only when more than one block', () => {
    const { queryByText, rerender } = render(<GroupSummaryPanel riders={riders} segmentCount={6} />);
    expect(queryByText(/6 blocks/)).toBeTruthy();
    rerender(<GroupSummaryPanel riders={riders} segmentCount={1} />);
    expect(queryByText(/blocks/)).toBeNull();
  });

  it('wires the close / delete / memo affordances', () => {
    const onClose = vi.fn(); const onDelete = vi.fn(); const onAddMemo = vi.fn();
    const { getByTitle } = render(
      <GroupSummaryPanel riders={riders} segmentCount={2} onClose={onClose} onDelete={onDelete} onAddMemo={onAddMemo} />
    );
    fireEvent.click(getByTitle('Close'));
    fireEvent.click(getByTitle('Delete session'));
    fireEvent.pointerDown(getByTitle('Add voice memo to this session'));
    expect(onClose).toHaveBeenCalled();
    expect(onDelete).toHaveBeenCalled();
    expect(onAddMemo).toHaveBeenCalled();
  });
});
