import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToolCallAttribution } from './ToolCallAttribution.jsx';

describe('ToolCallAttribution', () => {
  it('renders nothing when toolCalls is empty', () => {
    const { container } = render(<ToolCallAttribution toolCalls={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders one row per tool call with name and latency', () => {
    render(<ToolCallAttribution toolCalls={[
      { toolName: 'metric_trajectory', args: { x: 1 }, result: { y: 2 }, latencyMs: 9, status: 'done' },
      { toolName: 'aggregate_metric', args: {}, result: {}, latencyMs: 12, status: 'done' },
    ]} />);
    expect(screen.getByText(/metric_trajectory/)).toBeInTheDocument();
    expect(screen.getByText(/aggregate_metric/)).toBeInTheDocument();
    expect(screen.getByText(/9ms/)).toBeInTheDocument();
  });

  it('shows "running…" indicator for in-flight calls', () => {
    render(<ToolCallAttribution toolCalls={[
      { toolName: 'slow_tool', args: {}, status: 'running' },
    ]} />);
    expect(screen.getByText(/running/)).toBeInTheDocument();
  });

  it('expands to show args and result on click', () => {
    render(<ToolCallAttribution toolCalls={[
      { toolName: 'foo', args: { a: 1 }, result: { b: 2 }, latencyMs: 5, status: 'done' },
    ]} />);
    fireEvent.click(screen.getByText(/foo/));
    expect(screen.getByText(/"a": 1/)).toBeInTheDocument();
    expect(screen.getByText(/"b": 2/)).toBeInTheDocument();
  });
});
