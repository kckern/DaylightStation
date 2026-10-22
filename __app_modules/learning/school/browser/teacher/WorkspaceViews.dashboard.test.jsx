/**
 * The dashboard re-reads the backlog when it opens: counts written elsewhere
 * (an inspector settle, a reprint) must not wait for the next poll.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock("./tabs/TodayTab.jsx", () => ({ default: () => null }));
const { DashboardView } = await import("./WorkspaceViews.jsx");

describe('DashboardView', () => {
  it('refreshes the backlog once on mount', () => {
    const backlog = { total: 0, refresh: vi.fn() };
    const { rerender } = render(<DashboardView kids={[]} backlog={backlog} onOpenQueue={() => {}} />);
    rerender(<DashboardView kids={[]} backlog={{ ...backlog }} onOpenQueue={() => {}} />);
    expect(backlog.refresh).toHaveBeenCalledTimes(1);
  });
  it('prefers refreshIfStale, so a cold load does not read the backlog twice', () => {
    const backlog = { total: 0, refresh: vi.fn(), refreshIfStale: vi.fn() };
    render(<DashboardView kids={[]} backlog={backlog} onOpenQueue={() => {}} />);
    expect(backlog.refreshIfStale).toHaveBeenCalledTimes(1);
    expect(backlog.refresh).not.toHaveBeenCalled();
  });
  it('renders without a backlog', () => {
    expect(() => render(<DashboardView kids={[]} onOpenQueue={() => {}} />)).not.toThrow();
  });
});
