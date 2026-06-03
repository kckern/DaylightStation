import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import PanelSlot from './PanelSlot.jsx';

function Probe({ zoneBox }) {
  return <div data-testid="probe">{zoneBox ? `${zoneBox.width}x${zoneBox.height}` : 'no-box'}</div>;
}

describe('PanelSlot', () => {
  it('injects a zoneBox prop into its panel child', () => {
    const { getByTestId } = render(
      <PanelSlot panelId="distanceChart"><Probe /></PanelSlot>
    );
    expect(getByTestId('probe').textContent).toBe('0x0');
  });
  it('keeps the data-panel attribute on the slot element', () => {
    const { container } = render(<PanelSlot panelId="rankings"><Probe /></PanelSlot>);
    expect(container.querySelector('[data-panel="rankings"]')).toBeTruthy();
  });
});
