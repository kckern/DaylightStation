import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GridLayout } from './GridLayout.jsx';

describe('GridLayout', () => {
  it('should render a grid container', () => {
    render(
      <GridLayout columns={2} rows={2} gap="1rem">
        <div data-testid="widget-1">Widget 1</div>
      </GridLayout>
    );

    const grid = document.querySelector('.screen-grid-layout');
    expect(grid).toHaveStyle({ display: 'grid' });
  });

  it('should apply correct grid template', () => {
    render(
      <GridLayout columns={3} rows={2} gap="1rem">
        <div>Widget</div>
      </GridLayout>
    );

    const grid = document.querySelector('.screen-grid-layout');
    const styles = window.getComputedStyle(grid);

    // Check that grid-template-columns is set (3 columns)
    expect(grid.style.gridTemplateColumns).toContain('1fr');
  });

  it('should position widgets according to row/col props', () => {
    render(
      <GridLayout columns={2} rows={2}>
        <div data-testid="widget" data-row={1} data-col={2}>Widget</div>
      </GridLayout>
    );

    const widget = screen.getByTestId('widget');
    // GridLayout should wrap children and apply positioning
    expect(widget.parentElement.style.gridRow).toBe('1');
    expect(widget.parentElement.style.gridColumn).toBe('2');
  });

  it('should handle colspan and rowspan', () => {
    render(
      <GridLayout columns={3} rows={3}>
        <div data-testid="widget" data-row={1} data-col={1} data-colspan={2} data-rowspan={2}>
          Widget
        </div>
      </GridLayout>
    );

    const wrapper = screen.getByTestId('widget').parentElement;
    expect(wrapper.style.gridColumn).toBe('1 / span 2');
    expect(wrapper.style.gridRow).toBe('1 / span 2');
  });
});
